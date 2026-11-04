import MapLibre
import UIKit

/// An application image anchored to a geographic coordinate in a snapshot. The size defaults to the image's natural size in points. Attribution draws above it.
public struct TileflowSnapshotImage: Sendable {
  public let image: UIImage
  public var coordinate: TileflowCoordinate
  public var anchor: TileflowIconAnchor
  public var size: CGSize?

  public init(
    image: UIImage, coordinate: TileflowCoordinate, anchor: TileflowIconAnchor = .center,
    size: CGSize? = nil
  ) {
    self.image = image
    self.coordinate = coordinate
    self.anchor = anchor
    self.size = size
  }

  func validate() throws {
    let value = size ?? image.size
    guard (-180...180).contains(coordinate.longitude), (-90...90).contains(coordinate.latitude),
      value.width.isFinite, value.width > 0, value.height.isFinite, value.height > 0
    else { throw TileflowMapError.invalidRequest }
  }

  @MainActor
  func draw(in snapshot: MLNMapSnapshot) {
    let point = snapshot.point(
      for: CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude))
    guard point.x.isFinite, point.y.isFinite else { return }
    let size = self.size ?? image.size
    let x = anchor.rawValue.contains("left") ? 0 : anchor.rawValue.contains("right") ? 1.0 : 0.5
    let y = anchor.rawValue.contains("top") ? 0 : anchor.rawValue.contains("bottom") ? 1.0 : 0.5
    image.draw(
      in: CGRect(
        x: point.x - size.width * x, y: point.y - size.height * y, width: size.width,
        height: size.height))
  }
}
