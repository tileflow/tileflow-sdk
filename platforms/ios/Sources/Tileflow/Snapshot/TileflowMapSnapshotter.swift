@preconcurrency import MapLibre
import UIKit

/// The source's authored camera and default theme are used when the corresponding options are nil.
public struct TileflowMapSnapshotOptions: Sendable {
  /// Logical size in points. Scale must be at least one. Each physical edge (points × scale)
  /// must measure 1 through 4096 pixels.
  public var size: CGSize
  public var scale: CGFloat
  public var camera: TileflowCamera?
  public var theme: String?
  public var content: TileflowMapSnapshotContent

  public init(
    size: CGSize, scale: CGFloat = 1, camera: TileflowCamera? = nil, theme: String? = nil,
    content: TileflowMapSnapshotContent = .init()
  ) {
    self.size = size
    self.scale = scale
    self.camera = camera
    self.theme = theme
    self.content = content
  }

  func validate() throws {
    let width = size.width * scale
    let height = size.height * scale
    guard scale.isFinite, scale >= 1, width.isFinite, height.isFinite,
      (1...4096).contains(width), (1...4096).contains(height)
    else { throw TileflowMapError.invalidRequest }
    if let camera { try camera.validate() }
    for image in content.images { try image.validate() }
  }
}

/// Draws a map with its attribution, independent of any mounted view. Cancelling the task cancels
/// the render. A Hosted map uses its downloaded regions when the network is disabled.
@MainActor
public final class TileflowMapSnapshotter {
  public init() {}

  public func snapshot(_ source: TileflowMapSource, options: TileflowMapSnapshotOptions)
    async throws -> UIImage
  {
    try options.validate()
    try Task.checkCancellation()
    let map = try source.loadable()
    let session = map.makeSession()
    let loader = map.makeLoader(session: session)
    let route = SnapshotResources(loader)
    let owner = MapResourceContexts.shared.register(
      .init(loader: route, classify: route.kind, report: route.report))
    let close: @Sendable () -> Void = {
      MapResourceContexts.shared.retire(owner)
      session?.close()
      loader.close()
    }
    defer { close() }
    return try await withTaskCancellationHandler {
      try Task.checkCancellation()
      do {
        return try await render(map, options: options, loader: loader, route: route, owner: owner)
      } catch {
        try Task.checkCancellation()
        throw error as? TileflowMapError ?? TileflowMapError(.rendererFailed)
      }
    } onCancel: {
      close()
    }
  }

  private func render(
    _ map: LoadableMapSource, options: TileflowMapSnapshotOptions, loader: ResourceLoader,
    route: SnapshotResources, owner: String
  ) async throws -> UIImage {
    try await MapLibreNetwork.prepare()
    let fromPacks =
      map.grantScope != nil
      && OfflineServingRule.hostedUsesPacks(
        networkEnabled: TileflowHTTPClient.shared.isNetworkEnabled,
        reachable: OfflineReachability.shared.isReachable)
    let storedZooms: NativeStyleDocument.StoredZooms?
    if let scope = map.grantScope, fromPacks {
      storedZooms = { template in
        await OfflineServingIndex.shared.storedZooms(template: template, scope: scope)
      }
    } else {
      storedZooms = nil
    }
    let scheme = UITraitCollection.current.userInterfaceStyle == .dark ? "dark" : "light"
    let prepared = try await NativeMapPreparation(
      loader: loader, context: owner, storedZooms: storedZooms
    )
    .map(
      map.map, manifestURL: map.manifestURL, discoveryMapID: map.mapID, theme: options.theme,
      colorScheme: scheme, fromPacks: fromPacks)
    let family: NativeFamily?
    if options.content.overlays.contains(where: { $0.ink != nil }) {
      family = await NativeFamily.load(
        prepared.manifest, styleURL: prepared.theme.styleURL, loader: loader)
    } else {
      family = nil
    }
    let content = try options.content.apply(to: prepared, scheme: scheme, family: family)
    route.set(url: prepared.theme.styleURL, json: content.json, style: prepared.projected)
    guard
      let local = MapResourceAddress.encode(prepared.theme.styleURL.absoluteString, context: owner)
        .flatMap(URL.init(string:))
    else { throw TileflowMapError.invalidSource }

    let camera = options.camera ?? prepared.manifest.view
    let center = CLLocationCoordinate2D(latitude: camera.latitude, longitude: camera.longitude)
    let viewpoint = MLNMapCamera(
      lookingAtCenter: center, altitude: 0, pitch: camera.pitch, heading: camera.bearing)
    let native = MLNMapSnapshotOptions(styleURL: local, camera: viewpoint, size: options.size)
    native.zoomLevel = camera.zoom
    native.scale = options.scale
    native.showsLogo = false
    native.showsAttribution = false

    var attribution = MapAttribution()
    attribution.sources = prepared.projected.attributions
    attribution.notices = MapAttribution.notices(prepared.document.value)
    if let scope = map.grantScope {
      attribution.obligations = await OfflineServingIndex.shared.obligations(for: scope).map(
        MapAttributionObligation.init)
      attribution.credits = await OfflineServingIndex.shared.credits(for: scope).map(
        MapAttributionCredit.init)
    }

    let job = SnapshotRender(options: native, images: content.images)
    let image = try await job.render()
    try Task.checkCancellation()
    attribution.fairUse = route.notice
    return try SnapshotAttribution.draw(image, model: attribution, options: options)
  }
}

