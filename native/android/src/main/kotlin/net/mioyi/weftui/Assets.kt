package net.mioyi.weftui

import android.content.res.Resources
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import org.xmlpull.v1.XmlPullParser

internal fun Resources.weftResource(packageName: String, type: String, name: String): Int =
    getIdentifier("weft_$name", type, packageName)

private const val ANDROID_NS = "http://schemas.android.com/apk/res/android"
private val nonResourceCharacter = Regex("[^a-z0-9]")

internal data class FontKey(val packageName: String, val family: String)

private val fontFamilies = LruCache<FontKey, FontFamily>(16)

private fun loadFontFamily(resources: Resources, key: FontKey): FontFamily? {
    val name = key.family.lowercase().replace(nonResourceCharacter, "_")
    val id = resources.weftResource(key.packageName, "font", name)
    if (id == 0) return null
    val xml = try {
        resources.getXml(id)
    } catch (_: Resources.NotFoundException) {
        // The lookup can also name a single font file, not a family definition.
        return null
    }
    // Compose needs the individual faces to match a run's weight and italic style.
    val fonts = buildList {
        xml.use {
            while (it.next() != XmlPullParser.END_DOCUMENT) {
                if (it.eventType != XmlPullParser.START_TAG || it.name != "font") continue
                val face = it.getAttributeResourceValue(ANDROID_NS, "font", 0)
                if (face == 0) continue
                val weight = FontWeight(it.getAttributeIntValue(ANDROID_NS, "fontWeight", 400))
                val style = if (it.getAttributeIntValue(ANDROID_NS, "fontStyle", 0) == 1) FontStyle.Italic else FontStyle.Normal
                add(Font(face, weight, style))
            }
        }
    }
    return if (fonts.isEmpty()) null else FontFamily(fonts)
}

@Composable
internal fun weftFontFamily(family: String?): FontFamily? {
    if (family == null) return null
    val appContext = LocalContext.current.applicationContext
    val resources = appContext.resources
    val packageName = appContext.packageName
    return remember(packageName, family) {
        val key = FontKey(packageName, family)
        fontFamilies.get(key) ?: loadFontFamily(resources, key)?.also { fontFamilies.put(key, it) }
    }
}
