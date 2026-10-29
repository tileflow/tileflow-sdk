import SwiftUI

/// A stable map view: changing callbacks or recomputing a SwiftUI body does not recreate its renderer.
///
/// With a `camera` binding the map is controlled: it writes the camera to the binding whenever
/// the application receives a camera event (each time the camera settles, and more often at
/// higher event levels), and moves when the application writes a different camera. A write in a
/// SwiftUI animation eases there; any other write jumps. Its own writes never move the map again.
@MainActor
public struct TileflowMap: UIViewRepresentable {
  public var source: TileflowMapSource
  public var theme: String?
  public var options: TileflowMapOptions
  public var controller: TileflowMapController?
  public var initialCamera: TileflowCamera?
  /// Space covered by the application at each edge, in points, such as a sheet over the map.
  public var contentInsets: UIEdgeInsets = .zero
  /// Return false to leave a touch that begins at this point to the views behind the map. Set it
  /// with ``receivesTouches(where:)``.
  public var shouldReceiveTouch: ((CGPoint) -> Bool)?
  public var onEvent: (TileflowMapEvent) -> Void
  private var camera: Binding<TileflowCamera>?

  public init(
    source: TileflowMapSource,
    theme: String? = nil,
    initialCamera: TileflowCamera? = nil,
    options: TileflowMapOptions = .init(),
    contentInsets: UIEdgeInsets = .zero,
    controller: TileflowMapController? = nil,
    onEvent: @escaping (TileflowMapEvent) -> Void = { _ in }
  ) {
    self.source = source
    self.theme = theme
    self.initialCamera = initialCamera
    self.options = options
    self.contentInsets = contentInsets
    self.controller = controller
    self.onEvent = onEvent
  }

  /// A controlled map whose camera follows `camera` and writes it back as it moves.
  public init(
    source: TileflowMapSource,
    camera: Binding<TileflowCamera>,
    theme: String? = nil,
    options: TileflowMapOptions = .init(),
    contentInsets: UIEdgeInsets = .zero,
    controller: TileflowMapController? = nil,
    onEvent: @escaping (TileflowMapEvent) -> Void = { _ in }
  ) {
    self.init(
      source: source, theme: theme, initialCamera: camera.wrappedValue, options: options,
      contentInsets: contentInsets, controller: controller, onEvent: onEvent)
    self.camera = camera
  }

  /// Leaves a touch that begins where `predicate` returns false, in the map's coordinates, to the
  /// views behind the map; for example over application content drawn on the map. Native map
  /// controls receive their touches regardless.
  public func receivesTouches(where predicate: @escaping (CGPoint) -> Bool) -> TileflowMap {
    var map = self
    map.shouldReceiveTouch = predicate
    return map
  }

  /// Shows a Hosted map. Its credential and API origin come from ``Tileflow/configuration()``;
  /// use ``TileflowMapSource/hosted(mapID:surfaceID:publicResourceOrigins:configuration:)`` to
  /// pass a configuration for this map only.
  public init(
    mapID: String,
    theme: String? = nil,
    initialCamera: TileflowCamera? = nil,
    options: TileflowMapOptions = .init(),
    contentInsets: UIEdgeInsets = .zero,
    controller: TileflowMapController? = nil,
    onEvent: @escaping (TileflowMapEvent) -> Void = { _ in }
  ) {
    self.init(
      source: .hosted(mapID: mapID), theme: theme, initialCamera: initialCamera,
      options: options, contentInsets: contentInsets, controller: controller, onEvent: onEvent)
  }

  public func makeUIView(context: Context) -> TileflowMapView {
    let view = TileflowMapView(
      source: source, theme: theme, initialCamera: initialCamera, options: options)
    view.onEvent = events(context.coordinator)
    view.contentInsets = contentInsets
    view.shouldReceiveTouch = shouldReceiveTouch
    context.coordinator.theme = theme
    context.coordinator.options = options
    context.coordinator.camera = camera?.wrappedValue
    context.coordinator.bind(controller, to: view)
    return view
  }

  /// Writes the camera the application receives to the binding before the application sees it.
  private func events(_ coordinator: Coordinator) -> (TileflowMapEvent) -> Void {
    let onEvent = onEvent
    guard let camera else { return onEvent }
    return { event in
      if case .cameraChanged(let change) = event {
        coordinator.camera = change.camera
        if change.camera != camera.wrappedValue { camera.wrappedValue = change.camera }
      }
      onEvent(event)
    }
  }

  public func updateUIView(_ view: TileflowMapView, context: Context) {
    view.onEvent = events(context.coordinator)
    view.contentInsets = contentInsets
    view.shouldReceiveTouch = shouldReceiveTouch
    context.coordinator.bind(controller, to: view)
    if let target = camera?.wrappedValue, target != context.coordinator.camera {
      context.coordinator.camera = target
      let animation: TileflowCameraAnimation =
        context.transaction.animation == nil || context.transaction.disablesAnimations
        ? .none : .ease()
      Task { @MainActor [weak view] in
        do { try await view?.move(to: target, animation: animation) } catch {
          view?.report(propertyError: error)
        }
      }
    }
    do { try view.setSource(source) } catch {
      onEvent(.failed(error as? TileflowMapError ?? .invalidSource))
    }
    // Apply a prop only when it changes, so a controller's own changes survive later updates.
    if context.coordinator.theme != theme {
      context.coordinator.theme = theme
      Task { @MainActor [weak view] in
        do { try await view?.setTheme(theme) } catch {
          view?.report(propertyError: error)
        }
      }
    }
    if context.coordinator.options != options {
      context.coordinator.options = options
      Task { @MainActor [weak view] in
        do { try await view?.setOptions(options) } catch {
          view?.report(propertyError: error)
        }
      }
    }
  }

  public func makeCoordinator() -> Coordinator { Coordinator() }

  @MainActor
  public final class Coordinator {
    private var controller: TileflowMapController?
    /// The prop values last applied, not the view's current state.
    fileprivate var theme: String?
    fileprivate var options: TileflowMapOptions?
    /// The camera the binding and the map last agreed on.
    fileprivate var camera: TileflowCamera?
    fileprivate func bind(_ next: TileflowMapController?, to view: TileflowMapView) {
      guard controller !== next else { return }
      controller?.detach(view)
      controller = next
      do { try next?.attach(view) } catch { view.onEvent?(.failed(.invalidRequest)) }
    }
  }

  public static func dismantleUIView(_ view: TileflowMapView, coordinator: Coordinator) {
    coordinator.bind(nil, to: view)
    view.destroy()
  }
}

extension TileflowMapView {
  /// A property the view applies again to its next renderer is not lost when the call that
  /// carried it is cancelled by a renderer replacement.
  func report(propertyError error: any Error) {
    let error = error as? TileflowMapError ?? .rendererFailed
    guard error != .cancelled else { return }
    onEvent?(.failed(error))
  }
}
