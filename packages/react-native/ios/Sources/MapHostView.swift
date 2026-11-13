import Foundation
@_spi(TileflowReactNative) import Tileflow
import UIKit

@MainActor
@objc(TFMapHostView)
public final class TFMapHostView: UIView {
  private struct Key: Hashable { let tag: Int; let instance: String }
  private final class WeakHost {
    weak var view: TFMapHostView?
    init(_ view: TFMapHostView) { self.view = view }
  }
  private struct Pending { let method: String; let task: Task<Void, Never> }
  private static var registry: [Key: WeakHost] = [:]

  private var key: Key?
  private(set) var instanceID = ""
  private(set) var generation = 0
  private(set) var map: TileflowMapView?
  private let applicationContent = MapApplicationContent()
  private var source: TileflowMapSource?
  private var pending: [UUID: Pending] = [:]
  private var propsTask: Task<Void, Never>?
  private var propsRevision = 0
  private var options = TileflowMapOptions()
  private var baseInsets: UIEdgeInsets = .zero
  private var declaredInsets: UIEdgeInsets?
  private var deferredProps: (() -> Void)?
  private var locationInput: BridgeObject?
  private var points: TileflowPointAnnotationManager?
  private var markers: [TFMarkerBinding] = []
  private var gestures: Set<String> = []
  private var relay: MapLocationRelay?
  var loadImages: ([Any]) async throws -> [TileflowMapImage] = MapImageLoader.images
  private lazy var defaultPointImage: TileflowPointAnnotation.Image = {
    let image = UIGraphicsImageRenderer(size: CGSize(width: 16, height: 16)).image { context in
      let circle = CGRect(x: 2, y: 2, width: 12, height: 12)
      UIColor(red: 233 / 255, green: 87 / 255, blue: 63 / 255, alpha: 1).setFill()
      context.cgContext.fillEllipse(in: circle)
      UIColor.white.setStroke()
      context.cgContext.setLineWidth(2)
      context.cgContext.strokeEllipse(in: circle)
    }
    return .init(image: image, name: "rn-point-\(UUID().uuidString)")
  }()

  @objc public var eventHandler: ((String, String, String) -> Void)?

  @objc(updateWithReactTag:instanceId:sourceJSON:appearanceJSON:optionsJSON:)
  public func update(reactTag: Double, instanceID: String, sourceJSON: String, appearanceJSON: String, optionsJSON: String) {
    guard let tag = Int(exactly: reactTag), tag > 0, !instanceID.isEmpty else { return }
    let nextKey = Key(tag: tag, instance: instanceID)
    if self.instanceID != instanceID || key.map({ $0 != nextKey }) == true {
      retireMap()
      self.instanceID = instanceID
    }
    if key != nextKey {
      unregister()
      key = nextKey
      Self.registry[nextKey] = WeakHost(self)
    }
    guard !sourceJSON.isEmpty else { return }
    if map == nil, bounds.width <= 0 || bounds.height <= 0 {
      deferredProps = { [weak self] in
        self?.update(reactTag: reactTag, instanceID: instanceID, sourceJSON: sourceJSON,
          appearanceJSON: appearanceJSON, optionsJSON: optionsJSON)
      }
      return
    }
    deferredProps = nil
    do {
      let input = try MapBridgeValues.object(optionsJSON)
      let appearance = try MapBridgeValues.object(appearanceJSON)
      let nextSource = try MapBridgeValues.source(MapBridgeValues.object(sourceJSON), surfaceID: input.optionalString("surfaceId"))
      var nextOptions = try MapBridgeValues.options(input)
      nextOptions.location = options.location
      nextOptions.viewMode = try appearance.choice("viewMode", TileflowViewMode.self) ?? .flat
      let nextInsets = try MapBridgeValues.padding(input.optionalObject("contentInset"))
      if declaredInsets != nextInsets {
        declaredInsets = nextInsets
        setPadding(nextInsets)
      }
      options = nextOptions
      if map == nil {
        let initial = try input.optionalObject("initialCamera")
        let fit = try initial?.optionalObject("bounds").map(MapBridgeValues.bounds)
        let padding = try MapBridgeValues.padding(initial?.optionalObject("padding"))
        let created = TileflowMapView(source: nextSource, theme: try appearance.optionalString("theme"),
          initialCameraUpdate: try initial.map(MapBridgeValues.camera) ?? .init(),
          initialCameraBounds: fit, initialCameraPadding: padding, options: nextOptions)
        if fit == nil, initial?.has("padding") == true { baseInsets = padding }
        created.automaticallyAdjustsContentInsets = false
        created.contentInsets = baseInsets
        created.frame = bounds
        created.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        map = created
        let relay = MapLocationRelay()
        relay.onLocation = { [weak self] location in
          guard let self, (try? self.locationInput?.bool("emitsUpdates", default: false)) == true else { return }
          self.emit("locationUpdated", value: MapBridgeValues.locationEvent(location), generation: self.generation)
        }
        self.relay = relay
        created.locationProvider = relay
        created.onEvent = { [weak self, weak created] event in
          guard let self, self.map === created else { return }
          self.receive(event)
        }
        insertSubview(created, at: 0)
        created.installApplicationOverlay(applicationContent)
        for marker in markers { marker.attach(to: self) }
      } else if source != nextSource {
        generation += 1
        cancelPending()
        try map?.setSource(nextSource)
      }
      source = nextSource
      propsRevision += 1
      let revision = propsRevision, current = generation
      propsTask?.cancel()
      propsTask = Task { [weak self] in
        guard let self else { return }
        do {
          let map = try self.requireMap(current)
          try await map.setOptions(nextOptions)
          guard revision == self.propsRevision else { return }
          try self.checkGeneration(current)
          let duration = try MapBridgeValues.themeDuration(appearance)
          if let input = try appearance.optionalObject("themeBlend") {
            let blend = try MapBridgeValues.blend(input)
            try await map.setBlend(themes: blend.themes, position: blend.position, hold: blend.hold, duration: duration)
          } else {
            try await map.setTheme(appearance.optionalString("theme"),
              timeOfDay: appearance.choice("timeOfDay", TileflowTimeOfDay.self), duration: duration)
          }
          guard revision == self.propsRevision else { return }
          if let location = self.locationInput { try await self.setUserLocation(location, generation: current) }
        } catch {
          guard revision == self.propsRevision, !Task.isCancelled else { return }
          self.emitFailure(error, generation: current)
        }
      }
    } catch { emitFailure(error, generation: generation) }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    map?.frame = bounds
    if bounds.width > 0, bounds.height > 0, let update = deferredProps {
      deferredProps = nil
      update()
    }
  }

