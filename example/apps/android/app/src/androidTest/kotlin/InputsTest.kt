package net.mioyi.weftui.app

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHeightIsEqualTo
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.width
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class InputsTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val search = SemanticsMatcher.expectValue(SemanticsProperties.ImeAction, ImeAction.Search)

    @Test
    fun focusRequestsAreEdgesAndDoNotWriteBackOnUserFocusChanges() {
        openInputs()
        val text = compose.onNode(search)
        val password = compose.onNode(hasSetTextAction() and hasText("输入密码"))
        text.assertIsNotFocused()
        compose.onNodeWithText("未聚焦").assertIsDisplayed()
        text.performClick().assertIsFocused()
        compose.onNodeWithText("已聚焦").assertIsDisplayed()
        focusButton("聚焦文本框")

        password.performScrollTo().performClick().assertIsFocused()
        text.assertIsNotFocused()
        compose.onNodeWithText("未聚焦").assertIsDisplayed()
        // Dropping the text input's request must not clear the password field's focus.
        focusButton("放弃焦点")
        password.assertIsFocused()
        focusButton("聚焦文本框")
        text.assertIsFocused()
        compose.onNodeWithText("已聚焦").assertIsDisplayed()
        focusButton("放弃焦点")
        text.assertIsNotFocused()
        compose.onNodeWithText("未聚焦").assertIsDisplayed()
    }

    @Test
    fun editsKeepWholeUtf16PairsAndTheSearchActionSubmits() {
        openInputs()
        val text = compose.onNode(search)
        text.performClick()
        val prefix = "a".repeat(17) + "😀"
        text.performTextInput(prefix + "🚀rest")
        text.assertTextEquals(prefix)
        compose.onNodeWithText("19/20").assertIsDisplayed()
        text.performTextInput("z")
        text.assertTextEquals(prefix + "z")
        compose.onNodeWithText("20/20").assertIsDisplayed()
        text.performImeAction()
        text.assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
        compose.onNodeWithText("0/20").assertIsDisplayed()

        val notes = compose.onNode(hasSetTextAction() and hasText("输入备注"))
        notes.performScrollTo().performClick()
        val multiline = "b".repeat(76) + "\n😀"
        notes.performTextReplacement(multiline + "🚀rest")
        compose.onNode(hasSetTextAction() and hasText(multiline)).assertTextEquals(multiline)
    }

    @Test
    fun compactInputShowsItsHintAndFilledPickerSpansTheField() {
        compose.onNodeWithText("page:form").performScrollTo().performClick()
        val name = compose.onNode(hasSetTextAction() and hasText("Mara Chen"))
        name.assertHeightIsEqualTo(28.dp)
        compose.onNodeWithText("Mara Chen", useUnmergedTree = true).assertIsDisplayed()

        val picker = compose.onNode(hasClickAction() and hasText("Choose a region"))
        picker.assertWidthIsEqualTo(name.getUnclippedBoundsInRoot().width)
    }

    private fun openInputs() {
        compose.onNodeWithText("page:inputs").performScrollTo().performClick()
    }

    private fun focusButton(label: String) {
        compose.onNodeWithText(label).performScrollTo().performClick()
    }
}
