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
    fun switchingTabsReplacesAndClearsTheStack() {
        val initial = NavigationState(0, listOf(4, 0), listOf(9, 11), 0, 0)
        val switched = initial.switchTab(1)!!
        assertEquals(NavigationChange.REPLACE, switched.changeFrom(initial))
        assertEquals("{\"tab\":1,\"stack\":[],\"modal\":0}", switched.signal())
        assertEquals(listOf(4), switched.pages())
        assertNull(switched.switchTab(1))
        assertNull(switched.switchTab(2))
        val sameTab = initial.switchTab(0)!!
        assertEquals("{\"tab\":0,\"stack\":[],\"modal\":0}", sameTab.signal())
        assertEquals(NavigationChange.POP, sameTab.changeFrom(initial))
    }

    @Test
    fun modalChangesReplaceWithoutLosingUnderlyingPages() {
        val base = root.copy(stack = listOf(9))
        val sheet = base.copy(modal = 13, style = ModalStyle.SHEET)
        val fullScreen = base.copy(modal = 15, style = ModalStyle.FULLSCREEN)
        assertEquals(NavigationChange.REPLACE, sheet.changeFrom(base))
        assertEquals(NavigationChange.REPLACE, fullScreen.changeFrom(sheet))
        assertEquals(NavigationChange.REPLACE, base.changeFrom(sheet))
        assertEquals(listOf(4, 9, 13), sheet.pages())
        assertEquals(listOf(4, 9, 15), fullScreen.pages())
        assertEquals("{\"tab\":0,\"stack\":[9],\"modal\":0}", fullScreen.back()!!.signal())
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
