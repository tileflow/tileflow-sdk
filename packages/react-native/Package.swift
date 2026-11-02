// swift-tools-version: 6.0
// Builds and tests the bridge's Swift conversions against this repository's Swift SDK, without
// React Native. Apps build these files through the CocoaPods spec instead.
import PackageDescription

let package = Package(
  name: "TileflowReactNativeBridge",
  platforms: [.iOS(.v16)],
  dependencies: [.package(name: "Tileflow", path: "../../platforms/ios")],
  targets: [
    .target(
      name: "TileflowReactNativeBridge",
      dependencies: [
        .product(name: "Tileflow", package: "Tileflow"),
        .product(name: "TileflowSearch", package: "Tileflow"),
        .product(name: "TileflowRouting", package: "Tileflow"),
        .product(name: "TileflowElevation", package: "Tileflow"),
        .product(name: "TileflowGeoIP", package: "Tileflow"),
      ],
      path: "ios/Sources",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    .testTarget(
      name: "TileflowReactNativeBridgeTests",
      dependencies: ["TileflowReactNativeBridge"],
      path: "ios/BridgeTests",
      
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
  ]
)
