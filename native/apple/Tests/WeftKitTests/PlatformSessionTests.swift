import CoreGraphics
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers
@testable import WeftKit

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
