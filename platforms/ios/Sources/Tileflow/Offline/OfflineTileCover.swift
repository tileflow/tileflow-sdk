import Foundation

/// The region of one Hosted download in the service's canonical form: a box, one closed ring or a
/// GeoJSON geometry, with WGS84 positions rounded to six decimals, never crossing the
/// antimeridian.
enum OfflinePackRegion: Hashable, Sendable {
  case bbox(west: Double, south: Double, east: Double, north: Double)
  /// A closed ring: its last position repeats the first.
  case polygon([TileflowPosition])
  case geometry(OfflineRegionShape)

  static let maximumLatitude = 85.051129
  static let positions = 4...256

  /// The canonical box, or nil when the service would refuse it.
  static func canonical(_ west: Double, _ south: Double, _ east: Double, _ north: Double)
    -> OfflinePackRegion?
  {
    guard [west, east].allSatisfy(isLongitude), [south, north].allSatisfy(isLatitude) else {
      return nil
    }
    let (w, s, e, n) = (round(west), round(south), round(east), round(north))
    guard w < e, s < n else { return nil }
    return .bbox(west: w, south: s, east: e, north: n)
  }

  /// The canonical ring, or nil when the service would refuse it: open, too short or long, or
  /// with every position on one line. A self-crossing ring bounds area under the even-odd cover
  /// even when its signed areas cancel.
  static func canonical(_ ring: [TileflowPosition]) -> OfflinePackRegion? {
    guard positions.contains(ring.count),
      ring.allSatisfy({ isLongitude($0.longitude) && isLatitude($0.latitude) })
    else { return nil }
    let rounded = ring.map {
      TileflowPosition(longitude: round($0.longitude), latitude: round($0.latitude))
    }
    guard rounded.first == rounded.last, !isCollinear(rounded) else { return nil }
    return .polygon(rounded)
  }

  /// The region the service returns. It must already be canonical.
  init?(json value: JSONValue?) {
    func numbers(_ value: JSONValue?) -> [Double]? {
      guard case .array(let items) = value else { return nil }
      let numbers = items.compactMap(\.number)
      return numbers.count == items.count ? numbers : nil
    }
    guard case .object(let object) = value else { return nil }
    switch object["type"]?.string {
    case "bbox":
      guard object.count == 2, let box = numbers(object["bbox"]), box.count == 4,
        let region = Self.canonical(box[0], box[1], box[2], box[3]),
        region == .bbox(west: box[0], south: box[1], east: box[2], north: box[3])
      else { return nil }
      self = region
    case "polygon":
      guard object.count == 2, case .array(let items) = object["coordinates"] else { return nil }
      let ring = items.compactMap { item -> TileflowPosition? in
        guard let pair = numbers(item), pair.count == 2 else { return nil }
        return TileflowPosition(longitude: pair[0], latitude: pair[1])
      }
      guard ring.count == items.count, let region = Self.canonical(ring), region == .polygon(ring)
      else { return nil }
      self = region
    default:
      guard let shape = OfflineRegionShape(json: value),
        (try? OfflineRegionShape.canonical(shape)) == shape
      else { return nil }
      self = .geometry(shape)
    }
  }

  var json: JSONValue {
    switch self {
    case .bbox(let west, let south, let east, let north):
      return .object([
        "type": .string("bbox"),
        "bbox": .array([west, south, east, north].map(JSONValue.number)),
      ])
    case .polygon(let ring):
      return .object([
        "type": .string("polygon"),
        "coordinates": .array(
          ring.map { .array([.number($0.longitude), .number($0.latitude)]) }),
      ])
    case .geometry(let shape):
      return shape.json
    }
  }

  /// The parts the cover follows: a box is the ring of its four corners.
  var parts: [OfflineCoverPart] {
    switch self {
    case .bbox(let west, let south, let east, let north):
      let ring: [TileflowPosition] = [
        .init(longitude: west, latitude: south), .init(longitude: east, latitude: south),
        .init(longitude: east, latitude: north), .init(longitude: west, latitude: north),
        .init(longitude: west, latitude: south),
      ]
      return [OfflineCoverPart(paths: [ring], isFilled: true)]
    case .polygon(let ring): return [OfflineCoverPart(paths: [ring], isFilled: true)]
    case .geometry(let shape): return shape.parts
    }
  }

  private static func isLongitude(_ value: Double) -> Bool { value.isFinite && abs(value) <= 180 }
  private static func isLatitude(_ value: Double) -> Bool {
    value.isFinite && abs(value) <= maximumLatitude
  }

  /// Six decimals, as the service rounds: halves toward positive infinity, and never -0.
  static func round(_ value: Double) -> Double {
    let rounded = OfflineTileCover.roundHalfUp(value * 1e6) / 1e6
    return rounded == 0 ? 0 : rounded
  }

  /// Whether every position lies on the line through the first two distinct ones, with the
  /// service's exact arithmetic.
  static func isCollinear(_ ring: [TileflowPosition]) -> Bool {
    let first = ring[0]
    guard let other = ring.first(where: { $0 != first }) else { return true }
    let (dx, dy) = (other.longitude - first.longitude, other.latitude - first.latitude)
    return ring.allSatisfy {
      dx * ($0.latitude - first.latitude) - dy * ($0.longitude - first.longitude) == 0
    }
  }
}

