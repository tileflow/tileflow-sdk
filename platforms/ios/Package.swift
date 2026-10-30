// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "Tileflow",
  platforms: [.iOS(.v16)],
  products: [.library(name: "Tileflow", targets: ["Tileflow"])],
  targets: [
    .target(
      name: "Tileflow",
      path: "Sources/Tileflow",
      resources: [.copy("EmbeddedRuntime")]
    ),
    .testTarget(
      name: "TileflowTests",
      dependencies: ["Tileflow"],
      path: "Tests/TileflowTests",
      resources: [.copy("Fixtures")]
    ),
  ]
)
