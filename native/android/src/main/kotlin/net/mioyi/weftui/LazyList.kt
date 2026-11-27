package net.mioyi.weftui

import androidx.compose.runtime.mutableStateListOf

/** One stable item of a lazy mount point. A null child is an unmaterialized item. */
data class WeftLazyItem(val id: Int, val template: Int, val child: WeftScope? = null)

/** Observable item state and height estimates for a lazy mount point. Heights are in dp. */
class WeftLazyList internal constructor(private val window: (Int, Int) -> Unit) {
    private val state = mutableStateListOf<WeftLazyItem>()
    val items: List<WeftLazyItem> get() = state
    private val indices = HashMap<Int, Int>()
    private val heights = HashMap<Int, Float>()
    private val totals = HashMap<Int, Pair<Float, Int>>()

    internal fun splice(index: Int, remove: Int, inserted: List<Op.SpliceItem>, destroy: (WeftScope) -> Unit) {
        require(index >= 0 && remove >= 0 && index <= state.size && remove <= state.size - index)
        val removed = state.subList(index, index + remove).associateBy { it.id }
        val retained = inserted.mapTo(HashSet()) { it.item }
        for (item in removed.values) if (item.id !in retained) {
            item.child?.let(destroy)
            forgetHeight(item)
        }
        val replacement = inserted.map { item ->
            val old = removed[item.item]
            if (old != null && old.template == item.template) old
            else {
                if (old != null) {
                    old.child?.let(destroy)
                    forgetHeight(old)
                }
                WeftLazyItem(item.item, item.template)
            }
        }
        for (id in removed.keys) indices.remove(id)
        state.subList(index, index + remove).clear()
        state.addAll(index, replacement)
        for (i in index until state.size) indices[state[i].id] = i
    }

    internal fun bind(id: Int, child: WeftScope?, destroy: (WeftScope) -> Unit) {
        val index = indices[id] ?: return
        val old = state[index]
        if (old.child === child) return
        old.child?.let(destroy)
        state[index] = old.copy(child = child)
    }

    internal fun destroyChildren(destroy: (WeftScope) -> Unit) {
        for (item in state) item.child?.let(destroy)
    }

    /** Requests the half-open item interval [start, end) from the kernel. */
    fun request(start: Int, end: Int) = window(start, end)

    /** Records the latest measurement for an item, maintaining a per-template average. */
    fun measure(id: Int, height: Float) {
        if (!height.isFinite() || height <= 0f) return
        val item = state[indices[id] ?: return]
        val previous = heights.put(id, height)
        val (sum, count) = totals[item.template] ?: (0f to 0)
        totals[item.template] = (sum + height - (previous ?: 0f)) to (count + if (previous == null) 1 else 0)
    }

    /** Average measured height for this template, or 44 dp until measured. */
    fun estimatedHeight(template: Int): Float {
        val (sum, count) = totals[template] ?: return 44f
        return sum / count
    }

    /** Visible inclusive indices expanded by one viewport on each side, in whole grid rows. */
    fun range(first: Int, last: Int, viewportHeight: Float, columns: Int = 1): IntRange {
        require(columns > 0)
        if (state.isEmpty() || first > last || last < 0 || first >= state.size) return IntRange.EMPTY
        val visibleFirst = first.coerceIn(0, state.lastIndex)
        val visibleLast = last.coerceIn(0, state.lastIndex)
        var start = visibleFirst - visibleFirst % columns
        var end = visibleLast + minOf(columns - visibleLast % columns, state.size - visibleLast)
        val target = viewportHeight.coerceAtLeast(0f)
        var distance = 0f
        while (start > 0 && distance < target) {
            val rowEnd = start
            start = (start - columns).coerceAtLeast(0)
            distance += rowHeight(start, rowEnd)
        }
        distance = 0f
        while (end < state.size && distance < target) {
            val rowStart = end
            end += minOf(columns, state.size - end)
            distance += rowHeight(rowStart, end)
        }
        return start until end
    }

    private fun rowHeight(start: Int, end: Int): Float {
        var height = 0f
        for (i in start until end) {
            val item = state[i]
            height = maxOf(height, heights[item.id] ?: estimatedHeight(item.template))
        }
        return height
    }

    private fun forgetHeight(item: WeftLazyItem) {
        val height = heights.remove(item.id) ?: return
        val (sum, count) = totals.getValue(item.template)
        if (count == 1) totals.remove(item.template) else totals[item.template] = (sum - height) to (count - 1)
    }
}
