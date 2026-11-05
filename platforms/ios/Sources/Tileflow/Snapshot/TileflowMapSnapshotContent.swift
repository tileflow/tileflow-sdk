import UIKit

/// Optional application content drawn with the map. Interaction handlers are unused in an image.
public struct TileflowMapSnapshotContent: Sendable {
  public var annotations: [TileflowAnnotation]
  public var overlays: [TileflowGeoJSONLayer]
  public var points: [TileflowPointAnnotation]
  public var circles: [TileflowCircleAnnotation]
  public var polylines: [TileflowPolylineAnnotation]
  public var polygons: [TileflowPolygonAnnotation]
  public var images: [TileflowSnapshotImage]

  public init(
    annotations: [TileflowAnnotation] = [], overlays: [TileflowGeoJSONLayer] = [],
    points: [TileflowPointAnnotation] = [], circles: [TileflowCircleAnnotation] = [],
    polylines: [TileflowPolylineAnnotation] = [], polygons: [TileflowPolygonAnnotation] = [],
    images: [TileflowSnapshotImage] = []
  ) {
    self.annotations = annotations
    self.overlays = overlays
    self.points = points
    self.circles = circles
    self.polylines = polylines
    self.polygons = polygons
    self.images = images
  }

  @MainActor
  func apply(to map: NativeMapPreparation.Map, scheme: String, family: NativeFamily? = nil) throws
    -> (
      json: String, images: [String: UIImage]
    )
  {
    let original = map.projected.json
    guard
      !annotations.isEmpty || !overlays.isEmpty || !points.isEmpty || !circles.isEmpty
        || !polylines.isEmpty || !polygons.isEmpty
    else { return (original, [:]) }
    let content = MapContent(annotations: annotations, overlays: overlays)
    let channel = MapPayloadStore()
    let (wire, references) = try content.wireValue(data: channel)
    defer { channel.release(references) }
    guard var style = try JSONSerialization.jsonObject(with: Data(original.utf8)) as? [String: Any],
      var sources = style["sources"] as? [String: Any],
      var layers = style["layers"] as? [[String: Any]]
    else { throw TileflowMapError.invalidRequest }
    let anchors =
      (style["metadata"] as? [String: Any])?["tileflow:overlay-placement-manifest"]
      as? [String: Any]
    let before = (anchors?["anchors"] as? [String: Any])?["below-labels"] as? String
    func add(
      _ id: String, data: JSONValue, layer: JSONValue, ground: Bool = false, measured: Bool = false
    ) throws {
      guard sources[id] == nil, !layers.contains(where: { $0["id"] as? String == id }),
        let value = layer.foundation as? [String: Any]
      else { throw TileflowMapError.invalidRequest }
      var source: [String: Any] = ["type": "geojson", "data": data.foundation]
      if measured { source["lineMetrics"] = true }
      sources[id] = source
      let placement =
        ground
        ? layers.firstIndex {
          if let before { return $0["id"] as? String == before }
          return anchors == nil && $0["type"] as? String == "symbol"
        } : nil
      layers.insert(value, at: placement ?? layers.endIndex)
    }

    let inks = family?.routeInks([map.theme.name]) ?? NativeFamily.defaultRouteInks(scheme)
    for (overlay, definition) in zip(overlays, wire["overlays"]?.array ?? []) {
      guard let data = try? JSONDecoder().decode(JSONValue.self, from: overlay.geoJSON),
        NativeSceneContent.validCollection(data),
        let layer = NativeSceneContent.layer(
          overlay.id, definition: definition, progress: definition["progress"], inks: inks)["layer"]
      else { throw TileflowMapError(.invalidRequest, reason: .invalidGeoJSON) }
      try add(
        overlay.id, data: data, layer: layer, ground: overlay.placement == .ground,
        measured: overlay.progress != nil)
    }

    var images: [String: UIImage] = [:]
    for point in points {
      if let image = point.image {
        _ = try TileflowMapImage(name: image.name, image: image.image)
        if let prior = images[image.name], !prior.isEqual(image.image) {
          throw TileflowMapError(.invalidRequest, reason: .invalidImage)
        }
        images[image.name] = image.image
      }
    }
    let groups: [(AnnotationKind, [any AnnotationFeature])] = [
      (.polygon, polygons), (.polyline, polylines), (.circle, circles), (.point, points),
    ]
    for (kind, group) in groups where !group.isEmpty {
      guard Set(group.map(\.id)).count == group.count else { throw TileflowMapError.invalidRequest }
      let id = "tileflow-snapshot-" + kind.rawValue
      let layer = kind.layerJSON(
        id: id, used: Set(group.flatMap { $0.styleProperties.keys }), layout: [:])
      let data = JSONValue.object([
        "type": .string("FeatureCollection"), "features": .array(group.map(\.featureJSON)),
      ])
      guard NativeSceneContent.validCollection(data) else {
        throw TileflowMapError(.invalidRequest, reason: .invalidGeoJSON)
      }
      try add(id, data: data, layer: layer)
    }
    if !annotations.isEmpty {
      let id = "tileflow-snapshot-markers"
      let features = annotations.map { marker in
        JSONValue.object([
          "type": .string("Feature"),
          "geometry": .object([
            "type": .string("Point"),
            "coordinates": .array([
              .number(marker.coordinate.longitude), .number(marker.coordinate.latitude),
            ]),
          ]), "properties": .object(["color": .string(marker.color)]),
        ])
      }
      let layer: JSONValue = .object([
        "id": .string(id), "type": .string("circle"), "source": .string(id),
        "paint": .object([
          "circle-color": .array([.string("get"), .string("color")]), "circle-radius": .number(6),
        ]),
      ])
      try add(
        id, data: .object(["type": .string("FeatureCollection"), "features": .array(features)]),
        layer: layer)
    }
    style["sources"] = sources
    style["layers"] = layers
    return (
      String(decoding: try JSONSerialization.data(withJSONObject: style), as: UTF8.self), images
    )
  }
}
