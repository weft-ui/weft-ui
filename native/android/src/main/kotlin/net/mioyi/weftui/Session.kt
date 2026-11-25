package net.mioyi.weftui

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.annotation.MainThread
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.nio.ByteBuffer

/** Creates the scope of template `template` for a `create` op. */
typealias WeftMake = (template: Int, id: Int, session: WeftSession) -> WeftScope?

/**
 * One Weft app running in the native kernel: owns the kernel runtime and the
 * scope tree its ops build.
 *
 * The kernel runs on the main thread: `commit` applies each batch of ops to
 * the scopes as it arrives, timers are posted to the main looper, and
 * platform calls complete on a background thread and resolve on the main
 * thread. Each composed root owns its session; a recreated activity starts
 * a new session.
 */
class WeftSession private constructor(context: Context, layoutHash: Long, private val make: WeftMake) {
    /** The root component instance. */
    var root: WeftScope? by mutableStateOf(null)
        internal set

    /** Why the app failed to start or render, shown instead of its views. */
    var failure: String? by mutableStateOf(null)
        private set

    private val scopes = HashMap<Int, WeftScope>()
    private val main = Handler(Looper.getMainLooper())
    private val platform = PlatformModules(context)

    /** Whether a batch of ops is being applied; the kernel is not reentrant. */
    private var committing = false

    /** The last error the kernel logged: why the runtime failed to start. */
    private var lastError: String? = null
    private var runtime = 0L
    private var environment = WeftEnvironment.initial(context.resources)

    private val host = object : NativeHost {
        override fun commit(ops: ByteBuffer) = this@WeftSession.commit(ops)

        override fun schedule(delayMs: Long) {
            main.postDelayed({ if (runtime != 0L) Native.tick(runtime) }, delayMs)
        }

        override fun supports(module: ByteArray): Boolean = module.decodeToString() in PlatformModules.SUPPORTED

        override fun call(id: Int, module: ByteArray, method: ByteArray, args: ByteArray) {
            // Runs after the kernel's callback returns: the kernel is not reentrant.
            platform.call(module.decodeToString(), method.decodeToString(), args) { ok, result ->
                main.post { if (runtime != 0L) Native.resolve(runtime, id, ok, result) }
            }
        }

        override fun log(level: Int, message: ByteArray) {
            val text = message.decodeToString()
            WeftLog.write(level, text)
            if (level >= LogLevel.ERROR) lastError = text
        }
    }

    init {
        WeftLog.debuggable = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        scopes[0] = RootScope(this)
        start(context, layoutHash)
    }

    private fun start(context: Context, layoutHash: Long) {
        val bytecode = try {
            context.assets.open(BUNDLE).use { it.readBytes() }
        } catch (error: Exception) {
            return fail("weft: cannot read the bundle $BUNDLE ($error)")
        }
        runtime = try {
            Native.create(host, bytecode, layoutHash, Build.VERSION.RELEASE ?: "", environment.json())
        } catch (error: UnsatisfiedLinkError) {
            return fail("weft: cannot load the native kernel ($error)")
        }
        if (runtime == 0L) fail(lastError ?: "weft: the app failed to start")
    }

    internal fun updateEnvironment(updated: WeftEnvironment) {
        if (runtime == 0L || environment == updated) return
        environment = updated
        Native.environment(runtime, updated.json())
    }

    /** Reports event slot [slot] of [scope]; see [WeftScope.dispatch]. */
    internal fun dispatch(scope: Int, slot: Int, payload: WeftValue?): Boolean {
        if (committing) {
            WeftLog.error("weft: an event was dispatched while ops were applied")
            return true
        }
        if (runtime == 0L) return true
        return Native.dispatch(runtime, scope, slot, payload?.encode())
    }

    @MainThread
    internal fun close() {
        val handle = runtime
        runtime = 0L
        main.removeCallbacksAndMessages(null)
        if (handle != 0L) Native.free(handle)
        scopes.clear()
        root = null
    }

    private fun commit(ops: ByteBuffer) {
        committing = true
        try {
            for (op in OpReader.readAll(ops)) {
                if (!apply(op)) break
            }
        } catch (error: OpException) {
            fail("weft: malformed ops (${error.message})")
        } catch (error: RuntimeException) {
            fail("weft: cannot apply ops ($error)")
        } finally {
            committing = false
        }
    }

    private fun apply(op: Op): Boolean {
        when (op) {
            is Op.Create -> {
                val made = make(op.template, op.scope, this)
                if (made == null) {
                    fail("weft: the views have no template ${op.template}")
                    return false
                }
                scopes[op.scope] = made
            }
            is Op.Set -> scopes[op.scope]?.apply(op.slot, op.value)
            is Op.Branch -> mount(op.scope, op.point, if (op.child == 0) IntArray(0) else intArrayOf(op.child))
            is Op.Rows -> mount(op.scope, op.point, op.children)
            is Op.Attach -> mount(op.scope, op.point, intArrayOf(op.child))
        }
        return true
    }

    /**
     * Mounts the scopes [ids] at [point] of [parent]; children no longer
     * mounted there are destroyed with their descendants.
     */
    private fun mount(parent: Int, point: Int, ids: IntArray) {
        val scope = scopes[parent] ?: return
        val old = scope.children[point].orEmpty()
        if (old.isNotEmpty()) {
            val kept = ids.toHashSet()
            for (child in old) if (child.id !in kept) destroy(child)
        }
        val children = buildList(ids.size) { for (id in ids) scopes[id]?.let(::add) }
        scope.children[point] = children
        scope.mount(point, children)
    }

    private fun destroy(scope: WeftScope) {
        scopes.remove(scope.id)
        for (children in scope.children.values) children.forEach(::destroy)
    }

    private fun fail(message: String) {
        WeftLog.error(message)
        failure = message
    }

    companion object {
        /** Asset path of the app's bytecode, packaged by the generated module. */
        const val BUNDLE = "weft/bundle.hbc"

        /**
         * Starts a session with the bundle in the app's assets. The generated
         * views implement the layout with hash [layoutHash] and create their
         * scopes with [make].
         */
        @MainThread
        fun start(context: Context, layoutHash: Long, make: WeftMake): WeftSession =
            WeftSession(context.applicationContext, layoutHash, make)
    }
}
