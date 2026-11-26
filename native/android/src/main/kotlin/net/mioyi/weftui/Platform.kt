package net.mioyi.weftui

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

internal interface KeyValueStore {
    fun get(key: String): String?
    fun set(key: String, value: String): Boolean
    fun remove(key: String): Boolean
}

internal class SharedPrefsKeyValueStore(private val preferences: SharedPreferences) : KeyValueStore {
    override fun get(key: String): String? = preferences.getString(key, null)
    override fun set(key: String, value: String): Boolean = preferences.edit().putString(key, value).commit()
    override fun remove(key: String): Boolean = preferences.edit().remove(key).commit()
}

internal class StorageStore(private val store: KeyValueStore) {
    fun call(method: String, args: ByteArray): ByteArray {
        val list = parseStringArray(method, args)
        val key = list[0]
        when (method) {
            WeftProtocol.STORAGE_GET ->
                return (store.get(key)?.let(JSONObject::quote) ?: "null").encodeToByteArray()
            WeftProtocol.STORAGE_SET -> {
                if (list.size != 2) throw PlatformFailure("weft: storage.set expects [key, value]")
                if (!store.set(key, list[1])) throw PlatformFailure("weft: storage.set failed to persist $key")
            }
            else -> {
                if (!store.remove(key)) throw PlatformFailure("weft: storage.remove failed to persist $key")
            }
        }
        return ByteArray(0)
    }

    companion object {
        internal fun parseStringArray(method: String, args: ByteArray): List<String> {
            val array = try {
                JSONArray(args.decodeToString())
            } catch (_: Exception) {
                throw PlatformFailure("weft: storage.$method expects a JSON array of strings")
            }
            if (array.length() == 0) {
                throw PlatformFailure("weft: storage.$method expects a JSON array of strings")
            }
            val out = ArrayList<String>(array.length())
            for (i in 0 until array.length()) {
                val item = array.opt(i)
                if (item !is String) {
                    throw PlatformFailure("weft: storage.$method expects a JSON array of strings")
                }
                out.add(item)
            }
            return out
        }
    }
}

/**
 * The platform modules of the shell; byte formats in
 * protocol/SPEC.md ("Platform calls"). Calls run on a
 * background thread.
 */
internal class PlatformModules(context: Context) {
    private val storageStore = StorageStore(
        SharedPrefsKeyValueStore(context.applicationContext.getSharedPreferences(STORAGE, Context.MODE_PRIVATE)),
    )

    /** Starts a call; [done] runs on a background thread with the result or the error message. */
    fun call(module: String, method: String, args: ByteArray, done: (ok: Boolean, result: ByteArray) -> Unit) {
        val executor = if (module == WeftProtocol.STORAGE_MODULE) storageExecutor else fetchExecutor
        executor.execute {
            val result = try {
                Result.success(call(module, method, args))
            } catch (error: Exception) {
                Result.failure(error)
            }
            result.fold(
                onSuccess = { done(true, it) },
                onFailure = { done(false, (it.message ?: it.toString()).encodeToByteArray()) },
            )
        }
    }

    private fun call(module: String, method: String, args: ByteArray): ByteArray = when {
        module == WeftProtocol.FETCH_MODULE && method == WeftProtocol.FETCH_REQUEST -> fetch(args)
        module == WeftProtocol.STORAGE_MODULE &&
            (method == WeftProtocol.STORAGE_GET || method == WeftProtocol.STORAGE_SET || method == WeftProtocol.STORAGE_REMOVE) ->
            storageStore.call(method, args)
        else -> throw PlatformFailure("weft: $module.$method is not implemented")
    }

    /** `fetch.request` through HttpURLConnection. */
    private fun fetch(args: ByteArray): ByteArray {
        val (head, body) = unframe(args)
        val url = validatedFetchUrl(head.optString("url"))
        val connection = url.openConnection() as? HttpURLConnection
            ?: throw PlatformFailure("weft: unsupported URL ${head.optString("url")}")
        try {
            connection.requestMethod = head.optString("method", "GET")
            head.optJSONObject("headers")?.let { headers ->
                for (name in headers.keys()) connection.setRequestProperty(name, headers.getString(name))
            }
            if (body.isNotEmpty()) {
                connection.doOutput = true
                connection.outputStream.use { it.write(body) }
            }
            val status = connection.responseCode
            if (connection.contentLengthLong > MAX_FETCH_BYTES.toLong()) {
                throw PlatformFailure("weft: fetch response exceeds $MAX_FETCH_BYTES byte limit")
            }
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val response = stream?.use { readBoundedBytes(it, MAX_FETCH_BYTES) } ?: ByteArray(0)
            return frame(JSONObject().put("status", status), response)
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        val SUPPORTED = setOf(WeftProtocol.FETCH_MODULE, WeftProtocol.STORAGE_MODULE, WeftProtocol.UI_MODULE)
        internal const val MAX_FETCH_BYTES = 32 * 1024 * 1024

        /** Name of the shared preferences of `storage`. */
        private const val STORAGE = "weft.storage"

        /** Bounded fetch pool and serialized storage thread. */
        private val fetchExecutor: ExecutorService = ThreadPoolExecutor(
            0, 16, 60L, TimeUnit.SECONDS, LinkedBlockingQueue(),
        ).apply { allowCoreThreadTimeOut(true) }
        private val storageExecutor: ExecutorService = Executors.newSingleThreadExecutor()

        internal fun validatedFetchUrl(raw: String): URL {
            val url = try {
                URL(raw)
            } catch (_: Exception) {
                throw PlatformFailure("weft: unsupported URL $raw")
            }
            val scheme = url.protocol.lowercase()
            if (scheme != "http" && scheme != "https") {
                throw PlatformFailure("weft: unsupported URL $raw")
            }
            return url
        }

        internal fun readBoundedBytes(stream: InputStream, limit: Int = MAX_FETCH_BYTES): ByteArray {
            val buffer = ByteArray(8192)
            val out = ByteArrayOutputStream()
            while (true) {
                val read = stream.read(buffer)
                if (read < 0) break
                if (out.size() + read > limit) {
                    throw PlatformFailure("weft: fetch response exceeds $limit byte limit")
                }
                out.write(buffer, 0, read)
            }
            return out.toByteArray()
        }

        /** Splits `u32 head length (LE) | head (UTF-8 JSON) | body`. */
        internal fun unframe(data: ByteArray): Pair<JSONObject, ByteArray> {
            if (data.size < 4) throw PlatformFailure("weft: truncated frame")
            val length = (0 until 4).fold(0L) { acc, i -> acc or ((data[i].toLong() and 0xff) shl (8 * i)) }
            if (length > data.size - 4) throw PlatformFailure("weft: invalid frame head")
            val head = JSONObject(data.decodeToString(4, 4 + length.toInt()))
            return head to data.copyOfRange(4 + length.toInt(), data.size)
        }

        internal fun frame(head: JSONObject, body: ByteArray): ByteArray {
            val json = head.toString().encodeToByteArray()
            val out = ByteArray(4 + json.size + body.size)
            for (i in 0 until 4) out[i] = (json.size ushr (8 * i)).toByte()
            json.copyInto(out, 4)
            body.copyInto(out, 4 + json.size)
            return out
        }
    }
}

/** A failed platform call; its message rejects the call's promise. */
internal class PlatformFailure(message: String) : IOException(message)
