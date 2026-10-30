# Tileflow for iOS

Swift packages for Tileflow maps in UIKit and SwiftUI, and for the Tileflow Search, Routing,
Elevation and GeoIP services. The map embeds its renderer, workers, stylesheets and dependency
notices, so applications need no Node.js tooling and download no renderer code at run time.

This repository is generated for Swift Package Manager. Every tag is a release built from a clean,
reviewed revision of [tileflow/tileflow-sdk](https://github.com/tileflow/tileflow-sdk), where the
source, issues and contributions live. Please open issues and pull requests there.

## Install

Requires iOS 16 and Swift 6 tools. In Xcode, choose **File → Add Package Dependencies…**, enter
`https://github.com/tileflow/tileflow-swift` and select an exact version from the tags. Releases are
alphas (`0.1.0-alpha.N`); pin one exactly, because an alpha may change the API. In a `Package.swift`:

```swift
.package(url: "https://github.com/tileflow/tileflow-swift", exact: "0.1.0-alpha.0"),
```

Then add the products you use to your target:

| Product                  | Contents                                                     |
| ------------------------ | ------------------------------------------------------------ |
| `Tileflow`               | Map views for UIKit and SwiftUI with the embedded renderer   |
| `TileflowConfiguration`  | Configuration, credentials and app identity for the services |
| `TileflowSearch`         | Geocoding, reverse geocoding, autocomplete and nearby places |
| `TileflowRouting`        | Routes, isochrones, matrices, map matching and nearest roads |
| `TileflowElevation`      | Point heights, batches, profiles and GPX reading             |
| `TileflowGeoIP`          | Approximate location of the device's network connection      |
| `TileflowServiceContent` | Draws service answers on a Tileflow map                      |

Configuration and usage are described in the
[source repository](https://github.com/tileflow/tileflow-sdk/tree/main/platforms).

## Provenance

`provenance.json` names the source revision, the digest of every source input and the digest of the
embedded runtime of this release. The same release is published to Maven Central for Android under
`dev.tileflow` with the same version.

## License

Apache License 2.0, in `LICENSE`. The embedded dependencies keep their own notices in
`Sources/Tileflow/EmbeddedRuntime/notices.txt`. "Tileflow" and the Tileflow logo are trademarks of
Tileflow; see [TRADEMARKS.md](https://github.com/tileflow/tileflow-sdk/blob/main/TRADEMARKS.md).
