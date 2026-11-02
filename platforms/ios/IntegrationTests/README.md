# Swift integration tests

Run the Swift tests through `TileflowIntegration.xcodeproj` when testing WebKit and map
rendering. The project hosts the existing `Tests/TileflowTests` suite in a minimal UIKit
application and consumes the local Swift package. This gives WebKit and MapLibre Native an
application lifecycle, a window scene and a process identity; the standalone SwiftPM `xctest`
process does not provide them.

From the repository root, prepare the embedded resources with `pnpm native:runtime`, start
`node scripts/mobile-fixture-server.mjs`, then run:

```sh
xcodebuild test \
  -project platforms/ios/IntegrationTests/TileflowIntegration.xcodeproj \
  -scheme TileflowIntegration \
  -destination 'platform=iOS Simulator,id=<simulator-udid>'
```

The fixture server must stay running throughout the tests. To run it on another port, start it
with `TILEFLOW_FIXTURE_PORT=<port>` and pass the same value to the tests as
`TEST_RUNNER_TILEFLOW_FIXTURE_PORT=<port>`. CI rejects skipped tests. The test bundle copies the
same fixtures as SwiftPM and supplies its own `Bundle.module` accessor; the SDK and its embedded
resources still build through SwiftPM.

CI runs the suite on the standard macOS 26 runner with Xcode 26.6, on a pinned iPhone 17 simulator
with iOS 26.5. It exercises iOS WebKit, the `tileflow:` scheme transport, sessions, resource policy,
offline serving and the maps MapLibre Native draws with Metal, which the hosted simulator renders.
Hosted iOS simulators crash their GPU process during WebGL draws on both ARM and Intel runners,
with iOS 18.5 and 26 (rechecked with iOS 26.2 and 26.5 in October 2026); the macOS 26 crash report
identifies `SimMetalHost` inside `AppleParavirtGPUMetalIOGPUFamily`. The CI run therefore skips
only `MapIntegrationTests`, which draws the map with the web runtime. Run the command above on a
local Mac to render it on iOS itself. On failure, Xcode results are retained in the
`swift-integration-results` artifact.

MapLibre Native ships no Mac Catalyst slice, so neither the package nor these tests build for Mac
Catalyst.

The generated project and shared scheme are committed so CI only needs Xcode. After adding
test files or changing `project.yml`, regenerate them with XcodeGen 2.46.0:

```sh
xcodegen generate --spec platforms/ios/IntegrationTests/project.yml
```
