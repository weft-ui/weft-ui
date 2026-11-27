package net.mioyi.weftui.app

import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToIndex
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FieldnotesTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    @get:Rule val rules = org.junit.rules.RuleChain.outerRule(clearStorageRule).around(compose)

    @Test fun tabsAndDetailBack() {
        for ((tab, heading) in listOf("发现" to "FIELDNOTES  /  EXPLORE", "消息" to "FIELDNOTES  /  ACTIVITY", "我的" to "FIELDNOTES  /  MEMBER PROFILE", "首页" to "Latest notes")) {
            compose.onNodeWithText(tab).performClick()
            compose.waitUntil(5_000) { compose.onAllNodes(hasText(heading)).fetchSemanticsNodes().isNotEmpty() }
        }
        compose.onNodeWithText("NOTE 1", substring = true).performClick()
        compose.waitUntil(5_000) { compose.onAllNodes(hasText("Trail comments", substring = true)).fetchSemanticsNodes().isNotEmpty() }
        Espresso.pressBack()
        compose.onNodeWithText("Latest notes").assertIsDisplayed()
    }

    @Test fun modalsAndCache() {
        compose.onAllNodes(hasText("发布"))[0].performClick()
        compose.onNodeWithText("Publish a note").assertIsDisplayed()
        compose.onNodeWithText("Cancel").performScrollTo().performClick()
        compose.onNodeWithText("我的").performClick()
        compose.onNodeWithText("Log in").performScrollTo().performClick()
        compose.onNodeWithText("Welcome back to your journal.").assertIsDisplayed()
        compose.onNodeWithText("Cancel").performScrollTo().performClick()
        compose.onNodeWithText("Settings").performScrollTo().performClick()
        compose.onNodeWithText("Clear cache").performClick()
        compose.onNodeWithText("Clear cached data?").assertIsDisplayed()
        compose.onNodeWithText("Clear").performClick()
        compose.waitUntil(5_000) { compose.onAllNodes(hasText("Cache cleared", substring = true)).fetchSemanticsNodes().isNotEmpty() }
    }

    @Test fun feedLoadsThroughRow500() {
        val list = compose.onNode(hasScrollToIndexAction())
        for (end in 200..500 step 50) {
            list.performScrollToIndex(end)
            compose.waitUntil(5_000) { compose.onAllNodes(hasText("NOTE $end", substring = true)).fetchSemanticsNodes().isNotEmpty() }
        }
        compose.onNodeWithText("NOTE 500", substring = true).assertIsDisplayed()
    }
}

@RunWith(AndroidJUnit4::class)
class FieldnotesLinkTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test fun coldLinkBackReturnsToFeed() {
        clearStoredState()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("weftexample://notes/3"), context, MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(intent).use {
            compose.waitUntil(10_000) { compose.onAllNodes(hasText("Trail comments", substring = true)).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("The long way up Juniper Ridge").assertIsDisplayed()
            Espresso.pressBack()
            compose.waitUntil(5_000) { compose.onAllNodes(hasText("Latest notes")).fetchSemanticsNodes().isNotEmpty() }
        }
    }
}
