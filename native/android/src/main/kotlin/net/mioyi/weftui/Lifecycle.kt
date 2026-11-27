package net.mioyi.weftui

import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner

internal class LifecycleSignals(private val signal: (String, String) -> Unit) {
    private var foreground = true

    fun setForeground(value: Boolean) {
        if (foreground == value) return
        foreground = value
        signal("lifecycle", if (value) "{\"state\":\"foreground\"}" else "{\"state\":\"background\"}")
    }

    fun memory() = signal("memory", "{}")

    fun trimMemory(level: Int) {
        if (level >= ComponentCallbacks2.TRIM_MEMORY_BACKGROUND) memory()
    }
}

internal class LifecycleSubscription(context: Context, signal: (String, String) -> Unit) {
    private val application = context.applicationContext
    private val signals = LifecycleSignals(signal)
    private val observer = LifecycleEventObserver { _, event ->
        when (event) {
            Lifecycle.Event.ON_START -> signals.setForeground(true)
            Lifecycle.Event.ON_STOP -> signals.setForeground(false)
            else -> Unit
        }
    }
    private val callbacks = object : ComponentCallbacks2 {
        override fun onConfigurationChanged(newConfig: Configuration) = Unit
        override fun onLowMemory() = signals.memory()
        override fun onTrimMemory(level: Int) = signals.trimMemory(level)
    }

    init {
        application.registerComponentCallbacks(callbacks)
        val lifecycle = ProcessLifecycleOwner.get().lifecycle
        if (!lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) signals.setForeground(false)
        lifecycle.addObserver(observer)
    }

    fun close() {
        ProcessLifecycleOwner.get().lifecycle.removeObserver(observer)
        application.unregisterComponentCallbacks(callbacks)
    }
}
