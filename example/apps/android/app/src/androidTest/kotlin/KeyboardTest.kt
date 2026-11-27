package net.mioyi.weftui.app

import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class KeyboardTest {
    private val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val rules = org.junit.rules.RuleChain.outerRule(clearStorageRule).around(compose)

    @Test
    fun focusedFieldAndBottomRowStayAboveKeyboard() {
        compose.openPage("keyboard")
        val field = compose.onNode(hasSetTextAction() and hasText("Field 12"))
        field.performScrollTo().performClick()
        val decor = compose.activity.window.decorView
        compose.waitUntil(5_000) {
            ViewCompat.getRootWindowInsets(decor)?.isVisible(WindowInsetsCompat.Type.ime()) == true
        }
        compose.waitForIdle()
        val insets = requireNotNull(ViewCompat.getRootWindowInsets(decor))
        val imeTop = decor.height - insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
        val fieldBottom = field.fetchSemanticsNode().boundsInWindow.bottom
        val messageBottom = compose.onNode(hasSetTextAction() and hasText("Message"))
            .fetchSemanticsNode().boundsInWindow.bottom
        val sendBottom = compose.onNodeWithText("Send").fetchSemanticsNode().boundsInWindow.bottom
        assertTrue("Focused field bottom $fieldBottom exceeds IME top $imeTop", fieldBottom <= imeTop)
        assertTrue("Bottom input bottom $messageBottom exceeds IME top $imeTop", messageBottom <= imeTop)
        assertTrue("Send button bottom $sendBottom exceeds IME top $imeTop", sendBottom <= imeTop)
    }
}