/// Only the projected style changes. Every other request streams from the map's normal loader.
private final class SnapshotResources: ResourceLoading, Sendable {
  private let loader: ResourceLoader
  private let style = LockedValue<(url: URL, bytes: Data, projected: ProjectedStyle)?>(nil)
  private let fairUse = LockedValue(MapFairUseState())

  init(_ loader: ResourceLoader) { self.loader = loader }

  func set(url: URL, json: String, style projected: ProjectedStyle) {
    style.withLock { $0 = (url, Data(json.utf8), projected) }
  }

  func kind(_ url: URL) -> TileflowResourceKind {
    style.withLock { value in
      if url == value?.url { return .style }
      return value?.projected.kind(of: url) ?? .tile
    }
  }

  func report(_ outcome: MapResourceOutcome) {
    if let signal = outcome.fairUse { fairUse.withLock { _ = $0.receive(signal) } }
  }

  var notice: MapFairUseNotice? { fairUse.withLock { $0.notice } }

  func load(_ request: URLRequest) async throws -> ResourcePayload {
    if let bytes = style.withLock({ $0?.url == request.url ? $0?.bytes : nil }) {
      return ResourcePayload(
        bytes: bytes, status: 200,
        headers: ["Content-Type": "application/json", "Cache-Control": "no-store"])
    }
    return try await loader.load(request)
  }

  func open(_ request: URLRequest) async throws -> ResourceResponse {
    if style.withLock({ $0?.url == request.url }) {
      let snapshot = try await load(request)
      return ResourceResponse(
        status: snapshot.status, headers: snapshot.headers,
        body: .data(request.httpMethod == "HEAD" ? Data() : snapshot.bytes))
    }
    return try await loader.open(request)
  }
}

/// Owns one cancellable callback and the image registrations needed by its style.
@MainActor
private final class SnapshotRender: NSObject, @preconcurrency MLNMapSnapshotterDelegate {
  /// MapLibre hands the completed, immutable snapshot to the main queue.
  private struct ResultImage: @unchecked Sendable { let value: MLNMapSnapshot }
  private let renderer: MLNMapSnapshotter
  private let images: [String: UIImage]
  private var waiting: CheckedContinuation<ResultImage, any Error>?

  init(options: MLNMapSnapshotOptions, images: [String: UIImage]) {
    renderer = MLNMapSnapshotter(options: options)
    self.images = images
    super.init()
    renderer.delegate = self
  }

  func render() async throws -> MLNMapSnapshot {
    try Task.checkCancellation()
    let result: ResultImage = try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        waiting = continuation
        renderer.start { [weak self] snapshot, _ in
          let received = snapshot.map { ResultImage(value: $0) }
          Task { @MainActor in
            guard let self else { return }
            if let received {
              self.finish(.success(received))
            } else {
              self.finish(.failure(TileflowMapError(.rendererFailed)))
            }
          }
        }
      }
    } onCancel: {
      Task { @MainActor in
        self.renderer.cancel()
        self.finish(.failure(CancellationError()))
      }
    }
    return result.value
  }

  private func finish(_ result: Result<ResultImage, any Error>) {
    let pending = waiting
    waiting = nil
    pending?.resume(with: result)
  }

  func mapSnapshotter(_ snapshotter: MLNMapSnapshotter, didFinishLoading style: MLNStyle) {
    for (name, image) in images { style.setImage(image, forName: name) }
  }
}

@MainActor
private enum SnapshotAttribution {
  static func draw(
    _ snapshot: MLNMapSnapshot, model: MapAttribution, options: TileflowMapSnapshotOptions
  ) throws -> UIImage {
    let size = options.size
    let bounds = SnapshotBounds.measure(width: size.width, height: size.height) { x, y in
      let point = snapshot.coordinate(for: CGPoint(x: x, y: y))
      return TileflowCoordinate(longitude: point.longitude, latitude: point.latitude)
    }
    let text = model.entries(in: bounds).map(\.text).joined(separator: " · ")
    if text.isEmpty && options.content.images.isEmpty { return snapshot.image }
    let attributes: [NSAttributedString.Key: Any] = [
      .font: UIFont.systemFont(ofSize: 10), .foregroundColor: UIColor.black,
    ]
    let width = size.width - 8
    guard text.isEmpty || width > 0 else { throw TileflowMapError.invalidRequest }
    let height =
      text.isEmpty
      ? 0
      : ceil(
        (text as NSString).boundingRect(
          with: CGSize(width: width, height: .greatestFiniteMagnitude),
          options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes, context: nil
        ).height)
    guard text.isEmpty || height + 4 <= size.height else { throw TileflowMapError.invalidRequest }
    let format = UIGraphicsImageRendererFormat()
    format.scale = options.scale
    return UIGraphicsImageRenderer(size: size, format: format).image { renderer in
      snapshot.image.draw(at: .zero)
      for image in options.content.images { image.draw(in: snapshot) }
      guard !text.isEmpty else { return }
      let y = size.height - height - 4
      renderer.cgContext.setFillColor(UIColor.white.withAlphaComponent(0.9).cgColor)
      renderer.cgContext.fill(CGRect(x: 0, y: y, width: size.width, height: height + 4))
      (text as NSString).draw(
        with: CGRect(x: 4, y: y + 2, width: width, height: height),
        options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes, context: nil)
    }
  }
}
