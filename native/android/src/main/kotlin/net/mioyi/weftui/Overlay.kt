package net.mioyi.weftui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.json.JSONObject

internal data class OverlayRequest(
    val method: String, val title: String?, val message: String?, val confirmText: String,
    val cancelText: String, val destructive: Boolean, val options: List<String>,
    val destructiveIndex: Int, val icon: String, val duration: Long,
) {
    companion object {
        fun parse(method: String, bytes: ByteArray): OverlayRequest {
            val json = try { JSONObject(bytes.decodeToString()) } catch (_: Exception) {
                throw PlatformFailure("weft: ui.$method expects a JSON object")
            }
            if (method !in setOf("alert", "confirm", "actionSheet", "toast")) {
                throw PlatformFailure("weft: ui.$method is not implemented")
            }
            val array = json.optJSONArray("options")
            val options = if (array == null) emptyList() else (0 until array.length()).map { array.getString(it) }
            if (method == "actionSheet" && options.size !in 1..6) {
                throw PlatformFailure("weft: ui.actionSheet expects 1–6 options")
            }
            fun text(key: String): String? = if (json.isNull(key)) null else json.optString(key)
            return OverlayRequest(method, text("title"), text("message"), text("confirmText") ?: "OK",
                text("cancelText") ?: "Cancel", json.optBoolean("destructive", false), options,
                json.optInt("destructiveIndex", -1), text("icon") ?: "none",
                if (text("duration") == "long") 3000L else 1500L)
        }
    }
}

internal class OverlayQueue {
    internal data class Entry(val request: OverlayRequest, val done: (Boolean, ByteArray) -> Unit)
    private val pending = ArrayDeque<Entry>()
    var current: Entry? by mutableStateOf(null)
        private set
    var toast: OverlayRequest? by mutableStateOf(null)
        private set
    // Distinguishes consecutive identical toasts for the timeout effect.
    var toastVersion by mutableIntStateOf(0)
        private set

    fun call(method: String, args: ByteArray, done: (Boolean, ByteArray) -> Unit) {
        val request = try { OverlayRequest.parse(method, args) } catch (error: Exception) {
            done(false, (error.message ?: error.toString()).encodeToByteArray()); return
        }
        if (method == "toast") {
            toast = request
            toastVersion++
            done(true, ByteArray(0))
        } else {
            val entry = Entry(request, done)
            if (current == null) current = entry else pending.addLast(entry)
        }
    }

    fun finish(entry: Entry, result: Any?) {
        if (current !== entry) return
        current = if (pending.isEmpty()) null else pending.removeFirst()
        val encoded = when (entry.request.method) {
            "confirm" -> (result == true).toString().encodeToByteArray()
            "actionSheet" -> (result as? Int)?.toString()?.encodeToByteArray() ?: "null".encodeToByteArray()
            else -> ByteArray(0)
        }
        entry.done(true, encoded)
    }

    fun clearToast(version: Int) { if (toastVersion == version) toast = null }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun OverlayHost(queue: OverlayQueue) {
    val entry = queue.current
    if (entry != null) {
        val request = entry.request
        if (request.method == "actionSheet") {
            ModalBottomSheet(onDismissRequest = { queue.finish(entry, null) }) {
                Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
                    request.title?.let { Text(it, Modifier.padding(horizontal = 24.dp, vertical = 12.dp), style = MaterialTheme.typography.titleLarge) }
                    request.options.forEachIndexed { index, option ->
                        TextButton(onClick = { queue.finish(entry, index) }, modifier = Modifier.fillMaxWidth()) {
                            Text(option, color = if (index == request.destructiveIndex) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                        }
                    }
                    TextButton(onClick = { queue.finish(entry, null) }, modifier = Modifier.fillMaxWidth()) { Text(request.cancelText) }
                }
            }
        } else {
            AlertDialog(
                onDismissRequest = { queue.finish(entry, false) },
                title = request.title?.let { title -> { Text(title) } },
                text = request.message?.let { message -> { Text(message) } },
                confirmButton = { TextButton(onClick = { queue.finish(entry, true) }) {
                    Text(request.confirmText, color = if (request.isDestructive()) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                } },
                dismissButton = if (request.method == "confirm") ({ TextButton(onClick = { queue.finish(entry, false) }) { Text(request.cancelText) } }) else null,
            )
        }
    }
    val toast = queue.toast
    val version = queue.toastVersion
    if (toast != null) {
        LaunchedEffect(version) { delay(toast.duration); queue.clearToast(version) }
        Box(Modifier.fillMaxSize().padding(bottom = 48.dp), contentAlignment = Alignment.BottomCenter) {
            val prefix = when (toast.icon) { "success" -> "✓  "; "error" -> "✕  "; else -> "" }
            Text(prefix + (toast.message ?: ""), Modifier.background(MaterialTheme.colorScheme.inverseSurface, RoundedCornerShape(50)).padding(horizontal = 20.dp, vertical = 12.dp), color = MaterialTheme.colorScheme.inverseOnSurface)
        }
    }
}

private fun OverlayRequest.isDestructive() = method == "confirm" && destructive
