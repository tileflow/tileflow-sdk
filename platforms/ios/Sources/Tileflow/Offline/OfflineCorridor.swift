import Foundation

/// Turns a corridor into the convex rings Hosted packs accept.
///
/// A Hosted pack covers one simple ring of at most 256 positions, while a buffered route is
/// neither small nor, in general, simple. The line is simplified, then cut into consecutive pieces
/// whose convex hull stays close to the corridor's own area; each piece becomes one ring.
///
/// Distances use the Web Mercator scale at the piece's highest latitude, so the rings always
/// contain every point within the corridor's half width of the line. They cover more where the
/// line bends: a hull may cover up to ``maximumExcess`` times the area of the corridor it holds, or
/// more when the extra area is at most ``maximumExtraTiles`` tiles of World's deepest zoom. More
/// area means more tiles; more pieces mean more packs, each of which rounds its billing up to a
/// whole map view.
enum OfflineCorridor {
  static let widths: ClosedRange<Double> = 1...100_000
  static let maximumPositions = 10_000
  static let maximumExcess = 2.0
  static let maximumExtraTiles = 256.0
  /// Tiles per world unit of area at World's deepest zoom, 15.
  static let tilesPerArea = Double(1 << 30)
  /// Line positions per ring. With the eight sides of each position's octagon and the four sides
  /// clipping can add, a ring stays well within the service's 256 positions.
  static let maximumPiecePositions = 200
  /// Simplification moves the line by at most this share of the half width, which the rings add.
  static let simplification = 0.1
  static let earthRadius = 6_378_137.0
  private static let mercatorLimit = 85.051_128_779_806_6

  /// The rings that cover the corridor, in the line's order. The line has valid, distinct
  /// consecutive positions without antimeridian jumps, and `width` is in metres.
  static func regions(line: [TileflowPosition], width: Double) -> [OfflinePackRegion] {
    // One metre more covers the rounding of each ring to six decimals.
    let radius = width / 2 + 1
    let points = line.map { position -> Point in
      let latitude = min(max(position.latitude, -mercatorLimit), mercatorLimit)
      let world = OfflineTileCover.mercator(
        TileflowPosition(longitude: position.longitude, latitude: latitude), scale: 1)
      return Point(x: world.x, y: world.y, latitude: abs(latitude))
    }
    let lowest = points.map(\.latitude).min() ?? 0
    let tolerance = simplification * radius * scale(latitude: lowest)
    let simplified = simplify(points, tolerance: tolerance)
    var regions: [OfflinePackRegion] = []
    var start = 0
    repeat {
      var end = start
      var reach = pieceRadius(simplified[start...start], radius: radius, tolerance: tolerance)
      var hull = octagon(simplified[start], reach: reach)
      while end + 1 < simplified.count, end + 1 - start < maximumPiecePositions {
        let piece = simplified[start...(end + 1)]
        let pieceReach = pieceRadius(piece, radius: radius, tolerance: tolerance)
        // The hull grows by the next octagon unless the piece's radius grew with its latitude.
        let candidate =
          pieceReach == reach
          ? Self.hull(hull + octagon(simplified[end + 1], reach: pieceReach))
          : Self.hull(piece.flatMap { octagon($0, reach: pieceReach) })
        let (covered, own) = (area(candidate), corridorArea(piece, radius: pieceReach))
        if end > start, covered > maximumExcess * own,
          (covered - own) * tilesPerArea > maximumExtraTiles
        {
          break
        }
        hull = candidate
        reach = pieceReach
        end += 1
      }
      if let region = region(hull) { regions.append(region) }
      start = end
    } while start + 1 < simplified.count
    return regions
  }

  struct Point {
    var x: Double
    var y: Double
    /// The absolute latitude in degrees, for the metre scale.
    var latitude: Double
  }

  /// World units (the Web Mercator square as 1) per metre at `latitude` degrees.
  static func scale(latitude: Double) -> Double {
    1 / (2 * Double.pi * earthRadius * cos(min(latitude, mercatorLimit) * Double.pi / 180))
  }

  /// The radius in world units that covers the piece: at its highest latitude, and that far again
  /// toward the pole, plus the simplification tolerance.
  static func pieceRadius(_ piece: ArraySlice<Point>, radius: Double, tolerance: Double) -> Double {
    let highest = piece.map(\.latitude).max() ?? 0
    return radius * scale(latitude: highest + radius / 111_320) + tolerance
  }

  /// Douglas–Peucker in world units, keeping the first and last positions.
  static func simplify(_ points: [Point], tolerance: Double) -> [Point] {
    guard points.count > 2 else { return points }
    var keep = [Bool](repeating: false, count: points.count)
    keep[0] = true
    keep[points.count - 1] = true
    var stack = [(0, points.count - 1)]
    while let (first, last) = stack.popLast() {
      var farthest = 0.0
      var index = first
      for candidate in (first + 1)..<last {
        let distance = segmentDistance(points[candidate], points[first], points[last])
        if distance > farthest {
          farthest = distance
          index = candidate
        }
      }
      if farthest > tolerance {
        keep[index] = true
        if index - first > 1 { stack.append((first, index)) }
        if last - index > 1 { stack.append((index, last)) }
      }
    }
    return points.indices.filter { keep[$0] }.map { points[$0] }
  }

