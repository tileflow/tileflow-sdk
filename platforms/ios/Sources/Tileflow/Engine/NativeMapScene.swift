import Foundation
import MapLibre
import TileflowStyleBridge
import UIKit

/// Retained scene values and running transitions for one generation of the map.
@MainActor
final class NativeMapScene {
  unowned let engine: NativeMapEngine
  private var sunOverride: NativeSun.Direction?
  private var states: [String: JSONValue] = [:]
  private var transitions: [String: UUID] = [:]
  private(set) var boundaryValues = BoundaryRows()
  private var boundaryPending = Set<String>()
  private struct Removal: Hashable {
    let layer: String
    let id: String
    let key: String
  }
  private var boundaryRemovals: Set<Removal> = []
  private var lastBoundaryRetry = false

  init(_ engine: NativeMapEngine) { self.engine = engine }

  var style: MLNStyle? { engine.styleLoaded ? engine.mapView?.style : nil }

  /// A later change to the same value supersedes the previous transition.
  private func transition(_ key: String, duration: Double, update: (Double) -> Void) async throws
    -> JSONValue
  {
    let token = UUID()
    transitions[key] = token
    defer { if transitions[key] == token { transitions.removeValue(forKey: key) } }
    let start = CACurrentMediaTime()
    while true {
      try Task.checkCancellation()
      guard !engine.retired else { throw TileflowMapError.cancelled }
      guard transitions[key] == token else { return .object(["status": .string("superseded")]) }
      let t =
        duration > 0 && !UIAccessibility.isReduceMotionEnabled
        ? min(1, (CACurrentMediaTime() - start) * 1000 / duration) : 1
      update(t * t * (3 - 2 * t))
      if t >= 1 { return .object(["status": .string("applied")]) }
      try await Task.sleep(for: .milliseconds(16))
    }
  }

  private var themeSun: NativeSun.Direction {
    let sun: JSONValue?
    switch engine.shown {
    case .theme(let name): sun = engine.family?.theme(name)?["sun"]
    case .blend(let blend):
      let suns = blend.themes.compactMap { engine.family?.theme($0)?["sun"] }
      sun = NativeEvaluators.at(suns, position: blend.position, mix: NativeEvaluators.mixSuns)
    case nil: sun = nil
    }
    if let direction = NativeSun.Direction(sun) { return direction }
    let doc = engine.document?.style
    let metadata = doc?["metadata"] as? [String: Any]
    if let preset = metadata?["tileflow:sun"],
      let direction = NativeSun.Direction(JSONValue(foundation: preset))
    {
      return direction
    }
    let position = (doc?["light"] as? [String: Any])?["position"] as? [Double]
    return NativeSun.Direction(position?[safe: 1] ?? 210, 90 - (position?[safe: 2] ?? 30))
  }

  func setSun(_ request: JSONValue) async throws -> JSONValue {
    let goal: NativeSun.Direction?
    if let date = request["sun"]?["date"]?.number {
      guard date.isFinite else { throw TileflowMapError.invalidRequest }
      let location: TileflowCoordinate
      if let x = request["sun"]?["location"]?["longitude"]?.number,
        let y = request["sun"]?["location"]?["latitude"]?.number
      {
        location = .init(longitude: x, latitude: y)
      } else if let center = engine.camera?.current {
        location = .init(longitude: center.longitude, latitude: center.latitude)
      } else {
        throw TileflowMapError.notReady
      }
      goal = NativeSun.position(date: date, location: location)
    } else if request["sun"] == .null {
      goal = nil
    } else {
      guard let direction = NativeSun.Direction(request["sun"]) else {
        throw TileflowMapError.invalidRequest
      }
      goal = direction
    }
    let from = sunOverride ?? themeSun
    return try await transition("sun", duration: request["duration"]?.number ?? 0) { t in
      self.sunOverride = t == 1 ? goal : from.toward(goal ?? self.themeSun, t)
      self.applyLight()
    }
  }

  private func applyLight() {
    guard let style else { return }
    let base = engine.document?.style["light"] as? [String: Any]
    let position = base?["position"] as? [Double]
    let direction = sunOverride ?? themeSun
    let light = style.light
    let metadata = engine.document?.style["metadata"] as? [String: Any]
    let published =
      metadata?["tileflow:sun"] != nil
      || engine.shown.map { engine.family?.theme($0.theme)?["sunPublished"]?.bool == true } == true
    let followsCompiledLight = sunOverride == nil && !published
    let anchor = followsCompiledLight ? base?["anchor"] as? String ?? "viewport" : "map"
    light.anchor = NSExpression(forConstantValue: anchor)
    let target = MLNSphericalPositionMake(
      position?.first ?? 1.15,
      followsCompiledLight
        ? position?[safe: 1] ?? 210 : (direction.azimuth * 1000).rounded() / 1000,
      followsCompiledLight
        ? position?[safe: 2] ?? 30
        : (min(90, max(0, 90 - direction.altitude)) * 1000).rounded() / 1000)
    light.position = NSExpression(forConstantValue: NSValue(mlnSphericalPosition: target))
    style.light = light
  }

