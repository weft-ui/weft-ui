package net.mioyi.weftui.app

import android.content.Context
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.espresso.Espresso
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.rules.TestRule
import org.junit.runner.Description
import org.junit.runners.model.Statement
import androidx.compose.ui.test.onRoot
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

internal fun clearStoredState() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    check(context.getSharedPreferences("weft.storage", Context.MODE_PRIVATE).edit().clear().commit())
}

internal val clearStorageRule = TestRule { base: Statement, _: Description ->
    object : Statement() {
        override fun evaluate() {
            clearStoredState()
            base.evaluate()
        }
    }
}

internal fun ComposeTestRule.openPage(id: String) {
    onNodeWithText("page:$id").performScrollTo().performClick()
    waitUntil(5_000) { onAllNodes(hasText("page:$id")).fetchSemanticsNodes().isEmpty() }
    waitForIdle()
}

internal fun ComposeTestRule.returnToCatalog(id: String) {
    Espresso.closeSoftKeyboard()
    Espresso.pressBack()
    waitUntil(5_000) { onAllNodes(hasText("page:$id")).fetchSemanticsNodes().isNotEmpty() }
}

/** UI tests of the app; run with `./gradlew connectedDebugAndroidTest` on a device or emulator. */
@RunWith(AndroidJUnit4::class)
class UITests {
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val rules = org.junit.rules.RuleChain.outerRule(clearStorageRule).around(compose)

    @Test
    fun launches() {
        compose.onRoot().assertExists()
    }

    @Test
    fun everyCatalogEntryOpensAndReturns() {
        compose.waitUntil(5_000) { compose.onAllNodes(hasText("page:", substring = true)).fetchSemanticsNodes().isNotEmpty() }
        val entries = compose.onAllNodes(hasText("page:", substring = true)).fetchSemanticsNodes()
            .map { it.config[androidx.compose.ui.semantics.SemanticsProperties.Text].single().text.removePrefix("page:") }
        org.junit.Assert.assertTrue("Catalog must contain entries", entries.isNotEmpty())
        for (id in entries) {
            compose.openPage(id)
            compose.returnToCatalog(id)
        }
    }
}
