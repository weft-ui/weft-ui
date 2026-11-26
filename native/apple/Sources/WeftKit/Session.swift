import Foundation
import SwiftUI
import Observation
import WeftCore
import os

let logger = Logger(subsystem: "net.mioyi.weftui", category: "weft")

public struct WeftTab {
    let title: String
    let icon: String
    let activeIcon: String

    public init(title: String, icon: String, activeIcon: String) {
        self.title = title
        self.icon = icon
        self.activeIcon = activeIcon
    }
}

struct NavigationModal: Identifiable, Equatable {
    let id: UInt32
    let style: UInt32
}

enum NavigationTransition { case push, pop, replace }

func navigationTransition(from old: [UInt32], to new: [UInt32]) -> NavigationTransition {
    if new.count > old.count && new.starts(with: old) { return .push }
    if new.count < old.count && old.starts(with: new) { return .pop }
    return .replace
}

/// One Weft app running in the native kernel: owns the kernel runtime and
/// the scope tree its ops build.
///
/// The kernel runs on the main thread: `commit` applies each batch of ops
/// to the scopes as it arrives, timers run on the main dispatch queue, and
/// platform calls complete on the main actor.
@MainActor
@Observable
public final class WeftSession {
    /// Creates the scope of template `template` for a `create` op.
    public typealias Make = @MainActor (_ template: UInt32, _ id: UInt32, _ session: WeftSession) -> WeftScope?

    /// The root component instance.
    public internal(set) var root: WeftScope?
    /// Why the app failed to start or render, shown instead of its views.
    public private(set) var failure: String?
    private(set) var navigationRoot: WeftScope?
    private(set) var navigationPath: [UInt32] = []
    private(set) var navigationTab: UInt32 = 0
    private(set) var navigationTabs: [UInt32] = []
    let tabs: [WeftTab]
    private(set) var badges: [Int: String] = [:]
    private(set) var navigationModal: NavigationModal?

    let overlays = WeftOverlays()
    let assets: WeftAssets
    let safeArea: Bool
    @ObservationIgnored private let make: Make
    @ObservationIgnored private var scopes: [UInt32: WeftScope] = [:]
    @ObservationIgnored private let host = Host()
    @ObservationIgnored private var environment = WeftEnvironment.initial()
    /// Whether a batch of ops is being applied; the kernel is not reentrant.
    @ObservationIgnored private var committing = false
    // The runtime and the bytecode it executes are released by `deinit`,
    // which runs on the main thread with the session's last reference.
    @ObservationIgnored private nonisolated(unsafe) var runtime: OpaquePointer?
    @ObservationIgnored private nonisolated(unsafe) var bytecode: UnsafeMutableRawBufferPointer?

    /// Registers `resources` and starts the app compiled to `bytecode` (`bundle.hbc`).
    /// The views implement the layout with hash `layoutHash`; failures are reported through `failure`.
    /// `safeArea` controls root layout without changing the insets reported to the app.
    public init(bytecode url: URL?, resources: Bundle, layoutHash: UInt64, safeArea: Bool, tabs: [WeftTab] = [], make: @escaping Make) {
        self.tabs = tabs
        assets = WeftAssets(bundle: resources)
        self.safeArea = safeArea
        self.make = make
        scopes[0] = WeftRootScope(id: 0, session: self)
        guard let url, let data = try? Data(contentsOf: url, options: .mappedIfSafe), !data.isEmpty else {
            fail("weft: cannot read the bundle \(url?.path ?? "bundle.hbc")")
            return
        }
        // The kernel needs 4-byte aligned bytecode that outlives the runtime.
        let buffer = UnsafeMutableRawBufferPointer.allocate(byteCount: data.count, alignment: 16)
        data.copyBytes(to: buffer)
        bytecode = buffer
        host.session = self
        let os = ProcessInfo.processInfo.operatingSystemVersion
        let version = "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)"
        var json = environment.json()
        json.append(0)
        runtime = version.withCString { version in
            json.withUnsafeBytes { bytes in
                var callbacks = host.callbacks(version: version, environment: bytes.bindMemory(to: CChar.self).baseAddress!)
                return weft_runtime_new(
                    &callbacks, buffer.baseAddress!.assumingMemoryBound(to: UInt8.self), buffer.count, layoutHash)
            }
        }
        if runtime == nil {
            fail(host.lastError ?? "weft: the app failed to start")
        }
    }

    deinit {
        weft_runtime_free(runtime)
        bytecode?.deallocate()
    }

    func update(environment: WeftEnvironment) {
        guard let runtime, self.environment != environment else { return }
        self.environment = environment
        environment.json().withUnsafeBytes {
            weft_runtime_environment(runtime, $0.bindMemory(to: CChar.self).baseAddress, $0.count)
        }
    }

    /// Reports event slot `slot` of `scope`; see `WeftScope.dispatch`.
    func dispatch(scope: UInt32, slot: UInt32, payload: WeftValue?) -> Bool {
        guard !committing else {
            assertionFailure("weft: an event was dispatched while ops were applied")
            return true
        }
        guard let runtime else { return true }
        var bytes: [UInt8] = []
        payload?.encode(into: &bytes)
        return bytes.withUnsafeBufferPointer {
            weft_runtime_dispatch(runtime, scope, slot, $0.baseAddress, $0.count)
        }
    }

