import Foundation
import Observation
import WeftCore
import os

let logger = Logger(subsystem: "net.mioyi.weftui", category: "weft")

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
    public init(bytecode url: URL?, resources: Bundle, layoutHash: UInt64, safeArea: Bool, make: @escaping Make) {
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

    func commit(_ bytes: UnsafeRawBufferPointer) {
        committing = true
        defer { committing = false }
        do {
            let ops = try OpReader.readAll(bytes)
            for op in ops {
                switch op {
                case .splice, .bind, .nav:
                    fail("weft: cannot apply ops (lazy lists and app navigation are not supported by these views)")
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
        case .splice, .bind, .nav:
            fail("weft: cannot apply ops (lazy lists and app navigation are not supported by these views)")
            return false
        }
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
            environment: environment
        )
    }
}
