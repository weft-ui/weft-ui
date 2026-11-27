using Microsoft.UI.Xaml;
using Weft.WinUI;
using Windows.UI;

namespace Weft.WinUI.Tests;

[TestClass]
public sealed class OpReaderTests
{
    [TestMethod]
    public void LazySplicePreservesSurvivingBindingsAndReleasesRemovedItems()
    {
        var items = new LazyItems();
        items.Splice(0, 0, [new(1, 0), new(2, 0), new(3, 1)]);
        items.Bind(1, 11);
        items.Bind(2, 12);
        items.Bind(3, 13);
        items.Splice(0, 0, [new(4, 0)]);
        items.Splice(4, 0, [new(5, 0)]);
        CollectionAssert.AreEqual(new uint[] { 4, 1, 2, 3, 5 }, items.Items.Select(item => item.Id).ToArray());
        CollectionAssert.AreEquivalent(new uint[] { 11, 13 }, items.Splice(0, 5, [new(2, 0), new(6, 1)]));
        Assert.AreEqual(12u, items.Items[0].Child);
        Assert.AreEqual(12u, items.Bind(2, 0));
        Assert.AreEqual(0u, items.Items[0].Child);
    }

    [TestMethod]
    public void LazyWindowExpandsAndClampsBothEnds()
    {
        Assert.AreEqual((0u, 30u), LazyItems.Window(100, 0, 14));
        Assert.AreEqual((30u, 75u), LazyItems.Window(100, 45, 59));
        Assert.AreEqual((70u, 100u), LazyItems.Window(100, 85, 99));
    }

    [TestMethod]
    public void LazySpliceRejectsInvalidRangesAndDuplicateIds()
    {
        var items = new LazyItems();
        items.Splice(0, 0, [new(1, 0), new(2, 0)]);
        Assert.ThrowsExactly<OpException>(() => items.Splice(3, 0, []));
        Assert.ThrowsExactly<OpException>(() => items.Splice(1, 1, [new(1, 0)]));
        CollectionAssert.AreEqual(new uint[] { 1, 2 }, items.Items.Select(item => item.Id).ToArray());
    }

    [TestMethod]
    public void ParsesColors()
    {
        Assert.IsTrue(WeftColor.TryParse("#3B82f6", out var color));
        Assert.AreEqual(WeftColor.Rgba(0x3b82f6ff), color);
        Assert.IsTrue(WeftColor.TryParse("#abc", out color));
        Assert.AreEqual(WeftColor.Rgba(0xaabbccff), color);
        Assert.IsTrue(WeftColor.TryParse("#12345680", out color));
        Assert.AreEqual(Color.FromArgb(0x80, 0x12, 0x34, 0x56), color.Resolve(null, ElementTheme.Light));
        Assert.IsFalse(WeftColor.TryParse("red", out _));
        Assert.IsFalse(WeftColor.TryParse("#12345", out _));
        Assert.IsFalse(WeftColor.TryParse("#ggg", out _));
        Assert.IsFalse(WeftColor.TryParse("#abc\0\0\0", out _));
        Assert.IsFalse(WeftColor.TryParse("@", out _));
        Assert.IsFalse(WeftColor.TryParse("@accent!", out _));
        // Invalid dynamic colors are transparent.
        Assert.AreEqual(default, WeftValue.Of("nope").Color);
    }

    [TestMethod]
    public void ResolvesThemeColorSlotsAgainstTheSessionTheme()
    {
        var theme = WeftTheme.Register(new() { ["accent"] = (0x0a84ffff, 0x409cff80) });
        var otherTheme = WeftTheme.Register(new() { ["accent"] = (0xaabbccff, 0xaabbccff) });
        var token = WeftValue.Of("@accent").Color;
        Assert.AreEqual(WeftColor.Token("accent"), token);
        Assert.AreEqual(Color.FromArgb(0xff, 0x0a, 0x84, 0xff), token.Resolve(theme, ElementTheme.Light));
        Assert.AreEqual(Color.FromArgb(0x80, 0x40, 0x9c, 0xff), token.Resolve(theme, ElementTheme.Dark));
        Assert.AreEqual(Color.FromArgb(0xff, 0xaa, 0xbb, 0xcc), token.Resolve(otherTheme, ElementTheme.Dark));
        Assert.AreEqual(default, token.Resolve(null, ElementTheme.Dark));
        Assert.AreEqual(default, WeftColor.Token("missing").Resolve(theme, ElementTheme.Dark));
    }
}
