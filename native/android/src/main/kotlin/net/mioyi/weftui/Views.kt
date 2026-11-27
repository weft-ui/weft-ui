package net.mioyi.weftui

import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.core.util.Consumer
import org.json.JSONObject
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

/** Starts the app's session and renders its root, padding for system bars when [safeArea] is enabled. */
@Composable
fun WeftRoot(layoutHash: ULong, safeArea: Boolean, theme: WeftTheme = WeftTheme.Empty, tabs: List<WeftTab> = emptyList(), make: WeftMake) {
    val context = LocalContext.current
    val activity = remember(context) { context.componentActivity() }
    val session = remember { WeftSession.start(context, layoutHash.toLong(), make, activity?.intent?.dataString) }
    DisposableEffect(session, activity) {
        val lifecycle = LifecycleSubscription(context, session::signal)
        val listener = Consumer<Intent> { intent ->
            intent.dataString?.let { session.signal("link", JSONObject().put("url", it).toString()) }
        }
        activity?.addOnNewIntentListener(listener)
        onDispose {
            activity?.removeOnNewIntentListener(listener)
            lifecycle.close()
            session.close()
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val density = LocalDensity.current
        val safe = WindowInsets.safeDrawing
        val environment = WeftEnvironment(
            dark = isSystemInDarkTheme(),
            width = maxWidth.value,
            height = maxHeight.value,
            scale = density.density,
            top = with(density) { safe.getTop(this).toDp().value },
            bottom = with(density) { safe.getBottom(this).toDp().value },
            start = with(density) { safe.getLeft(this, LayoutDirection.Ltr).toDp().value },
            end = with(density) { safe.getRight(this, LayoutDirection.Ltr).toDp().value },
        )
        LaunchedEffect(session, environment) { session.updateEnvironment(environment) }
        val fill = Modifier.fillMaxSize()
        val rootModifier = if (safeArea) fill.safeDrawingPadding() else fill
        val failure = session.failure
        val root = session.root
        val navigation = session.navigation
        CompositionLocalProvider(LocalWeftTheme provides theme, LocalLayoutDirection provides LayoutDirection.Ltr) {
            if (failure == null && navigation != null) {
                Box(rootModifier.clipToBounds()) { WeftNavigationHost(session, navigation, tabs) }
            } else {
                WeftLinear(WeftAxis.VERTICAL, rootModifier.clipToBounds()) {
                    if (failure != null) Text(failure, Modifier.padding(16.dp), color = Color.Red)
                    else if (root != null) key(root.id) { root.Content() }
                }
            }
        }
        OverlayHost(session.overlays)
    }
}

private tailrec fun Context.componentActivity(): ComponentActivity? = when (this) {
    is ComponentActivity -> this
    is ContextWrapper -> if (baseContext === this) null else baseContext.componentActivity()
    else -> null
}

/** `Button`: a Material button around its children. */
@Composable
fun WeftButton(
    onClick: () -> Unit,
    disabled: Boolean = false,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Button(onClick = onClick, enabled = !disabled, modifier = modifier, contentPadding = noButtonPadding) {
        WeftButtonContent(content)
    }
}

private val noButtonPadding = PaddingValues(0.dp)
