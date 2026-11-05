import Foundation
import CryptoKit
import Tileflow
import UIKit

extension MapBridgeValues {
  struct Blend {
    let themes: [String]
    let position: Double
    let hold: Bool
  }

  static func blend(_ input: BridgeObject) throws -> Blend {
    if input.has("themes") {
      return Blend(themes: try input.strings("themes"), position: try input.double("position"),
        hold: try input.bool("hold", default: false))
    }
    return Blend(themes: try [input.string("from"), input.string("to")],
      position: try input.double("mix"), hold: false)
  }

  static func themeDuration(_ appearance: BridgeObject) throws -> TimeInterval {
    let milliseconds = try appearance.optionalObject("themeTransition")?.double("duration") ?? 0
    guard (0...5000).contains(milliseconds) else { throw TileflowMapError.invalidRequest }
    return milliseconds / 1000
  }

  static func sun(_ input: BridgeObject?) throws -> TileflowSun? {
    guard let input else { return nil }
    if input.has("date") {
      return .date(Date(timeIntervalSince1970: try input.double("date") / 1000),
        location: try input.optionalArray("location").map { try coordinate($0) })
    }
    return .direction(azimuth: try input.double("azimuth"), altitude: try input.double("altitude"))
  }

  static func emphasis(_ input: BridgeObject?) throws -> TileflowEmphasis? {
    guard let input else { return nil }
    var recede: [TileflowMapModule: Double] = [:]
    for (key, value) in try input.optionalObject("recede")?.values ?? [:] {
      guard let number = BridgeObject.number(value), number.isFinite else {
        throw BridgeArgumentError(path: "emphasis.recede", expected: "numeric strengths")
      }
      recede[TileflowMapModule(rawValue: key)] = number
    }
    return TileflowEmphasis(recede: recede, labels: try input.optionalDouble("labels"),
      keepArea: try input.optionalObject("keepArea").map { try JSONSerialization.data(withJSONObject: $0.values) })
  }

  static func boundaries(_ input: BridgeObject?) throws -> TileflowBoundaryValues? {
    guard let input else { return nil }
    guard input.has("ids") != input.has("refs") else {
      throw BridgeArgumentError(path: "values", expected: "ids or refs")
    }
    let labels = try input.bool("labels", default: false), state = try input.optionalString("state") ?? "value"
    let values = try input.object(input.has("ids") ? "ids" : "refs").values.mapValues { value -> TileflowBoundaryValue in
      if let string = value as? String { return .category(string) }
      if let number = BridgeObject.number(value), number.isFinite { return .number(number) }
      throw BridgeArgumentError(path: "values", expected: "numeric or category values")
    }
    if input.has("refs") { return TileflowBoundaryValues(refs: values, labels: labels, state: state) }
    var ids: [Int: TileflowBoundaryValue] = [:]
    for (key, value) in values {
      guard let id = Int(key), String(id) == key else {
        throw BridgeArgumentError(path: "values.ids", expected: "integer identifiers")
      }
      ids[id] = value
    }
    return TileflowBoundaryValues(ids: ids, labels: labels, state: state)
  }

  static func progress(_ input: BridgeObject) throws -> TileflowLineProgress {
    TileflowLineProgress(start: try input.optionalDouble("start") ?? 0,
      end: try input.optionalDouble("end") ?? 1, light: try input.optionalDouble("light"),
      opacity: try input.optionalDouble("opacity") ?? 1, highlight: try input.optionalString("highlight"))
  }

  static func shot(_ input: BridgeObject) throws -> TileflowShot {
    let frames = try input.array("keyframes").map { value -> TileflowShot.Keyframe in
      let frame = try BridgeObject(value), camera = try frame.object("camera")
      let center = try coordinate(camera.array("centerCoordinate"))
      return TileflowShot.Keyframe(time: try frame.double("time") / 1000,
        camera: TileflowCamera(longitude: center.longitude, latitude: center.latitude,
          zoom: try camera.double("zoomLevel"), bearing: try camera.optionalDouble("heading") ?? 0,
          pitch: try camera.optionalDouble("pitch") ?? 0),
        blendPosition: try frame.optionalDouble("blendPosition"))
    }
    let cues = try (input.optionalArray("cues") ?? []).map { value -> TileflowShot.Cue in
      let cue = try BridgeObject(value)
      return .init(time: try cue.double("time") / 1000, id: try cue.string("id"))
    }
    return TileflowShot(keyframes: frames, themes: try input.has("themes") ? input.strings("themes") : nil,
      easing: try input.choice("easing", TileflowShot.Easing.self) ?? .smooth, cues: cues)
  }

  static func depthMarker(_ value: Any) throws -> TileflowDepthMarker {
    let input = try BridgeObject(value), size = try point(input.array("size"))
    let offset = try input.optionalArray("offset").map(point) ?? .zero
    return TileflowDepthMarker(id: try input.string("id"), coordinate: try coordinate(input.array("coordinate")),
      image: try input.string("image"), size: CGSize(width: size.x, height: size.y),
      alignment: try input.choice("alignment", TileflowDepthMarker.Alignment.self) ?? .screen,
      anchor: try input.choice("anchor", TileflowDepthMarker.Anchor.self) ?? .center,
      offset: CGVector(dx: offset.x, dy: offset.y), rotation: try input.optionalDouble("rotation") ?? 0,
      altitude: try input.optionalDouble("altitude") ?? 0, opacity: try input.optionalDouble("opacity") ?? 1,
      occluded: try input.bool("occluded", default: true))
  }

