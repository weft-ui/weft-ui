import SwiftUI
import Observation

struct WeftOverlayOptions: Decodable {
    var title: String?
    var message: String?
    var confirmText: String?
    var cancelText: String?
    var destructive: Bool?
    var options: [String]?
    var destructiveIndex: Int?
    var icon: String?
    var duration: String?
}

@MainActor @Observable
final class WeftOverlays {
    struct Dialog: Identifiable {
        let id = UUID()
        let method: String
        let options: WeftOverlayOptions
        let resolve: (Data) -> Void
    }
    struct Toast: Identifiable {
        let id = UUID()
        let options: WeftOverlayOptions
    }
    private(set) var active: Dialog?
    private(set) var toast: Toast?
    private var pending: [Dialog] = []
    private var toastTask: Task<Void, Never>?

    func call(_ method: String, _ data: Data, resolve: @escaping (Data) -> Void) throws {
        let options = try JSONDecoder().decode(WeftOverlayOptions.self, from: data)
        switch method {
        case WeftProtocol.uiToast:
            toastTask?.cancel()
            let item = Toast(options: options)
            toast = item
            toastTask = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(options.duration == "long" ? 3000 : 1500))
                guard !Task.isCancelled, self?.toast?.id == item.id else { return }
                self?.toast = nil
            }
            resolve(Data())
        case WeftProtocol.uiAlert, WeftProtocol.uiConfirm, WeftProtocol.uiActionSheet:
            if method == WeftProtocol.uiActionSheet && !(1...6).contains(options.options?.count ?? 0) {
                throw PlatformFailure("weft: actionSheet expects 1–6 options")
            }
            let dialog = Dialog(method: method, options: options, resolve: resolve)
            if active == nil && pending.isEmpty { active = dialog } else { pending.append(dialog) }
        default:
            throw PlatformFailure("weft: ui.\(method) is not implemented")
        }
    }

    func finish(_ id: UUID, result: Data) {
        guard let dialog = active, dialog.id == id else { return }
        active = nil
        dialog.resolve(result)
        // Present the next dialog after SwiftUI has dismissed the current one.
        DispatchQueue.main.async { [weak self] in
            guard let self, self.active == nil, !self.pending.isEmpty else { return }
            self.active = self.pending.removeFirst()
        }
    }

    static func result(_ value: Bool) -> Data { Data((value ? "true" : "false").utf8) }
    static func result(_ index: Int?) -> Data { Data(index.map(String.init)?.utf8 ?? "null".utf8) }
}

private struct WeftOverlayModifier: ViewModifier {
    let overlays: WeftOverlays

    func body(content: Content) -> some View {
        let dialog = overlays.active
        let isAlert = dialog?.method == WeftProtocol.uiAlert || dialog?.method == WeftProtocol.uiConfirm
        let alertBinding = Binding(get: { isAlert }, set: { shown in
            if !shown, let dialog { dismiss(dialog) }
        })
        let sheetBinding = Binding(get: { dialog?.method == WeftProtocol.uiActionSheet }, set: { shown in
            if !shown, let dialog { dismiss(dialog) }
        })
        content
            .alert(dialog?.options.title ?? "", isPresented: alertBinding, presenting: dialog) { item in
                if item.method == WeftProtocol.uiConfirm {
                    Button(item.options.cancelText ?? "Cancel", role: .cancel) {
                        overlays.finish(item.id, result: WeftOverlays.result(false))
                    }
                }
                Button(item.options.confirmText ?? "OK", role: item.options.destructive == true ? .destructive : nil) {
                    overlays.finish(item.id, result: item.method == WeftProtocol.uiConfirm ? WeftOverlays.result(true) : Data())
                }
            } message: { item in
                if let message = item.options.message { Text(verbatim: message) }
            }
            .confirmationDialog(dialog?.options.title ?? "", isPresented: sheetBinding, titleVisibility: .visible, presenting: dialog) { item in
                ForEach(Array((item.options.options ?? []).enumerated()), id: \.offset) { index, label in
                    Button(label, role: index == item.options.destructiveIndex ? .destructive : nil) {
                        overlays.finish(item.id, result: WeftOverlays.result(index))
                    }
                }
                Button(item.options.cancelText ?? "Cancel", role: .cancel) { dismiss(item) }
            }
            .overlay(alignment: .bottom) {
                if let toast = overlays.toast {
                    HStack {
                        if toast.options.icon == "success" { Image(systemName: "checkmark.circle.fill") }
                        if toast.options.icon == "error" { Image(systemName: "xmark.circle.fill") }
                        Text(verbatim: toast.options.message ?? "")
                    }
                    .padding(.horizontal, 18).padding(.vertical, 10)
                    .foregroundStyle(.white).background(.black.opacity(0.8), in: Capsule())
                    .padding(.bottom, 24)
                }
            }
    }