    func window(scope: UInt32, point: UInt32, start: UInt32, end: UInt32) {
        guard !committing else {
            assertionFailure("weft: a window was requested while ops were applied")
            return
        }
        guard let runtime else { return }
        weft_runtime_window(runtime, scope, point, start, end)
    }

    func signal(name: String, json: String) {
        guard !committing else {
            assertionFailure("weft: a signal was sent while ops were applied")
            return
        }
        guard let runtime else { return }
        let length = json.utf8.count
        name.withCString { name in
            json.withCString { json in
                weft_runtime_signal(runtime, name, json, length)
            }
        }
    }

    func commit(_ bytes: UnsafeRawBufferPointer) {
        committing = true
        defer { committing = false }
        do {
            let ops = try OpReader.readAll(bytes)
            for op in ops {
                switch op {
                case .splice, .bind:
                    fail("weft: cannot apply ops (lazy lists are not supported by these views)")
                    return
                default: break
                }
            }
            for op in ops {
                if !apply(op) { break }
            }
        } catch {
            fail("weft: malformed ops (\(error))")
        }
    }

    private func apply(_ op: Op) -> Bool {
        switch op {
        case let .create(scope, template):
            guard let made = make(template, scope, self) else {
                fail("weft: the views have no template \(template)")
                return false
            }
            scopes[scope] = made
            return true
        case let .set(scope, slot, value):
            scopes[scope]?.apply(Int(slot), value)
            return true
        case let .branch(scope, point, child):
            mount(scope, point, child == 0 ? [] : [child])
            return true
        case let .rows(scope, point, children):
            mount(scope, point, children)
            return true
        case let .attach(scope, point, child):
            mount(scope, point, [child])
            return true
        case let .nav(tab, tabs, stack, modal, style):
            guard Int(tab) < tabs.count, tabs[Int(tab)] != 0, let root = scopes[tabs[Int(tab)]], stack.allSatisfy({ $0 != 0 && scopes[$0] != nil }),
                  modal == 0 || scopes[modal] != nil else {
                fail("weft: navigation references a missing page scope")
                return false
            }
            let previous = Set(navigationTabs + navigationPath + [navigationModal?.id ?? 0])
            let retained = Set(tabs + stack + [modal])
            let transition = navigationRoot?.id == root.id
                ? navigationTransition(from: navigationPath, to: stack) : .replace
            navigationTab = tab
            navigationTabs = tabs
            navigationModal = modal == 0 ? nil : NavigationModal(id: modal, style: style)
            let update = {
                self.navigationRoot = root
                self.navigationPath = stack
            }
            if transition == .replace {
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction, update)
            } else {
                update()
            }
            for id in previous.subtracting(retained) {
                if let scope = scopes[id], id != 0 { destroy(scope) }
            }
            return true
        case .splice, .bind:
            fail("weft: cannot apply ops (lazy lists are not supported by these views)")
            return false
        }
    }

    func page(_ id: UInt32) -> WeftScope? { id == 0 ? nil : scopes[id] }

    @discardableResult
    func userNavigationPath(_ path: [UInt32]) -> String? {
        guard path.count < navigationPath.count, navigationPath.starts(with: path) else { return nil }
        let removed = navigationPath.dropFirst(path.count)
        navigationPath = path
        for id in removed {
            if let scope = scopes[id] { destroy(scope) }
        }
        let stack = path.map(String.init).joined(separator: ",")
        let json = "{\"tab\":\(navigationTab),\"stack\":[\(stack)],\"modal\":\(navigationModal?.id ?? 0)}"
        signal(name: "navigation", json: json)
        return json
    }

    @discardableResult
    func userDismissModal(_ id: UInt32) -> String? {
        guard navigationModal?.id == id else { return nil }
        navigationModal = nil
        if let scope = scopes[id] { destroy(scope) }
        let stack = navigationPath.map(String.init).joined(separator: ",")
        let json = "{\"tab\":\(navigationTab),\"stack\":[\(stack)],\"modal\":0}"
        signal(name: "navigation", json: json)
        return json
    }

    @discardableResult
    func userSelectTab(_ tab: UInt32) -> String? {
        guard Int(tab) < tabs.count, Int(tab) < navigationTabs.count,
              tab != navigationTab || !navigationPath.isEmpty else { return nil }
        let removed = navigationPath
        navigationPath = []
        navigationTab = tab
        let root = navigationTabs[Int(tab)]
        navigationRoot = root == 0 ? nil : scopes[root]
        for id in removed {
            if let scope = scopes[id] { destroy(scope) }
        }
        let json = "{\"tab\":\(tab),\"stack\":[],\"modal\":0}"
        signal(name: "navigation", json: json)
        return json
    }

    func setBadge(_ data: Data) throws {
        struct Badge: Decodable { let tab: Int; let text: String? }
        let badge = try JSONDecoder().decode(Badge.self, from: data)
        guard badge.tab >= 0 && badge.tab < tabs.count else {
            throw PlatformFailure("weft: invalid badge tab")
        }
        badges[badge.tab] = badge.text
    }

    /// Mounts the scopes `ids` at `point` of `parent`; children no longer
    /// mounted there are destroyed with their descendants.
    private func mount(_ parent: UInt32, _ point: UInt32, _ ids: [UInt32]) {
        guard let scope = scopes[parent] else { return }
        let kept = Set(ids)
        for old in scope.children[point] ?? [] where !kept.contains(old.id) {
            destroy(old)
        }
        let children = ids.compactMap { scopes[$0] }
        scope.children[point] = children
        scope.mount(Int(point), children)
    }

    private func destroy(_ scope: WeftScope) {
        scopes[scope.id] = nil
        for children in scope.children.values {
            children.forEach(destroy)
        }
    }

    fileprivate func schedule(after delay: UInt64) {
        let deadline = DispatchTime.now() + .milliseconds(Int(min(delay, UInt64(Int32.max))))
        DispatchQueue.main.asyncAfter(deadline: deadline) { [weak self] in
            MainActor.assumeIsolated {
                guard let runtime = self?.runtime else { return }
                weft_runtime_tick(runtime)
            }
        }
    }

    fileprivate func call(_ id: UInt32, _ module: String, _ method: String, _ args: Data) {
        // Runs after the kernel's callback returns: the kernel is not reentrant.
        if module == WeftProtocol.navigationModule && method == WeftProtocol.navigationBadge {
            let result: Result<Data, any Error>
            do {
                try setBadge(args)
                result = .success(Data())
            } catch {
                result = .failure(error)
            }
            Task { [weak self] in self?.resolve(id, result) }
            return
        }
        if module == WeftProtocol.uiModule {
            Task { [weak self] in
                guard let self else { return }
                do {
                    try self.overlays.call(method, args) { [weak self] data in
                        self?.resolve(id, .success(data))
                    }
                } catch {
                    self.resolve(id, .failure(error))
                }
            }
            return
        }
        Task { [weak self] in
            let result: Result<Data, any Error>
            do {
                result = .success(try await PlatformModules.call(module, method, args))
            } catch {
                result = .failure(error)
            }
            self?.resolve(id, result)
        }
    }

    private func resolve(_ id: UInt32, _ result: Result<Data, any Error>) {
        guard let runtime else { return }
        let (ok, bytes) = switch result {
        case .success(let data): (true, data)
        case .failure(let error): (false, Data(error.localizedDescription.utf8))
        }
        bytes.withUnsafeBytes {
            weft_runtime_resolve(runtime, id, ok, $0.baseAddress?.assumingMemoryBound(to: UInt8.self), $0.count)
        }
    }

    private func fail(_ message: String) {
        logger.error("\(message, privacy: .public)")
        failure = message
    }
}