  @objc public func dispose() {
    unregister()
    retireMap()
    markers.removeAll()
    instanceID = ""
    eventHandler = nil
  }

  private func unregister() {
    if let key, Self.registry[key]?.view === self { Self.registry.removeValue(forKey: key) }
    key = nil
  }

  private func retireMap() {
    generation += 1
    propsRevision += 1
    propsTask?.cancel()
    propsTask = nil
    cancelPending()
    for marker in markers { marker.detachAnnotation() }
    points = nil
    relay?.dispose()
    relay = nil
    map?.onEvent = nil
    map?.destroy()
    map?.removeFromSuperview()
    map = nil
    source = nil
    locationInput = nil
    declaredInsets = nil
    deferredProps = nil
    options = TileflowMapOptions()
    gestures.removeAll()
  }

  private func cancelPending() {
    for call in pending.values { call.task.cancel() }
    pending.removeAll()
  }

  func stopAnimations() {
    for call in pending.values where call.method == "playShot" || call.method == "animateLineProgress" { call.task.cancel() }
  }

  func checkGeneration(_ value: Int) throws {
    guard value == generation, map != nil, !instanceID.isEmpty else { throw TileflowMapError.disposed }
    try Task.checkCancellation()
  }

  func requireMap(_ value: Int) throws -> TileflowMapView {
    try checkGeneration(value)
    guard let map else { throw TileflowMapError.notReady }
    return map
  }

  @objc(callWithReactTag:instanceId:method:payload:resolve:reject:)
  public static func call(reactTag: Double, instanceID: String, method: String, payload: String,
    resolve: @escaping TFBridgeResolve, reject: @escaping TFBridgeReject)
  {
    guard let tag = Int(exactly: reactTag), let host = registry[Key(tag: tag, instance: instanceID)]?.view,
      host.instanceID == instanceID, host.map != nil
    else {
      let error = MapBridgeValues.failure(TileflowMapError.disposed)
      reject(error.code, error.message, error.info)
      return
    }
    let current = host.generation, id = UUID()
    if method == "setImages" {
      for call in host.pending.values where call.method == method { call.task.cancel() }
    }
    let task = Task { [weak host] in
      guard let host else { reject("disposed", "The map was disposed.", ["recoverable": false]); return }
      do {
        try host.checkGeneration(current)
        let value = try await MapBridgeOperations.call(method, input: MapBridgeValues.object(payload), host: host, generation: current)
        try host.checkGeneration(current)
        resolve(try MapBridgeValues.json(value))
      } catch {
        let error = MapBridgeValues.failure(host.generation == current ? error : TileflowMapError.disposed)
        reject(error.code, error.message, error.info)
      }
      host.pending.removeValue(forKey: id)
    }
    host.pending[id] = Pending(method: method, task: task)
  }

