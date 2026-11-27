package net.mioyi.weftui.app

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assume.assumeNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ScreenshotTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    @Test
    fun pages() {
        val arguments = InstrumentationRegistry.getArguments()
        val pages = arguments.getString("pages")
        assumeNotNull(pages)
        val ids = requireNotNull(pages).split(",")
        val links = requireNotNull(arguments.getString("links")).split(",")
        require(ids.size == links.size)
        val suffix = if (arguments.getString("appearance") == "dark") "-dark" else ""
        // Gradle pulls this directory before uninstalling the app and runner.
        val directory = File(requireNotNull(arguments.getString("additionalTestOutputDir")))
        directory.mkdirs()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        for ((id, link) in ids.zip(links)) {
            clearStoredState()
            val intent = Intent(context, MainActivity::class.java)
            if (link != "/") {
                intent.action = Intent.ACTION_VIEW
                intent.data = Uri.parse("weftexample:/$link")
            }
            ActivityScenario.launch<MainActivity>(intent).use {
                compose.waitForIdle()
                Thread.sleep(1000)
                // Auto-advance cancels infinite animations. Capture a stable frame after the
                // animation has started, rather than freezing indicators at their initial value.
                compose.mainClock.autoAdvance = false
                try {
                    compose.mainClock.advanceTimeBy(3_000)
                    compose.waitForIdle()
                    Thread.sleep(1000)
                    val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
                    File(directory, "$id$suffix.png").outputStream().use { output ->
                        check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output))
                    }
                } finally {
                    compose.mainClock.autoAdvance = true
                }
            }
        }
    }
}
