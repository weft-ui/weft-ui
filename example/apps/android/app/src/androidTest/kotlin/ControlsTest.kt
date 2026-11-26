package net.mioyi.weftui.app

import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.isEnabled
import androidx.compose.ui.test.isNotEnabled
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ControlsTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun controlledEditsAreAcceptedUntilLocked() {
        openControls()
        val switches = compose.onAllNodes(role(Role.Switch) and isEnabled())
        val lock = switches[0]
        val notifications = switches[1]
        val sounds = switches[2]
        val checkbox = compose.onNode(role(Role.Checkbox) and isEnabled())
        val slider = compose.onNode(sliderAction and isEnabled())
        val notes = compose.onNode(hasSetTextAction() and isEnabled())

        notifications.performClick().assertIsOff()
        sounds.performClick().assertIsOn()
        checkbox.performClick().assertIsOff()
        slider.setProgress(64f)
        slider.assert(progress(65f, steps = 19, range = 0f..100f))
        compose.onNodeWithText("音量 · 65%").assertIsDisplayed()
        pick("本地", "远程")
        pick("选择频道", "稳定版")
        notes.performScrollTo().performClick().performTextReplacement("First line\nSecond line")
        notes.assertTextEquals("First line\nSecond line")

        lock.performScrollTo().performClick().assertIsOn()
        notifications.performClick().assertIsOff()
        sounds.performClick().assertIsOn()
        checkbox.performClick().assertIsOff()
        slider.setProgress(25f)
        slider.assert(progress(65f, steps = 19, range = 0f..100f))
        compose.onNodeWithText("音量 · 65%").assertIsDisplayed()
        compose.onNodeWithText("远程").performClick()
        compose.onNodeWithText("本地").performClick()
        compose.onNodeWithText("远程").assertIsDisplayed()
        compose.onNodeWithText("稳定版").performScrollTo().performClick()
        compose.onNodeWithText("测试版").performClick()
        compose.onNodeWithText("稳定版").assertIsDisplayed()
        notes.performScrollTo().performClick().performTextReplacement("Refused edit")
        notes.assertTextEquals("First line\nSecond line")
    }

    @Test
    fun disabledControlsAndProgressAreExposed() {
        openControls()
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.ProgressBarRangeInfo, ProgressBarRangeInfo.Indeterminate))
            .performScrollTo().assertIsDisplayed()
        compose.onNode(progress(0.3f)).performScrollTo().assertIsDisplayed()
        compose.onNode(progress(0.8f)).performScrollTo().assertIsDisplayed()

        compose.onNode(role(Role.Switch) and isNotEnabled()).performScrollTo().assertIsOff()
        compose.onNode(role(Role.Checkbox) and isNotEnabled()).assertIsOff()
        compose.onNode(sliderAction and isNotEnabled()).assert(progress(40f, steps = 99, range = 0f..100f))
        compose.onNodeWithText("不可更改").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText("不可编辑").assertIsNotEnabled()
    }

    private fun openControls() {
        compose.onNodeWithText("page:controls").performScrollTo().performClick()
        compose.onNodeWithText("控件设置").assertIsDisplayed()
    }

    private fun pick(previous: String, option: String) {
        compose.onNodeWithText(previous).performScrollTo().performClick()
        compose.onNodeWithText(option).performClick()
        compose.onNodeWithText(option).assertIsDisplayed()
    }

    private fun role(role: Role) = SemanticsMatcher.expectValue(SemanticsProperties.Role, role)

    private val sliderAction = SemanticsMatcher.keyIsDefined(SemanticsActions.SetProgress)

    private fun progress(value: Float, steps: Int = 0, range: ClosedFloatingPointRange<Float> = 0f..1f) =
        SemanticsMatcher.expectValue(SemanticsProperties.ProgressBarRangeInfo, ProgressBarRangeInfo(value, range, steps))

    private fun SemanticsNodeInteraction.setProgress(value: Float) {
        performScrollTo().performSemanticsAction(SemanticsActions.SetProgress) { it(value) }
    }
}
