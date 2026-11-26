using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Weft.WinUI;
using Weft.WinUI.Protocol;

namespace Weft.WinUI.Tests;

[TestClass]
public sealed class CorpusTests
{
    [TestMethod]
    public void DecodesOpsAndReportsErrorKinds()
    {
        using var corpus = Load("ops.json");
        foreach (var row in corpus.RootElement.GetProperty("cases").EnumerateArray())
        {
            var name = Name(row);
            var bytes = Hex(row);
            if (row.TryGetProperty("error", out var kind))
            {
                var error = Assert.ThrowsExactly<OpException>(() => OpReader.ReadAll(bytes, []), name);
                Assert.AreEqual(kind.GetString(), error.Kind, name);
                continue;
            }

            var ops = new List<Op>();
            OpReader.ReadAll(bytes, ops);
            var expected = row.GetProperty("ops");
            Assert.AreEqual(expected.GetArrayLength(), ops.Count, name);
            var index = 0;
            foreach (var op in expected.EnumerateArray()) AssertOp(ops[index++], op, name);
        }
    }

    [TestMethod]
    public void HandlesValues()
    {
        using var corpus = Load("values.json");
        foreach (var row in corpus.RootElement.GetProperty("cases").EnumerateArray())
        {
            var json = row.GetProperty("value");
            var value = Value(json);
            if (json.TryGetProperty("strings", out _))
            {
                byte[] batch = [WeftProtocol.Version, (byte)OpCode.Set, 0, 0, 0, 0, 0, 0, 0, 0, .. Hex(row)];
                var ops = new List<Op>();
                OpReader.ReadAll(batch, ops);
                Assert.AreEqual(new Op(OpCode.Set, 0, 0, 0, value, null), ops.Single(), Name(row));
            }
            else
            {
                var actual = new List<byte>();
                value.Encode(actual);
                Assert.IsTrue(Hex(row).SequenceEqual(actual), Name(row));
            }
        }
    }

    [TestMethod]
    public void UnframesRequests()
    {
        using var corpus = Load("frames.json");
        foreach (var row in corpus.RootElement.GetProperty("requests").EnumerateArray())
        {
            var (head, body) = PlatformModules.Unframe(Hex(row));
            AssertFrame(row, head, body);
        }
    }

    [TestMethod]
    public void FramesResponses()
    {
        using var corpus = Load("frames.json");
        foreach (var row in corpus.RootElement.GetProperty("responses").EnumerateArray())
        {
            var encoded = PlatformModules.Frame(Head(row).AsObject(), Body(row)).AsSpan();
            Assert.IsTrue(encoded.Length >= 4, Name(row));
            var headLength = BinaryPrimitives.ReadUInt32LittleEndian(encoded);
            Assert.IsTrue(headLength <= (uint)(encoded.Length - 4), Name(row));
            var head = JsonNode.Parse(encoded.Slice(4, (int)headLength));
            AssertFrame(row, head, encoded[(4 + (int)headLength)..]);
        }
    }

    [TestMethod]
    public void RejectsMalformedFrames()
    {
        using var corpus = Load("frames.json");
        foreach (var row in corpus.RootElement.GetProperty("malformed").EnumerateArray())
        {
            var bytes = Hex(row);
            Assert.ThrowsExactly<InvalidOperationException>(() => PlatformModules.Unframe(bytes), Name(row));
        }
    }

