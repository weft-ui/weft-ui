package net.mioyi.weftui

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

class CorpusTest {
    private val corpus = File(checkNotNull(System.getProperty("weft.corpus")) { "build.gradle.kts sets weft.corpus" })

    @Test
    fun decodesOpsAndErrors() {
        load("ops.json").getJSONArray("cases").forEachObject { case ->
            val name = case.getString("name")
            val bytes = ByteBuffer.wrap(case.bytes())
            if (case.has("error")) {
                val error = assertThrows(name, OpException::class.java) { OpReader.readAll(bytes) }
                assertEquals(name, case.getString("error"), error.kind)
            } else {
                val ops = case.getJSONArray("ops")
                assertEquals(name, List(ops.length()) { op(ops.getJSONObject(it)) }, OpReader.readAll(bytes))
            }
        }
    }

    @Test
    fun handlesValues() {
        load("values.json").getJSONArray("cases").forEachObject { case ->
            val name = case.getString("name")
            val value = value(case.getJSONObject("value"))
            if (value is WeftValue.Strings) {
                val header = byteArrayOf(WeftProtocol.VERSION.toByte(), OpCode.SET.toByte(), 0, 0, 0, 0, 0, 0, 0, 0)
                assertEquals(name, listOf(Op.Set(0, 0, value)), OpReader.readAll(ByteBuffer.wrap(header + case.bytes())))
            } else {
                assertArrayEquals(name, case.bytes(), value.encode())
            }
        }
    }

    @Test
    fun handlesFrames() {
        val frames = load("frames.json")
        frames.getJSONArray("requests").forEachObject { case ->
            val (head, body) = PlatformModules.unframe(case.bytes())
            assertFrame(case, head, body)
        }
        frames.getJSONArray("responses").forEachObject { case ->
            val bytes = PlatformModules.frame(case.getJSONObject("head"), case.getString("body").encodeToByteArray())
            val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
            val length = buffer.int.toUInt().toLong()
            assertTrue("${case.getString("name")}: head length $length", length <= buffer.remaining())
            val head = ByteArray(length.toInt()).also { buffer.get(it) }
            val body = ByteArray(buffer.remaining()).also { buffer.get(it) }
            assertFrame(case, JSONObject(head.decodeToString()), body)
        }
        frames.getJSONArray("malformed").forEachObject { case ->
            assertThrows(case.getString("name"), PlatformFailure::class.java) { PlatformModules.unframe(case.bytes()) }
        }
    }

    @Test
    fun laysOutEverySharedCase() {
        load("layout.json").getJSONArray("cases").forEachObject { case ->
            val name = case.getString("name")
            val axis = WeftAxis.parse(case.getString("axis"))
            val limits = case.getJSONArray("proposal")
            val main = limits.limit(0)
            val cross = limits.limit(1)
            val proposal = if (axis == WeftAxis.HORIZONTAL) WeftProposal(main, cross) else WeftProposal(cross, main)
            val padding = case.getJSONArray("padding").edges()
            val entries = case.getJSONArray("children")
            val sizings = List(entries.length()) { index ->
                val child = entries.getJSONObject(index)
                WeftSizing(
                    width = child.number("width"), height = child.number("height"),
                    minWidth = child.number("minWidth"), maxWidth = child.number("maxWidth"),
                    minHeight = child.number("minHeight"), maxHeight = child.number("maxHeight"),
                    aspectRatio = child.number("aspectRatio"),
                )
            }
            val children = List(entries.length()) { index ->
                val child = entries.getJSONObject(index)
                WeftChild(
                    grow = child.optDouble("grow", 0.0), fill = child.optBoolean("fill"),
                    margin = child.optJSONArray("margin")?.edges() ?: WeftEdges(),
                    fixedWidth = sizings[index].width != null, fixedHeight = sizings[index].height != null,
                    spacer = child.optBoolean("spacer"), size = child.number("size"),
                )
            }
            val measured = BooleanArray(children.size)
            val measure = { index: Int, suggested: WeftProposal ->
                assertTrue("$name: child $index was measured more than once", !measured[index])
                measured[index] = true
                val intrinsic = entries.getJSONObject(index).getJSONArray("intrinsic")
                val constrained = sizings[index].resolve(suggested, WeftEdges())
                WeftExtent(constrained.width.resolve(intrinsic.getDouble(0)), constrained.height.resolve(intrinsic.getDouble(1)))
            }
            val result = when (case.getString("kind")) {
                "linear" -> weftLinear(
                    axis, case.getDouble("gap"), WeftCrossAlign.parse(case.getString("align")),
                    WeftJustify.parse(case.getString("justify")), padding, proposal, children, measure = measure,
                )
                "stack" -> weftStack(WeftAlignment.parse(case.getString("alignment")), padding, proposal, children, measure)
                else -> error("Unknown layout kind in $name")
            }
            assertTrue("$name: not all children were measured", measured.all { it })
            assertLayout(name, case.getJSONArray("size"), result.size.width, result.size.height)
            val frames = case.getJSONArray("frames")
            assertEquals(name, frames.length(), result.frames.size)
            result.frames.forEachIndexed { index, frame ->
                assertLayout("$name child $index", frames.getJSONArray(index), frame.x, frame.y, frame.width, frame.height)
            }
        }
    }

    @Test
    fun constraintsAndAspectRatioApplyInsidePadding() {
        val sizing = WeftSizing(width = 40.0, minWidth = 60.0, maxWidth = 80.0, aspectRatio = 2.0)
        val padding = paddingEdges(2f, 5f, 3f, 7f, null, null, 9f)
        assertEquals(WeftEdges(top = 7.0, end = 9.0, bottom = 3.0, start = 5.0), padding)
        val result = sizing.resolve(WeftProposal(WeftLimit(20.0), WeftLimit(15.0)), padding)
        assertEquals(WeftProposal(WeftLimit.exact(74.0), WeftLimit.exact(40.0)), result)
    }

