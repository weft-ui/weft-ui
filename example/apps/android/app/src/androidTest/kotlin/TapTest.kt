package net.mioyi.weftui.app

import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.click
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasParent
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TapTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun physicalTapsActivateOnlyTheInnermostTarget() {
        compose.onNodeWithText("page:tap").performScrollTo().performClick()
        assertCounters(rows = 0, cards = 0, buttons = 0, texts = 0)

        val buttonRole = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button)
        for (label in listOf("Open details", "Image card", "Save", "Preview")) {
            compose.onNodeWithText(label).assert(hasClickAction() and buttonRole)
        }

        touchText("Open details")
        assertCounters(rows = 1, cards = 0, buttons = 0, texts = 0)
        touchText("Image card")
        assertCounters(rows = 1, cards = 1, buttons = 0, texts = 0)
        compose.onNode(hasParent(hasText("Image card")) and hasClickAction() and buttonRole)
            .performScrollTo().performTouchInput { click() }
        assertCounters(rows = 1, cards = 2, buttons = 0, texts = 0)
        touchText("Save")
        assertCounters(rows = 1, cards = 2, buttons = 1, texts = 0)
        touchText("Preview")
        assertCounters(rows = 1, cards = 2, buttons = 1, texts = 1)
    }

    private fun touchText(label: String) {
        compose.onNodeWithText(label, useUnmergedTree = true).performScrollTo().performTouchInput { click() }
    }

    private fun assertCounters(rows: Int, cards: Int, buttons: Int, texts: Int) {
        for (counter in listOf("Rows: $rows", "Cards: $cards", "Buttons: $buttons", "Text: $texts")) {
            compose.onNodeWithText(counter).assertIsDisplayed()
        }
    }
}
