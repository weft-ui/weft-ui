package net.mioyi.weftui

import androidx.compose.runtime.Composable

/**
 * One template instance of the view protocol. The generated views subclass
 * it per template, store value slots and mount points in snapshot state, and
 * override [apply], [mount] and [Content].
 */
abstract class WeftScope(
    /** Scope id assigned by the JS logic layer. */
    val id: Int,
    val session: WeftSession,
) {
    /** Children by mount point, as last mounted; the session uses them to destroy subtrees. */
    internal val children = HashMap<Int, List<WeftScope>>()

    /** Writes value slot [slot] (a `set` op). */
    open fun apply(slot: Int, value: WeftValue) {}

    /**
     * Replaces the children of mount point [point] (`branch`, `rows` and
     * `attach` ops); children are scopes of the point's templates.
     */
    open fun mount(point: Int, children: List<WeftScope>) {}

    /** Page scopes are roots referenced by navigation rather than attach. */
    open val isPage: Boolean get() = false

    /** Page title bar; generated page scopes override this when a NavBar is present. */
    @Composable
    open fun NavigationBar(onBack: (() -> Unit)?) {
        WeftNavigationBar(title = "", hidden = false, onBack = onBack) {}
    }

    /** The Compose UI of this scope. */
    @Composable
    abstract fun Content()

    /**
     * Reports that event slot [slot] fired. The handler runs and its ops are
     * applied before this returns; `false` means a controlled edit was
     * refused and the control must show its value slot again.
     */
    fun dispatch(slot: Int, payload: WeftValue? = null): Boolean = session.dispatch(id, slot, payload)
}

/** Scope 0: holds the root component instance at mount point 0. */
internal class RootScope(session: WeftSession) : WeftScope(0, session) {
    override fun mount(point: Int, children: List<WeftScope>) {
        session.root = children.firstOrNull()
    }

    @Composable
    override fun Content() {}
}
