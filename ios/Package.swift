// swift-tools-version: 6.0
// Swift Package used by xtool (https://github.com/xtool-org/xtool) to build the
// iPhone app on Linux / Windows (WSL) without a Mac. See XTOOL.md.
// The Xcode project (NutriScan.xcodeproj) builds the same sources on a Mac.

import PackageDescription

let swiftSettings: [SwiftSetting] = [
    // Lets widget code fall back to deep links where App Intents metadata
    // (which only Xcode generates) would be needed.
    .define("XTOOL"),
]

let package = Package(
    name: "NutriScan",
    platforms: [.iOS(.v17)],
    products: [
        // xtool turns these library products into the app and its widget extension (xtool.yml).
        .library(name: "NutriScan", targets: ["NutriScan"]),
        .library(name: "NutriScanWidgets", targets: ["NutriScanWidgets"]),
    ],
    targets: [
        .target(
            name: "NutriScanShared",
            path: "Shared",
            swiftSettings: swiftSettings
        ),
        .target(
            name: "NutriScan",
            dependencies: ["NutriScanShared"],
            path: "NutriScan",
            exclude: ["Assets.xcassets"],
            swiftSettings: swiftSettings
        ),
        .target(
            name: "NutriScanWidgets",
            dependencies: ["NutriScanShared"],
            path: "NutriScanWidgets",
            exclude: ["Assets.xcassets"],
            swiftSettings: swiftSettings
        ),
    ],
    swiftLanguageModes: [.v5]
)