    @Test
    fun borderAndPaddingAreOutsideAspectRatioAndFixedSize() {
        val padding = WeftEdges(top = 3.0, end = 5.0, bottom = 7.0, start = 9.0)
        val sizing = WeftSizing(width = 60.0, aspectRatio = 2.0)
        val result = sizing.resolve(WeftProposal(), padding, border = 2.0)
        assertEquals(WeftProposal(WeftLimit.exact(78.0), WeftLimit.exact(44.0)), result)
    }

    @Test
    fun atMostZeroDoesNotEstablishAnAspectRatio() {
        val proposal = WeftProposal(width = WeftLimit(0.0))
        assertEquals(proposal, WeftSizing(aspectRatio = 2.0).resolve(proposal, WeftEdges()))
    }

    @Test
    fun pixelSharesKeepTheAllocatedMainSize() {
        val result = weftLinear(
            WeftAxis.HORIZONTAL, 0.0, WeftCrossAlign.START, WeftJustify.START, WeftEdges(),
            WeftProposal(width = WeftLimit.exact(5.0)), List(3) { WeftChild(grow = 1.0) }, pixelShares = true,
        ) { _, proposal -> WeftExtent(proposal.width.resolve(0.0), 0.0) }
        assertEquals(listOf(WeftFrame(0.0, 0.0, 2.0, 0.0), WeftFrame(2.0, 0.0, 1.0, 0.0), WeftFrame(3.0, 0.0, 2.0, 0.0)), result.frames)
    }

    private fun assertLayout(name: String, expected: JSONArray, vararg actual: Double) {
        actual.forEachIndexed { index, value -> assertEquals("$name coordinate $index", expected.getDouble(index), value, 0.001) }
    }

    private fun JSONArray.limit(index: Int): WeftLimit {
        if (isNull(index)) return WeftLimit()
        val limit = getJSONObject(index)
        return if (limit.has("exact")) WeftLimit.exact(limit.getDouble("exact")) else WeftLimit(limit.getDouble("atMost"))
    }

    private fun JSONArray.edges() = WeftEdges(getDouble(0), getDouble(1), getDouble(2), getDouble(3))

    private fun JSONObject.number(name: String): Double? = if (has(name)) getDouble(name) else null

    private fun load(file: String): JSONObject = JSONObject(corpus.resolve(file).readText())

    private fun op(json: JSONObject): Op {
        val scope = if (json.has("scope")) json.getInt("scope") else 0
        return when (val name = json.getString("op")) {
            "create" -> Op.Create(scope, json.getInt("template"))
            "set" -> Op.Set(scope, json.getInt("slot"), value(json.getJSONObject("value")))
            "branch" -> Op.Branch(scope, json.getInt("point"), json.getInt("child"))
            "rows" -> {
                val children = json.getJSONArray("children")
                Op.Rows(scope, json.getInt("point"), IntArray(children.length()) { children.getInt(it) })
            }
            "attach" -> Op.Attach(scope, json.getInt("point"), json.getInt("child"))
            "splice" -> {
                val items = json.getJSONArray("items")
                Op.Splice(scope, json.getInt("point"), json.getInt("index"), json.getInt("remove"),
                    List(items.length()) { items.getJSONObject(it).let { item -> Op.SpliceItem(item.getInt("item"), item.getInt("template")) } })
            }
            "bind" -> Op.Bind(scope, json.getInt("point"), json.getInt("item"), json.getInt("child"))
            "nav" -> {
                val tabs = json.getJSONArray("tabs")
                val stack = json.getJSONArray("stack")
                val style = when (val value = json.getString("style")) {
                    "sheet" -> ModalStyle.SHEET
                    "fullScreen" -> ModalStyle.FULLSCREEN
                    else -> error("Unknown modal style: $value")
                }
                Op.Nav(json.getInt("tab"), List(tabs.length()) { tabs.getInt(it) },
                    List(stack.length()) { stack.getInt(it) }, json.getInt("modal"), style)
            }
            else -> error("Unknown corpus op: $name")
        }
    }

    private fun value(json: JSONObject): WeftValue = when {
        json.has("bool") -> WeftValue.Bool(json.getBoolean("bool"))
        json.has("number") -> WeftValue.Number(json.getDouble("number"))
        json.has("string") -> WeftValue.Text(json.getString("string"))
        json.has("strings") -> {
            val strings = json.getJSONArray("strings")
            WeftValue.Strings(List(strings.length()) { strings.getString(it) })
        }
        else -> error("Unknown corpus value: $json")
    }

    private fun assertFrame(case: JSONObject, head: JSONObject, body: ByteArray) {
        val name = case.getString("name")
        assertEquals(name, case.getJSONObject("head").jsonValue(), head.jsonValue())
        assertArrayEquals(name, case.getString("body").encodeToByteArray(), body)
    }

    private fun Any?.jsonValue(): Any? = when (this) {
        is JSONObject -> keys().asSequence().associateWith { get(it).jsonValue() }
        is JSONArray -> List(length()) { get(it).jsonValue() }
        is Number -> toString().toBigDecimal().stripTrailingZeros()
        JSONObject.NULL -> null
        else -> this
    }

    private fun JSONObject.bytes(): ByteArray = getString("hex").filterNot(Char::isWhitespace).hexToByteArray()

    private inline fun JSONArray.forEachObject(action: (JSONObject) -> Unit) {
        for (index in 0 until length()) action(getJSONObject(index))
    }
}
