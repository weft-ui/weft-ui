using System;
using System.Collections.Generic;
using System.Text;
using System.Threading.Tasks;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Weft.WinUI.Protocol;

namespace Weft.WinUI.Tests;

[TestClass]
public sealed class UiTests
{
    [TestMethod]
    public void ParsesOptionsAndDefaults()
    {
        var options = UiOptions.Parse(Encoding.UTF8.GetBytes("{\"title\":\"Pick\",\"options\":[\"One\",\"Two\"],\"destructiveIndex\":1,\"destructive\":true,\"duration\":\"long\"}"));
        Assert.AreEqual("Pick", options.Title);
        CollectionAssert.AreEqual(new[] { "One", "Two" }, options.Options);
        Assert.AreEqual(1, options.DestructiveIndex);
        Assert.IsTrue(options.Destructive);
        Assert.AreEqual("OK", options.ConfirmText);
        Assert.AreEqual("Cancel", options.CancelText);
        Assert.AreEqual("long", options.Duration);
        Assert.IsTrue(PlatformModules.Supported.Contains(WeftProtocol.UiModule));
    }

    [TestMethod]
    public void EncodesResults()
    {
        string Encode(string method, bool confirmed, int? selection) => Encoding.UTF8.GetString(UiOverlay.EncodeResult(method, confirmed, selection));
        Assert.AreEqual("", Encode(WeftProtocol.UiAlert, true, null));
        Assert.AreEqual("true", Encode(WeftProtocol.UiConfirm, true, null));
        Assert.AreEqual("false", Encode(WeftProtocol.UiConfirm, false, null));
        Assert.AreEqual("null", Encode(WeftProtocol.UiActionSheet, false, null));
        Assert.AreEqual("2", Encode(WeftProtocol.UiActionSheet, false, 2));
    }

    [TestMethod]
    public async Task DialogsRunInOrderAndContinueAfterFailure()
    {
        var queue = new DialogQueue();
        var gate = new TaskCompletionSource();
        var order = new List<int>();
        var first = queue.Enqueue(async () => { order.Add(1); await gate.Task; return await Task.FromException<int>(new InvalidOperationException()); });
        var second = queue.Enqueue(() => { order.Add(2); return Task.FromResult(2); });
        var third = queue.Enqueue(() => { order.Add(3); return Task.FromResult(3); });
        CollectionAssert.AreEqual(new[] { 1 }, order);
        gate.SetResult();
        try { await first; Assert.Fail("Expected failure"); } catch (InvalidOperationException) { }
        Assert.AreEqual(2, await second);
        Assert.AreEqual(3, await third);
        CollectionAssert.AreEqual(new[] { 1, 2, 3 }, order);
    }
}
