import AppKit
import CoreText
import SwiftUI
import Testing
@testable import WeftKit

@MainActor @Test func assetCatalogProvidesImagesAndChoosesDensity() throws {
    try withAssetBundle { bundle, workspace in
        let resources = try #require(bundle.resourceURL)
        let logo = workspace.appendingPathComponent("Assets.xcassets/logo.imageset", isDirectory: true)
        try FileManager.default.createDirectory(at: logo, withIntermediateDirectories: true)
        try Data(#"{"info":{"author":"weft","version":1}}"#.utf8)
            .write(to: logo.deletingLastPathComponent().appendingPathComponent("Contents.json"))
        try Data(#"""
        {"info":{"author":"weft","version":1},"images":[
          {"idiom":"universal","filename":"logo.png","scale":"1x"},
          {"idiom":"universal","filename":"logo@2x.png","scale":"2x"}
        ]}
        """#.utf8).write(to: logo.appendingPathComponent("Contents.json"))
        for file in ["logo.png", "logo@2x.png"] {
            try FileManager.default.copyItem(at: fixture("images/\(file)"), to: logo.appendingPathComponent(file))
        }
        let compiler = Process()
        compiler.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        compiler.arguments = ["actool", "--compile", resources.path, "--platform", "macosx",
                              "--target-device", "mac", "--minimum-deployment-target", "14.0",
                              logo.deletingLastPathComponent().path]
        try compiler.run()
        compiler.waitUntilExit()
        try #require(compiler.terminationStatus == 0)

        let assets = WeftAssets(bundle: bundle)
        let image = try #require(assets.image("logo", scale: 2))
        #expect(image.size == CGSize(width: 64, height: 40))
        let native = try #require(bundle.image(forResource: "logo"))
        for scale in [1, 2] {
            let context = try #require(CGContext(data: nil, width: 64 * scale, height: 40 * scale,
                                                 bitsPerComponent: 8, bytesPerRow: 0,
                                                 space: CGColorSpaceCreateDeviceRGB(),
                                                 bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
            var rect = CGRect(origin: .zero, size: image.size)
            let bitmap = try #require(native.cgImage(forProposedRect: &rect,
                context: NSGraphicsContext(cgContext: context, flipped: false), hints: nil))
            #expect(bitmap.width == 64 * scale)
            #expect(bitmap.height == 40 * scale)
        }
    }
}

@MainActor @Test func missingImageFillsItsBoxWithThePlaceholder() throws {
    let assets = WeftAssets(bundle: .main)
    #expect(assets.image("missing", scale: 2) == nil)
    let placeholder = WeftColor.rgba(0xff0000ff)
    let view = WeftImage(src: "asset:missing", placeholder: placeholder)
        .weftDecoration(radius: 8, clip: true)
        .weftFrame(width: 30, height: 20)
        .environment(\.weftAssets, assets)
    let renderer = ImageRenderer(content: view)
    let image = try #require(renderer.cgImage)
    #expect(image.width == 30)
    #expect(image.height == 20)
    let bitmap = NSBitmapImageRep(cgImage: image)
    #expect(bitmap.colorAt(x: 0, y: 0)?.alphaComponent == 0)
    let reference = ImageRenderer(content: placeholder.resolved.frame(width: 30, height: 20))
    let expected = NSBitmapImageRep(cgImage: try #require(reference.cgImage))
    #expect(bitmap.colorAt(x: 15, y: 10) == expected.colorAt(x: 15, y: 10))
}

@MainActor @Test func processRegistrationSelectsTheBundledPostScriptFaces() throws {
    try withAssetBundle { bundle, _ in
        let fonts = try #require(bundle.resourceURL).appendingPathComponent("fonts", isDirectory: true)
        try FileManager.default.createDirectory(at: fonts, withIntermediateDirectories: true)
        for file in ["Inter-Regular.ttf", "Inter-SemiBold.ttf", "Inter-Bold.ttf"] {
            try FileManager.default.copyItem(at: fixture("fonts/\(file)", example: true), to: fonts.appendingPathComponent(file))
        }
        try Data(#"""
        [
          {"file":"Inter-Regular.ttf","family":"Inter","weight":400,"italic":false},
          {"file":"Inter-SemiBold.ttf","family":"Inter","weight":600,"italic":false},
          {"file":"Inter-Bold.ttf","family":"Inter","weight":700,"italic":false}
        ]
        """#.utf8).write(to: fonts.appendingPathComponent("manifest.json"))
        let assets = WeftAssets(bundle: bundle)
        for (weight, expected) in [(400, "Inter-Regular"), (600, "Inter-SemiBold"), (700, "Inter-Bold")] {
            let face = try #require(assets.face(family: "Inter", weight: weight, italic: false))
            #expect(face.name == expected)
            let font = CTFontCreateWithName(face.name as CFString, 18, nil)
            #expect(CTFontCopyPostScriptName(font) as String == expected)
        }
    }
}

@Test func intrinsicImageSizePreservesAspectWithOneKnownSide() {
    let intrinsic = CGSize(width: 64, height: 40)
    #expect(WeftProposal().imageIdeal(intrinsic: intrinsic) == intrinsic)
    #expect(WeftProposal(width: .exact(96)).imageIdeal(intrinsic: intrinsic) == CGSize(width: 96, height: 60))
    #expect(WeftProposal(height: .exact(20)).imageIdeal(intrinsic: intrinsic) == CGSize(width: 32, height: 20))
    #expect(WeftProposal(width: .atMost(32)).imageIdeal(intrinsic: intrinsic) == CGSize(width: 32, height: 20))
}

private func fixture(_ path: String, example: Bool = false) -> URL {
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { root.deleteLastPathComponent() }
    return root.appendingPathComponent(example ? "example/assets/\(path)" : "tests/vite/fixtures/assets/assets/\(path)")
}

private func withAssetBundle(_ body: (Bundle, URL) throws -> Void) throws {
    let id = UUID().uuidString
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(id, isDirectory: true)
    let path = directory.appendingPathComponent("TestAssets.bundle", isDirectory: true)
    let contents = path.appendingPathComponent("Contents", isDirectory: true)
    try FileManager.default.createDirectory(at: contents.appendingPathComponent("Resources"), withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let metadata = try PropertyListSerialization.data(fromPropertyList: [
        "CFBundleIdentifier": "net.mioyi.weftui.tests.\(id)", "CFBundlePackageType": "BNDL",
    ], format: .xml, options: 0)
    try metadata.write(to: contents.appendingPathComponent("Info.plist"))
    try body(#require(Bundle(url: path)), directory)
}
