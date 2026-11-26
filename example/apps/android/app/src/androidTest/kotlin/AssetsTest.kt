package net.mioyi.weftui.app

import android.util.DisplayMetrics
import android.util.TypedValue
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertHeightIsEqualTo
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.font.FontListFontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import net.mioyi.weftui.WeftButton
import net.mioyi.weftui.WeftColor
import net.mioyi.weftui.WeftImage
import net.mioyi.weftui.WeftSpan
import net.mioyi.weftui.WeftText
import net.mioyi.weftui.weftSize
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AssetsTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun drawableVariantsHaveOneIdAndRetainTheirDensity() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val resources = context.resources
        val id = resources.getIdentifier("weft_hero", "drawable", context.packageName)
        assertNotEquals(0, id)
        val value = TypedValue()
        for (density in listOf(DisplayMetrics.DENSITY_MEDIUM, DisplayMetrics.DENSITY_XHIGH, DisplayMetrics.DENSITY_XXHIGH)) {
            resources.getValueForDensity(id, density, value, true)
            assertEquals(density, value.density)
        }
    }

    @Test
    fun bundledImageUsesIntrinsicSizeAndMissingImagePresentsPlaceholder() {
        val src = mutableStateOf("asset:hero")
        val placeholder = Color(0xfff4bc81)
        compose.setContent {
            Column {
                WeftImage("asset:hero", Modifier.testTag("intrinsic"))
                WeftImage(src.value, Modifier.size(40.dp).testTag("switchable"), placeholder = WeftColor.Fixed(placeholder))
            }
        }
        val bounds = compose.onNodeWithTag("intrinsic").getUnclippedBoundsInRoot()
        assertEquals(240f, (bounds.right - bounds.left).value, 1f)
        assertEquals(104f, (bounds.bottom - bounds.top).value, 1f)
        val image = compose.onNodeWithTag("switchable")
        fun center() = image.captureToImage().toPixelMap().let { it[it.width / 2, it.height / 2] }
        assertNotEquals(placeholder, center())
        compose.runOnIdle { src.value = "asset:not_packaged" }
        assertEquals(placeholder, center())
    }

    @Test
    fun compactButtonKeepsItsImageFullSizeAndCentered() {
        compose.setContent {
            WeftButton(onClick = {}, modifier = Modifier.size(44.dp).testTag("button")) {
                WeftImage("asset:compass", Modifier.weftSize(width = 22f, height = 22f).testTag("icon"))
            }
        }
        val button = compose.onNodeWithTag("button").getUnclippedBoundsInRoot()
        val icon = compose.onNodeWithTag("icon", useUnmergedTree = true)
        icon.assertWidthIsEqualTo(22.dp).assertHeightIsEqualTo(22.dp)
        val bounds = icon.getUnclippedBoundsInRoot()
        assertEquals("left/right insets", (bounds.left - button.left).value, (button.right - bounds.right).value, 1f)
        assertEquals("top/bottom insets", (bounds.top - button.top).value, (button.bottom - bounds.bottom).value, 1f)
    }

    @Test
    fun textAndSpansUseThePackagedFamilyAndItsFaces() {
        compose.setContent {
            WeftText(font = "Inter") {
                WeftSpan("Inter span", font = "Inter")
            }
        }
        val results = mutableListOf<TextLayoutResult>()
        compose.onNodeWithText("Inter span").performSemanticsAction(SemanticsActions.GetTextLayoutResult) {
            assertTrue(it(results))
        }
        val input = results.single().layoutInput
        val family = input.style.fontFamily as FontListFontFamily
        assertEquals(setOf(FontWeight.W400, FontWeight.W600, FontWeight.W700), family.map { it.weight }.toSet())
        assertEquals(family, input.text.spanStyles.single().item.fontFamily)
    }
}