  func setStyleState(_ request: JSONValue) async throws -> JSONValue {
    guard let name = request["name"]?.string, let value = request["value"] else {
      throw TileflowMapError.invalidRequest
    }
    let from = states[name]?.number
    let to = value.number
    let duration = from != nil && to != nil && from != to ? (request["duration"]?.number ?? 0) : 0
    return try await transition("state/" + name, duration: duration) { t in
      let current: JSONValue
      if t < 1, let from, let to {
        current = .number(from + (to - from) * t)
      } else {
        current = value
      }
      self.states[name] = current
      self.style?.setGlobalStateValue(
        current == .null ? nil : current.foundation, forProperty: name)
    }
  }

  func restore() {
    guard let style else { return }
    applyLight()
    for (name, value) in states {
      style.setGlobalStateValue(value == .null ? nil : value.foundation, forProperty: name)
    }
    boundaryRemovals.removeAll()
    boundaryPending = Set(boundaryValues.rows.keys)
    lastBoundaryRetry = false
    applyBoundaryChanges(previous: BoundaryRows())
  }

  func blendChanged() {
    applyLight()
    if let name = engine.shown?.theme, let style {
      engine.runtimeStyle.showImages(for: name, style: style)
    }
  }

  struct BoundaryRows {
    var state = "value"
    var sourceLayers = ["boundary_area"]
    var rows: [String: JSONValue] = [:]

    init() {}
    @MainActor init(request: JSONValue, data: DataChannel) throws {
      guard let values = request["values"], values != .null else { return }
      guard values["joinBy"] == .string("id"), let id = values["rows"]?["id"]?.string,
        let bytes = data.payload(id)?.bytes,
        let list = (try? JSONDecoder().decode(JSONValue.self, from: bytes))?.array
      else { throw TileflowMapError.invalidRequest }
      state = request["state"]?.string ?? "value"
      if request["labels"]?.bool == true { sourceLayers.append("boundary_label") }
      for item in list {
        guard let pair = item.array, pair.count == 2, let number = pair[0].number,
          number >= 0, number <= 9_007_199_254_740_991, let id = Int64(exactly: number)
        else { throw TileflowMapError.invalidRequest }
        switch pair[1] {
        case .string, .number: rows[String(id)] = pair[1]
        case .null: break
        default: throw TileflowMapError.invalidRequest
        }
      }
    }
  }

  func setBoundaries(_ request: JSONValue, data: DataChannel) throws {
    let next = try BoundaryRows(request: request, data: data)
    let previous = boundaryValues
    boundaryValues = next
    applyBoundaryChanges(previous: previous)
  }

  private func applyBoundaryChanges(previous: BoundaryRows) {
    guard let source = style?.source(withIdentifier: "tileflow-boundaries") as? MLNVectorTileSource
    else { return }
    for layer in previous.sourceLayers {
      for id in previous.rows.keys
      where previous.state != boundaryValues.state || !boundaryValues.sourceLayers.contains(layer)
        || boundaryValues.rows[id] == nil
      {
        let removal = Removal(layer: layer, id: id, key: previous.state)
        boundaryRemovals.insert(removal)
        erase(removal, from: source)
      }
    }
    boundaryPending.formIntersection(boundaryValues.rows.keys)
    for layer in boundaryValues.sourceLayers {
      for (id, value) in boundaryValues.rows
      where previous.state != boundaryValues.state || !previous.sourceLayers.contains(layer)
        || previous.rows[id] != value
      {
        boundaryRemovals.remove(Removal(layer: layer, id: id, key: boundaryValues.state))
        _ = source.setFeatureState(
          sourceLayerID: layer, featureID: id, state: [boundaryValues.state: value.foundation])
        boundaryPending.insert(id)
      }
    }
  }

  private func erase(_ target: Removal, from source: MLNVectorTileSource) {
    let state = source.featureState(sourceLayerID: target.layer, featureID: target.id) ?? [:]
    if state.keys.allSatisfy({ $0 == target.key }) {
      _ = source.removeFeatureState(sourceLayerID: target.layer, featureID: target.id)
    } else {
      _ = source.removeFeatureState(
        sourceLayerID: target.layer, featureID: target.id, stateKey: target.key)
    }
  }

  func confirmBoundaries() {
    guard !boundaryPending.isEmpty || !boundaryRemovals.isEmpty,
      let source = style?.source(withIdentifier: "tileflow-boundaries") as? MLNVectorTileSource
    else { return }
    var retried = false
    // The renderer can coalesce two property removals on the same source layer in a frame.
    // Confirm each removal and retry one outstanding row per layer, keeping other clients' keys.
    var touched = Set<String>()
    for target in boundaryRemovals {
      if source.featureState(sourceLayerID: target.layer, featureID: target.id)?[target.key] == nil
      {
        boundaryRemovals.remove(target)
      } else if touched.insert(target.layer).inserted {
        erase(target, from: source)
      }
    }
    for id in boundaryPending {
      guard let value = boundaryValues.rows[id] else {
        boundaryPending.remove(id)
        continue
      }
      let missing = boundaryValues.sourceLayers.filter { layer in
        source.featureState(sourceLayerID: layer, featureID: id)?[boundaryValues.state].map(
          JSONValue.init(foundation:)) != value
      }
      if missing.isEmpty {
        boundaryPending.remove(id)
      } else if !lastBoundaryRetry {
        for layer in missing {
          _ = source.setFeatureState(
            sourceLayerID: layer, featureID: id, state: [boundaryValues.state: value.foundation])
        }
        retried = true
      }
    }
    lastBoundaryRetry = retried
  }

  func retire() { transitions.removeAll() }
}

extension Array {
  fileprivate subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
