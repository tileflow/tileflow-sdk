import Foundation
import SwiftUI

/// Runs the measurement plan named by `-plan <path>` (or the TF_PLAN environment variable),
/// writes `<path>.result.json` beside it, prints it and exits. Without a plan it only shows a
/// label, which is what the binary-size comparison builds.
@main
struct BenchApp: App {
    init() {
        let args = ProcessInfo.processInfo.arguments
        let plan = args.firstIndex(of: "-plan").map { args[$0 + 1] }
            ?? ProcessInfo.processInfo.environment["TF_PLAN"]
        if let plan {
            DispatchQueue.global(qos: .userInitiated).async {
                let text = (try? String(contentsOfFile: plan, encoding: .utf8)) ?? "{}"
                let result = text.withCString { pointer -> String in
                    let raw = tf_bench_run(pointer)!
                    defer { tf_string_free(raw) }
                    return String(cString: raw)
                }
                try? result.write(toFile: plan + ".result.json", atomically: true, encoding: .utf8)
                print("TF_BENCH_RESULT " + result)
                exit(0)
            }
        }
    }

    var body: some Scene {
        WindowGroup { Text("Valhalla on-device measurement") }
    }
}
