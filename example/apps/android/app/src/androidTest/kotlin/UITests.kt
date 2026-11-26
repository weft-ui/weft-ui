package net.mioyi.weftui.app

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** UI tests of the app; run with `./gradlew connectedDebugAndroidTest` on a device or emulator. */
@RunWith(AndroidJUnit4::class)
class UITests {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun launches() {
        compose.onRoot().assertExists()
    }
}
