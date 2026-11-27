package net.mioyi.weftui.app

import android.os.Bundle
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import android.graphics.Rect
import androidx.test.uiautomator.Until
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PerformanceTests {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val device = UiDevice.getInstance(instrumentation)
    private val pkg = instrumentation.targetContext.packageName

    private fun shell(command: String): String =
        instrumentation.uiAutomation.executeShellCommand(command).use { descriptor ->
            android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).bufferedReader().use { it.readText() }
        }

    private fun hierarchy(): String =
        java.io.ByteArrayOutputStream().also { device.dumpWindowHierarchy(it) }.toString("UTF-8")

    private fun openBench(count: Int): Rect {
        val launch = shell("am start -W -a android.intent.action.VIEW -d weftexample://bench/feed?count=$count $pkg")
        check(launch.contains("Status: ok")) { "Bench launch failed: $launch" }
        check(device.wait(Until.hasObject(By.text("Feed benchmark")), 30_000)) {
            "Bench with $count rows did not appear; launch: $launch\n${hierarchy()}"
        }
        // The title becomes accessible while NavDisplay is still sliding the old Feed
        // out and Bench in. Wait until the outgoing list is no longer selectable.
        android.os.SystemClock.sleep(1_000)
        device.waitForIdle()
        check(device.wait(Until.hasObject(By.textContains("NOTE 1  /")), 30_000)) {
            "Bench with $count rows did not render its first row; launch: $launch\n${hierarchy()}"
        }
        val lists = device.findObjects(By.scrollable(true))
        check(lists.size == 1) { "Expected one Bench list, found ${lists.size}; ${hierarchy()}" }
        return lists.single().visibleBounds
    }

    private fun fling(bounds: Rect) {
        // Wait for the preceding fling and its lazy-window updates to settle before
        // injecting the next gesture; overlapping gestures can cancel each other.
        device.waitForIdle()
        check(device.swipe(bounds.centerX(), bounds.bottom - bounds.height() / 10,
            bounds.centerX(), bounds.top + bounds.height() / 10, 20)) { "Swipe injection failed" }
    }

    private fun assertScrolled(bounds: Rect) {
        device.waitForIdle()
        // Compose can leave the initial accessibility tree cached during a fling.
        if (android.os.Build.VERSION.SDK_INT >= 34) instrumentation.uiAutomation.clearCache()
        check(!device.hasObject(By.textContains("NOTE 1  /"))) { "Bench did not scroll; bounds=$bounds\n${hierarchy()}" }
    }

    private fun memory(count: Int): String {
        val bounds = openBench(count)
        repeat(20) { fling(bounds) }
        assertScrolled(bounds)
        return shell("dumpsys meminfo $pkg")
    }

    private fun publish(name: String, value: String) {
        val encoded = Base64.encodeToString(value.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
        instrumentation.sendStatus(2, Bundle().apply { putString(name, encoded) })
    }

    @Test
    fun measure() {
        val scenario = InstrumentationRegistry.getArguments().getString("scenario")
        org.junit.Assume.assumeTrue("Performance scenario not requested", scenario != null)
        when (scenario) {
            "scroll" -> {
                val bounds = openBench(10_000)
                shell("dumpsys gfxinfo $pkg reset")
                repeat(20) { fling(bounds) }
                assertScrolled(bounds)
                publish("weft_gfxinfo", shell("dumpsys gfxinfo $pkg"))
            }
            "memory100" -> publish("weft_meminfo_100", memory(100))
            "memory10000" -> publish("weft_meminfo_10000", memory(10_000))
            else -> error("Expected a performance scenario")
        }
    }
}
