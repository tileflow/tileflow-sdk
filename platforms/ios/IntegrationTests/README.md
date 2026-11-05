# Swift integration tests

The integration project hosts `Tests/TileflowTests` in a UIKit app. This gives MapLibre Native a
window scene and a render surface. CI runs all map tests with Metal on an iPhone simulator.

From the repository root, check the generated types and start the fixture server.

```sh
pnpm native:check-generated
pnpm exec turbo build --filter=@tileflow/dev --filter=@tileflow/maps
node scripts/mobile-fixture-server.mjs
```

Keep the server running. In a second terminal, run the integration suite on a booted simulator.

```sh
xcodebuild test \
  -project platforms/ios/IntegrationTests/TileflowIntegration.xcodeproj \
  -scheme TileflowIntegration \
  -destination 'platform=iOS Simulator,id=<simulator-udid>'
```

To use another port, set `TILEFLOW_FIXTURE_PORT` on the server and
`TEST_RUNNER_TILEFLOW_FIXTURE_PORT` on the test command. Keep Reduce Motion off for camera
cancellation, shot cues and annotation tracking. CI retains failed results in
`swift-integration-results`.

After changing test files or `project.yml`, regenerate the committed project with XcodeGen.

```sh
xcodegen generate --spec platforms/ios/IntegrationTests/project.yml
```
