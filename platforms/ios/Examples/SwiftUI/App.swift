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

  var body: some View {
    ZStack(alignment: .bottom) {
      TileflowMap(
        source: source, camera: $camera, theme: dark ? "dark" : "light",
        options: .init(controls: .init(scaleBar: true, recenterButton: true)),
        contentInsets: UIEdgeInsets(top: 0, left: 0, bottom: panelHeight, right: 0),
        controller: controller
      ) { event in
        switch event {
        case .contentReady: status = "Tileflow · SwiftUI"
        case .failed(let error): status = "Map unavailable: \(error)"
        case .tap(let touch):
          Task {
            let selected = try? await ClusterExample.tap(at: touch.point, on: controller)
            status = selected ?? "Map selected"
          }
        case .longPress(let touch):
          status = String(
            format: "Held at %.4f, %.4f", touch.coordinate.latitude, touch.coordinate.longitude)
        case .recenterRequested:
          Task { try? await controller.fly(to: Self.start) }
        default: break
        }
      }
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
        Button("Show 100,000 places") {
          Task {
            do {
              try await ClusterExample.show(on: controller, around: TileflowCoordinate(longitude: Self.start.longitude, latitude: Self.start.latitude))
              withAnimation { camera.zoom = 10 }
              status = "Tap a cluster to zoom in"
            } catch {
              status = "Places unavailable"
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

