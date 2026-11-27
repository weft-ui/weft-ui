package net.mioyi.weftui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

/** Static children before and after a lazy mount point. */
class WeftLazyContent {
    internal val headers = mutableListOf<@Composable () -> Unit>()
    internal val footers = mutableListOf<@Composable () -> Unit>()
    fun header(content: @Composable () -> Unit) { headers.add(content) }
    fun footer(content: @Composable () -> Unit) { footers.add(content) }
}

@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
@Composable
fun WeftLazy(
    model: WeftLazyList,
    grid: Boolean,
    sections: Boolean,
    modifier: Modifier = Modifier,
    columns: Float = 1f,
    gap: Float = 0f,
    indicators: Boolean = true,
    stickyHeaders: Boolean = false,
    refreshing: Boolean = false,
    onRefresh: (() -> Unit)? = null,
    padding: Float? = null,
    paddingX: Float? = null,
    paddingY: Float? = null,
    paddingTop: Float? = null,
    paddingBottom: Float? = null,
    paddingStart: Float? = null,
    paddingEnd: Float? = null,
    content: WeftLazyContent.() -> Unit,
) {
    val static = WeftLazyContent().apply(content)
    val insets = paddingEdges(padding, paddingX, paddingY, paddingTop, paddingBottom, paddingStart, paddingEnd)
    val paddingValues = PaddingValues(
        start = insets.start.dp, top = insets.top.dp, end = insets.end.dp, bottom = insets.bottom.dp,
    )
    val spacing = gap.coerceAtLeast(0f).dp
    val items = model.items
    val density = LocalDensity.current
    val row: @Composable (Int) -> Unit = { index ->
        val item = items[index]
        val child = item.child
        if (child == null) {
            Spacer(Modifier.fillMaxWidth().height(model.estimatedHeight(item.template).dp))
        } else {
            WeftLinear(
                axis = WeftAxis.VERTICAL,
                align = WeftCrossAlign.STRETCH,
                modifier = Modifier.fillMaxWidth().onSizeChanged { model.measure(item.id, it.height / density.density) },
            ) { child.Content() }
        }
    }
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = { onRefresh?.invoke() },
        modifier = modifier.then(WeftScrollModifier).weftPadding(insets),
    ) {
        if (grid) {
            val state = rememberLazyGridState()
            LaunchedEffect(model, state, static.headers.size) {
                var requested = IntRange.EMPTY
                snapshotFlow { Triple(state.layoutInfo.visibleItemsInfo.map { it.index }, state.layoutInfo.viewportSize.height, state.isScrollInProgress) }.collect { (indices, height, scrolling) ->
                    val first = (indices.firstOrNull() ?: return@collect) - static.headers.size
                    val last = (indices.lastOrNull() ?: return@collect) - static.headers.size
                    requested = requestWindow(model, requested, first, last, height / density.density, scrolling, if (grid) columns.toInt().coerceAtLeast(1) else 1)
                }
            }
            val color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
            val bar = if (indicators) Modifier.lazyScrollbar(color) { Triple(state.isScrollInProgress, state.firstVisibleItemIndex, state.layoutInfo.totalItemsCount to state.layoutInfo.visibleItemsInfo.size) } else Modifier
            LazyVerticalGrid(columns = GridCells.Fixed(columns.toInt().coerceAtLeast(1)), state = state, modifier = bar, contentPadding = paddingValues, verticalArrangement = Arrangement.spacedBy(spacing), horizontalArrangement = Arrangement.spacedBy(spacing)) {
                static.headers.forEachIndexed { index, child -> item(key = "header:$index", span = { GridItemSpan(maxLineSpan) }) { WeftLinear(axis = WeftAxis.VERTICAL, align = WeftCrossAlign.STRETCH, modifier = Modifier.fillMaxWidth()) { child() } } }
                items(items.size, key = { items[it].id }, contentType = { items[it].template }) { row(it) }
                static.footers.forEachIndexed { index, child -> item(key = "footer:$index", span = { GridItemSpan(maxLineSpan) }) { WeftLinear(axis = WeftAxis.VERTICAL, align = WeftCrossAlign.STRETCH, modifier = Modifier.fillMaxWidth()) { child() } } }
            }
        } else {
            val state = rememberLazyListState()
            LaunchedEffect(model, state, static.headers.size) {
                var requested = IntRange.EMPTY
                snapshotFlow { Triple(state.layoutInfo.visibleItemsInfo.map { it.index }, state.layoutInfo.viewportSize.height, state.isScrollInProgress) }.collect { (indices, height, scrolling) ->
                    val first = (indices.firstOrNull() ?: return@collect) - static.headers.size
                    val last = (indices.lastOrNull() ?: return@collect) - static.headers.size
                    requested = requestWindow(model, requested, first, last, height / density.density, scrolling, if (grid) columns.toInt().coerceAtLeast(1) else 1)
                }
            }
            val color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
            val bar = if (indicators) Modifier.lazyScrollbar(color) { Triple(state.isScrollInProgress, state.firstVisibleItemIndex, state.layoutInfo.totalItemsCount to state.layoutInfo.visibleItemsInfo.size) } else Modifier
            LazyColumn(state = state, modifier = bar, contentPadding = paddingValues, verticalArrangement = Arrangement.spacedBy(spacing)) {
                static.headers.forEachIndexed { index, child -> item(key = "header:$index") { WeftLinear(axis = WeftAxis.VERTICAL, align = WeftCrossAlign.STRETCH, modifier = Modifier.fillMaxWidth()) { child() } } }
                if (sections && stickyHeaders) {
                    items.forEachIndexed { index, item ->
                        if (item.template == 0) stickyHeader(key = item.id, contentType = item.template) { row(index) }
                        else item(key = item.id, contentType = item.template) { row(index) }
                    }
                } else {
                    items(items.size, key = { items[it].id }, contentType = { items[it].template }) { row(it) }
                }
                static.footers.forEachIndexed { index, child -> item(key = "footer:$index") { WeftLinear(axis = WeftAxis.VERTICAL, align = WeftCrossAlign.STRETCH, modifier = Modifier.fillMaxWidth()) { child() } } }
            }
        }
    }
}

private fun Modifier.lazyScrollbar(color: androidx.compose.ui.graphics.Color, state: () -> Triple<Boolean, Int, Pair<Int, Int>>): Modifier = drawWithContent {
    drawContent()
    val (scrolling, first, counts) = state()
    val (total, visible) = counts
    if (scrolling && total > visible && visible > 0) {
        val height = size.height * visible / total
        val offset = (size.height - height) * first / (total - visible).coerceAtLeast(1)
        val width = 3.dp.toPx()
        drawRoundRect(color, Offset(size.width - width, offset), Size(width, height), CornerRadius(width / 2))
    }
}

private fun requestWindow(model: WeftLazyList, previous: IntRange, first: Int, last: Int, height: Float, scrolling: Boolean, columns: Int): IntRange {
    if (model.items.isEmpty() || last < 0 || first >= model.items.size) return previous
    val visibleFirst = first.coerceAtLeast(0)
    val visibleLast = last.coerceAtMost(model.items.lastIndex)
    val range = model.range(visibleFirst, visibleLast, height, columns)
    val margin = (previous.last - previous.first + 1) / 4
    if (previous.isEmpty() || !scrolling || visibleFirst < previous.first + margin || visibleLast > previous.last - margin) {
        if (range != previous) model.request(range.first, range.last + 1)
        return range
    }
    return previous
}
