# MapLibre Native on Android: check receipts

Receipts written by `NativeEngineFeasibilityTest` (`platforms/android/tileflow/src/androidTest/java/dev/tileflow/sdk/nativeengine`)
with `org.maplibre.gl:android-sdk-opengl:13.7.1` on an Android 16 (API 36) arm64 emulator with a
software GPU. Pictures stay out of the repository. `hosted-runners.json` records the run on
GitHub-hosted runners.

Run the checks with `TILEFLOW_FIXTURE_PORT=18682 node scripts/mobile-fixture-server.mjs`,
`adb reverse tcp:18682 tcp:18682` and `scripts/native-engine-feasibility.sh`. The style family
check also needs `TILEFLOW_NATIVE_ARTIFACTS` naming the output of
`pnpm exec tsx scripts/native-streets-artifacts.ts <directory>` (its `native` folder), and the
elevation checks a style pack pushed to `/data/local/tmp/tileflow-native-engine/`.