  func emit(_ type: String, value: Any, generation: Int) {
    guard generation == self.generation, !instanceID.isEmpty, let payload = try? MapBridgeValues.json(value) else { return }
    eventHandler?(instanceID, type, payload)
  }

  private func emitFailure(_ error: Error, generation: Int) {
    let error = MapBridgeValues.failure(error)
    emit("failed", value: error.info.merging(["code": error.code, "message": error.message]) { _, value in value }, generation: generation)
  }

  private func receive(_ event: TileflowMapEvent) {
    let current = generation
    switch event {
    case .loading: emit("loading", value: [:], generation: current)
    case .contentReady:
      emit("contentReady", value: [:], generation: current)
      if let locationInput {
        Task { [weak self] in try? await self?.setUserLocation(locationInput, generation: current) }
      }
    case .cameraChanged(let change):
      if let value = MapBridgeValues.cameraEvent(change, gestureActive: !gestures.isEmpty,
        timestamp: Date().timeIntervalSince1970 * 1000) { emit("cameraChanged", value: value, generation: current) }
    case .gestureStarted(let gesture): gestures.insert(gesture.rawValue)
    case .gestureEnded(let gesture): gestures.remove(gesture.rawValue)
    case .tap(let touch): emit("tap", value: MapBridgeValues.touch(touch.coordinate, point: touch.point), generation: current)
    case .longPress(let touch): emit("longPress", value: MapBridgeValues.touch(touch.coordinate, point: touch.point), generation: current)
    case .poiActivated(let poi):
      var value: [String: Any] = ["coordinate": [poi.coordinate.longitude, poi.coordinate.latitude], "category": poi.category]
      value["id"] = poi.id
      value["name"] = poi.name
      emit("poiActivated", value: value, generation: current)
    case .annotationActivated(let id, let coordinate):
      emit("annotationActivated", value: ["id": id, "coordinate": [coordinate.longitude, coordinate.latitude]], generation: current)
    case .themeChanged(let theme): emit("themeChanged", value: ["theme": theme], generation: current)
    case .themeTransition(let transition): emit("themeTransition", value: BridgeJSON.encode(transition) ?? [:], generation: current)
    case .warning(let warning):
      let error = MapBridgeValues.failure(warning.error)
      emit("warning", value: error.info.merging(["code": error.code, "message": error.message, "occurrences": warning.occurrences]) { _, value in value }, generation: current)
    case .failed(let error): emitFailure(error, generation: current)
    case .followModeChanged(let change): emit("followModeChanged", value: ["mode": change.mode.rawValue, "reason": change.reason.rawValue], generation: current)
    case .externalLinkRequested(let url): emit("externalLinkRequested", value: ["url": url.absoluteString], generation: current)
    case .recenterRequested: emit("recenterRequested", value: [:], generation: current)
    }
  }

  func setPointAnnotations(_ values: [Any], generation: Int) throws {
    let map = try requireMap(generation)
    let annotations = try values.map { value -> TileflowPointAnnotation in
      let input = try BridgeObject(value)
      var annotation = TileflowPointAnnotation(id: try input.string("id"), coordinate: try MapBridgeValues.coordinate(input.array("coordinate")))
      annotation.iconImage = try input.optionalString("iconImage")
      if annotation.iconImage == nil { annotation.image = defaultPointImage }
      annotation.iconSize = try input.optionalDouble("iconSize")
      annotation.iconRotate = try input.optionalDouble("iconRotate")
      if let color = try input.optionalString("iconColor") {
        guard let parsed = TileflowColor(hex: color) else { throw TileflowMapError.invalidRequest }
        annotation.iconColor = parsed
      }
      annotation.isDraggable = try input.bool("draggable", default: false)
      annotation.accessibilityLabel = try input.optionalString("accessibilityLabel")
      let id = annotation.id
      annotation.tapHandler = { [weak self, weak map] context in
        guard let self, self.map === map else { return false }
        self.annotationEvent(id: id, context: context)
        return true
      }
      annotation.dragBeginHandler = { [weak self, weak map] _, context in
        guard let self, self.map === map else { return }
        self.annotationEvent(id: id, context: context, phase: "started")
      }
      annotation.dragChangeHandler = { [weak self, weak map] _, context in
        guard let self, self.map === map else { return }
        self.annotationEvent(id: id, context: context, phase: "moving")
      }
      annotation.dragEndHandler = { [weak self, weak map] _, context in
        guard let self, self.map === map else { return }
        self.annotationEvent(id: id, context: context, phase: "ended")
      }
      return annotation
    }
    guard Set(annotations.map(\.id)).count == annotations.count else { throw TileflowMapError.invalidRequest }
    if points == nil { points = map.annotations.makePointAnnotationManager() }
    points?.annotations = annotations
  }