    [TestMethod]
    public void LaysOutEverySharedCase()
    {
        using var corpus = Load("layout.json");
        foreach (var row in corpus.RootElement.GetProperty("cases").EnumerateArray())
        {
            var input = row.GetProperty("children");
            var children = new LayoutChild[input.GetArrayLength()];
            var intrinsic = new LayoutSize[children.Length];
            var frames = new LayoutFrame[children.Length];
            for (var i = 0; i < children.Length; i++)
            {
                var child = input[i];
                var size = child.GetProperty("intrinsic");
                intrinsic[i] = new(size[0].GetDouble(), size[1].GetDouble());
                var bounds = new LayoutBounds(Number(child, "width") ?? double.NaN, Number(child, "height") ?? double.NaN,
                    Number(child, "minWidth") ?? 0, Number(child, "maxWidth") ?? double.PositiveInfinity,
                    Number(child, "minHeight") ?? 0, Number(child, "maxHeight") ?? double.PositiveInfinity,
                    Number(child, "aspectRatio") ?? 0, default);
                children[i] = new(bounds, child.TryGetProperty("margin", out var margin) ? Insets(margin) : default,
                    Number(child, "grow") ?? 0, Flag(child, "fill"), Flag(child, "spacer"), Number(child, "size"));
            }

            LayoutSize Measure(int index, LayoutProposal proposal)
            {
                var bounds = children[index].Bounds;
                return bounds.Resolve(bounds.Constrain(proposal), intrinsic[index]);
            }

            var axis = WeftUnions.ParseAxis(row.GetProperty("axis").GetString()!);
            var limits = row.GetProperty("proposal");
            var (main, cross) = (Limit(limits[0]), Limit(limits[1]));
            var proposal = axis == WeftAxis.Vertical ? new LayoutProposal(cross, main) : new LayoutProposal(main, cross);
            var padding = Insets(row.GetProperty("padding"));
            var result = row.GetProperty("kind").GetString() switch
            {
                "linear" => WeftLayoutAlgorithm.Linear(axis, row.GetProperty("gap").GetDouble(),
                    WeftUnions.ParseCrossAlign(row.GetProperty("align").GetString()!),
                    WeftUnions.ParseJustify(row.GetProperty("justify").GetString()!), padding, proposal, children, Measure, frames),
                "stack" => WeftLayoutAlgorithm.Stack(WeftUnions.ParseAlignment(row.GetProperty("alignment").GetString()!),
                    padding, proposal, children, Measure, frames),
                _ => throw new InvalidOperationException($"Unknown layout kind in {Name(row)}"),
            };
            var expected = row.GetProperty("size");
            Near(expected[0], result.Width, $"{Name(row)} width");
            Near(expected[1], result.Height, $"{Name(row)} height");
            var expectedFrames = row.GetProperty("frames");
            Assert.AreEqual(expectedFrames.GetArrayLength(), frames.Length, Name(row));
            for (var i = 0; i < frames.Length; i++)
            {
                var rect = expectedFrames[i];
                var frame = frames[i];
                Near(rect[0], frame.X, $"{Name(row)} child {i} x");
                Near(rect[1], frame.Y, $"{Name(row)} child {i} y");
                Near(rect[2], frame.Width, $"{Name(row)} child {i} width");
                Near(rect[3], frame.Height, $"{Name(row)} child {i} height");
            }
        }
    }

    [TestMethod]
    public void AspectRatioMeasuresTheContentBoxAndSizeBoundsClampTheResult()
    {
        var bounds = new LayoutBounds(90, double.NaN, 0, 80, 32, 39, 2, new(3, 6, 4, 8));
        var proposed = LayoutProposal.Exact(new(45, 46));
        Assert.AreEqual(new LayoutSize(80, 39), bounds.Resolve(bounds.Constrain(proposed), new(2, 3)));
        bounds = bounds with { MaxWidth = double.PositiveInfinity, MaxHeight = double.PositiveInfinity };
        Assert.AreEqual(new LayoutSize(90, 45), bounds.Resolve(bounds.Constrain(proposed), new(2, 3)));
    }

    private static LayoutLimit Limit(JsonElement value) => value.ValueKind == JsonValueKind.Null ? LayoutLimit.Unbounded
        : value.TryGetProperty("exact", out var exact) ? new(exact.GetDouble(), true) : new(value.GetProperty("atMost").GetDouble());

    private static LayoutInsets Insets(JsonElement value) => new(value[0].GetDouble(), value[1].GetDouble(), value[2].GetDouble(), value[3].GetDouble());
    private static double? Number(JsonElement value, string name) => value.TryGetProperty(name, out var number) ? number.GetDouble() : null;
    private static bool Flag(JsonElement value, string name) => value.TryGetProperty(name, out var flag) && flag.GetBoolean();
    private static void Near(JsonElement expected, double actual, string context) => Assert.AreEqual(expected.GetDouble(), actual, 0.001, context);

