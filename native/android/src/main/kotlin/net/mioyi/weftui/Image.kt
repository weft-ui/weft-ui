package net.mioyi.weftui

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.roundToInt

/** Displays a density-qualified drawable or a remote image; missing or pending images have no intrinsic size. */
@Composable
fun WeftImage(
    src: String,
    modifier: Modifier = Modifier,
    fit: WeftImageFit = WeftImageFit.COVER,
    placeholder: WeftColor? = null,
) {
    if (src.startsWith("asset:")) {
        val resources = LocalResources.current
        val packageName = LocalContext.current.packageName
        val id = remember(resources, packageName, src) {
            val drawable = resources.weftResource(packageName, "drawable", src.removePrefix("asset:"))
            if (drawable == 0 && WeftLog.debuggable) WeftLog.warn("weft: image asset not found: $src")
            drawable
        }
        if (id != 0) {
            val painter = painterResource(id)
            RenderImage(painter, painter.intrinsicSize, fit, modifier)
            return
        }
    } else {
        val bitmap = remember(src) { mutableStateOf(Images.cached(src)) }
        val image = bitmap.value
        if (image != null) {
            val painter = remember(image) { BitmapPainter(image) }
            val intrinsic = with(LocalDensity.current) { Size(image.width.dp.toPx(), image.height.dp.toPx()) }
            RenderImage(painter, intrinsic, fit, modifier)
            return
        }
        LaunchedEffect(src) { bitmap.value = withContext(Dispatchers.IO) { Images.load(src) } }
    }
    val paint = if (placeholder == null) modifier else modifier.background(placeholder.resolve())
    Box(paint.size(0.dp))
}

@Composable
private fun RenderImage(painter: Painter, intrinsic: Size, fit: WeftImageFit, modifier: Modifier) {
    Image(
        painter,
        contentDescription = null,
        modifier = modifier.layout { measurable, constraints ->
            val (w, h) = intrinsic
            if (!w.isFinite() || !h.isFinite() || w <= 0f || h <= 0f) {
                val placeable = measurable.measure(Constraints.fixed(constraints.minWidth, constraints.minHeight))
                return@layout layout(constraints.minWidth, constraints.minHeight) { placeable.place(0, 0) }
            }
            val rawScale = when {
                constraints.hasFixedWidth -> constraints.maxWidth / w
                constraints.hasFixedHeight -> constraints.maxHeight / h
                else -> minOf(1f, constraints.maxWidth / w, constraints.maxHeight / h)
            }
            val scale = if (rawScale.isFinite()) rawScale else 0f
            val scaledW = w * scale
            val scaledH = h * scale
            val width = (if (scaledW.isFinite()) scaledW.roundToInt() else constraints.maxWidth)
                .coerceIn(constraints.minWidth, constraints.maxWidth)
            val height = (if (scaledH.isFinite()) scaledH.roundToInt() else constraints.maxHeight)
                .coerceIn(constraints.minHeight, constraints.maxHeight)
            val placeable = measurable.measure(Constraints.fixed(width, height))
            layout(width, height) { placeable.place(0, 0) }
        },
        contentScale = when (fit) {
            WeftImageFit.COVER -> ContentScale.Crop
            WeftImageFit.CONTAIN -> ContentScale.Fit
            WeftImageFit.FILL -> ContentScale.FillBounds
        },
    )
}

internal const val MAX_IMAGE_BYTES = 16 * 1024 * 1024
internal const val MAX_IMAGE_PIXELS = 16_777_216L

internal fun validatedImageUrl(src: String): URL? = try {
    val url = URL(src)
    val scheme = url.protocol.lowercase()
    if (scheme == "http" || scheme == "https") url else null
} catch (_: Exception) {
    null
}

internal fun imageCacheCapacityKiB(maxMemoryBytes: Long): Int =
    ((maxMemoryBytes / 8L) / 1024L).coerceIn(1L, Int.MAX_VALUE.toLong()).toInt()

internal fun bitmapSizeKiB(width: Int, height: Int): Int {
    if (width <= 0 || height <= 0) return 1
    val bytes = width.toLong() * height.toLong() * 4L
    return (bytes / 1024L).coerceIn(1L, Int.MAX_VALUE.toLong()).toInt()
}

internal fun withinImagePixelLimit(width: Int, height: Int): Boolean =
    width > 0 && height > 0 && width.toLong() * height.toLong() <= MAX_IMAGE_PIXELS

internal fun readBoundedImageBytes(stream: java.io.InputStream, limit: Int = MAX_IMAGE_BYTES): ByteArray? {
    val buffer = ByteArray(8192)
    val out = java.io.ByteArrayOutputStream()
    while (true) {
        val read = stream.read(buffer)
        if (read < 0) break
        if (out.size() + read > limit) return null
        out.write(buffer, 0, read)
    }
    return out.toByteArray()
}

/** Downloaded images by URL. */
private object Images {
    /** Up to an eighth of the heap, in KiB. */
    private val cache = object : LruCache<String, ImageBitmap>(imageCacheCapacityKiB(Runtime.getRuntime().maxMemory())) {
        override fun sizeOf(key: String, value: ImageBitmap): Int = bitmapSizeKiB(value.width, value.height)
    }

    fun cached(src: String): ImageBitmap? = cache.get(src)

    /** Downloads and decodes [src]; null when it fails. Blocks. */
    fun load(src: String): ImageBitmap? {
        val url = validatedImageUrl(src) ?: return null
        val connection = try {
            url.openConnection() as? HttpURLConnection ?: return null
        } catch (error: Exception) {
            WeftLog.warn("weft: cannot load the image $src ($error)")
            return null
        }
        return try {
            if (connection.responseCode >= 400) {
                WeftLog.warn("weft: cannot load the image $src (status ${connection.responseCode})")
                return null
            }
            if (connection.contentLengthLong > MAX_IMAGE_BYTES.toLong()) {
                WeftLog.warn("weft: image $src exceeds ${MAX_IMAGE_BYTES} byte limit")
                return null
            }
            val bytes = connection.inputStream.use { readBoundedImageBytes(it, MAX_IMAGE_BYTES) }
            if (bytes == null) {
                WeftLog.warn("weft: image $src exceeds ${MAX_IMAGE_BYTES} byte limit")
                return null
            }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (!withinImagePixelLimit(bounds.outWidth, bounds.outHeight)) {
                WeftLog.warn("weft: image $src exceeds ${MAX_IMAGE_PIXELS} pixel limit")
                return null
            }
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            bitmap?.asImageBitmap()?.also { cache.put(src, it) }
        } catch (error: Exception) {
            WeftLog.warn("weft: cannot load the image $src ($error)")
            null
        } finally {
            connection.disconnect()
        }
    }
}
