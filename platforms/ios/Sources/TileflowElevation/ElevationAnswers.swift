import Foundation

/// The Terrain release read and the tile zoom sampled.
public struct TileflowElevationDataset: Sendable, Hashable {
  public var releaseID: String
  public var zoom: Int
}

/// A position with its height in the requested unit, or nil where there is no data.
public struct TileflowElevatedPosition: Sendable, Hashable {
  public var position: TileflowPosition
  public var elevation: Double?
}

public struct TileflowElevationPointsResponse: Sendable, Hashable {
  public var positions: [TileflowElevatedPosition]
  public var unit: TileflowElevationUnit
  public var dataset: TileflowElevationDataset
  /// The credit to show with the data.
  public var attribution: String
  public var units: Int
}

public struct TileflowElevationBatch: Sendable, Hashable {
  public var positions: [TileflowElevatedPosition]
  public var unit: TileflowElevationUnit
  /// The credits to show with the data.
  public var attribution: String
  /// API units used by all the requests.
  public var units: Int
}

public struct TileflowElevationSample: Sendable, Hashable {
  public var position: TileflowPosition
  public var elevation: Double?
  /// The distance along the profile from the start of its first line.
  public var distance: Double
}

public struct TileflowElevationProfileSummary: Sendable, Hashable {
  public var distance: Double
  public var ascent: Double?
  public var descent: Double?
  public var minElevation: Double?
  public var maxElevation: Double?
  public var startElevation: Double?
  public var endElevation: Double?
  /// The steepest uphill grade in percent, over a run of at least 100 m.
  public var maxGrade: Double?
  /// The steepest downhill grade in percent, over a run of at least 100 m.
  public var minGrade: Double?
}

/// An elevation profile: samples along one or more lines and their summary.
public struct TileflowElevationProfile: Sendable, Hashable {
  public var unit: TileflowElevationUnit
  public var dataset: TileflowElevationDataset
  public var attribution: String
  public var units: Int
  /// The spacing of the samples, in `unit`.
  public var interval: Double
  public var samples: [TileflowElevationSample]
  /// The first and last sample index of each line, in request order.
  public var lines: [ClosedRange<Int>]
  public var summary: TileflowElevationProfileSummary

  /// The profile at a distance from its start, interpolated between samples. The distance is
  /// clamped to the profile. Nil for a profile without samples or a non-finite distance.
  public func point(atDistance distance: Double) -> TileflowElevationProfilePoint? {
    guard let lastSample = samples.last, !lines.isEmpty, distance.isFinite else { return nil }
    let clamped = min(lastSample.distance, max(0, distance))
    var low = 0
    var high = samples.count - 1
    while high - low > 1 {
      let middle = (low + high) / 2
      if samples[middle].distance <= clamped { low = middle } else { high = middle }
    }
    // Two lines meet at one distance: the earlier line ends where the next starts.
    let line = lines.firstIndex { low <= $0.upperBound } ?? lines.count - 1
    let a = samples[low]
    let b = samples[min(high, lines[line].upperBound)]
    let span = b.distance - a.distance
    let t = span > 0 ? min(1, max(0, (clamped - a.distance) / span)) : 0
    return TileflowElevationProfilePoint(
      position: TileflowPosition(
        longitude: a.position.longitude + (b.position.longitude - a.position.longitude) * t,
        latitude: a.position.latitude + (b.position.latitude - a.position.latitude) * t),
      elevation: height(onLine: line, at: clamped), distance: clamped, index: low, line: line)
  }

  /// The index of the sample nearest to a position, by straight-line distance in degrees
  /// scaled by latitude. Nil for a profile without samples.
  public func nearestSampleIndex(to position: TileflowPosition) -> Int? {
    let scale = cos(position.latitude * .pi / 180)
    var best: Int?
    var bestDistance = Double.infinity
    for (index, sample) in samples.enumerated() {
      let dx = (sample.position.longitude - position.longitude) * scale
      let dy = sample.position.latitude - position.latitude
      let value = dx * dx + dy * dy
      if value < bestDistance {
        bestDistance = value
        best = index
      }
    }
    return best
  }

