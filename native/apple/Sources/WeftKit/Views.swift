import SwiftUI
import Observation
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

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
    /// Only the topmost presentation (the window or a modal page) may host overlays; SwiftUI
    /// cannot present an alert from a view that is covered by a sheet.
    var enabled = true

    func body(content: Content) -> some View {
        let dialog = enabled ? overlays.active : nil
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
                if enabled, let toast = overlays.toast {
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

private struct WeftModalPageKey: EnvironmentKey {
    static let defaultValue = false
}

public extension EnvironmentValues {
    var weftModalPage: Bool {
        get { self[WeftModalPageKey.self] }
        set { self[WeftModalPageKey.self] = newValue }
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

#if os(macOS)
private struct WeftBackShortcut: NSViewRepresentable {
    let session: WeftSession

    func makeNSView(context: Context) -> BackShortcutView {
        BackShortcutView()
    }

    func updateNSView(_ view: BackShortcutView, context: Context) {
        view.session = session
    }

    static func dismantleNSView(_ view: BackShortcutView, coordinator: ()) {
        view.stopMonitoring()
    }
}

private final class BackShortcutView: NSView {
    weak var session: WeftSession?
    private var monitor: Any?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        stopMonitoring()
        guard window != nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command,
                  event.charactersIgnoringModifiers == "[" else { return event }
            let eventWindow = event.window
            let handled = MainActor.assumeIsolated {
                guard let self, eventWindow === self.window,
                      let session = self.session, session.navigationModal == nil,
                      !session.navigationPath.isEmpty else { return false }
                session.userNavigationPath(Array(session.navigationPath.dropLast()))
                return true
            }
            return handled ? nil : event
        }
    }

    func stopMonitoring() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }
}

func macOSTabTitle(_ title: String, badge: String?) -> String {
    guard let badge else { return title }
    return "\(title) \(badge.isEmpty ? "•" : badge)"
}
#endif

private struct WeftPushedTab: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
        content.toolbar(.hidden, for: .tabBar)
        #else
        content
        #endif
    }
}

