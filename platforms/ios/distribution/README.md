# Tileflow for iOS

Swift packages for Tileflow maps in UIKit and SwiftUI, and for the Tileflow Search, Routing,
Elevation and GeoIP services. The map uses a pinned MapLibre Native framework. Swift Package Manager downloads it when building your app.

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

| Product            | Contents                                                                         |
| ------------------ | -------------------------------------------------------------------------------- |
| `Tileflow`         | Native maps for UIKit and SwiftUI, offline regions, location and drawing helpers |
| `TileflowServices` | Search, Routing, Elevation and GeoIP clients                                     |

Both products expose shared configuration and result types. Import the products your app uses.

Configuration and usage are described in the
[source repository](https://github.com/tileflow/tileflow-sdk/tree/main/platforms).

## Provenance

`provenance.json` names the source revision, the source inventory digest and the renderer versions. The same release is published to Maven Central for Android under
`dev.tileflow` with the same version.

## License

The Tileflow SDK uses the Apache License 2.0 in `LICENSE`. Include the MapLibre license and third-party notices in your app’s notices. [MapLibre notices](MapLibreNotices/NOTICE.txt)

“Tileflow” and the Tileflow logo are trademarks of Tileflow. [Trademark policy](https://github.com/tileflow/tileflow-sdk/blob/main/TRADEMARKS.md)
