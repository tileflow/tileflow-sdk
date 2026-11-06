import UIKit

#if MAPS
  import Tileflow
#endif
#if SERVICES
  import TileflowServices
#endif

@main
@MainActor
final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    #if BENCHMARK
      let started = CACurrentMediaTime()
      let startedAt = Date().timeIntervalSince1970
    #endif
    let root = UIViewController()
    root.view.backgroundColor = .systemBackground
    let window = UIWindow(frame: UIScreen.main.bounds)
    window.overrideUserInterfaceStyle = .light
    window.rootViewController = root
    self.window = window

    #if BENCHMARK
      let beforeMapBytes = residentBytes()
    #endif

    #if MAPS
      let map = TileflowMapView(source: exampleSource(), initialCamera: benchmarkCamera)
      map.frame = root.view.bounds
      map.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      root.view.addSubview(map)
    #endif

    #if BENCHMARK
      var warnings: [String] = []
      map.onEvent = { event in
        switch event {
        case .warning(let warning): warnings.append(String(describing: warning))
        case .failed(let error): warnings.append(String(describing: error))
        default: break
        }
      }
    #endif

    window.makeKeyAndVisible()

    #if BENCHMARK
      Task {
        await measureStreets(
          map, started: started, startedAt: startedAt, beforeMapBytes: beforeMapBytes
        ) { warnings }
      }
    #elseif BENCHMARK_BASELINE
      if ProcessInfo.processInfo.arguments.contains("--measure") {
        Task {
          try await Task.sleep(for: .seconds(2))
          try writeMeasurement(["residentBytes": residentBytes()])
        }
      }
    #endif

    #if SERVICES
      if ProcessInfo.processInfo.arguments.contains("--exercise-services") {
        Task { await exerciseServices() }
      }
    #endif

    return true
  }
}

#if MAPS
  private let benchmarkCamera = TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 16)
#endif

#if BENCHMARK || BENCHMARK_BASELINE
  func residentBytes() -> UInt64 {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(
      MemoryLayout<mach_task_basic_info>.size / MemoryLayout<integer_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
      }
    }
    precondition(result == KERN_SUCCESS)
    return info.resident_size
  }

  func writeMeasurement(_ values: [String: Any]) throws {
    let documents = try FileManager.default.url(
      for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let data = try JSONSerialization.data(
      withJSONObject: values, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: documents.appendingPathComponent("measurement.json"), options: .atomic)
  }
#endif

#if SERVICES
  // Keep representative request paths through all four clients after Release dead stripping.
  private func exerciseServices() async {
    let configuration = try! TileflowConfiguration(apiOrigin: URL(string: "https://127.0.0.1:1")!)
    let start = TileflowPosition(longitude: -3.70, latitude: 40.42)
    let end = TileflowPosition(longitude: -3.69, latitude: 40.42)
    _ = try? await TileflowSearch(configuration: configuration).geocode(.init(query: "Madrid"))
    _ = try? await TileflowRouting(configuration: configuration).route(
      .init(locations: [start, end], mode: .walking))
    _ = try? await TileflowElevation(configuration: configuration).elevation(at: start)
    _ = try? await TileflowGeoIP(configuration: configuration).locate()
  }
#endif
