import Foundation
import MapLibre
import UIKit

/// What a native map shows: one theme, or a blend of a family's themes.
enum NativeAppearance: Equatable {
  case theme(String)
  case blend(NativeBlend)

  /// The theme on screen; during a blend, the nearest theme.
  var theme: String {
    switch self {
    case .theme(let name): name
    case .blend(let blend): blend.themes[blend.dominant]
    }
  }
}

struct NativeBlend: Equatable {
  let group: Int
  let themes: [String]
  /// The themes as indices into the group's themes, in blend order.
  let selection: [Int]
  var position: Double
  /// The nearest theme, which symbol layers and switched values follow.
  var dominant: Int
}

/// An emphasis: how far each module recedes, how visible labels stay, and an area kept as designed.
struct NativeEmphasisRequest: Equatable {
  var recede: [String: Double]
  var labels: Double?
  var keep: JSONValue?
}

struct NativeEmphasis {
  /// The emphasis requested last, or nil for the map as designed.
  var goal: NativeEmphasisRequest?
  /// The emphasis whose values are on the map, kept while it eases out.
  var shown: NativeEmphasisRequest?
  var strength: Double = 0
  var motion: Task<Void, Never>?
}

extension NativeStyleDocument {
  /// What the engine reads from the style document MapLibre shows.
  struct Shown {
    /// Layers that stand in for the 3D scene, with their designed extrusion height and base.
    let toggles: [(id: String, height: JSONValue?, base: JSONValue?)]
    let degradations: [JSONValue]
    let omitted: [String]
    let style: [String: Any]

    init(_ style: [String: Any], omitted: [String]) {
      self.style = style
      self.omitted = omitted
      let value = JSONValue(foundation: style)
      degradations = value["metadata"]?["tileflow:nativeDegradations"]?.array ?? []
      toggles = (value["layers"]?.array ?? []).compactMap { layer in
        guard layer["metadata"]?["tileflow:3d-toggle"] != nil, let id = layer["id"]?.string else {
          return nil
        }
        return (id, layer["paint"]?["fill-extrusion-height"], layer["paint"]?["fill-extrusion-base"])
      }
    }
  }
}

/// Themes, blends, emphasis, the view mode and degradations on MapLibre Native.
extension NativeMapEngine {
  // MARK: Styles

  /// A style finished loading: the view mode, the emphasis and the degradations apply to it.
  func styleDidLoad() {
    scene.restore()
    viewModeMotion?.cancel()
    viewModeMotion = nil
    applyViewMode(factor: viewMode == "3d" ? 1 : 0)
    applyEmphasis(strength: emphasis.strength, featureData: true)
    reportDegradations()
  }