/// One part of a region's cover: paths whose segments it touches, a single position touching the
/// tile it lies in, and, for a polygon, whether the area its rings enclose (even-odd) is covered.
struct OfflineCoverPart: Hashable, Sendable {
  var paths: [[TileflowPosition]]
  var isFilled: Bool
}

/// The tiles of one zoom that a pack region covers, exactly as the service plans and admits them.
///
/// Edges are straight lines in Web Mercator. A tile belongs to the region when a part's edge or
/// position touches it (closed tile bounds) or its row's center line lies inside a polygon part
/// (even-odd over that polygon's rings). Parts form a union.
struct OfflineTileCover: Sendable {
  let zoom: Int
  private let parts: [(paths: [[(x: Double, y: Double)]], isFilled: Bool)]
  private let limit: Int

  init(_ region: OfflinePackRegion, zoom: Int) {
    self.zoom = zoom
    let scale = Double(1 << zoom)
    parts = region.parts.map { part in
      (part.paths.map { $0.map { Self.mercator($0, scale: scale) } }, part.isFilled)
    }
    limit = (1 << zoom) - 1
  }

  /// The rows the region can touch; empty when it touches none. Row bounds are closed, so a
  /// region whose top lies exactly on a row edge also touches the row above it.
  var rows: ClosedRange<Int>? {
    let ys = parts.flatMap { $0.paths.flatMap { $0.map(\.y) } }
    guard let low = ys.min(), let high = ys.max() else { return nil }
    let first = max(0, Int(low.rounded(.up)) - 1)
    let last = min(limit, Int(high.rounded(.down)))
    return first <= last ? first...last : nil
  }

  /// The covered tiles of row `y` as sorted, disjoint, inclusive column ranges.
  func row(_ y: Int) -> [ClosedRange<Int>] {
    guard (0...limit).contains(y) else { return [] }
    let row = Double(y)
    var ranges: [ClosedRange<Int>] = []
    func add(_ from: Double, _ to: Double) {
      let start = max(0, min(from, to).rounded(.down))
      let end = min(Double(limit), max(from, to).rounded(.down))
      if start <= end { ranges.append(Int(start)...Int(end)) }
    }
    let center = row + 0.5
    for part in parts {
      var crossings: [Double] = []
      for path in part.paths {
        // A single position is a segment of no length.
        for index in path.indices.dropFirst(path.count > 1 ? 1 : 0) {
          let (p, q) = (path[max(0, index - 1)], path[index])
          if part.isFilled, (p.y <= center) != (q.y <= center) {
            crossings.append(p.x + ((center - p.y) / (q.y - p.y)) * (q.x - p.x))
          }
          if max(p.y, q.y) < row || min(p.y, q.y) > row + 1 { continue }
          if p.y == q.y {
            add(p.x, q.x)
            continue
          }
          let t0 = max(0, min(1, (row - p.y) / (q.y - p.y)))
          let t1 = max(0, min(1, (row + 1 - p.y) / (q.y - p.y)))
          add(p.x + min(t0, t1) * (q.x - p.x), p.x + max(t0, t1) * (q.x - p.x))
        }
      }
      crossings.sort()
      var index = 0
      while index + 1 < crossings.count {
        add(crossings[index], crossings[index + 1])
        index += 2
      }
    }
    return Self.merged(ranges)
  }

  func contains(x: Int, y: Int) -> Bool { row(y).contains { $0.contains(x) } }

  /// The number of covered tiles.
  var count: Int {
    guard let rows else { return 0 }
    return rows.reduce(0) { total, y in total + row(y).reduce(0) { $0 + $1.count } }
  }

  /// The distinct tiles of several regions at `zoom`.
  static func count(_ regions: [OfflinePackRegion], zoom: Int) -> Int {
    let covers = regions.map { OfflineTileCover($0, zoom: zoom) }
    if covers.count == 1 { return covers[0].count }
    let spans = covers.compactMap(\.rows)
    guard let first = spans.map(\.lowerBound).min(), let last = spans.map(\.upperBound).max()
    else { return 0 }
    var total = 0
    for y in first...last {
      total += merged(covers.flatMap { $0.row(y) }).reduce(0) { $0 + $1.count }
    }
    return total
  }

  static func merged(_ ranges: [ClosedRange<Int>]) -> [ClosedRange<Int>] {
    var merged: [ClosedRange<Int>] = []
    for range in ranges.sorted(by: { $0.lowerBound < $1.lowerBound }) {
      if let previous = merged.last, range.lowerBound <= previous.upperBound + 1 {
        merged[merged.count - 1] = previous.lowerBound...max(previous.upperBound, range.upperBound)
      } else {
        merged.append(range)
      }
    }
    return merged
  }

  /// Fractional Web Mercator tile coordinates at `scale` tiles per side.
  static func mercator(_ position: TileflowPosition, scale: Double) -> (x: Double, y: Double) {
    let phi = position.latitude * Double.pi / 180
    return (
      (position.longitude + 180) / 360 * scale,
      (1 - log(tan(phi) + 1 / cos(phi)) / Double.pi) / 2 * scale
    )
  }

  /// The nearest integer, with halves toward positive infinity.
  static func roundHalfUp(_ value: Double) -> Double {
    let floor = value.rounded(.down)
    return value - floor >= 0.5 ? floor + 1 : floor
  }
}
