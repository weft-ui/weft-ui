package net.mioyi.weftui

import org.junit.Assert.assertEquals
import org.junit.Test

class LifecycleTest {
    @Test
    fun trimMemoryOnlyWarnsAtBackgroundLevelOrHigher() {
        val events = mutableListOf<Pair<String, String>>()
        val signals = LifecycleSignals { name, json -> events.add(name to json) }
        signals.trimMemory(10) // RUNNING_LOW
        signals.trimMemory(39)
        signals.trimMemory(40) // BACKGROUND
        signals.trimMemory(80) // COMPLETE
        assertEquals(listOf("memory" to "{}", "memory" to "{}"), events)
    }

    @Test
    fun deduplicatesStateChangesButNotMemoryWarnings() {
        val events = mutableListOf<Pair<String, String>>()
        val signals = LifecycleSignals { name, json -> events.add(name to json) }
        signals.setForeground(true)
        signals.setForeground(false)
        signals.setForeground(false)
        signals.memory()
        signals.memory()
        signals.setForeground(true)
        signals.setForeground(true)
        assertEquals(listOf(
            "lifecycle" to "{\"state\":\"background\"}",
            "memory" to "{}",
            "memory" to "{}",
            "lifecycle" to "{\"state\":\"foreground\"}",
        ), events)
    }
}
