package net.mioyi.weftui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NavigationTest {
    private val root = NavigationState(0, listOf(4), emptyList(), 0, 0)

    @Test
    fun classifiesStackChanges() {
        val pushed = root.copy(stack = listOf(9))
        val deeper = pushed.copy(stack = listOf(9, 11))
        assertEquals(NavigationChange.PUSH, pushed.changeFrom(root))
        assertEquals(NavigationChange.POP, root.changeFrom(deeper))
        assertEquals(NavigationChange.REPLACE, pushed.copy(stack = listOf(12)).changeFrom(pushed))
    }

    @Test
    fun backUpdatesStateAndReportsRemainingStack() {
        val deeper = root.copy(stack = listOf(9, 11))
        val next = deeper.back()!!
        assertEquals(listOf(9), next.stack)
        assertEquals("{\"tab\":0,\"stack\":[9],\"modal\":0}", next.signal())
        assertEquals(root, next.back())
        assertNull(root.back())
    }

    @Test
    fun backDismissesModalBeforePoppingStack() {
        val state = root.copy(stack = listOf(9), modal = 13, style = 1)
        val next = state.back()!!
        assertEquals(listOf(9), next.stack)
        assertEquals(0, next.modal)
        assertEquals(0, next.style)
        assertEquals("{\"tab\":0,\"stack\":[9],\"modal\":0}", next.signal())
    }
}
