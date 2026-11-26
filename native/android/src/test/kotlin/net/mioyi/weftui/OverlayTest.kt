package net.mioyi.weftui

import org.junit.Assert.*
import org.junit.Test

class OverlayTest {
    @Test fun parsesOptionsAndDefaults() {
        val request = OverlayRequest.parse("actionSheet", """{"title":"Choose","options":["one","two"],"destructiveIndex":1}""".encodeToByteArray())
        assertEquals("Choose", request.title)
        assertEquals(listOf("one", "two"), request.options)
        assertEquals(1, request.destructiveIndex)
        assertEquals("Cancel", request.cancelText)
        assertEquals("OK", request.confirmText)
        assertEquals(1500L, request.duration)
        assertEquals(3000L, OverlayRequest.parse("toast", """{"duration":"long"}""".encodeToByteArray()).duration)
        assertThrows(PlatformFailure::class.java) { OverlayRequest.parse("actionSheet", """{"options":[]}""".encodeToByteArray()) }
        assertThrows(PlatformFailure::class.java) { OverlayRequest.parse("alert", "invalid".encodeToByteArray()) }
    }

    @Test fun queuesDialogsAndEncodesResultsWhileToastReplaces() {
        val queue = OverlayQueue()
        val results = mutableListOf<String>()
        fun call(method: String, json: String = "{}") = queue.call(method, json.encodeToByteArray()) { ok, data ->
            assertTrue(ok); results.add(data.decodeToString())
        }
        call("confirm")
        call("actionSheet", """{"options":["A","B"]}""")
        call("alert")
        call("toast", """{"message":"first"}""")
        val version = queue.toastVersion
        call("toast", """{"message":"second"}""")
        queue.clearToast(version)
        assertEquals("second", queue.toast?.message)
        assertEquals("confirm", queue.current?.request?.method)
        queue.finish(false)
        assertEquals("actionSheet", queue.current?.request?.method)
        queue.finish(1)
        queue.finish(null)
        assertNull(queue.current)
        assertEquals(listOf("", "", "false", "1", ""), results)
        call("actionSheet", """{"options":["A"]}""")
        queue.finish(null)
        assertEquals("null", results.last())
        call("confirm")
        queue.finish(true)
        assertEquals("true", results.last())
    }
}
