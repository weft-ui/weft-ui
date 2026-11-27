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
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TapTest {
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val rules = org.junit.rules.RuleChain.outerRule(clearStorageRule).around(compose)

    @org.junit.After
    fun returnToCatalog() = compose.returnToCatalog("tap")

    @Test
    fun physicalTapsActivateOnlyTheInnermostTarget() {
        compose.openPage("tap")
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

@RunWith(AndroidJUnit4::class)
class LazyListTest {
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val rules = org.junit.rules.RuleChain.outerRule(clearStorageRule).around(compose)

    @Test
    fun reachingTheEndLoadsMoreRows() {
        compose.openPage("list")
        try {
            compose.onNodeWithText("Row 1 — a longer note from the trail").assertIsDisplayed()
            val list = compose.onNode(hasScrollToIndexAction())
            // Index zero is the introductory header; row 1000 is the last initial item.
            list.performScrollToIndex(1000)
            compose.waitUntil(5_000) {
                compose.onAllNodes(hasText("Row 1000", substring = true)).fetchSemanticsNodes().isNotEmpty()
            }
            // The end event appends another page asynchronously. Scroll into it as it arrives.
            repeat(5) {
                if (compose.onAllNodes(hasText("Row 1001")).fetchSemanticsNodes().isEmpty()) {
                    list.performTouchInput { swipeUp() }
                    compose.waitForIdle()
                }
            }
            list.performScrollToIndex(1001)
            compose.onNodeWithText("Row 1001").assertIsDisplayed()
        } finally {
            compose.returnToCatalog("list")
        }
    }

    @Test
    fun pullingAtTheTopShowsAndCompletesRefresh() {
        compose.openPage("list")
        try {
            val list = compose.onNode(hasScrollToIndexAction())
            list.performTouchInput { swipeDown(durationMillis = 500) }
            val progress = SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo)
            compose.waitUntil(5_000) { compose.onAllNodes(progress).fetchSemanticsNodes().isNotEmpty() }
            compose.waitUntil(5_000) { compose.onAllNodes(progress).fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithText("Row 1 — a longer note from the trail").assertIsDisplayed()
        } finally {
            compose.returnToCatalog("list")
        }
    }

    @Test
    fun sectionHeaderStaysVisibleWhenItsRowsScroll() {
        compose.openPage("sections")
        try {
            val list = compose.onNode(hasScrollToIndexAction())
            compose.onNodeWithText("A").assertIsDisplayed()
            // Scroll the first row to the top, past its header's original position.
            list.performScrollToIndex(2)
            compose.onNodeWithText("Alder").assertIsDisplayed()
            compose.onNodeWithText("A").assertIsDisplayed()
        } finally {
            compose.returnToCatalog("sections")
        }
    }
}