  static func locationEvent(_ location: TileflowLocation) -> [String: Any] {
    var coords: [String: Any] = ["longitude": location.coordinate.longitude, "latitude": location.coordinate.latitude]
    coords["accuracy"] = location.horizontalAccuracy
    coords["altitude"] = location.altitude
    coords["heading"] = location.course
    coords["speed"] = location.speed
    return ["coords": coords, "timestamp": location.timestamp.timeIntervalSince1970 * 1000]
  }
}

/// Application images are loaded outside the UI actor before the SDK installs one complete set.
enum MapImageLoader {
  static let maximumBytes = 32 * 1024 * 1024

  static func data(_ uri: String) async throws -> Data {
    try Task.checkCancellation()
    guard let url = URL(string: uri), let scheme = url.scheme?.lowercased() else {
      throw BridgeArgumentError(path: "image.uri", expected: "an absolute image URI")
    }
    let data: Data
    if scheme == "http" || scheme == "https" {
      let (bytes, response) = try await URLSession.shared.bytes(from: url)
      defer { bytes.task.cancel() }
      guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
        response.expectedContentLength <= maximumBytes else { throw TileflowMapError.resourceFailed }
      var buffer = Data()
      for try await byte in bytes {
        guard buffer.count < maximumBytes else { throw TileflowMapError.invalidRequest }
        buffer.append(byte)
      }
      data = buffer
    } else if scheme == "data" {
      data = try await detached { try dataURI(uri) }
    } else if scheme == "file" {
      data = try await detached {
        guard let stream = InputStream(url: url) else { throw TileflowMapError.resourceFailed }
        stream.open()
        defer { stream.close() }
        var data = Data(), bytes = [UInt8](repeating: 0, count: 16_384)
        while stream.hasBytesAvailable {
          try Task.checkCancellation()
          let count = stream.read(&bytes, maxLength: bytes.count)
          guard count >= 0 else { throw TileflowMapError.resourceFailed }
          if count == 0 { break }
          guard data.count + count <= maximumBytes else { throw TileflowMapError.invalidRequest }
          data.append(bytes, count: count)
        }
        return data
      }
    } else { throw BridgeArgumentError(path: "image.uri", expected: "file, data, http or https") }
    try Task.checkCancellation()
    guard !data.isEmpty else { throw TileflowMapError.invalidRequest }
    return data
  }

  private static func detached(_ work: @escaping @Sendable () throws -> Data) async throws -> Data {
    let task = Task.detached(operation: work)
    return try await withTaskCancellationHandler { try await task.value } onCancel: { task.cancel() }
  }

  private static func dataURI(_ uri: String) throws -> Data {
    guard let comma = uri.firstIndex(of: ",") else { throw TileflowMapError.invalidRequest }
    let payload = uri[uri.index(after: comma)...]
    if uri[..<comma].lowercased().hasSuffix(";base64") {
      guard payload.utf8.count <= (maximumBytes + 2) / 3 * 4,
        let data = Data(base64Encoded: String(payload)), data.count <= maximumBytes
      else { throw TileflowMapError.invalidRequest }
      return data
    }
    let bytes = Array(payload.utf8)
    var result = Data(), index = 0
    while index < bytes.count {
      if index % 16_384 == 0 { try Task.checkCancellation() }
      guard result.count < maximumBytes else { throw TileflowMapError.invalidRequest }
      if bytes[index] == 37 {
        guard index + 2 < bytes.count,
          let byte = UInt8(String(decoding: bytes[(index + 1)...(index + 2)], as: UTF8.self), radix: 16)
        else { throw TileflowMapError.invalidRequest }
        result.append(byte)
        index += 3
      } else {
        result.append(bytes[index])
        index += 1
      }
    }
    return result
  }

  static func images(_ values: [Any]) async throws -> [TileflowMapImage] {
    guard values.count <= 64 else { throw TileflowMapError.invalidRequest }
    var images: [TileflowMapImage] = []
    var cache: [String: Data] = [:]
    var sizes: [SHA256.Digest: Int] = [:]
    func load(_ uri: String) async throws -> Data {
      if let cached = cache[uri] { return cached }
      let bytes = try await data(uri)
      sizes[SHA256.hash(data: bytes)] = bytes.count
      guard sizes.count <= 64, sizes.values.reduce(0, +) <= 64 * 1024 * 1024 else {
        throw TileflowMapError.invalidRequest
      }
      cache[uri] = bytes
      return bytes
    }
    for value in values {
      let input = try BridgeObject(value)
      let bytes = try await load(input.string("uri"))
      var variants: [String: Data] = [:]
      for (theme, uri) in try input.optionalStringMap("variants") ?? [:] {
        variants[theme] = try await load(uri)
      }
      images.append(try TileflowMapImage(name: input.string("id"), data: bytes,
        pixelRatio: input.optionalDouble("scale") ?? 1, variants: variants,
        sdf: input.bool("sdf", default: false)))
    }
    return images
  }
}