    private func dismiss(_ item: WeftOverlays.Dialog) {
        let result = item.method == WeftProtocol.uiConfirm ? WeftOverlays.result(false) :
            item.method == WeftProtocol.uiActionSheet ? WeftOverlays.result(nil as Int?) : Data()
        overlays.finish(item.id, result: result)
    }
}

private struct WeftInlineTitle: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
        content.navigationBarTitleDisplayMode(.inline)
        #else
        content
        #endif
    }
}

/// Renders the root component or startup failure, respecting the safe area by default.
public struct WeftRoot: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.displayScale) private var displayScale
    private let session: WeftSession

    public init(session: WeftSession) {
        self.session = session
    }

    public var body: some View {
        GeometryReader { geometry in
            let environment = windowEnvironment(geometry)
            Group {
                if session.safeArea {
                    content(size: geometry.size)
                } else {
                    // Keep the outer reader in the safe area so platform.safeArea still reports the insets.
                    GeometryReader { fullWindow in
                        content(size: fullWindow.size)
                    }
                    .ignoresSafeArea()
                }
            }
            .modifier(WeftOverlayModifier(overlays: session.overlays))
            .onChange(of: environment, initial: true) { _, updated in
                session.update(environment: updated)
            }
        }
    }

    private func content(size: CGSize) -> some View {
        weftLinear(axis: .vertical) {
            if let failure = session.failure {
                Text(verbatim: failure)
                    .foregroundStyle(.red)
                    .padding()
            } else if let root = session.navigationRoot {
                NavigationStack(path: Binding(
                    get: { session.navigationPath },
                    set: { _ = session.userNavigationPath($0) }
                )) {
                    root.view.id(root.id)
                        .modifier(WeftInlineTitle())
                        .navigationDestination(for: UInt32.self) { id in
                            if let page = session.page(id) {
                                page.view.id(id).modifier(WeftInlineTitle())
                            }
                        }
                }
                #if os(macOS)
                // The stack's toolbar back button belongs to the pushed page and disappears with a hidden
                // navigation bar; ⌘[ lives outside the toolbar so it works in both cases.
                .background {
                    Button("Back") {
                        session.userNavigationPath(Array(session.navigationPath.dropLast()))
                    }
                    .keyboardShortcut("[", modifiers: .command)
                    .disabled(session.navigationPath.isEmpty)
                    .opacity(0)
                    .accessibilityHidden(true)
                }
                #endif
                .frame(width: size.width, height: size.height)
            } else if let root = session.root {
                root.view.id(root.id)
            }
        }
        .weftFrame(width: size.width, height: size.height)
        .clipped()
        .environment(\.layoutDirection, .leftToRight)
        .environment(\.weftAssets, session.assets)
    }

    private func windowEnvironment(_ geometry: GeometryProxy) -> WeftEnvironment {
        #if os(iOS)
        let safe = geometry.safeAreaInsets
        let insets = WeftEnvironment.Insets(top: safe.top, bottom: safe.bottom, start: safe.leading, end: safe.trailing)
        #else
        let insets = WeftEnvironment.Insets()
        #endif
        // SwiftUI lays out this reader inside the safe area; include the insets in the full size.
        let size = CGSize(
            width: geometry.size.width + insets.start + insets.end,
            height: geometry.size.height + insets.top + insets.bottom)
        return WeftEnvironment(dark: colorScheme == .dark, size: size, scale: displayScale, insets: insets)
    }
}

/// Gives tappable Weft elements native button behavior without changing their layout or colors.
public struct WeftPressStyle: ButtonStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

/// Keeps interactive descendants of a button label individually accessible.
@MainActor public func weftButtonWithChildren<Label: View>(
    action: @escaping () -> Void,
    @ViewBuilder label: () -> Label
) -> some View {
    let content = label()
    let button = Button(action: action) { content }
    #if os(macOS)
    // SwiftUI exposes the button label but drops its interactive descendants on macOS.
    return button.accessibilityChildren { content.buttonStyle(.automatic) }
    #else
    return button
    #endif
}

