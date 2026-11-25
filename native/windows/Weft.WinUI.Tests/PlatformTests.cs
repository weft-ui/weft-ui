using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Weft.WinUI;
using Weft.WinUI.Protocol;

namespace Weft.WinUI.Tests;

[TestClass]
public sealed class PlatformTests
{
    [TestMethod]
    public void FetchAndImageValidateHttpAndHttpsSchemesOnly()
    {
        Assert.AreEqual("https", PlatformModules.ValidatedHttpUri("https://example.com/a").Scheme);
        Assert.AreEqual("http", PlatformModules.ValidatedHttpUri("HTTP://example.com/a").Scheme);
        foreach (var bad in new[] { "file:///C:/Windows/win.ini", "data:text/plain,hi", "ms-appx:///a.png", "not-a-url", "" })
        {
            var threw = false;
            try { PlatformModules.ValidatedHttpUri(bad); }
            catch (InvalidOperationException) { threw = true; }
            Assert.IsTrue(threw, $"expected fetch rejection for {bad}");
            Assert.IsNull(WeftImage.ValidatedRemoteUri(bad), $"expected image rejection for {bad}");
        }
        Assert.IsNotNull(WeftImage.ValidatedRemoteUri("https://example.com/a.png"));
    }

    [TestMethod]
    public async Task ReadBoundedAsyncEnforcesByteCap()
    {
        await using var exact = new MemoryStream([1, 2, 3, 4]);
        CollectionAssert.AreEqual(new byte[] { 1, 2, 3, 4 }, await PlatformModules.ReadBoundedAsync(exact, 4));

        await using var tooLarge = new MemoryStream([1, 2, 3, 4, 5]);
        var threw = false;
        try { await PlatformModules.ReadBoundedAsync(tooLarge, 4); }
        catch (InvalidOperationException) { threw = true; }
        Assert.IsTrue(threw);
    }

    [TestMethod]
    public void ImageEnforcesPixelLimit()
    {
        Assert.IsTrue(WeftImage.WithinPixelLimit(100, 100));
        Assert.IsFalse(WeftImage.WithinPixelLimit(5000, 5000));
        Assert.IsFalse(WeftImage.WithinPixelLimit(0, 100));
    }

    [TestMethod]
    public async Task StorageValidatesStringArraysAndRollsBackOnWriteFailure()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"weft-win-storage-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        try
        {
            var file = Path.Combine(tempDir, "storage.json");
            var store = new StorageStore(file);
            CollectionAssert.AreEqual(Array.Empty<byte>(),
                await store.CallAsync(WeftProtocol.StorageSet, Encoding.UTF8.GetBytes("""["k","v1"]""")));
            var got = Encoding.UTF8.GetString(
                await store.CallAsync(WeftProtocol.StorageGet, Encoding.UTF8.GetBytes("""["k"]""")));
            Assert.AreEqual("\"v1\"", got);

            foreach (var bad in new[] { "[]", "[123]", """["k",123]""", """["k",null]""", "not-json" })
            {
                var threw = false;
                try { await store.CallAsync(WeftProtocol.StorageSet, Encoding.UTF8.GetBytes(bad)); }
                catch (InvalidOperationException) { threw = true; }
                Assert.IsTrue(threw, $"expected rejection for {bad}");
            }

            // Make saving fail cleanly by blocking directory creation with an existing file.
            var blocker = Path.Combine(tempDir, "blocker");
            await File.WriteAllTextAsync(blocker, "locked");
            var failingStore = new StorageStore(Path.Combine(blocker, "nested", "storage.json"));
            await failingStore.CallAsync(WeftProtocol.StorageGet, Encoding.UTF8.GetBytes("""["missing"]"""));

            var threwSave = false;
            try
            {
                await failingStore.CallAsync(WeftProtocol.StorageSet, Encoding.UTF8.GetBytes("""["k","v2"]"""));
            }
            catch (Exception)
            {
                threwSave = true;
            }
            Assert.IsTrue(threwSave);
            var after = Encoding.UTF8.GetString(
                await failingStore.CallAsync(WeftProtocol.StorageGet, Encoding.UTF8.GetBytes("""["k"]""")));
            Assert.AreEqual("null", after);
        }
        finally
        {
            try { Directory.Delete(tempDir, recursive: true); } catch { }
        }
    }

    [TestMethod]
    public void ControlsSanitizeNonFiniteValues()
    {
        Assert.AreEqual(0, WeftSlider.RoundValue(double.NaN, 0, 10, 1));
        Assert.AreEqual(0, WeftSlider.RoundValue(5, double.NaN, 10, 1));
        Assert.AreEqual(-1, WeftPicker.PickerIndex(double.NaN, 3));
        Assert.AreEqual(-1, WeftPicker.PickerIndex(5, 3));
        Assert.AreEqual(1, WeftPicker.PickerIndex(1, 3));
        Assert.AreEqual(0, WeftProgress.SanitizeProgress(double.NaN));
        Assert.AreEqual(0, WeftProgress.SanitizeProgress(double.PositiveInfinity));
        Assert.AreEqual(0, WeftProgress.SanitizeProgress(-0.5));
        Assert.AreEqual(1, WeftProgress.SanitizeProgress(2.0));
        Assert.AreEqual(0.5, WeftProgress.SanitizeProgress(0.5));
    }
}
