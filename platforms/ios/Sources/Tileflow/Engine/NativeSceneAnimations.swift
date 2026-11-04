import Foundation
import UIKit

/// Camera and optional theme blend at a time along a shot, following Core's Mercator interpolation.
struct NativeShot {
  struct Frame {
    let at: Double
    let camera: TileflowCamera
    let blend: Double?
  }
  let frames: [Frame]
  let themes: [String]?
  let cues: [(at: Double, id: String)]
  let smooth: Bool
  var duration: Double { frames.last!.at }

  init(_ request: JSONValue) throws {
    guard let keys = request["keyframes"]?.array, keys.count >= 2 else {
      throw TileflowMapError.invalidRequest
    }
    themes = request["themes"]?.array?.compactMap(\.string)
    smooth = request["easing"] != .string("linear")
    frames = try keys.map { key in
      guard let at = key["at"]?.number, let camera = key["camera"],
        let x = camera["longitude"]?.number ?? camera["center"]?.array?.first?.number,
        let y = camera["latitude"]?.number ?? camera["center"]?.array?.last?.number,
        let zoom = camera["zoom"]?.number
      else { throw TileflowMapError.invalidRequest }
      return .init(
        at: at,
        camera: .init(
          longitude: x, latitude: y, zoom: zoom, bearing: camera["bearing"]?.number ?? 0,
          pitch: camera["pitch"]?.number ?? 0),
        blend: key["blendPosition"]?.number ?? key["blend"]?["position"]?.number)
    }
    cues = try (request["cues"]?.array ?? []).enumerated().map { index, cue in
      guard let at = cue["at"]?.number, let id = cue["id"]?.string else {
        throw TileflowMapError.invalidRequest
      }
      return (at, id, index)
    }.sorted { ($0.0, $0.2) < ($1.0, $1.2) }.map { ($0.0, $0.1) }
    guard frames[0].at == 0, zip(frames, frames.dropFirst()).allSatisfy({ $0.at < $1.at }),
      cues.allSatisfy({ (0...frames.last!.at).contains($0.at) })
    else { throw TileflowMapError.invalidRequest }
    if let themes {
      guard (2...8).contains(themes.count), Set(themes).count == themes.count,
        frames.allSatisfy({ frame in
          frame.blend.map { (0...Double(themes.count - 1)).contains($0) } == true
        })
      else { throw TileflowMapError.invalidRequest }
    }
  }

  func sample(_ time: Double) -> Frame {
    let at = min(duration, max(0, time))
    let end = frames.firstIndex(where: { $0.at >= at }) ?? frames.count - 1
    guard end > 0, frames[end].at != at else { return frames[end] }
    let a = frames[end - 1]
    let b = frames[end]
    let raw = (at - a.at) / (b.at - a.at)
    let t = smooth ? raw * raw * (3 - 2 * raw) : raw
    func lerp(_ x: Double, _ y: Double) -> Double { x + (y - x) * t }
    func wrap(_ x: Double) -> Double {
      (-180...180).contains(x) ? x : (x + 540).truncatingRemainder(dividingBy: 360) - 180
    }
    let start = a.camera
    let finish = b.camera
    let longitude = wrap(start.longitude + wrap(finish.longitude - start.longitude) * t)
    func mercator(_ d: Double) -> Double {
      log(tan(.pi / 4 + min(85.051129, max(-85.051129, d)) * .pi / 360))
    }
    let latitude =
      start.latitude == finish.latitude
      ? start.latitude
      : (360 / Double.pi) * atan(exp(lerp(mercator(start.latitude), mercator(finish.latitude))))
        - 90
    let turn =
      ((finish.bearing - start.bearing).truncatingRemainder(dividingBy: 360) + 540)
      .truncatingRemainder(dividingBy: 360) - 180
    return Frame(
      at: at,
      camera: .init(
        longitude: longitude, latitude: latitude, zoom: lerp(start.zoom, finish.zoom),
        bearing: wrap(start.bearing + turn * t), pitch: lerp(start.pitch, finish.pitch)),
      blend: a.blend.flatMap { av in b.blend.map { lerp(av, $0) } })
  }
}

@MainActor
final class NativeSceneAnimations {
  unowned let engine: NativeMapEngine
  private struct Running {
    let layers: Set<String>?
    var task: Task<Void, Never>?
    var movingCamera = false
    var blendRevision: Int?
  }
  private var runs: [String: Running] = [:]
  private var next: UInt64 = 0

  init(_ engine: NativeMapEngine) { self.engine = engine }

