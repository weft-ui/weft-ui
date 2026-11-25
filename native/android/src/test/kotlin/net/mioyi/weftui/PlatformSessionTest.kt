package net.mioyi.weftui

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream

class PlatformSessionTest {
    @Test
    fun storageValidatesStringArraysAndPropagatesCommitFailure() {
        val backing = mutableMapOf<String, String>()
        var failCommit = false
        val store = StorageStore(object : KeyValueStore {
            override fun get(key: String): String? = backing[key]
            override fun set(key: String, value: String): Boolean {
                if (failCommit) return false
                backing[key] = value
                return true
            }
            override fun remove(key: String): Boolean {
                if (failCommit) return false
                backing.remove(key)
                return true
            }
        })

        assertArrayEquals(ByteArray(0), store.call(WeftProtocol.STORAGE_SET, """["k","v"]""".encodeToByteArray()))
        assertEquals("\"v\"", store.call(WeftProtocol.STORAGE_GET, """["k"]""".encodeToByteArray()).decodeToString())

        for (bad in listOf("[123]", """["k",123]""", """["k",null]""", "[]", "not-json")) {
            val threw = try {
                store.call(WeftProtocol.STORAGE_SET, bad.encodeToByteArray())
                false
            } catch (_: PlatformFailure) {
                true
            }
            assertTrue("expected PlatformFailure for $bad", threw)
        }

        failCommit = true
        val commitFailed = try {
            store.call(WeftProtocol.STORAGE_SET, """["k","v2"]""".encodeToByteArray())
            false
        } catch (_: PlatformFailure) {
            true
        }
        assertTrue(commitFailed)
        assertEquals("v", backing["k"])
    }

    @Test
    fun fetchAndImageValidateSchemesAndByteCaps() {
        assertNotNull(PlatformModules.validatedFetchUrl("https://example.com/api"))
        assertNotNull(PlatformModules.validatedFetchUrl("HTTP://example.com/api"))
        for (bad in listOf("file:///etc/passwd", "data:text/plain,hi", "ftp://example.com", "not a url")) {
            val threw = try {
                PlatformModules.validatedFetchUrl(bad)
                false
            } catch (_: PlatformFailure) {
                true
            }
            assertTrue("expected fetch rejection for $bad", threw)
        }

        assertEquals(3, PlatformModules.readBoundedBytes(ByteArrayInputStream(byteArrayOf(1, 2, 3)), 3).size)
        val tooBig = try {
            PlatformModules.readBoundedBytes(ByteArrayInputStream(byteArrayOf(1, 2, 3, 4)), 3)
            false
        } catch (_: PlatformFailure) {
            true
        }
        assertTrue(tooBig)

        assertNotNull(validatedImageUrl("https://example.com/a.png"))
        assertNull(validatedImageUrl("file:///tmp/a.png"))
        assertNull(validatedImageUrl("data:image/png;base64,abc"))
        assertNull(readBoundedImageBytes(ByteArrayInputStream(ByteArray(10)), 8))
        assertTrue(withinImagePixelLimit(100, 100))
        assertFalse(withinImagePixelLimit(5000, 5000))
        assertFalse(withinImagePixelLimit(0, 100))
        assertTrue(imageCacheCapacityKiB(16L * 1024L * 1024L * 1024L) > 0)
        assertTrue(bitmapSizeKiB(5000, 5000) > 0)
    }

    @Test
    fun controlsSanitizeNonFiniteValues() {
        assertEquals(-1, sanitizedMaxLength(Float.NaN))
        assertEquals(-1, sanitizedMaxLength(-5f))
        assertEquals(-1, sanitizedMaxLength(Float.POSITIVE_INFINITY))
        assertEquals(Int.MAX_VALUE, sanitizedMaxLength(1e12f))
        assertEquals(12, sanitizedMaxLength(12f))

        assertEquals(-1, sanitizedPickerIndex(Float.NaN))
        assertEquals(-1, sanitizedPickerIndex(-1f))
        assertEquals(2, sanitizedPickerIndex(2f))

        assertEquals(0f, sanitizedProgress(Float.NaN), 0f)
        assertEquals(0f, sanitizedProgress(Float.POSITIVE_INFINITY), 0f)
        assertEquals(0f, sanitizedProgress(-0.5f), 0f)
        assertEquals(1f, sanitizedProgress(2f), 0f)
        assertEquals(0.4f, sanitizedProgress(0.4f), 0f)

        val bad = sanitizedSliderParams(Float.NaN, Float.NEGATIVE_INFINITY, 10f, Float.NaN, disabled = false)
        assertFalse(bad.enabled)
        assertEquals(0f, bad.value, 0f)
        assertEquals(0f, bad.min, 0f)
        assertEquals(1f, bad.max, 0f)
        assertEquals(1f, bad.step, 0f)
    }
}
