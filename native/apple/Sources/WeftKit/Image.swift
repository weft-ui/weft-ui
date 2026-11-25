import ImageIO
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

struct WeftImageContent {
    let image: Image
    let size: CGSize
}

extension WeftImageContent {
    static let maxBytes = 16 * 1024 * 1024
    static let maxPixels: Int64 = 16_777_216

    static func validatedRemoteURL(_ src: String) -> URL? {
        guard let url = URL(string: src),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            return nil
        }
        return url
    }

    static func withinPixelLimit(_ data: Data) -> Bool {
        guard data.count <= maxBytes,
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = props[kCGImagePropertyPixelWidth] as? NSNumber,
              let height = props[kCGImagePropertyPixelHeight] as? NSNumber else {
            return false
        }
        let w = width.int64Value
        let h = height.int64Value
        guard w > 0, h > 0 else { return false }
        let (pixels, overflow) = w.multipliedReportingOverflow(by: h)
        return !overflow && pixels <= maxPixels
    }

    init?(data: Data) {
        guard Self.withinPixelLimit(data) else { return nil }
        #if os(iOS)
        guard let native = UIImage(data: data) else { return nil }
        self.init(image: Image(uiImage: native), size: native.size)
        #else
        guard let native = NSImage(data: data), native.isValid else { return nil }
        if let bitmap = native.representations.first(where: { $0 is NSBitmapImageRep }) {
            // Network bitmaps use their pixel dimensions, not the file's print DPI.
            native.size = CGSize(width: bitmap.pixelsWide, height: bitmap.pixelsHigh)
        }
        self.init(image: Image(nsImage: native), size: native.size)
        #endif
    }
}

/// Displays a bundled or remote image, measuring its box before applying its fit.
public struct WeftImage: View {
    private let src: String
    private let fit: WeftImageFit
    private let placeholder: WeftColor?
    @Environment(\.weftAssets) private var assets
    @Environment(\.displayScale) private var displayScale
    @State private var remote: (src: String, content: WeftImageContent)?

    public init(src: String, fit: WeftImageFit = .cover, placeholder: WeftColor? = nil) {
        self.src = src
        self.fit = fit
        self.placeholder = placeholder
    }

    public var body: some View {
        if src.hasPrefix("asset:") {
            let name = String(src.dropFirst("asset:".count))
            let asset = assets?.image(name, scale: displayScale)
            #if DEBUG
            box(asset).onChange(of: name, initial: true) {
                if asset == nil { logger.warning("weft: missing image asset \(name, privacy: .public)") }
            }
            #else
            box(asset)
            #endif
        } else {
            box(remote?.src == src ? remote?.content : nil)
                .task(id: src) {
                    remote = nil
                    guard let url = WeftImageContent.validatedRemoteURL(src) else { return }
                    do {
                        let (bytes, response) = try await URLSession.shared.bytes(for: URLRequest(url: url))
                        guard !Task.isCancelled,
                              let http = response as? HTTPURLResponse,
                              (200..<300).contains(http.statusCode),
                              http.expectedContentLength <= Int64(WeftImageContent.maxBytes) else { return }
                        var data = Data()
                        if http.expectedContentLength > 0 {
                            data.reserveCapacity(Int(http.expectedContentLength))
                        }
                        for try await byte in bytes {
                            if Task.isCancelled || data.count >= WeftImageContent.maxBytes { return }
                            data.append(byte)
                        }
                        guard !Task.isCancelled, let content = WeftImageContent(data: data) else { return }
                        remote = (src, content)
                    } catch {
                        return
                    }
                }
        }
    }

    private func box(_ content: WeftImageContent?) -> some View {
        weftImageBox(intrinsic: content?.size ?? .zero) {
            if let content, content.size.width > 0, content.size.height > 0 {
                Color.clear.overlay {
                    let image = content.image.resizable()
                    switch fit {
                    case .cover: image.aspectRatio(content.size.width / content.size.height, contentMode: .fill)
                    case .contain: image.aspectRatio(content.size.width / content.size.height, contentMode: .fit)
                    case .fill: image
                    }
                }
                .clipped()
            } else {
                placeholder?.resolved ?? .clear
            }
        }
    }
}