/// Context of the kernel's callbacks: forwards them to the session.
@MainActor
private final class Host {
    weak var session: WeftSession?
    /// The last error the kernel logged: why `weft_runtime_new` failed.
    var lastError: String?

    nonisolated static func from(_ ctx: UnsafeMutableRawPointer?) -> Host {
        Unmanaged<Host>.fromOpaque(ctx!).takeUnretainedValue()
    }

    /// The kernel's callbacks, valid while this host lives. Every callback
    /// arrives on the main thread.
    func callbacks(version: UnsafePointer<CChar>, environment: UnsafePointer<CChar>) -> weft_host {
        weft_host(
            protocol: UInt32(WeftProtocol.version),
            ctx: Unmanaged.passUnretained(self).toOpaque(),
            commit: { ctx, ops, len in
                let host = Host.from(ctx)
                let bytes = UnsafeRawBufferPointer(start: ops, count: len)
                MainActor.assumeIsolated { host.session?.commit(bytes) }
            },
            schedule: { ctx, delay in
                let host = Host.from(ctx)
                MainActor.assumeIsolated { host.session?.schedule(after: delay) }
            },
            supports: { _, module in
                guard let module else { return false }
                return PlatformModules.supported.contains(String(cString: module))
            },
            call: { ctx, id, module, method, args, len in
                let host = Host.from(ctx)
                let module = String(cString: module!)
                let method = String(cString: method!)
                let args = args.map { Data(bytes: $0, count: len) } ?? Data()
                MainActor.assumeIsolated { host.session?.call(id, module, method, args) }
            },
            log: { ctx, level, message, len in
                let host = Host.from(ctx)
                let text = String(decoding: UnsafeRawBufferPointer(start: message, count: len), as: UTF8.self)
                switch Int(level) {
                case WEFT_LOG_DEBUG: logger.debug("\(text, privacy: .public)")
                case WEFT_LOG_INFO: logger.info("\(text, privacy: .public)")
                case WEFT_LOG_WARN: logger.warning("\(text, privacy: .public)")
                default:
                    logger.error("\(text, privacy: .public)")
                    MainActor.assumeIsolated { host.lastError = text }
                }
            },
            version: version,
            environment: environment,
            launch: nil
        )
    }
}
