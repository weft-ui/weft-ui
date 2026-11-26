package net.mioyi.weftui

import java.nio.ByteBuffer

/**
 * The kernel's C ABI (`weft/runtime.h`) through the JNI glue of libweft.so
 * (`src/main/cpp/weft_jni.cpp`). Every function runs on the main thread and
 * never from inside a [NativeHost] callback.
 */
internal object Native {
    init {
        System.loadLibrary("weft")
    }

    /**
     * `weft_runtime_new`: runs [bytecode] (copied) with [host] receiving the
     * callbacks. Returns the runtime handle, or 0 when the app failed to start;
     * the reason has been logged through [NativeHost.log].
     */
    external fun create(host: NativeHost, bytecode: ByteArray, layoutHash: Long, version: String, environment: String): Long

    external fun environment(runtime: Long, json: String)

    external fun tick(runtime: Long)

    /** [payload] is one encoded value, or null for events without payload. */
    external fun dispatch(runtime: Long, scope: Int, slot: Int, payload: ByteArray?): Boolean

    external fun window(runtime: Long, scope: Int, point: Int, start: Int, end: Int)

    external fun signal(runtime: Long, name: ByteArray, json: ByteArray)

    external fun resolve(runtime: Long, id: Int, ok: Boolean, result: ByteArray)

    external fun free(runtime: Long)
}

/**
 * The kernel's `weft_host` callbacks, called on the main thread while the
 * kernel runs. Strings arrive as UTF-8 bytes.
 */
internal interface NativeHost {
    /** One batch of ops; [ops] is only valid during the call. */
    fun commit(ops: ByteBuffer)

    fun schedule(delayMs: Long)

    fun supports(module: ByteArray): Boolean

    fun call(id: Int, module: ByteArray, method: ByteArray, args: ByteArray)

    fun log(level: Int, message: ByteArray)
}

/** Levels of [NativeHost.log] (`WEFT_LOG_*`). */
internal object LogLevel {
    const val DEBUG = 0
    const val INFO = 1
    const val WARN = 2
    const val ERROR = 3
}
