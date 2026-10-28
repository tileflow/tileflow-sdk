import SwiftUI
import Tileflow
import TileflowServiceContent

@main
struct TileflowExampleApp: App {
  init() { configureExample() }

  var body: some Scene { WindowGroup { MapScreen() } }
}

struct MapScreen: View {
  private let source = exampleSource()
  private let servicesAvailable = servicesConfigured()
  @State private var controller = TileflowMapController()
  @State private var dark = false
  @State private var status = "Loading Tileflow…"

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text(status)
        Spacer()
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
        Button("Change theme") { dark.toggle() }
      }
      .padding()
      TileflowMap(source: source, theme: dark ? "dark" : "light", controller: controller) { event in
        switch event {
        case .contentReady: status = "Tileflow · SwiftUI"
        case .failed(let error): status = "Map unavailable: \(error)"
        case .tap: status = "Map selected"
        default: break
        }
      }
    }
  }
}
