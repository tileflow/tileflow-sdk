# Swift and Kotlin SDKs on the embedded web renderer

This branch keeps the Swift and Kotlin map SDKs as they were built on an embedded web renderer:
Tileflow Core and MapLibre GL JS running inside `WKWebView` on iOS and Android `WebView`, driven
through a typed message protocol. The released Swift and Kotlin SDKs render with MapLibre Native
instead; this branch is not maintained for applications.

It is kept as the reference and starting point for SDKs that host a web map inside a native app,
such as a Capacitor plugin.

## What it contains

- `packages/mobile-runtime`: the embedded renderer (Core, MapLibre GL JS, camera, location puck,
  runtime style, annotations and tracked view positions), its protocol definition
  (`protocol.json`) and size budget.
- `platforms/ios` and `platforms/android`: the native hosts. `TileflowMapView`, the UIKit, SwiftUI,
  View and Compose APIs, the bridge, the data channel, and the renderer process recovery. The
  same modules hold the parts that do not depend on the renderer: configuration and credentials,
  Hosted sessions, the network transport and disk cache, offline regions and packs, and the
  Search, Routing, Elevation and GeoIP clients.
- `scripts/mobile-*.mjs`: protocol and style type generation, runtime build, fixture server and
  runtime smoke test.
- Guides: `native-map-camera.md`, `native-location.md`, `native-style-data.md`,
  `native-annotations.md`, `native-services.md` and `web-parity.md`, plus
  `docs/contracts/mobile-protocol.md`.

## Building it

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm native:runtime
node scripts/mobile-runtime-smoke.mjs
```

The iOS integration tests run on Mac Catalyst from
`platforms/ios/IntegrationTests/TileflowIntegration.xcodeproj`; the Android modules build with
Gradle from `platforms/android`.
