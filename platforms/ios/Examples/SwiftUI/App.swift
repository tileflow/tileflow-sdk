import SwiftUI
import Tileflow

@main
struct TileflowExampleApp: App {
  var body: some Scene { WindowGroup { MapScreen() } }
}

struct MapScreen: View {
  private let source = exampleSource()
  @State private var dark = false
  @State private var status = "Loading Tileflow…"

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text(status)
        Spacer()
        Button("Change theme") { dark.toggle() }
      }
      .padding()
      TileflowMap(source: source, theme: dark ? "dark" : "light") { event in
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
