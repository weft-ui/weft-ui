import SwiftUI

/// One template instance of the view protocol. The generated views subclass
/// it per template, store value slots and mount points in observable
/// properties, and override `apply`, `mount` and `view`.
@MainActor
open class WeftScope: Identifiable {
    /// Scope id assigned by the JS logic layer.
    public nonisolated let id: UInt32
    public unowned let session: WeftSession
    /// Children by mount point, as last mounted; the session uses them to
    /// destroy subtrees.
    var children: [UInt32: [WeftScope]] = [:]

    public required init(id: UInt32, session: WeftSession) {
        self.id = id
        self.session = session
    }

    /// Writes value slot `slot` (a `set` op).
    open func apply(_ slot: Int, _ value: WeftValue) {}

    /// Replaces the children of mount point `point` (`branch`, `rows` and
    /// `attach` ops); children are scopes of the point's templates.
    open func mount(_ point: Int, _ children: [WeftScope]) {}

    /// The SwiftUI view of this scope.
    open var view: AnyView { AnyView(EmptyView()) }

    #if os(macOS)
    /// Modal title bar content generated from this page's NavBar.
    open var modalBar: AnyView { AnyView(EmptyView()) }
    open var modalBarHidden: Bool { false }
    #endif

    /// Reports that event slot `slot` fired. The handler runs and its ops are
    /// applied before this returns; `false` means a controlled edit was
    /// refused and the control must show its value slot again.
    public func dispatch(_ slot: Int, _ payload: WeftValue? = nil) -> Bool {
        session.dispatch(scope: id, slot: UInt32(slot), payload: payload)
    }
}

/// Scope 0: holds the root component instance at mount point 0.
final class WeftRootScope: WeftScope {
    override func mount(_ point: Int, _ children: [WeftScope]) {
        session.root = children.first
    }
}
