package net.mioyi.weftui.app

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OverlaysTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test fun opensAndClosesEveryOverlay() {
        ActivityScenario.launch(MainActivity::class.java).use {
            compose.onNodeWithText("page:overlays").performScrollTo().performClick()
            compose.onNodeWithText("Alert").performClick()
            compose.onNodeWithText("This is an alert.").assertIsDisplayed()
            compose.onNodeWithText("OK").performClick()
            compose.onNodeWithText("Alert dismissed.").assertIsDisplayed()
            compose.onNodeWithText("Confirm").performClick()
            compose.onNodeWithText("Continue?").assertIsDisplayed()
            compose.onNodeWithText("Cancel").performClick()
            compose.onNodeWithText("Cancelled.").assertIsDisplayed()
            compose.onNodeWithText("Action sheet").performClick()
            compose.onNodeWithText("Second").performClick()
            compose.onNodeWithText("Selected option 2.").assertIsDisplayed()
            compose.onNodeWithText("Toast").performClick()
            compose.onNodeWithText("This is a toast.").assertIsDisplayed()
            compose.waitUntil(5000) { compose.onAllNodes(androidx.compose.ui.test.hasText("This is a toast.")).fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithText("This is a toast.").assertDoesNotExist()
        }
    }
}
