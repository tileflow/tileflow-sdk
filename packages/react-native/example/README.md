# Tileflow React Native example

This Expo development app uses `MapView`, `Camera`, a `GeoJSONSource` and a `CircleLayer`. It opens the Streets fixture at zoom 16 and can reopen a downloaded Hosted map with the server stopped.

Install the example's dependencies and configure the native SDK before prebuild.

```sh
pnpm --dir ../../.. --filter @tileflow/react-native build
pnpm install
export TILEFLOW_API_ORIGIN=http://127.0.0.1:18645
export EXPO_PUBLIC_TILEFLOW_FIXTURE_ORIGIN=$TILEFLOW_API_ORIGIN
export TILEFLOW_SWIFT_PACKAGE_PATH=/absolute/path/to/candidate/swift
export TILEFLOW_MAVEN_REPOSITORY=/absolute/path/to/candidate/maven
export TILEFLOW_NATIVE_VERSION=0.0.0-alpha.0
# Synthetic credential for the local fixture.
export TILEFLOW_MAP_CREDENTIAL=tf_public_000000000000000000000000000000000000000000000000
pnpm prebuild
pnpm ios
# Or pnpm android
```

Credentials belong in the `TILEFLOW_*_CREDENTIAL` prebuild environment variables. The plugin writes them to native configuration. Expo Go cannot load the native SDK.

Start the repository's `scripts/mobile-fixture-server.mjs` and forward the configured port when using an Android emulator. The server supplies synthetic Hosted data and the Streets map with its climate image.

Tap **Run offline check**. The app loads Streets, checks the declared points through source and rendered queries, changes their clustering radius, verifies feature-state and rollback after an invalid update, downloads a region and opens the Hosted map. When it displays **Stop the fixture server**, stop that process. The app then remounts the Hosted map with SDK networking disabled and reports `TILEFLOW_SELF_TEST` with its result. **Enable network** restores SDK networking.

Set `EXPO_PUBLIC_TILEFLOW_SELF_TEST=1` before bundling to start the same check automatically. Use a loopback fixture origin for this mode.