  static func segmentDistance(_ point: Point, _ a: Point, _ b: Point) -> Double {
    let (dx, dy) = (b.x - a.x, b.y - a.y)
    let length = dx * dx + dy * dy
    let t = length == 0 ? 0 : max(0, min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
    return hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
  }

  /// An octagon around the position that circumscribes a circle of radius `reach`. The hull of
  /// the octagons of a piece contains every point within `reach` of its segments.
  static func octagon(_ point: Point, reach: Double) -> [(Double, Double)] {
    let corner = reach / cos(Double.pi / 8)
    return (0..<8).map { k in
      let angle = Double.pi / 8 + Double(k) * Double.pi / 4
      return (point.x + corner * cos(angle), point.y + corner * sin(angle))
    }
  }

  /// The corridor's own area: each segment's band plus one disk for the ends and joins.
  static func corridorArea(_ piece: ArraySlice<Point>, radius: Double) -> Double {
    var length = 0.0
    for index in piece.indices.dropFirst() {
      length += hypot(piece[index].x - piece[index - 1].x, piece[index].y - piece[index - 1].y)
    }
    return 2 * radius * length + Double.pi * radius * radius
  }

  /// Andrew's monotone chain: counterclockwise, without repeating the first point.
  static func hull(_ points: [(Double, Double)]) -> [(Double, Double)] {
    let sorted = points.sorted { $0.0 < $1.0 || ($0.0 == $1.0 && $0.1 < $1.1) }
    guard sorted.count > 2 else { return sorted }
    func cross(_ o: (Double, Double), _ a: (Double, Double), _ b: (Double, Double)) -> Double {
      (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0)
    }
    var lower: [(Double, Double)] = []
    for point in sorted {
      while lower.count >= 2, cross(lower[lower.count - 2], lower[lower.count - 1], point) <= 0 {
        lower.removeLast()
      }
      lower.append(point)
    }
    var upper: [(Double, Double)] = []
    for point in sorted.reversed() {
      while upper.count >= 2, cross(upper[upper.count - 2], upper[upper.count - 1], point) <= 0 {
        upper.removeLast()
      }
      upper.append(point)
    }
    return Array(lower.dropLast() + upper.dropLast())
  }

  static func area(_ ring: [(Double, Double)]) -> Double {
    var area = 0.0
    for index in ring.indices {
      let (a, b) = (ring[index], ring[(index + 1) % ring.count])
      area += a.0 * b.1 - b.0 * a.1
    }
    return abs(area) / 2
  }

  /// Clips a convex ring to the Web Mercator square and converts it to a canonical pack ring.
  static func region(_ hull: [(Double, Double)]) -> OfflinePackRegion? {
    var ring = hull
    for (axis, bound, keepBelow) in [
      (0, 0.0, false), (0, 1.0, true), (1, 0.0, false), (1, 1.0, true),
    ] {
      ring = clip(ring, axis: axis, bound: bound, keepBelow: keepBelow)
    }
    var positions: [TileflowPosition] = []
    for (x, y) in ring {
      let latitude = atan(sinh(Double.pi * (1 - 2 * y))) * 180 / Double.pi
      let position = TileflowPosition(
        longitude: min(max(OfflinePackRegion.round(x * 360 - 180), -180), 180),
        latitude: min(
          max(OfflinePackRegion.round(latitude), -OfflinePackRegion.maximumLatitude),
          OfflinePackRegion.maximumLatitude))
      if positions.last != position { positions.append(position) }
    }
    while positions.count > 1, positions.first == positions.last { positions.removeLast() }
    guard positions.count >= 3 else { return nil }
    return OfflinePackRegion.canonical(positions + [positions[0]])
  }

  private static func clip(
    _ ring: [(Double, Double)], axis: Int, bound: Double, keepBelow: Bool
  ) -> [(Double, Double)] {
    func value(_ point: (Double, Double)) -> Double { axis == 0 ? point.0 : point.1 }
    func inside(_ point: (Double, Double)) -> Bool {
      keepBelow ? value(point) <= bound : value(point) >= bound
    }
    var clipped: [(Double, Double)] = []
    for index in ring.indices {
      let (current, next) = (ring[index], ring[(index + 1) % ring.count])
      if inside(current) { clipped.append(current) }
      if inside(current) != inside(next) {
        let t = (bound - value(current)) / (value(next) - value(current))
        clipped.append(
          (current.0 + t * (next.0 - current.0), current.1 + t * (next.1 - current.1)))
      }
    }
    return clipped
  }
}
