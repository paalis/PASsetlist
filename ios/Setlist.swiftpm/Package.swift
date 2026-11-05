// swift-tools-version: 5.9

// Swift Playgrounds-prosjekt for Setlist Generator på iPad.
// Åpne mappen «Setlist.swiftpm» i Swift Playgrounds-appen.

import PackageDescription
import AppleProductTypes

let package = Package(
    name: "Setlist",
    platforms: [
        .iOS("17.0")
    ],
    products: [
        .iOSApplication(
            name: "Setlist",
            targets: ["AppModule"],
            bundleIdentifier: "com.setlistgenerator.ipad",
            teamIdentifier: "",
            displayVersion: "1.0",
            bundleVersion: "1",
            appIcon: .placeholder(icon: .leaf),
            accentColor: .presetColor(.pink),
            supportedDeviceFamilies: [
                .pad,
                .phone
            ],
            supportedInterfaceOrientations: [
                .portrait,
                .landscapeRight,
                .landscapeLeft,
                .portraitUpsideDown(.when(deviceFamilies: [.pad]))
            ]
        )
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            path: "."
        )
    ]
)
