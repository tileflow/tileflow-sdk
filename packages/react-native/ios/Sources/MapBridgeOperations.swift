import Foundation
import Tileflow
import UIKit

@MainActor
enum MapBridgeOperations {
  static func call(_ method: String, input: BridgeObject, host: TFMapHostView, generation: Int) async throws -> Any {
    let map = try host.requireMap(generation)
    switch method {
    case "getCamera": return MapBridgeValues.cameraJSON(try await map.camera())
    case "setCamera":
      let animation = try MapBridgeValues.animation(input)
      if let bounds = try input.optionalObject("bounds") {
        try await map.fit(MapBridgeValues.bounds(bounds), padding: MapBridgeValues.padding(input.optionalObject("padding")),
          bearing: input.optionalDouble("heading"), pitch: input.optionalDouble("pitch"),
          maxZoom: input.optionalDouble("zoomLevel"), animation: animation)
      } else {
        if let padding = try input.optionalObject("padding") { host.setPadding(try MapBridgeValues.padding(padding)) }
        try await map.move(to: MapBridgeValues.camera(input), animation: animation)
      }
    case "stopCamera": map.stopCamera()
    case "cameraForBounds":
      let camera = try await map.camera(for: MapBridgeValues.bounds(input.object("bounds")),
        padding: MapBridgeValues.padding(input.optionalObject("padding")),
        bearing: input.optionalDouble("heading"), pitch: input.optionalDouble("pitch"))
      return camera.map { MapBridgeValues.cameraJSON($0) as Any } ?? NSNull()
    case "getVisibleBounds": return MapBridgeValues.boundsJSON(try await map.visibleBounds())
    case "project":
      let point = try await map.project(MapBridgeValues.coordinate(input.array("coordinate")))
      return [point.x, point.y]
    case "unproject":
      let coordinate = try await map.unproject(MapBridgeValues.point(input.array("point")))
      return [coordinate.longitude, coordinate.latitude]
    case "addSource": try await map.addSource(id: input.string("id"), properties: input.object("properties").values)
    case "updateSource": try await map.updateSource(id: input.string("id"), properties: input.object("properties").values)
    case "removeSource": try await map.removeSource(input.string("id"))
    case "setGeoJSONSourceData":
      let data: TileflowGeoJSONData
      if let uri = input.values["data"] as? String {
        guard let url = URL(string: uri), url.scheme != nil else { throw TileflowMapError.invalidRequest }
        data = .url(url)
      } else { data = .geoJSON(try JSONSerialization.data(withJSONObject: input.object("data").values)) }
      try await map.setGeoJSONSourceData(input.string("id"), data: data)
    case "updateGeoJSONSource":
      let update = try input.object("update")
      let features = try ((update.optionalArray("add") ?? []) + (update.optionalArray("update") ?? [])).map(MapBridgeValues.feature)
      let removed = try update.has("remove") ? update.strings("remove") : []
      try await map.updateGeoJSONSourceFeatures(sourceId: input.string("id"), features: features, removeFeatureIds: removed)
    case "addLayer":
      var properties = try input.object("properties").values
      let position = try input.optionalObject("position")
      if position?.values.keys.contains("slot") == true { properties["slot"] = position?.values["slot"] }
      try await map.addLayer(properties: properties, position: MapBridgeValues.position(position,
        layerId: properties["id"] as? String))
    case "updateLayer": try await map.updateLayer(properties: input.object("properties").values)
    case "moveLayer":
      let position = try input.object("position")
      let placement = try MapBridgeValues.position(position, layerId: input.string("id"), operation: "moveLayer")
      if position.values.keys.contains("slot") {
        try await map.moveLayer(input.string("id"), position: placement,
          slot: position.choice("slot", TileflowLayerSlot.self))
      } else {
        try await map.moveLayer(input.string("id"), position: placement)
      }
    case "removeLayer": try await map.removeLayer(input.string("id"))
    case "setFeatureState":
      try await map.setFeatureState(sourceId: input.string("sourceId"), sourceLayer: input.optionalString("sourceLayer"),
        featureId: input.string("featureId"), state: MapBridgeValues.state(input.object("state")))
    case "getFeatureState":
      return MapBridgeValues.stateJSON(try await map.featureState(sourceId: input.string("sourceId"),
        sourceLayer: input.optionalString("sourceLayer"), featureId: input.string("featureId")))
    case "removeFeatureState":
      try await map.removeFeatureState(sourceId: input.string("sourceId"), sourceLayer: input.optionalString("sourceLayer"),
        featureId: input.string("featureId"), key: input.optionalString("key"))
    case "queryRenderedFeatures":
      let options = try TileflowRenderedQueryOptions(layerIds: input.has("layerIds") ? input.strings("layerIds") : nil,
        filter: MapBridgeValues.filter(input.values["filter"]))
      return try await map.queryRenderedFeatures(in: MapBridgeValues.query(input.object("geometry")), options: options)
        .map(MapBridgeValues.featureJSON)
    case "querySourceFeatures":
      let options = try TileflowSourceQueryOptions(sourceLayerIds: input.optionalString("sourceLayer").map { [$0] },
        filter: MapBridgeValues.filter(input.values["filter"]))
      return try await map.querySourceFeatures(sourceId: input.string("sourceId"), options: options)
        .map(MapBridgeValues.featureJSON)
    case "getClusterChildren":
      return try await map.clusterChildren(sourceId: input.string("sourceId"), clusterId: input.int("clusterId"))
        .map(MapBridgeValues.featureJSON)
    case "getClusterLeaves":
      return try await map.clusterLeaves(sourceId: input.string("sourceId"), clusterId: input.int("clusterId"),
        limit: input.optionalInt("limit") ?? 10, offset: input.optionalInt("offset") ?? 0).map(MapBridgeValues.featureJSON)
    case "getClusterExpansionZoom":
      return try await map.clusterExpansionZoom(sourceId: input.string("sourceId"), clusterId: input.int("clusterId"))
    case "setImages":
      let images = try await host.loadImages(input.array("images"))
      try host.checkGeneration(generation)
      try await host.installImages(images, generation: generation)
    case "setBoundaryValues": try await map.setBoundaryValues(MapBridgeValues.boundaries(input.optionalObject("values")))
    case "joinBoundaryRows":
      let request = try MapBridgeValues.boundaryJoin(input)
      let result = try await map.joinBoundaryRows(request.rows, options: request.options)
      try host.checkGeneration(generation)
      return try MapBridgeValues.boundaryJoinJSON(result)
    case "setDataLayers":
      try await map.setDataLayers(dataSources: input.object("dataSources").values, dataOverlays: input.object("dataOverlays").values)
    case "setStyleState":
      for (name, value) in try MapBridgeValues.state(input.object("state")) {
        try host.checkGeneration(generation)
        try await map.setStyleState(name, to: value)
      }
    case "setEmphasis":
      try await map.setEmphasis(MapBridgeValues.emphasis(input.optionalObject("emphasis")),
        duration: (input.optionalDouble("duration") ?? 0) / 1000)
    case "setSun":
      try await map.setSun(MapBridgeValues.sun(input.optionalObject("sun")), duration: (input.optionalDouble("duration") ?? 0) / 1000)
    case "setDepthMarkers": try await map.setDepthMarkers(input.array("markers").map(MapBridgeValues.depthMarker))
    case "getRouteInks": return BridgeJSON.encode(try await map.routeInks()) ?? NSNull()
    case "animateLineProgress":
      return try await map.animateLineProgress(layers: input.strings("layers"), to: MapBridgeValues.progress(input.object("to")),
        duration: input.double("duration") / 1000)
    case "playShot":
      return try await map.play(MapBridgeValues.shot(input.object("shot"))) { [weak host] id in
        host?.emit("shotCue", value: ["id": id], generation: generation)
      }
    case "stopAnimation": host.stopAnimations()
    case "setPointAnnotations": try host.setPointAnnotations(input.array("annotations"), generation: generation)
    case "setUserLocation": try await host.setUserLocation(input, generation: generation)
    case "requestLocationPermission":
      let authorization = await TileflowLocationPermissions.requestWhenInUse()
      return ["authorization": authorization.rawValue, "accuracy": TileflowLocationPermissions.accuracy.rawValue]
    case "reload": try map.reload()
    default: throw BridgeArgumentError(path: "method", expected: "a native map command")
    }
    return NSNull()
  }
}