/// Renders the root component or startup failure, respecting the safe area by default.
public struct WeftRoot: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.displayScale) private var displayScale
    @Environment(\.scenePhase) private var scenePhase
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
                    .ignoresSafeArea(.container)
                }
            }
            // Fill the window so the toast centers on it; keep the content at the top leading corner.
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .modifier(WeftOverlayModifier(overlays: session.overlays, enabled: session.navigationModal == nil))
            .onChange(of: environment, initial: true) { _, updated in
                session.update(environment: updated)
            }
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            session.update(phase: phase)
        }
        .onOpenURL { url in
            session.openLink(url)
        }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { session.openLink(url) }
        }
        #if os(macOS)
        .handlesExternalEvents(preferring: ["*"], allowing: ["*"])
        #endif
        #if os(iOS)
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)) { _ in
            session.signal(name: "memory", json: "{}")
        }
        #endif
    }

    private func content(size: CGSize) -> some View {
        Group {
            if let root = session.navigationRoot, session.failure == nil {
                navigation(root: root, size: size)
            } else {
                weftLinear(axis: .vertical) {
                    if let failure = session.failure {
                        Text(verbatim: failure).foregroundStyle(.red).padding()
                    } else if let root = session.root {
                        root.view.id(root.id)
                    }
                }
                .weftFrame(width: size.width, height: size.height)
                .clipped()
            }
        }
        .environment(\.layoutDirection, .leftToRight)
        .environment(\.weftAssets, session.assets)
    }

    @ViewBuilder
    private func navigation(root: WeftScope, size: CGSize) -> some View {
        Group {
            if usesSingleStack {
                navigationStack(root: root, tab: nil)
            } else {
                TabView(selection: Binding(
                    get: { session.navigationTab },
                    set: { _ = session.userSelectTab($0) }
                )) {
                    ForEach(session.tabs.indices, id: \.self) { index in
                        let tab = session.tabs[index]
                        Group {
                            if index < session.navigationTabs.count,
                               let page = session.page(session.navigationTabs[index]) {
                                navigationStack(root: page, tab: UInt32(index))
                            } else {
                                Color.clear
                            }
                        }
                        .tabItem {
                            Label {
                                #if os(macOS)
                                Text(macOSTabTitle(tab.title, badge: session.badges[index]))
                                #else
                                Text(tab.title)
                                #endif
                            } icon: {
                                Image(index == Int(session.navigationTab) ? tab.activeIcon : tab.icon, bundle: session.assets.bundle)
                            }
                        }
                        .badge(session.badges[index])
                        .tag(UInt32(index))
                    }
                }
            }
        }
        #if os(iOS)
        .sheet(item: modalBinding(style: 0)) { modal in
            modalPage(modal).presentationDetents([.medium, .large])
        }
        .fullScreenCover(item: modalBinding(style: 1)) { modal in
            modalPage(modal)
        }
        #else
        .sheet(item: modalBinding(style: nil)) { modal in
            macOSModalPage(modal)
                .frame(width: modal.style == 1 ? size.width : min(size.width, 480),
                       height: modal.style == 1 ? max(0, size.height - 32) : min(size.height, 360))
        }
        .background { WeftBackShortcut(session: session).accessibilityHidden(true) }
        #endif
    }

    private func modalBinding(style: UInt32?) -> Binding<NavigationModal?> {
        Binding(
            get: {
                guard let modal = session.navigationModal, style == nil || modal.style == style else { return nil }
                return modal
            },
            set: { value in
                if value == nil, let modal = session.navigationModal, style == nil || modal.style == style {
                    session.userDismissModal(modal.id)
                }
            }
        )
    }

    #if os(macOS)
    private func macOSModalPage(_ modal: NavigationModal) -> some View {
        Group {
            if let page = session.page(modal.id) {
                VStack(spacing: 0) {
                    if !page.modalBarHidden {
                        HStack {
                            Button("Close", systemImage: "xmark") {
                                session.userDismissModal(modal.id)
                            }
                            .keyboardShortcut(.cancelAction)
                            page.modalBar
                        }
                        .padding(12)
                        Divider()
                    }
                    // A page body may have several children; lay them out as one column like a root page.
                    weftLinear(axis: .vertical) { page.view.id(modal.id) }
                        .environment(\.weftModalPage, true)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
                .background {
                    if page.modalBarHidden {
                        Button("Close") { session.userDismissModal(modal.id) }
                            .keyboardShortcut(.cancelAction)
                            .opacity(0)
                            .accessibilityHidden(true)
                    }
                }
                .modifier(WeftOverlayModifier(overlays: session.overlays))
            }
        }
    }
    #endif

    private func modalPage(_ modal: NavigationModal) -> some View {
        NavigationStack {
            if let page = session.page(modal.id) {
                page.view.id(modal.id)
                    .modifier(WeftInlineTitle())
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close", systemImage: "xmark") {
                                session.userDismissModal(modal.id)
                            }
                        }
                    }
            }
        }
        .modifier(WeftOverlayModifier(overlays: session.overlays))
    }

    private var usesSingleStack: Bool {
        #if os(macOS)
        session.tabs.isEmpty || !session.navigationPath.isEmpty
        #else
        session.tabs.isEmpty
        #endif
    }

    private func navigationStack(root: WeftScope, tab: UInt32?) -> some View {
        NavigationStack(path: Binding(
            get: { tab == nil || tab == session.navigationTab ? session.navigationPath : [] },
            set: { if tab == nil || tab == session.navigationTab { _ = session.userNavigationPath($0) } }
        )) {
            root.view.id(root.id)
                .modifier(WeftInlineTitle())
                .navigationDestination(for: UInt32.self) { id in
                    if let page = session.page(id) {
                        page.view.id(id)
                            .modifier(WeftInlineTitle())
                            .modifier(WeftPushedTab())
                    }
                }
        }
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

