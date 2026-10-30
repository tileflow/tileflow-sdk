import SwiftUI
import Tileflow
import TileflowServiceContent

@main
struct TileflowExampleApp: App {
  init() { configureExample() }

  var body: some Scene { WindowGroup { MapScreen() } }
}

/// A controlled map under a bottom panel. The panel's measured height is the map's bottom content
/// inset, so the camera centres on the visible map and its controls stay above the panel.
struct MapScreen: View {
  private static let start = TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 13)
  private let source = exampleSource()
  private let servicesAvailable = servicesConfigured()
  @State private var controller = TileflowMapController()
  @State private var camera = MapScreen.start
  @State private var dark = false
  @State private var expanded = false
  @State private var status = "Loading Tileflow…"
  @State private var panelHeight: CGFloat = 0
  @State private var showsLocation = false
  @State private var followMode = TileflowFollowMode.none
  private let locationProvider = exampleLocationProvider()

  var body: some View {
    ZStack(alignment: .bottom) {
      TileflowMap(
        source: source, camera: $camera, theme: dark ? "dark" : "light",
        options: .init(
          controls: .init(scaleBar: true, recenterButton: true),
          location: .init(enabled: showsLocation, puckBearing: .heading)),
        contentInsets: UIEdgeInsets(top: 0, left: 0, bottom: panelHeight, right: 0),
        controller: controller
      ) { event in
        switch event {
        case .contentReady: status = "Tileflow · SwiftUI"
        case .failed(let error): status = "Map unavailable: \(error)"
        case .tap: status = "Map selected"
        case .longPress(let touch):
          status = String(
            format: "Held at %.4f, %.4f", touch.coordinate.latitude, touch.coordinate.longitude)
        case .recenterRequested:
          Task { try? await controller.fly(to: Self.start) }
        case .followModeChanged(let change):
          status = change.mode == .none ? "Moved away from your location" : "Following you"
        default: break
        }
      }
      .followMode($followMode)
      .locationProvider(locationProvider)
      .ignoresSafeArea()
      panel.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { panelHeight = $0 }
    }
  }

  private var panel: some View {
    VStack(alignment: .leading, spacing: 12) {
      Capsule().fill(.secondary).frame(width: 36, height: 5).frame(maxWidth: .infinity)
      Text(status).font(.headline)
      Text(String(format: "Zoom %.1f · bearing %.0f°", camera.zoom, camera.bearing))
        .font(.subheadline).foregroundStyle(.secondary)
      HStack {
        Button("Change theme") { dark.toggle() }
        Spacer()
        // Asks for the location, then shows it and follows it. The recenter button follows it
        // again after the map is moved.
        Button("My location") {
          Task {
            guard await requestLocationAccess() else {
              status = "Location access is off"
              return
            }
            showsLocation = true
            followMode = .position
          }
        }
        Spacer()
        Button("Zoom in") { withAnimation { camera.zoom = min(camera.zoom + 1, 20) } }
      }
      if expanded {
        if servicesAvailable {
          Button("Walk to a café") {
            Task {
              do {
                status = try await showWalkingRoute(to: "café", on: controller)
              } catch {
                status = "Directions unavailable"
              }
            }
          }
        }
        Button("Tilt to the street") {
          Task { try? await controller.ease(to: TileflowCameraUpdate(zoom: 17, pitch: 75)) }
        }
      }
      Button(expanded ? "Show less" : "Show more") { withAnimation { expanded.toggle() } }
    }
    .padding()
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
  }
}

