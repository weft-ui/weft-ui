package net.mioyi.weftui

import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.ui.NavDisplay

/** Display metadata for one app tab. */
data class WeftTab(val title: String, val icon: String, val activeIcon: String)

internal enum class NavigationChange { PUSH, POP, REPLACE }

internal data class NavigationState(
    val tab: Int, val tabs: List<Int>, val stack: List<Int>, val modal: Int, val style: Int,
) {
    fun pages(): List<Int> = tabs.filter { it != 0 } + stack + listOfNotNull(modal.takeIf { it != 0 })
    fun back(): NavigationState? = when {
        modal != 0 -> copy(modal = 0, style = 0)
        stack.isNotEmpty() -> copy(stack = stack.dropLast(1))
        else -> null
    }
    fun switchTab(index: Int): NavigationState? =
        if (index !in tabs.indices || (index == tab && stack.isEmpty() && modal == 0)) null
        else copy(tab = index, stack = emptyList(), modal = 0, style = 0)
    fun signal(): String = "{\"tab\":$tab,\"stack\":[${stack.joinToString(",")}],\"modal\":$modal}"
    fun changeFrom(old: NavigationState?): NavigationChange {
        if (old == null || tab != old.tab || tabs != old.tabs || modal != old.modal) return NavigationChange.REPLACE
        return when {
            stack.size > old.stack.size && stack.take(old.stack.size) == old.stack -> NavigationChange.PUSH
            stack.size < old.stack.size && old.stack.take(stack.size) == stack -> NavigationChange.POP
            else -> NavigationChange.REPLACE
        }
    }
}

@Composable
internal fun WeftNavigationHost(session: WeftSession, state: NavigationState, tabs: List<WeftTab>) {
    val ids = listOf(state.tabs[state.tab]) + state.stack
    val pages = ids.mapNotNull(session::page)
    if (pages.isEmpty()) return
    NavDisplay(
        backStack = pages,
        onBack = { session.back() },
        transitionSpec = {
            if (session.navigationChange == NavigationChange.REPLACE) {
                EnterTransition.None togetherWith ExitTransition.None
            } else {
                slideInHorizontally { it } togetherWith slideOutHorizontally { -it }
            }
        },
        popTransitionSpec = {
            slideInHorizontally { -it } togetherWith slideOutHorizontally { it }
        },
        entryProvider = { page ->
            NavEntry(page, contentKey = page.id) {
                if (page.id == state.tabs[state.tab] && tabs.isNotEmpty()) {
                    Scaffold(bottomBar = {
                        NavigationBar {
                            tabs.forEachIndexed { index, tab ->
                                val selected = index == state.tab
                                NavigationBarItem(
                                    selected = selected,
                                    onClick = { session.selectTab(index) },
                                    icon = {
                                        BadgedBox(badge = {
                                            session.badges[index]?.let { text ->
                                                if (text.isEmpty()) Badge() else Badge { Text(text) }
                                            }
                                        }) {
                                            WeftImage(if (selected) tab.activeIcon else tab.icon, Modifier.size(24.dp))
                                        }
                                    },
                                    label = { Text(tab.title) },
                                )
                            }
                        }
                    }) { padding ->
                        Column(Modifier.padding(padding)) {
                            page.NavigationBar(null)
                            page.Content()
                        }
                    }
                } else {
                    Column {
                        page.NavigationBar(if (page.id != state.tabs[state.tab]) ({ session.back() }) else null)
                        page.Content()
                    }
                }
            }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WeftNavigationBar(title: String, hidden: Boolean, onBack: (() -> Unit)?, actions: @Composable RowScope.() -> Unit) {
    if (!hidden) {
        TopAppBar(
            title = { Text(title) },
            navigationIcon = {
                if (onBack != null) IconButton(onClick = onBack, modifier = Modifier.semantics { contentDescription = "Back" }) {
                    Text("←")
                }
            },
            actions = actions,
        )
    }
}

@Composable
fun WeftBarButton(title: String, icon: String?, enabled: Boolean, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.semantics { contentDescription = title }) {
        if (icon.isNullOrEmpty()) Text(title) else WeftImage(icon, Modifier.size(24.dp))
    }
}
