import Foundation
import UIKit

@testable import Tileflow

/// Data and images fed to the map integration tests.
enum MapTestFixtures {
  /// A FeatureCollection of points of at least `bytes`.
  static func geoJSON(bytes: Int) -> (data: Data, features: Int) {
    var text = #"{"type":"FeatureCollection","features":["#
    var count = 0
    while text.utf8.count < bytes {
      if count > 0 { text += "," }
      let longitude = -3.75 + Double(count % 1000) / 10_000
      let latitude = 40.40 + Double(count / 1000) / 1000
      text +=
        #"{"type":"Feature","id":\#(count),"properties":{"name":"Point \#(count)","rank":\#(count % 7)},"geometry":{"type":"Point","coordinates":[\#(longitude),\#(latitude)]}}"#
      count += 1
    }
    text += "]}"
    return (Data(text.utf8), count)
  }

  /// Points on a grid around the fixture map, each with a numeric identifier and a rank.
  static func points(_ count: Int) -> Data {
    var text = #"{"type":"FeatureCollection","features":["#
    text.reserveCapacity(count * 120)
    for index in 0..<count {
      if index > 0 { text += "," }
      let longitude = -3.9 + Double(index % 400) / 1000
      let latitude = 40.3 + Double(index / 400) / 1000
      text +=
        #"{"type":"Feature","id":\#(index),"properties":{"rank":\#(index % 10)},"geometry":{"type":"Point","coordinates":[\#(longitude),\#(latitude)]}}"#
    }
    return Data((text + "]}").utf8)
  }

  /// A white disc on transparency: a signed distance field the layer recolours.
  static func sdfDisc() throws -> TileflowMapImage {
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: 24, height: 24))
    let image = renderer.image { context in
      UIColor.white.setFill()
      context.cgContext.fillEllipse(in: CGRect(x: 4, y: 4, width: 16, height: 16))
    }
    return try TileflowMapImage(name: "disc", image: image, sdf: true)
  }

  static func pinImage() -> UIImage {
    UIGraphicsImageRenderer(size: CGSize(width: 24, height: 24)).image { context in
      UIColor.systemRed.setFill()
      context.cgContext.fillEllipse(in: CGRect(x: 2, y: 2, width: 20, height: 20))
    }
  }
}