  func stopShot() {
    for (id, animation) in runs where animation.layers == nil { finish(id, completed: false) }
  }
  func stopLines() {
    for (id, animation) in runs where animation.layers != nil { finish(id, completed: false) }
  }
  func stop(_ request: JSONValue) {
    if let id = request["animation"]?.string { finish(id, completed: false) }
  }
  func retire() {
    for run in runs.values { run.task?.cancel() }
    runs.removeAll()
  }

  private func begin(layers: Set<String>?) -> String {
    next += 1
    let id = "a" + String(next)
    runs[id] = Running(layers: layers, task: nil)
    return id
  }
  private func finish(_ id: String, completed: Bool) {
    guard let animation = runs.removeValue(forKey: id) else { return }
    animation.task?.cancel()
    if !completed, animation.blendRevision == engine.appearanceRevision {
      engine.appearanceRevision += 1
    }
    if animation.movingCamera { engine.camera?.shotEnded() }
    engine.onEvent?(
      "animationEnded", .object(["animation": .string(id), "finished": .bool(completed)]))
  }

  func play(_ request: JSONValue) async throws -> JSONValue {
    try Task.checkCancellation()
    let shot = try NativeShot(request)
    stopShot()
    let id = begin(layers: nil)
    if let themes = shot.themes, let blend = shot.frames[0].blend {
      do {
        runs[id]?.blendRevision = engine.appearanceRevision + 1
        _ = try await engine.setBlend(
          .object(["themes": .array(themes.map(JSONValue.string)), "position": .number(blend)]))
        runs[id]?.blendRevision = nil
        try Task.checkCancellation()
      } catch {
        runs.removeValue(forKey: id)
        throw error
      }
    }
    guard runs[id] != nil else { return .object(["animation": .string(id)]) }
    runs[id]?.movingCamera = true
    engine.camera?.shotStarted()
    runs[id]?.task = Task { @MainActor [weak self] in
      guard let self else { return }
      let start = CACurrentMediaTime()
      var cue = 0
      while !Task.isCancelled, runs[id] != nil, !engine.retired {
        let time =
          UIAccessibility.isReduceMotionEnabled
          ? shot.duration : (CACurrentMediaTime() - start) * 1000
        let frame = shot.sample(time)
        engine.camera?.shotFrame(frame.camera)
        if let themes = shot.themes, let blend = frame.blend {
          do {
            runs[id]?.blendRevision = engine.appearanceRevision + 1
            _ = try await engine.setBlend(
              .object(["themes": .array(themes.map(JSONValue.string)), "position": .number(blend)]))
            runs[id]?.blendRevision = nil
          } catch {
            finish(id, completed: false)
            return
          }
        }
        guard runs[id] != nil else { return }
        while cue < shot.cues.count, shot.cues[cue].at <= frame.at {
          engine.onEvent?(
            "shotCue", .object(["animation": .string(id), "cue": .string(shot.cues[cue].id)]))
          cue += 1
        }
        if frame.at >= shot.duration {
          finish(id, completed: true)
          return
        }
        try? await Task.sleep(for: .milliseconds(16))
      }
    }
    return .object(["animation": .string(id)])
  }

  func progress(_ request: JSONValue, content: NativeSceneContent) throws -> JSONValue {
    guard let ids = request["layers"]?.array?.compactMap(\.string), let goal = request["to"] else {
      throw TileflowMapError.invalidRequest
    }
    let initial = try content.progress(for: ids)
    let wanted = Set(ids)
    for (id, run) in runs where run.layers?.isDisjoint(with: wanted) == false {
      finish(id, completed: false)
    }
    let id = begin(layers: wanted)
    let duration = request["duration"]?.number ?? 0
    runs[id]?.task = Task { @MainActor [weak self] in
      guard let self else { return }
      let start = CACurrentMediaTime()
      while !Task.isCancelled, runs[id] != nil, !engine.retired {
        let raw =
          UIAccessibility.isReduceMotionEnabled || duration == 0
          ? 1 : min(1, (CACurrentMediaTime() - start) * 1000 / duration)
        let t = raw * raw * (3 - 2 * raw)
        let values = initial.mapValues { value -> JSONValue in
          var next: [String: JSONValue] = [:]
          for key in ["start", "end", "light", "opacity"] {
            if let a = value[key]?.number, let b = goal[key]?.number {
              next[key] = .number(a + (b - a) * t)
            } else if key == "light", goal[key]?.number == nil, t < 1 {
              next[key] = value[key]
            } else {
              next[key] = goal[key]
            }
          }
          return .object(next)
        }
        do { try content.applyProgress(values) } catch {
          finish(id, completed: false)
          return
        }
        if raw >= 1 {
          finish(id, completed: true)
          return
        }
        try? await Task.sleep(for: .milliseconds(16))
      }
    }
    return .object(["animation": .string(id)])
  }
}
