// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "Tileflow",
  platforms: [.iOS(.v16)],
  products: [
    .library(name: "Tileflow", targets: ["Tileflow"]),
    .library(name: "TileflowConfiguration", targets: ["TileflowConfiguration"]),
    .library(name: "TileflowSearch", targets: ["TileflowSearch"]),
    .library(name: "TileflowRouting", targets: ["TileflowRouting"]),
    .library(name: "TileflowElevation", targets: ["TileflowElevation"]),
    .library(name: "TileflowGeoIP", targets: ["TileflowGeoIP"]),
    .library(name: "TileflowServiceContent", targets: ["TileflowServiceContent"]),
  ],
  dependencies: [
    // MapLibre Native draws maps. The version is exact: each upgrade is a reviewed change.
    .package(url: "https://github.com/maplibre/maplibre-gl-native-distribution", exact: "7.0.0")
  ],
  targets: [
    .target(
      name: "Tileflow",
      dependencies: [
        "TileflowConfiguration", "TileflowStyleBridge",
        .product(name: "MapLibre", package: "maplibre-gl-native-distribution"),
      ],
      path: "Sources/Tileflow"
    ),
    .target(
      name: "TileflowStyleBridge",
      dependencies: [.product(name: "MapLibre", package: "maplibre-gl-native-distribution")],
      path: "Sources/TileflowStyleBridge"
    ),
    .target(name: "TileflowConfiguration", path: "Sources/TileflowConfiguration"),
    .target(
      name: "TileflowSearch", dependencies: ["TileflowConfiguration"],
      path: "Sources/TileflowSearch"),
    .target(
      name: "TileflowRouting", dependencies: ["TileflowConfiguration"],
      path: "Sources/TileflowRouting"),
    .target(
      name: "TileflowElevation", dependencies: ["TileflowConfiguration"],
      path: "Sources/TileflowElevation"),
    .target(
      name: "TileflowGeoIP", dependencies: ["TileflowConfiguration"],
      path: "Sources/TileflowGeoIP"),
    .target(
      name: "TileflowServiceContent",
      dependencies: [
        "Tileflow", "TileflowSearch", "TileflowRouting", "TileflowElevation", "TileflowGeoIP",
      ],
      path: "Sources/TileflowServiceContent"),
    .testTarget(
      name: "TileflowTests",
      dependencies: ["Tileflow"],
      path: "Tests/TileflowTests",
      resources: [.copy("Fixtures")]
    ),
    .testTarget(
      name: "TileflowServiceTests",
      dependencies: [
        "TileflowConfiguration", "TileflowSearch", "TileflowRouting", "TileflowElevation",
        "TileflowGeoIP", "TileflowServiceContent",
      ],
      path: "Tests/TileflowServiceTests",
      resources: [.copy("Fixtures")]
    ),
  ]
)