  /// The interpolated height at a distance within one line, or nil without data on both sides.
  private func height(onLine line: Int, at distance: Double) -> Double? {
    let range = lines[line]
    let clamped = min(
      samples[range.upperBound].distance, max(samples[range.lowerBound].distance, distance))
    var low = range.lowerBound
    var high = range.upperBound
    while high - low > 1 {
      let middle = (low + high) / 2
      if samples[middle].distance <= clamped { low = middle } else { high = middle }
    }
    let a = samples[low]
    let b = samples[high]
    guard let from = a.elevation, let to = b.elevation else { return a.elevation ?? b.elevation }
    let span = b.distance - a.distance
    return span > 0 ? from + (to - from) * (clamped - a.distance) / span : from
  }
}

/// A point along a profile.
public struct TileflowElevationProfilePoint: Sendable, Hashable {
  public var position: TileflowPosition
  public var elevation: Double?
  public var distance: Double
  /// The index of the sample at or before this point.
  public var index: Int
  /// The line this point is on.
  public var line: Int
}

// MARK: Decoding

struct ElevationAnswer {
  var unit: TileflowElevationUnit
  var dataset: TileflowElevationDataset
  var attribution: String
  var units: Int

  init(_ json: ServiceJSON) throws {
    _ = try json.object()
    guard try json.required("schemaVersion").integer() == 1,
      let unit = TileflowElevationUnit(rawValue: try json.required("unit").string())
    else { throw ServiceJSONError.invalid }
    let dataset = try json.required("dataset")
    self.unit = unit
    self.dataset = TileflowElevationDataset(
      releaseID: try dataset.required("releaseId").text(maximum: 128),
      zoom: try dataset.required("zoom").integer(0...24))
    attribution = try json.required("attribution").text(maximum: 16_384)
    units = try json.required("usage").required("units").integer(1...Int.max)
  }

  static func height(_ json: ServiceJSON) throws -> Double? {
    json == .null ? nil : try json.number()
  }
}

extension TileflowElevationPointsResponse {
  init(_ json: ServiceJSON) throws {
    let answer = try ElevationAnswer(json)
    self.init(
      positions: try json.required("positions").array().map { item in
        let values = try item.array(count: 3...3)
        return TileflowElevatedPosition(
          position: try ServiceJSON.array(Array(values[0...1])).position(),
          elevation: try ElevationAnswer.height(values[2]))
      },
      unit: answer.unit, dataset: answer.dataset, attribution: answer.attribution,
      units: answer.units)
  }
}

extension TileflowElevationProfile {
  init(_ json: ServiceJSON) throws {
    let answer = try ElevationAnswer(json)
    let samples = try json.required("samples").array().map { item in
      let values = try item.array(count: 4...4)
      return TileflowElevationSample(
        position: try ServiceJSON.array(Array(values[0...1])).position(),
        elevation: try ElevationAnswer.height(values[2]),
        distance: try values[3].number(0 ... .greatestFiniteMagnitude))
    }
    let lines = try json.required("lines").array().map { item -> ClosedRange<Int> in
      let values = try item.array(count: 2...2)
      let first = try values[0].integer(0...Int.max)
      let last = try values[1].integer(0...Int.max)
      guard first <= last else { throw ServiceJSONError.invalid }
      return first...last
    }
    let summary = try json.required("summary")
    func length(_ key: String) throws -> Double? {
      try summary.optional(key)?.number(0 ... .greatestFiniteMagnitude)
    }
    func value(_ key: String) throws -> Double? { try summary.optional(key)?.number() }
    self.init(
      unit: answer.unit, dataset: answer.dataset, attribution: answer.attribution,
      units: answer.units,
      interval: try json.required("interval").number(
        .leastNonzeroMagnitude ... .greatestFiniteMagnitude),
      samples: samples, lines: lines,
      summary: TileflowElevationProfileSummary(
        distance: try summary.required("distance").number(0 ... .greatestFiniteMagnitude),
        ascent: try length("ascent"), descent: try length("descent"),
        minElevation: try value("minElevation"), maxElevation: try value("maxElevation"),
        startElevation: try value("startElevation"), endElevation: try value("endElevation"),
        maxGrade: try value("maxGrade"), minGrade: try value("minGrade")))
  }
}
