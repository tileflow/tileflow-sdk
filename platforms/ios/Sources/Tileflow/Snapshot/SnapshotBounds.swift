import Foundation

/// Follows the image boundary continuously across the antimeridian and repeated worlds. A corner
/// above the horizon cannot locate the boundary, so every downloaded regional credit is retained.
enum SnapshotBounds {
  static func measure(
    width: Double, height: Double, coordinate: (Double, Double) -> TileflowCoordinate
  ) -> TileflowBounds {
    let world = TileflowBounds(west: -180, south: -90, east: 180, north: 90)
    let corners = [(0.0, 0.0), (width, 0), (width, height), (0, height), (0, 0)]
    var previous: Double?
    var west = Double.infinity
    var east = -Double.infinity
    var south = Double.infinity
    var north = -Double.infinity
    for (a, b) in zip(corners, corners.dropFirst()) {
      let dx = b.0 - a.0
      let dy = b.1 - a.1
      let steps = max(1, Int(ceil(max(abs(dx), abs(dy)) / 64)))
      for step in 0..<steps {
        let t = Double(step) / Double(steps)
        let p = coordinate(a.0 + dx * t, a.1 + dy * t)
        guard p.longitude.isFinite, (-90...90).contains(p.latitude) else { return world }
        let lon =
          previous.map { start in
            let delta = (p.longitude - start).truncatingRemainder(dividingBy: 360)
            return start + (delta + 540).truncatingRemainder(dividingBy: 360) - 180
          } ?? p.longitude
        previous = lon
        west = min(west, lon)
        east = max(east, lon)
        south = min(south, p.latitude)
        north = max(north, p.latitude)
      }
    }
    return .init(west: west, south: south, east: east, north: north)
  }
}