  func installImages(_ images: [TileflowMapImage], generation: Int) async throws {
    let map = try requireMap(generation)
    var images = images
    if points?.annotations.contains(where: { $0.image?.name == defaultPointImage.name }) == true {
      images.append(try TileflowMapImage(name: defaultPointImage.name, image: defaultPointImage.image))
    }
    try await map.setImages(images)
  }

  func setPadding(_ padding: UIEdgeInsets) {
    baseInsets = padding
    map?.contentInsets = padding
  }

  private func annotationEvent(id: String, context: TileflowAnnotationInteractionContext, phase: String? = nil) {
    var payload: [String: Any] = ["id": id, "coordinate": [context.coordinate.longitude, context.coordinate.latitude]]
    payload["phase"] = phase
    emit(phase == nil ? "annotationActivated" : "annotationDragged", value: payload, generation: generation)
  }

  func setUserLocation(_ input: BridgeObject, generation: Int) async throws {
    let map = try requireMap(generation)
    let visible = try input.bool("visible", default: false)
    let follows = try input.bool("followUserLocation", default: false)
    let consumes = try visible || input.bool("emitsUpdates", default: false) || follows
    var next = options
    next.location.enabled = consumes
    next.location.showsPuck = visible
    next.location.puckBearing = try input.bool("followsCourse", default: false) ? .course :
      (input.bool("showsUserHeadingIndicator", default: false) ? .heading : .none)
    next.location.followZoom = try input.optionalDouble("followZoomLevel")
    let padding = try follows ? (input.optionalObject("followPadding").map { try MapBridgeValues.padding($0) } ?? baseInsets) : baseInsets
    let pitch = try input.optionalDouble("followPitch")
    let mode: TileflowFollowMode
    switch try input.optionalString("followUserMode") ?? "normal" {
    case "normal": mode = .position
    case "compass": mode = .heading
    case "course": mode = .course
    default: throw BridgeArgumentError(path: "followUserMode", expected: "normal, compass or course")
    }
    locationInput = input
    try await map.setOptions(next)
    try checkGeneration(generation)
    options = next
    map.contentInsets = padding
    if follows, let pitch, map.currentCamera != nil {
      let movement = try await map.move(to: TileflowCameraUpdate(pitch: pitch))
      try checkGeneration(generation)
      guard movement == .finished else { return }
    }
    map.followMode = follows ? mode : .none
  }

  @objc public func addMarker(_ marker: TFMarkerBinding) {
    if !markers.contains(where: { $0 === marker }) { markers.append(marker) }
    marker.attach(to: self)
  }

  @objc public func removeMarker(_ marker: TFMarkerBinding) {
    markers.removeAll { $0 === marker }
    marker.detachAnnotation()
  }

  @objc(mountContent:index:)
  public func mountContent(_ content: UIView, index: Int) {
    applicationContent.insertSubview(content, at: index)
  }
}

@MainActor
private final class MapLocationRelay: TileflowLocationProvider, TileflowLocationConsumer {
  private final class WeakConsumer {
    weak var value: (any TileflowLocationConsumer)?
    init(_ value: any TileflowLocationConsumer) { self.value = value }
  }
  private let provider = TileflowDefaultLocationProvider()
  private var consumers: [WeakConsumer] = []
  var onLocation: ((TileflowLocation) -> Void)?

  func addConsumer(_ consumer: any TileflowLocationConsumer) {
    consumers.removeAll { $0.value == nil }
    guard !consumers.contains(where: { $0.value === consumer }) else { return }
    consumers.append(WeakConsumer(consumer))
    provider.addConsumer(self)
    if let latest = provider.latestLocation { consumer.locationUpdated(latest) }
    if let heading = provider.latestHeading { consumer.headingUpdated(heading) }
  }

  func removeConsumer(_ consumer: any TileflowLocationConsumer) {
    consumers.removeAll { $0.value == nil || $0.value === consumer }
    if consumers.isEmpty { provider.removeConsumer(self) }
  }

  func locationUpdated(_ location: TileflowLocation) {
    for consumer in consumers.compactMap(\.value) { consumer.locationUpdated(location) }
    onLocation?(location)
  }

  func headingUpdated(_ heading: TileflowHeading) {
    for consumer in consumers.compactMap(\.value) { consumer.headingUpdated(heading) }
  }

  func dispose() {
    provider.removeConsumer(self)
    consumers.removeAll()
    onLocation = nil
  }
}

@MainActor
private final class MapApplicationContent: UIView {
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let target = super.hitTest(point, with: event)
    return target === self ? nil : target
  }
}