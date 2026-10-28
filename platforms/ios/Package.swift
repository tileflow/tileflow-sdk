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
  targets: [
    .target(
      name: "Tileflow",
      dependencies: ["TileflowConfiguration"],
      path: "Sources/Tileflow",
      resources: [.copy("EmbeddedRuntime")]
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
