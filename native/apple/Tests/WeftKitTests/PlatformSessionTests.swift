import CoreGraphics
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers
@testable import WeftKit

@Test @MainActor func overlayParsingResultsAndQueue() async throws {
    let overlays = WeftOverlays()
    var results: [String] = []
    func receive(_ data: Data) { results.append(String(decoding: data, as: UTF8.self)) }
    try overlays.call("confirm", Data(#"{"title":"Continue?","confirmText":"Yes","destructive":true}"#.utf8), resolve: receive)
    let first = try #require(overlays.active)
    #expect(first.options.title == "Continue?")
    #expect(first.options.confirmText == "Yes")
    #expect(first.options.destructive == true)
    try overlays.call("actionSheet", Data(#"{"options":["A","B"],"destructiveIndex":1}"#.utf8), resolve: receive)
    #expect(overlays.active?.id == first.id)
    try overlays.call("toast", Data(#"{"message":"Saved","icon":"success","duration":"long"}"#.utf8), resolve: receive)
    #expect(overlays.toast?.options.message == "Saved")
    #expect(results == [""])
    overlays.finish(first.id, result: WeftOverlays.result(false))
    await Task.yield()
    let second = try #require(overlays.active)
    #expect(second.options.options == ["A", "B"])
    #expect(second.options.destructiveIndex == 1)
    overlays.finish(second.id, result: WeftOverlays.result(1))
    #expect(results == ["", "false", "1"])
    #expect(String(decoding: WeftOverlays.result(nil as Int?), as: UTF8.self) == "null")
    #expect(String(decoding: WeftOverlays.result(true), as: UTF8.self) == "true")
    #expect(throws: (any Error).self) { try overlays.call("actionSheet", Data(#"{"options":[]}"#.utf8), resolve: receive) }
    #expect(throws: (any Error).self) { try overlays.call("alert", Data("[]".utf8), resolve: receive) }
}

@Test func fetchAndImageRejectNonHttpSchemes() {
    #expect((try? PlatformModules.validatedFetchURL("https://example.com/data")) != nil)
    #expect((try? PlatformModules.validatedFetchURL("HTTP://example.com/data")) != nil)
    #expect((try? PlatformModules.validatedFetchURL("file:///etc/passwd")) == nil)
    #expect((try? PlatformModules.validatedFetchURL("data:text/plain,hello")) == nil)
    #expect((try? PlatformModules.validatedFetchURL("ftp://example.com/file")) == nil)

    #expect(WeftImageContent.validatedRemoteURL("https://example.com/a.png") != nil)
    #expect(WeftImageContent.validatedRemoteURL("file:///tmp/a.png") == nil)
    #expect(WeftImageContent.validatedRemoteURL("data:image/png;base64,iVBOR") == nil)
}

@Test func controlsSanitizeNonFiniteValues() {
    let badSlider = sanitizedSliderParams(value: .nan, min: -.infinity, max: 10, step: .nan)
    #expect(!badSlider.valid)
    #expect(badSlider.value == 0)
    #expect(badSlider.lower == 0)
    #expect(badSlider.upper == 1)
    #expect(badSlider.step == 1)

    let clampedSlider = sanitizedSliderParams(value: .infinity, min: 2, max: 8, step: 0)
    #expect(clampedSlider.valid)
    #expect(clampedSlider.value == 2)
    #expect(clampedSlider.step == 1)

    #expect(clampedProgressValue(.nan) == 0)
    #expect(clampedProgressValue(.infinity) == 0)
    #expect(clampedProgressValue(-0.5) == 0)
    #expect(clampedProgressValue(1.5) == 1)
    #expect(clampedProgressValue(0.4) == 0.4)
}

@Test func imageRejectsOversizedHeaderBeforeDecode() throws {
    // Encode a real 10x10 PNG via CoreGraphics/ImageIO.
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let ctx = try #require(CGContext(
        data: nil, width: 10, height: 10, bitsPerComponent: 8, bytesPerRow: 40,
        space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ))
    let cgImage = try #require(ctx.makeImage())
    let smallPng = NSMutableData()
    let dest = try #require(CGImageDestinationCreateWithData(smallPng, UTType.png.identifier as CFString, 1, nil))
    CGImageDestinationAddImage(dest, cgImage, nil)
    #expect(CGImageDestinationFinalize(dest))
    #expect(WeftImageContent.withinPixelLimit(smallPng as Data))
    #expect(WeftImageContent(data: smallPng as Data) != nil)

    // Minimal 54-byte BMP header claiming 5000x5000 (25M pixels > 16,777,216 limit).
    var hugeBmp = Data(count: 54)
    hugeBmp[0] = 0x42 // 'B'
    hugeBmp[1] = 0x4D // 'M'
    hugeBmp[14] = 40  // BITMAPINFOHEADER size
    for (offset, val) in [(18, UInt32(5000)), (22, UInt32(5000))] {
        var le = val.littleEndian
        withUnsafeBytes(of: &le) { hugeBmp.replaceSubrange(offset..<(offset + 4), with: $0) }
    }
    hugeBmp[26] = 1   // planes
    hugeBmp[28] = 24  // bpp

    #expect(!WeftImageContent.withinPixelLimit(hugeBmp))
    #expect(WeftImageContent(data: hugeBmp) == nil)
    #expect(!WeftImageContent.withinPixelLimit(Data()))
}

@Test func navigationTransitions() {
    #expect(navigationTransition(from: [1], to: [1, 2]) == .push)
    #expect(navigationTransition(from: [1, 2], to: [1]) == .pop)
    #expect(navigationTransition(from: [1, 2], to: [1, 3]) == .replace)
    #expect(navigationTransition(from: [1], to: [1]) == .replace)
}

@Test @MainActor func navigationBackReportsRetainedStack() {
    let session = WeftSession(bytecode: nil, resources: .main, layoutHash: 0, safeArea: true) { _, id, session in
        WeftScope(id: id, session: session)
    }
    var bytes: [UInt8] = [WeftProtocol.version]
    func word(_ value: UInt32) {
        withUnsafeBytes(of: value.littleEndian) { bytes.append(contentsOf: $0) }
    }
    for id: UInt32 in [1, 2, 3] {
        bytes.append(OpCode.create.rawValue)
        word(id)
        word(0)
    }
    bytes.append(OpCode.nav.rawValue)
    word(0); word(1); word(1); word(2); word(2); word(3); word(0); word(0)
    bytes.withUnsafeBytes { session.commit($0) }
    #expect(session.navigationPath == [2, 3])
    #expect(session.userNavigationPath([2]) == #"{"tab":0,"stack":[2],"modal":0}"#)
    #expect(session.navigationPath == [2])
    #expect(session.page(3) == nil)
    #expect(session.userNavigationPath([3]) == nil)
}

@Test @MainActor func navigationTabSwitchAndBadges() throws {
    let tab = WeftTab(title: "Home", icon: "home", activeIcon: "home-on")
    let session = WeftSession(bytecode: nil, resources: .main, layoutHash: 0, safeArea: true, tabs: [tab, tab]) { _, id, session in
        WeftScope(id: id, session: session)
    }
    try session.setBadge(Data(#"{"tab":1,"text":""}"#.utf8))
    #expect(session.badges[1] == "")
    try session.setBadge(Data(#"{"tab":1,"text":null}"#.utf8))
    #expect(session.badges[1] == nil)
    var bytes: [UInt8] = [WeftProtocol.version]
    func word(_ value: UInt32) { withUnsafeBytes(of: value.littleEndian) { bytes.append(contentsOf: $0) } }
    for id: UInt32 in [1, 2, 3] {
        bytes.append(OpCode.create.rawValue); word(id); word(0)
    }
    bytes.append(OpCode.nav.rawValue)
    word(0); word(2); word(1); word(2); word(1); word(3); word(0); word(0)
    bytes.withUnsafeBytes { session.commit($0) }
    #expect(session.userSelectTab(1) == #"{"tab":1,"stack":[],"modal":0}"#)
    #expect(session.navigationRoot?.id == 2)
    #expect(session.navigationPath.isEmpty)
    #expect(session.page(3) == nil)
    #expect(session.userSelectTab(1) == nil)
    #expect(session.userSelectTab(9) == nil)
    #expect(session.userSelectTab(0) == #"{"tab":0,"stack":[],"modal":0}"#)
}

@Test @MainActor func navigationSelectsUncreatedTab() {
    let tab = WeftTab(title: "Tab", icon: "tab", activeIcon: "tab")
    let session = WeftSession(bytecode: nil, resources: .main, layoutHash: 0, safeArea: true, tabs: [tab, tab]) { _, id, session in
        WeftScope(id: id, session: session)
    }
    var bytes: [UInt8] = [WeftProtocol.version]
    func word(_ value: UInt32) { withUnsafeBytes(of: value.littleEndian) { bytes.append(contentsOf: $0) } }
    bytes.append(OpCode.create.rawValue); word(1); word(0)
    bytes.append(OpCode.nav.rawValue)
    word(0); word(2); word(1); word(0); word(0); word(0); word(0)
    bytes.withUnsafeBytes { session.commit($0) }
    #expect(session.userSelectTab(1) == #"{"tab":1,"stack":[],"modal":0}"#)
    #expect(session.navigationRoot == nil)
    #expect(session.page(1) != nil)
    bytes = [WeftProtocol.version]
    bytes.append(OpCode.create.rawValue); word(2); word(0)
    bytes.append(OpCode.nav.rawValue)
    word(1); word(2); word(1); word(2); word(0); word(0); word(0)
    bytes.withUnsafeBytes { session.commit($0) }
    #expect(session.navigationRoot?.id == 2)
    #expect(session.page(1) != nil)
}

@Test @MainActor func sessionCommitStopsAfterMissingTemplateOp() {
    var requestedTemplates: [UInt32] = []
    let session = WeftSession(bytecode: nil, resources: .main, layoutHash: 0, safeArea: true) { template, id, session in
        requestedTemplates.append(template)
        if template == 999 { return nil }
        return WeftScope(id: id, session: session)
    }

    // Batch: [version, Create(scope=1, template=999), Create(scope=2, template=1)]
    var bytes: [UInt8] = [WeftProtocol.version]
    func appendCreate(scope: UInt32, template: UInt32) {
        bytes.append(1) // Code.create
        withUnsafeBytes(of: scope.littleEndian) { bytes.append(contentsOf: $0) }
        withUnsafeBytes(of: template.littleEndian) { bytes.append(contentsOf: $0) }
    }
    appendCreate(scope: 1, template: 999)
    appendCreate(scope: 2, template: 1)

    bytes.withUnsafeBytes { session.commit($0) }

    #expect(requestedTemplates == [999])
    #expect(session.failure == "weft: the views have no template 999")
}
