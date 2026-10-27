# Swift integration tests

Run the Swift tests through `TileflowIntegration.xcodeproj` when testing WebKit and map
rendering. The project hosts the existing `Tests/TileflowTests` suite in a minimal UIKit
application and consumes the local Swift package. This gives WebKit an application lifecycle
and process identity; the standalone SwiftPM `xctest` process does not provide them.

From the repository root, prepare the embedded resources with `pnpm native:runtime`, start
`node scripts/mobile-fixture-server.mjs`, then run:

```sh
xcodebuild test \
  -project platforms/ios/IntegrationTests/TileflowIntegration.xcodeproj \
  -scheme TileflowIntegration \
  -destination 'platform=iOS Simulator,id=<simulator-udid>'
```

The fixture server must stay running throughout the tests. CI rejects skipped tests.
The test bundle copies the same fixtures as SwiftPM and supplies its own `Bundle.module`
accessor; the SDK and its embedded resources still build through SwiftPM.

CI pins macOS 15 and Xcode 26.2, selecting the matching iOS 26.2 simulator. On the macOS
26.6.2 runner with Xcode 26.6 and iOS 26.5, WebGL draws crash `SimMetalHost` inside
`AppleParavirtGPUMetalIOGPUFamily`, including on the larger runner. Keep the pinned
environment until a replacement passes the complete rendering and reload test. Xcode
results and simulator diagnostics are retained in the `swift-integration-results` artifact.

The generated project and shared scheme are committed so CI only needs Xcode. After adding
test files or changing `project.yml`, regenerate them with XcodeGen 2.46.0:

```sh
xcodegen generate --spec platforms/ios/IntegrationTests/project.yml
```
