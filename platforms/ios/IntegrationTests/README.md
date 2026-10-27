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

CI builds the app and test bundle for iOS Simulator, then runs the complete suite with Mac
Catalyst on the standard macOS 26 runner. Catalyst uses the same UIKit SDK sources and test
files while rendering through the host graphics stack. Hosted iOS simulators crash their GPU
process during WebGL draws on both ARM and Intel runners, with iOS 18.5 and 26. The macOS 26
crash report identifies `SimMetalHost` inside `AppleParavirtGPUMetalIOGPUFamily`.

Catalyst coverage does not replace execution on iOS: use the simulator command above on a
local Mac when changing iOS-specific behavior. The CI build still checks iOS compilation,
and the Catalyst suite exercises real WebKit rendering, resources, sessions, themes, and
reloads without skipping tests. Its app and test bundle use ad-hoc signing, so no developer
certificate is needed. Xcode results are retained in the `swift-integration-results` artifact.

To run the same Catalyst tests locally, keep the fixture server running and use:

```sh
xcodebuild test \
  -project platforms/ios/IntegrationTests/TileflowIntegration.xcodeproj \
  -scheme TileflowIntegration \
  -destination 'platform=macOS,variant=Mac Catalyst' \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=NO
```

The generated project and shared scheme are committed so CI only needs Xcode. After adding
test files or changing `project.yml`, regenerate them with XcodeGen 2.46.0:

```sh
xcodegen generate --spec platforms/ios/IntegrationTests/project.yml
```
