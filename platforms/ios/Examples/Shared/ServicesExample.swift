import Foundation
import Tileflow
import TileflowServiceContent

/// Whether Search and Routing have a credential, from the Info.plist or ``configureExample()``.
func servicesConfigured() -> Bool {
  let configuration = try? Tileflow.configuration()
  return configuration?.credential(for: .search) != nil
    && configuration?.credential(for: .routing) != nil
}

/// Finds a place near the camera, walks there from the camera's centre, frames the route and draws
/// it on in the theme's route inks. Returns a short summary.
@MainActor
func showWalkingRoute(to query: String, on controller: TileflowMapController) async throws
  -> String
{
  let camera = try await controller.camera()
  let found = try await TileflowSearch().geocode(
    TileflowGeocodeRequest(query: query, limit: 1, proximity: camera.searchProximity))
  guard let place = found.results.first else { return "No place found for “\(query)”" }
  let start = TileflowPosition(longitude: camera.longitude, latitude: camera.latitude)
  let answer = try await TileflowRouting().route(
    TileflowRouteRequest(locations: [start, place.position], mode: .walking))
  let route = answer.routes[0]
  try await controller.setContent(
    annotations: [TileflowAnnotation(place: place, id: "destination")],
    layers: try TileflowGeoJSONLayer.route(answer, progress: TileflowLineProgress(end: 0)))
  try await controller.fit(TileflowBounds(route.bounds), padding: 48, duration: 0.6)
  try await controller.animateLineProgress(
    layers: TileflowGeoJSONLayer.routeProgressLayers(), to: TileflowLineProgress(end: 1),
    duration: 2)
  let distance = Measurement(value: route.distance, unit: UnitLength.meters)
  return
    "\(place.name ?? place.label): \(distance.formatted(.measurement(width: .abbreviated, usage: .road))), \(Int((route.duration / 60).rounded())) min"
}
