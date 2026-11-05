// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "Tileflow",
  platforms: [.iOS(.v16)],
  products: [
    .library(name: "Tileflow", targets: ["Tileflow"]),
    .library(name: "TileflowServices", targets: ["TileflowServices"]),
  ],
  dependencies: [
    // MapLibre Native draws maps. The version is exact: each upgrade is a reviewed change.
    .package(url: "https://github.com/maplibre/maplibre-gl-native-distribution", exact: "7.0.0")
  ],
  targets: [
    .target(
      name: "Tileflow",
      dependencies: [
        "TileflowFoundation", "TileflowStyleBridge",
        .product(name: "MapLibre", package: "maplibre-gl-native-distribution"),
      ],
      path: "Sources/Tileflow"
    ),
    .target(
      name: "TileflowStyleBridge",
      dependencies: [.product(name: "MapLibre", package: "maplibre-gl-native-distribution")],
      path: "Sources/TileflowStyleBridge"
    ),
    .target(name: "TileflowFoundation", path: "Sources/TileflowFoundation"),
    .target(
      name: "TileflowServices", dependencies: ["TileflowFoundation"],
      path: "Sources/TileflowServices"),
    .testTarget(
      name: "TileflowTests",
      dependencies: ["Tileflow"],
      path: "Tests/TileflowTests",
      resources: [.copy("Fixtures")]
    ),
    .testTarget(
      name: "TileflowServiceTests",
      dependencies: ["TileflowServices", "TileflowFoundation"],
      path: "Tests/TileflowServiceTests",
      resources: [.process("Fixtures")]
    ),
  ]
)
