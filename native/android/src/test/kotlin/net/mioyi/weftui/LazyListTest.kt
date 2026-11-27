package net.mioyi.weftui

import androidx.compose.runtime.Composable
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import sun.misc.Unsafe

class LazyListTest {
    private fun child(id: Int): WeftScope {
        // The model never calls the session; allocating it avoids Android's Looper in JVM tests.
        val field = Unsafe::class.java.getDeclaredField("theUnsafe")
        field.isAccessible = true
        val session = (field.get(null) as Unsafe).allocateInstance(WeftSession::class.java) as WeftSession
        return object : WeftScope(id, session) {
            @Composable override fun Content() {}
        }
    }

    private fun item(id: Int, template: Int = 0) = Op.SpliceItem(id, template)

    @Test
    fun splicePreservesRetainedItemsAndDestroysOnlyRemovedChildren() {
        val list = WeftLazyList { _, _ -> }
        val destroyed = mutableListOf<WeftScope>()
        val a = child(10)
        val b = child(11)
        val c = child(12)
        list.splice(0, 0, listOf(item(1), item(2), item(3)), destroyed::add)
        list.bind(1, a, destroyed::add)
        list.bind(2, b, destroyed::add)
        list.bind(3, c, destroyed::add)
        list.splice(0, 1, listOf(item(4)), destroyed::add) // prefix
        assertEquals(listOf(a), destroyed)
        list.splice(2, 1, listOf(item(5)), destroyed::add) // suffix
        assertEquals(listOf(a, c), destroyed)
        list.splice(0, 3, listOf(item(5), item(2), item(6)), destroyed::add) // whole, reordered
        assertSame(b, list.items[1].child)
        assertEquals(listOf(5, 2, 6), list.items.map { it.id })
        assertEquals(listOf(a, c), destroyed)
        list.splice(0, 3, emptyList(), destroyed::add)
        assertEquals(listOf(a, c, b), destroyed)
    }

    @Test
    fun bindReleaseAndDestroyChildren() {
        val list = WeftLazyList { _, _ -> }
        val destroyed = mutableListOf<WeftScope>()
        val a = child(10)
        val b = child(11)
        list.splice(0, 0, listOf(item(1), item(2)), destroyed::add)
        list.bind(1, a, destroyed::add)
        list.bind(1, a, destroyed::add)
        list.bind(1, b, destroyed::add)
        assertEquals(listOf(a), destroyed)
        list.bind(1, null, destroyed::add)
        assertNull(list.items[0].child)
        assertEquals(listOf(a, b), destroyed)
        list.bind(2, a, destroyed::add)
        list.destroyChildren(destroyed::add)
        assertEquals(listOf(a, b, a), destroyed)
    }

    @Test
    fun gridRangeExpandsByRowsAndUsesTallestItem() {
        val list = WeftLazyList { _, _ -> }
        list.splice(0, 0, (1..12).map { item(it, it) }) {}
        list.measure(3, 20f)
        list.measure(4, 100f)
        list.measure(9, 30f)
        list.measure(10, 90f)
        assertEquals(2..9, list.range(4, 7, 80f, columns = 2))
        assertEquals(0..3, list.range(0, 1, 80f, columns = 2))
        assertEquals(10..11, list.range(11, 11, 0f, columns = 2))
    }

    @Test
    fun averagesAndExpandedRange() {
        var requested = 0 to 0
        val list = WeftLazyList { first, end -> requested = first to end }
        list.splice(0, 0, (1..10).map { item(it, if (it == 5) 1 else 0) }) {}
        assertEquals(44f, list.estimatedHeight(0), 0f)
        list.measure(1, 20f)
        list.measure(2, 60f)
        list.measure(5, 100f)
        assertEquals(40f, list.estimatedHeight(0), 0f)
        assertEquals(100f, list.estimatedHeight(1), 0f)
        assertEquals(1..6, list.range(3, 4, 80f))
        assertEquals(0..2, list.range(0, 0, 80f))
        assertEquals(IntRange.EMPTY, list.range(11, 12, 80f))
        list.request(1, 7)
        assertEquals(1 to 7, requested)
        list.splice(0, 1, emptyList()) {}
        assertEquals(60f, list.estimatedHeight(0), 0f)
        list.measure(2, 30f)
        assertEquals(30f, list.estimatedHeight(0), 0f)
    }
}