    private static JsonDocument Load(string file) =>
        JsonDocument.Parse(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "corpus", file)));

    private static string Name(JsonElement row) => row.GetProperty("name").GetString()!;

    private static byte[] Hex(JsonElement row) =>
        Convert.FromHexString(string.Concat(row.GetProperty("hex").GetString()!.Where(c => !char.IsWhiteSpace(c))));

    private static JsonNode Head(JsonElement row) => JsonNode.Parse(row.GetProperty("head").GetRawText())!;

    private static byte[] Body(JsonElement row) => Encoding.UTF8.GetBytes(row.GetProperty("body").GetString()!);

    private static void AssertFrame(JsonElement row, JsonNode? head, ReadOnlySpan<byte> body)
    {
        Assert.IsTrue(JsonNode.DeepEquals(Head(row), head), Name(row));
        Assert.IsTrue(body.SequenceEqual(Body(row)), Name(row));
    }

    private static WeftValue Value(JsonElement value)
    {
        if (value.TryGetProperty("bool", out var boolean)) return WeftValue.Of(boolean.GetBoolean());
        if (value.TryGetProperty("number", out var number)) return WeftValue.Of(number.GetDouble());
        if (value.TryGetProperty("strings", out var strings))
            return WeftValue.Of(strings.EnumerateArray().Select(item => item.GetString()!).ToArray());
        return WeftValue.Of(value.GetProperty("string").GetString()!);
    }

    private static void AssertOp(in Op op, JsonElement expected, string name)
    {
        var code = expected.GetProperty("op").GetString() switch
        {
            "create" => OpCode.Create,
            "set" => OpCode.Set,
            "branch" => OpCode.Branch,
            "rows" => OpCode.Rows,
            "attach" => OpCode.Attach,
            "splice" => OpCode.Splice,
            "bind" => OpCode.Bind,
            "nav" => OpCode.Nav,
            var unknown => throw new InvalidOperationException($"unknown corpus op {unknown}"),
        };
        Assert.AreEqual(code, op.Code, name);
        Assert.AreEqual(expected.GetProperty(code == OpCode.Nav ? "tab" : "scope").GetUInt32(), op.Scope, name);
        switch (code)
        {
            case OpCode.Create:
                Assert.AreEqual(expected.GetProperty("template").GetUInt32(), op.Arg, name);
                break;
            case OpCode.Set:
                Assert.AreEqual(expected.GetProperty("slot").GetUInt32(), op.Arg, name);
                Assert.AreEqual(Value(expected.GetProperty("value")), op.Value, name);
                break;
            case OpCode.Branch or OpCode.Attach:
                Assert.AreEqual(expected.GetProperty("point").GetUInt32(), op.Arg, name);
                Assert.AreEqual(expected.GetProperty("child").GetUInt32(), op.Child, name);
                break;
            case OpCode.Splice:
                Assert.AreEqual(expected.GetProperty("point").GetUInt32(), op.Arg, name);
                Assert.AreEqual(expected.GetProperty("index").GetUInt32(), op.Index, name);
                Assert.AreEqual(expected.GetProperty("remove").GetUInt32(), op.Remove, name);
                var items = expected.GetProperty("items");
                Assert.AreEqual(items.GetArrayLength(), op.Items!.Length, name);
                var itemIndex = 0;
                foreach (var item in items.EnumerateArray())
                    Assert.AreEqual(new SpliceItem(item.GetProperty("item").GetUInt32(), item.GetProperty("template").GetUInt32()), op.Items[itemIndex++], name);
                break;
            case OpCode.Bind:
                Assert.AreEqual(expected.GetProperty("point").GetUInt32(), op.Arg, name);
                Assert.AreEqual(expected.GetProperty("item").GetUInt32(), op.Item, name);
                Assert.AreEqual(expected.GetProperty("child").GetUInt32(), op.Child, name);
                break;
            case OpCode.Nav:
                CollectionAssert.AreEqual(expected.GetProperty("tabs").EnumerateArray().Select(x => x.GetUInt32()).ToArray(), op.Tabs!, name);
                CollectionAssert.AreEqual(expected.GetProperty("stack").EnumerateArray().Select(x => x.GetUInt32()).ToArray(), op.Stack!, name);
                Assert.AreEqual(expected.GetProperty("modal").GetUInt32(), op.Modal, name);
                var style = expected.GetProperty("style").GetString() switch
                {
                    "sheet" => ModalStyle.Sheet,
                    "fullScreen" => ModalStyle.FullScreen,
                    var unknown => throw new InvalidOperationException($"unknown modal style {unknown}"),
                };
                Assert.AreEqual((uint)style, op.Style, name);
                break;
            case OpCode.Rows:
                Assert.AreEqual(expected.GetProperty("point").GetUInt32(), op.Arg, name);
                var children = expected.GetProperty("children");
                Assert.AreEqual(children.GetArrayLength(), op.Rows!.Length, name);
                var i = 0;
                foreach (var child in children.EnumerateArray())
                {
                    Assert.AreEqual(child.GetUInt32(), op.Rows[i++], name);
                }
                break;
        }
    }
}