  /// Shows a style over an image of the map as drawn, then fades the image out over `duration`
  /// seconds once MapLibre has drawn the new style.
  func present(_ style: [String: Any], projected: ProjectedStyle, duration: TimeInterval)
    async throws
  {
    guard let mapView else { throw TileflowMapError.notReady }
    var cover: UIImageView?
    if styleLoaded, mapView.bounds.width > 0, mapView.bounds.height > 0 {
      // MLNMapView gives no Metal snapshot; the view hierarchy capture includes its drawing.
      let image = UIGraphicsImageRenderer(bounds: mapView.bounds).image { _ in
        _ = mapView.drawHierarchy(in: mapView.bounds, afterScreenUpdates: false)
      }
      let view = UIImageView(image: image)
      view.frame = mapView.frame
      view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      // Under the attribution, which stays shown through the change.
      container.insertSubview(view, aboveSubview: mapView)
      cover = view
    }
    defer { if retired { cover?.removeFromSuperview() } }
    do {
      try await withCheckedThrowingContinuation { (waiter: CheckedContinuation<Void, any Error>) in
        styleWaiters.append(waiter)
        show(style, projected: projected)
      }
    } catch {
      cover?.removeFromSuperview()
      throw error
    }
    await rendered(within: .seconds(5))
    guard let cover else { return }
    guard duration > 0, !retired else {
      cover.removeFromSuperview()
      return
    }
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
      UIView.animate(
        withDuration: duration, delay: 0, options: [.curveEaseInOut, .beginFromCurrentState],
        animations: { cover.alpha = 0 },
        completion: { _ in
          cover.removeFromSuperview()
          done.resume()
        })
    }
  }

  /// Waits until MapLibre draws the current style completely, at most `limit`.
  func rendered(within limit: Duration) async {
    let timeout = Task { @MainActor [weak self] in
      try? await Task.sleep(for: limit)
      self?.rendered()
    }
    await withCheckedContinuation { renderWaiters.append($0) }
    timeout.cancel()
  }

  /// MapLibre drew the style completely.
  func rendered() {
    let waiters = renderWaiters
    renderWaiters.removeAll()
    for waiter in waiters { waiter.resume() }
  }

  private func transition(
    _ phase: String, current: String?, target: String?, inks: JSONValue? = nil
  ) {
    var value: [String: JSONValue] = ["phase": .string(phase)]
    if let current { value["currentTheme"] = .string(current) }
    if let target { value["targetTheme"] = .string(target) }
    if let inks { value["routeInks"] = inks }
    onEvent?("themeTransition", .object(value))
    if phase == "ready", let current { onEvent?("themeChanged", .object(["theme": .string(current)])) }
  }

  // MARK: Themes

  func setTheme(_ payload: JSONValue) async throws -> JSONValue {
    guard let manifest else { throw TileflowMapError.notReady }
    appearanceRevision += 1
    let revision = appearanceRevision
    if let scheme = payload["colorScheme"]?.string { colorScheme = scheme }
    let theme: NativeManifest.Theme
    do {
      theme = try manifest.resolve(
        payload["theme"]?.string, colorScheme: colorScheme,
        timeOfDay: payload["timeOfDay"]?.string)
    } catch {
      throw TileflowMapError(
        .resourceFailed, context: .init(resource: .style, message: "The theme is not available."))
    }
    // The theme on screen needs no change, as when a new engine replays the view's theme.
    if shown == .theme(theme.name) {
      return .object(["status": .string("applied"), "theme": .string(theme.name)])
    }
    let current = shown?.theme
    transition("preloading", current: current, target: theme.name)
    do {
      let (style, projected) = try await loadStyle(theme.styleURL)
      guard revision == appearanceRevision, !retired else {
        return .object(["status": .string("superseded"), "theme": .string(theme.name)])
      }
      transition("applying", current: current, target: theme.name)
      shown = .theme(theme.name)
      try await present(
        style, projected: projected, duration: (payload["duration"]?.number ?? 0) / 1000)
    } catch {
      guard revision == appearanceRevision, !retired else {
        return .object(["status": .string("superseded"), "theme": .string(theme.name)])
      }
      transition("error", current: current, target: theme.name)
      throw TileflowMapError(
        .resourceFailed,
        context: .init(resource: .style, message: "The theme could not be applied."))
    }
    guard revision == appearanceRevision else {
      return .object(["status": .string("superseded"), "theme": .string(theme.name)])
    }
    transition("ready", current: theme.name, target: theme.name, inks: routeInks)
    return .object(["status": .string("applied"), "theme": .string(theme.name)])
  }

  /// The route inks of the theme on screen; during a blend, mixed at its position.
  var routeInks: JSONValue {
    switch shown {
    case .blend(let blend):
      if let inks = family?.routeInks(blend.themes, position: blend.position) { return inks }
    case .theme(let name):
      if let inks = family?.routeInks([name]) { return inks }
    case nil: break
    }
    return Self.defaultRouteInks(colorScheme)
  }

  /// Core's route inks for a colour scheme, for maps without a family document.
  static func defaultRouteInks(_ scheme: String) -> JSONValue {
    let dark = scheme == "dark"
    return .object([
      "line": .string(dark ? "#60a5fa" : "#2563eb"), "casing": .string(dark ? "#0b1220" : "#1e3a8a"),
      "core": .string("#eff6ff"), "glow": .string(dark ? "#60a5fa" : "#2563eb"),
      "alternative": .string("#64748b"), "glowOpacity": .number(dark ? 0.4 : 0.16),
      "coreOpacity": .number(dark ? 0.7 : 0),
    ])
  }

  // MARK: Blends

  /// A blend request, validated against the map's family.
  struct BlendRequest {
    let themes: [String]
    let group: Int
    let selection: [Int]
    let position: Double
    let nearest: Int
    let hold: Bool
    let duration: TimeInterval
  }

  func setBlend(_ payload: JSONValue) async throws -> JSONValue {
    let request = try blendRequest(payload)
    appearanceRevision += 1
    // A move within the blend on screen sets the values that follow the position.
    if let moved = moveBlend(request) { return moved }
    return try await loadBlend(request, revision: appearanceRevision)
  }

  private func blendRequest(_ payload: JSONValue) throws -> BlendRequest {
    guard let manifest else { throw TileflowMapError.notReady }
    guard let family else {
      throw TileflowMapError(
        .resourceFailed,
        context: .init(resource: .style, message: "The map has no native family document."))
    }
    guard let names = payload["themes"]?.array?.compactMap(\.string), names.count >= 2,
      let position = payload["position"]?.number
    else { throw TileflowMapError.invalidRequest }
    guard names.allSatisfy({ manifest.styles[$0] != nil }), let plan = family.blend(names) else {
      throw TileflowMapError(
        .invalidRequest, context: .init(message: "The blend contains themes that cannot blend."))
    }
    let at = min(Double(names.count - 1), max(0, position))
    return BlendRequest(
      themes: names, group: plan.group, selection: plan.selection, position: at,
      nearest: Int(at.rounded(.toNearestOrAwayFromZero)), hold: payload["hold"]?.bool ?? false,
      duration: (payload["duration"]?.number ?? 0) / 1000)
  }

  private func moveBlend(_ request: BlendRequest) -> JSONValue? {
    guard case .blend(let blend) = shown, blend.group == request.group,
      blend.selection == request.selection,
      let next = moved(
        blend, to: request.position, dominant: request.hold ? blend.dominant : request.nearest)
    else { return nil }
    shown = .blend(next)
    scene.blendChanged()
    applyEmphasis(strength: emphasis.strength, featureData: true)
    return .object(["status": .string("applied"), "theme": .string(request.themes[next.dominant])])
  }

  private func loadBlend(_ request: BlendRequest, revision: Int) async throws -> JSONValue {
    guard let manifest else { throw TileflowMapError.notReady }
    let target = request.themes[request.nearest]
    let superseded: JSONValue = .object(["status": .string("superseded"), "theme": .string(target)])
    let current = shown?.theme
    transition("preloading", current: current, target: target)
    do {
      let style = try await blendStyle(
        group: request.group, selection: request.selection, themes: request.themes,
        position: request.position)
      guard let context else { throw TileflowMapError.notReady }
      let projected = try await project(
        style, styleURL: try manifest.theme(target).styleURL, context: context)
      guard revision == appearanceRevision, !retired else { return superseded }
      transition("applying", current: current, target: target)
      shown = .blend(
        NativeBlend(
          group: request.group, themes: request.themes, selection: request.selection,
          position: request.position, dominant: request.nearest))
      try await present(style, projected: projected, duration: request.duration)
    } catch {
      guard revision == appearanceRevision, !retired else { return superseded }
      transition("error", current: current, target: target)
      throw TileflowMapError(
        .resourceFailed,
        context: .init(resource: .style, message: "The theme blend could not be applied."))
    }
    guard revision == appearanceRevision else { return superseded }
    transition("ready", current: target, target: target, inks: routeInks)
    return .object(["status": .string("applied"), "theme": .string(target)])
  }

  /// One style that holds a blend: the nearest theme's style with the group's planned layers and
  /// light filled at the position.
  private func blendStyle(group: Int, selection: [Int], themes: [String], position: Double)
    async throws -> [String: Any]
  {
    guard let manifest, let family else { throw TileflowMapError.notReady }
    let plan = family.groups[group]
    let dominant = Int(position.rounded(.toNearestOrAwayFromZero))
    let url = try manifest.theme(themes[dominant]).styleURL
    var style = try await Self.read(url, kind: .style, loader: loader).value
    let layers = try NativeEvaluators.blendLayers(
      group: plan, selection: selection, position: position)
    style["layers"] = layers.map(\.foundation)
    if let light = plan["light"] {
      style["light"] = try NativeEvaluators.fill(light, position: position, select: selection)
        .foundation
    }
    if case .object(let entries)? = plan["metadata"] {
      var metadata = style["metadata"] as? [String: Any] ?? [:]
      for (key, value) in entries { metadata[key] = value.foundation }
      style["metadata"] = metadata
    }
    return style
  }

  /// The blend on screen moved to a position, with each value that changes set on the live
  /// style. Nil when a value cannot be set that way, so the style loads again.
  private func moved(_ blend: NativeBlend, to position: Double, dominant: Int) -> NativeBlend? {
    guard let family, let style = mapView?.style, styleLoaded else { return nil }
    let plan = family.groups[blend.group]
    var layers: [JSONValue]
    do {
      // The planned layers at the position, with switches and symbols at the nearest theme.
      layers = try NativeEvaluators.blendLayers(
        group: plan, selection: blend.selection, position: position)
      if dominant != Int(position.rounded(.toNearestOrAwayFromZero)) {
        let held = try NativeEvaluators.blendLayers(
          group: plan, selection: blend.selection, position: Double(dominant))
        layers = zip(layers, held).map { live, held in
          held["type"]?.string == "symbol" ? held : Self.merged(live, switches: held, plan: plan)
        }
      }
    } catch {
      return nil
    }
    guard
      apply(
        layers, plan: plan, style: style, switched: dominant != blend.dominant,
        selection: blend.selection, position: position)
    else { return nil }
    var next = blend
    next.position = position
    next.dominant = dominant
    return next
  }

  /// A layer at the position whose switched values stay at the held theme's.
  private static func merged(_ live: JSONValue, switches held: JSONValue, plan: JSONValue)
    -> JSONValue
  {
    guard case .object(var layer) = live else { return live }
    for entry in plan["switches"]?.array ?? [] where entry["layer"] == live["id"] {
      guard let kind = entry["group"]?.string, let property = entry["property"]?.string else {
        continue
      }
      var values: [String: JSONValue] = [:]
      if case .object(let current)? = layer[kind] { values = current }
      values[property] = held[kind]?[property]
      layer[kind] = .object(values)
    }
    return .object(layer)
  }

  private func apply(
    _ layers: [JSONValue], plan: JSONValue, style: MLNStyle, switched: Bool, selection: [Int],
    position: Double
  ) -> Bool {
    let byID = Dictionary(
      layers.compactMap { layer in layer["id"]?.string.map { ($0, layer) } },
      uniquingKeysWith: { first, _ in first })
    var writes: [(layer: String, property: String, value: JSONValue?)] = []
    for paint in plan["paints"]?.array ?? [] {
      guard let id = paint["layer"]?.string, let property = paint["property"]?.string else {
        continue
      }
      writes.append((id, property, byID[id]?["paint"]?[property]))
    }
    if switched {
      for entry in plan["switches"]?.array ?? [] {
        guard let id = entry["layer"]?.string, let kind = entry["group"]?.string,
          let property = entry["property"]?.string
        else { continue }
        writes.append((id, property, byID[id]?[kind]?[property]))
      }
    }
    for (id, property, value) in writes {
      guard let layer = style.layer(withIdentifier: id),
        NativeStyleProperties.set(value, property: property, of: layer)
      else { return false }
    }
    // Light follows the position.
    if let light = plan["light"],
      let filled = try? NativeEvaluators.fill(light, position: position, select: selection)
    {
      let light = style.light
      if let intensity = filled["intensity"]?.number {
        light.intensity = NSExpression(forConstantValue: intensity)
      }
      if let colour = filled["color"]?.string, let rgba = NativeEvaluators.parseColour(colour) {
        light.color = NSExpression(
          forConstantValue: UIColor(
            red: rgba[0] / 255, green: rgba[1] / 255, blue: rgba[2] / 255, alpha: rgba[3]))
      }
      style.light = light
    }
    return true
  }

  // MARK: Emphasis

  func setEmphasis(_ payload: JSONValue) async throws -> JSONValue {
    var request: NativeEmphasisRequest?
    if let value = payload["emphasis"], value != .null {
      guard family != nil else {
        throw TileflowMapError(
          .resourceFailed,
          context: .init(resource: .style, message: "The map has no native family document."))
      }
      var recede: [String: Double] = [:]
      if case .object(let amounts)? = value["recede"] {
        for (domain, amount) in amounts {
          guard let amount = amount.number, (0...1).contains(amount) else {
            throw TileflowMapError.invalidRequest
          }
          recede[domain] = amount
        }
      }
      var keep: JSONValue?
      if let reference = value["keep"]?["id"]?.string {
        guard let bytes = data.payload(reference)?.bytes,
          let area = try? JSONDecoder().decode(JSONValue.self, from: bytes),
          ["Polygon", "MultiPolygon"].contains(area["type"]?.string ?? ""),
          area["coordinates"]?.array != nil
        else {
          throw TileflowMapError(
            .invalidRequest,
            context: .init(
              message: "The emphasis keep area must be a GeoJSON Polygon or MultiPolygon."))
        }
        keep = .object(["type": area["type"]!, "coordinates": area["coordinates"]!])
      }
      request = NativeEmphasisRequest(recede: recede, labels: value["labels"]?.number, keep: keep)
    }
    emphasis.motion?.cancel()
    emphasis.goal = request
    if let request { emphasis.shown = request }
    let goal: Double = request == nil ? 0 : 1
    let duration = (payload["duration"]?.number ?? 0) / 1000
    // Values read per feature are set once, at their goal.
    applyEmphasis(strength: goal, featureData: true, only: true)
    let from = emphasis.strength
    if duration > 0, from != goal {
      let started = ContinuousClock.now
      let motion = Task { @MainActor [weak self] in
        while !Task.isCancelled {
          let elapsed = started.duration(to: .now) / .milliseconds(1) / (duration * 1000)
          let t = min(1, elapsed)
          let eased = t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2
          self?.applyEmphasis(strength: from + (goal - from) * eased, featureData: false)
          if t >= 1 { break }
          try? await Task.sleep(for: .milliseconds(33))
        }
      }
      emphasis.motion = motion
      await motion.value
      guard !motion.isCancelled else { return .object(["status": .string("superseded")]) }
    }
    applyEmphasis(strength: goal, featureData: true)
    if request == nil { emphasis.shown = nil }
    return .object(["status": .string("applied")])
  }

  /// Writes the shown emphasis at a strength to the theme on screen. `only` writes just the values
  /// that read feature data.
  func applyEmphasis(strength: Double, featureData: Bool, only: Bool = false) {
    if !only { emphasis.strength = strength }
    guard let request = emphasis.shown, let family, let shown, let style = mapView?.style,
      styleLoaded, let targets = family.theme(shown.theme)?["emphasis"]?["targets"]?.array
    else { return }
    for target in targets {
      let reads = target["featureData"]?.bool == true
      guard reads ? featureData : !only, let id = target["layer"]?.string,
        let property = target["property"]?.string, let layer = style.layer(withIdentifier: id)
      else { continue }
      let amount =
        target["kind"]?.string == "label"
        ? 1 - (request.labels ?? 1) : request.recede[target["domain"]?.string ?? ""] ?? 0
      guard let value = try? NativeEvaluators.emphasize(target, t: amount * strength, keep: request.keep)
      else { continue }
      _ = NativeStyleProperties.set(value, property: property, of: layer)
    }
  }

  // MARK: View mode

  /// Shows the layers that stand in for the 3D scene (`3d`) or hides them (`2d`). With a
  /// duration, buildings rise from the ground or sink into it first.
  func setViewMode(_ mode: String, duration: TimeInterval) {
    guard mode != viewMode || viewModeMotion != nil else { return }
    viewModeMotion?.cancel()
    viewModeMotion = nil
    viewMode = mode
    let goal: Double = mode == "3d" ? 1 : 0
    guard duration > 0, styleLoaded, document?.toggles.isEmpty == false else {
      applyViewMode(factor: goal)
      return
    }
    let started = ContinuousClock.now
    viewModeMotion = Task { @MainActor [weak self] in
      while !Task.isCancelled {
        let t = min(1, started.duration(to: .now) / .milliseconds(1) / (duration * 1000))
        self?.applyViewMode(factor: goal == 1 ? t : 1 - t, visible: true)
        if t >= 1 { break }
        try? await Task.sleep(for: .milliseconds(33))
      }
      guard !Task.isCancelled, let self else { return }
      self.applyViewMode(factor: goal)
      self.viewModeMotion = nil
    }
  }

  /// Scales the stand-in extrusions' heights by `factor`; they show only above 0.
  func applyViewMode(factor: Double, visible: Bool? = nil) {
    guard let style = mapView?.style, let toggles = document?.toggles else { return }
    for toggle in toggles {
      guard let layer = style.layer(withIdentifier: toggle.id) else { continue }
      layer.isVisible = visible ?? (factor > 0)
      guard layer is MLNFillExtrusionStyleLayer else { continue }
      for (property, value) in [
        ("fill-extrusion-height", toggle.height), ("fill-extrusion-base", toggle.base),
      ] {
        guard let value else { continue }
        let scaled: JSONValue =
          factor >= 1 ? value : .array([.string("*"), value, .number(factor)])
        _ = NativeStyleProperties.set(scaled, property: property, of: layer)
      }
    }
  }

  // MARK: Degradations

  /// Reports each degradation of the style on screen once per map: what native maps do not draw,
  /// and what they show instead.
  func reportDegradations() {
    guard let document else { return }
    var records: [(id: String, feature: String, message: String)] = document.degradations.compactMap
    { record in
      guard let id = record["id"]?.string, let feature = record["feature"]?.string else {
        return nil
      }
      return (id, feature, Self.degradationMessage(feature, fallback: record["fallback"]?.string))
    }
    if document.omitted.contains("text") {
      records.append(
        (
          "text", "text",
          "This map's labels have no glyphs or font faces native maps can draw, so they are left out."
        ))
    }
    for record in records where reportedFeatures.insert(record.id).inserted {
      warnFeature(record.feature, message: record.message)
    }
  }

  func warnFeature(_ feature: String, message: String) {
    Self.log.warning("\(message, privacy: .public)")
    warnings.warn(
      .object([
        "code": .string("rendererFailed"), "message": .string(message),
        "context": .object([
          "reason": .string(ProtocolContract.ErrorReason.featureUnavailable.rawValue),
          "feature": .string(feature),
        ]),
      ]))
  }

  static func degradationMessage(_ feature: String, fallback: String?) -> String {
    let instead: String
    switch fallback {
    case "extrusions": instead = "plain building extrusions stand in for it"
    case "flat": instead = "it is drawn flat"
    case "mercator": instead = "the map is drawn in Web Mercator"
    case "steady": instead = "the lights shine steadily"
    case "allow-overlap": instead = "symbols are placed with allowed overlap"
    case "engine-default": instead = "the renderer's default is used"
    case "capped": instead = "the camera's pitch is capped"
    default: instead = "it is left out"
    }
    return "Native maps do not draw this map's \(feature) feature; \(instead)."
  }
}
