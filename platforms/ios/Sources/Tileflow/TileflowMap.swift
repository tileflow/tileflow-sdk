import SwiftUI

/// A stable map view: changing callbacks or recomputing a SwiftUI body does not recreate its renderer.
@MainActor
public struct TileflowMap: UIViewRepresentable {
  public var source: TileflowMapSource
  public var theme: String?
  public var options: TileflowMapOptions
  public var controller: TileflowMapController?
  public var initialCamera: TileflowCamera?
  public var onEvent: (TileflowMapEvent) -> Void

  public init(
    source: TileflowMapSource,
    theme: String? = nil,
    initialCamera: TileflowCamera? = nil,
    options: TileflowMapOptions = .init(),
    controller: TileflowMapController? = nil,
    onEvent: @escaping (TileflowMapEvent) -> Void = { _ in }
  ) {
    self.source = source
    self.theme = theme
    self.initialCamera = initialCamera
    self.options = options
    self.controller = controller
    self.onEvent = onEvent
  }

  public func makeUIView(context: Context) -> TileflowMapView {
    let view = TileflowMapView(
      source: source, theme: theme, initialCamera: initialCamera, options: options)
    view.onEvent = onEvent
    context.coordinator.theme = theme
    context.coordinator.options = options
    context.coordinator.bind(controller, to: view)
    return view
  }

  public func updateUIView(_ view: TileflowMapView, context: Context) {
    view.onEvent = onEvent
    context.coordinator.bind(controller, to: view)
    do { try view.setSource(source) } catch {
      onEvent(.failed(error as? TileflowMapError ?? .invalidSource))
    }
    // Apply a prop only when it changes, so a controller's own changes survive later updates.
    if context.coordinator.theme != theme {
      context.coordinator.theme = theme
      Task { @MainActor [weak view] in
        do { try await view?.setTheme(theme) } catch {
          view?.onEvent?(.failed(error as? TileflowMapError ?? .rendererFailed))
        }
      }
    }
    if context.coordinator.options != options {
      context.coordinator.options = options
      Task { @MainActor [weak view] in
        do { try await view?.setOptions(options) } catch {
          view?.onEvent?(.failed(error as? TileflowMapError ?? .rendererFailed))
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
