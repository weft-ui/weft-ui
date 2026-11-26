package net.mioyi.weftui.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import net.mioyi.weftui.WeftAlignment
import net.mioyi.weftui.WeftAxis
import net.mioyi.weftui.WeftColor
import net.mioyi.weftui.WeftLinear
import net.mioyi.weftui.WeftShadow
import net.mioyi.weftui.WeftStack
import net.mioyi.weftui.weftAppearance
import net.mioyi.weftui.weftSize
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppearanceTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun hiddenChildrenAreNotMeasuredOrPlacedAndLeaveNoGap() {
        val hidden = mutableStateOf(true)
        var linearMeasures = 0
        var stackMeasures = 0
        compose.setContent {
            WeftLinear(WeftAxis.VERTICAL, gap = 5f) {
                Box(Modifier.weftSize(width = 10f, height = 10f))
                Box(Modifier.weftSize(width = 10f, height = 10f)
                    .weftAppearance(hidden = hidden.value).testTag("linear child").layout { measurable, constraints ->
                        linearMeasures++
                        val placeable = measurable.measure(constraints)
                        layout(placeable.width, placeable.height) { placeable.place(0, 0) }
                    })
                WeftStack(modifier = Modifier.testTag("stack")) {
                    Box(Modifier.weftSize(width = 10f, height = 10f))
                    Box(Modifier.weftSize(width = 20f, height = 20f)
                        .weftAppearance(hidden = hidden.value).testTag("stack child").layout { measurable, constraints ->
                            stackMeasures++
                            val placeable = measurable.measure(constraints)
                            layout(placeable.width, placeable.height) { placeable.place(0, 0) }
                        })
                }
            }
        }
        compose.runOnIdle {
            assertEquals(0, linearMeasures)
            assertEquals(0, stackMeasures)
        }
        compose.onNodeWithTag("linear child").assertIsNotDisplayed()
        compose.onNodeWithTag("stack child").assertIsNotDisplayed()
        val stack = compose.onNodeWithTag("stack")
        val collapsed = stack.getUnclippedBoundsInRoot()
        assertEquals(15f, collapsed.top.value, 1f)
        assertEquals(10f, (collapsed.bottom - collapsed.top).value, 1f)
        compose.runOnIdle { hidden.value = false }
        compose.onNodeWithTag("linear child").assertIsDisplayed()
        compose.onNodeWithTag("stack child").assertIsDisplayed()
        val expanded = stack.getUnclippedBoundsInRoot()
        assertEquals(30f, expanded.top.value, 1f)
        assertEquals(20f, (expanded.bottom - expanded.top).value, 1f)
    }

    @Test
    fun roundedClipKeepsOverflowInsideThePaddingBoxEvenWithOpacity() {
        val clip = mutableStateOf(true)
        compose.setContent {
            WeftStack(
                modifier = Modifier.size(100.dp).background(Color.White).testTag("canvas"),
                alignment = WeftAlignment.CENTER,
            ) {
                WeftStack(
                    modifier = Modifier.weftSize(width = 40f, height = 32f).weftAppearance(
                        radius = 12f, border = 2f, borderColor = WeftColor.Fixed(Color.Black),
                        opacity = 0.5f, clip = clip.value,
                    ),
                    alignment = WeftAlignment.CENTER,
                ) {
                    Box(Modifier.weftSize(width = 70f, height = 64f).background(Color.Red))
                }
            }
        }
        val canvas = compose.onNodeWithTag("canvas")
        val clipped = canvas.captureToImage().toPixelMap()
        val center = clipped[clipped.width / 2, clipped.height / 2]
        val corner = clipped[clipped.width * 29 / 100, clipped.height / 3]
        val border = clipped[clipped.width * 29 / 100, clipped.height / 2]
        assertEquals(Color.White, corner)
        assertEquals(1f, center.red, 0.01f)
        assertEquals(0.5f, center.green, 0.02f)
        assertEquals(0.5f, border.red, 0.02f)
        compose.runOnIdle { clip.value = false }
        val overflowing = canvas.captureToImage().toPixelMap()
        val outside = overflowing[overflowing.width / 4, overflowing.height / 2]
        assertEquals(1f, outside.red, 0.01f)
        assertTrue(outside.green in 0.48f..0.52f)
    }

    @Test
    fun pressedOpacityMultipliesOwnOpacityAndRestoresOnReleaseOrCancel() {
        var taps = 0
        compose.setContent {
            Box(Modifier.size(120.dp).background(Color.White)) {
                Box(Modifier.size(40.dp).testTag("target").weftAppearance(
                    opacity = 0.5f, background = WeftColor.Fixed(Color.Red), onTap = { taps++ },
                ))
            }
        }
        val target = compose.onNodeWithTag("target")
        fun green(): Float {
            val pixels = target.captureToImage().toPixelMap()
            return pixels[pixels.width / 2, pixels.height / 2].green
        }
        assertEquals(0.5f, green(), 0.02f)
        target.performTouchInput { down(center) }
        assertEquals(0.7f, green(), 0.02f)
        compose.runOnIdle { assertEquals(0, taps) }
        target.performTouchInput { up() }
        assertEquals(0.5f, green(), 0.02f)
        compose.runOnIdle { assertEquals(1, taps) }

        target.performTouchInput { down(center) }
        assertEquals(0.7f, green(), 0.02f)
        target.performTouchInput { cancel() }
        assertEquals(0.5f, green(), 0.02f)
        compose.runOnIdle { assertEquals(1, taps) }

        target.performTouchInput {
            down(center)
            moveTo(Offset(right + 2f, centerY))
            up()
        }
        assertEquals(0.5f, green(), 0.02f)
        compose.runOnIdle { assertEquals(1, taps) }
    }

    @Test
    fun shadowIsOutsideTheTransparentBoxAndFallsDownEvenWithOpacityAndClip() {
        compose.setContent {
            WeftStack(
                modifier = Modifier.size(100.dp).background(Color.White).testTag("canvas"),
                alignment = WeftAlignment.CENTER,
            ) {
                Box(Modifier.weftSize(width = 40f, height = 32f).weftAppearance(
                    radius = 8f, shadow = WeftShadow.MEDIUM, opacity = 0.5f, clip = true,
                ))
            }
        }
        val pixels = compose.onNodeWithTag("canvas").captureToImage().toPixelMap()
        val x = pixels.width / 2
        assertEquals(Color.White, pixels[x, pixels.height / 2])
        val below = pixels[x, pixels.height * 69 / 100].red
        val above = pixels[x, pixels.height * 31 / 100].red
        assertTrue("shadow should be darker below ($below) than above ($above)", below < above)
    }
}
