import SwiftUI
import Tileflow
import TileflowServiceContent

@main
struct TileflowExampleApp: App {
  var body: some Scene { WindowGroup { MapScreen() } }
}

struct MapScreen: View {
  private let source = exampleSource()
  private let servicesConfigured = configureExampleServices()
  @State private var controller = TileflowMapController()
  @State private var dark = false
  @State private var status = "Loading Tileflow…"

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text(status)
        Spacer()
        if servicesConfigured {
          Button("Walk to a café") {
            Task {
              do {
                status = try await showWalkingRoute(
                  to: "café", on: controller, inks: dark ? .dark : .light)
              } catch {
                status = "Directions unavailable"
              }
            }
          }
        }
        Button("Change theme") { dark.toggle() }
      }
      .padding()
      TileflowMap(source: source, theme: dark ? "dark" : "light", controller: controller) { event in
        switch event {
        case .contentReady: status = "Tileflow · SwiftUI"
        case .failed: status = "Map unavailable"
        case .tap: status = "Map selected"
        default: break
        }
      }
    }
  }
}
