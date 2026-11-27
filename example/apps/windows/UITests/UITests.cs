using System.Reflection;
using System.Text.Json;
using FlaUI.Core;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Tools;
using FlaUI.UIA3;

namespace UITests;

/// <summary>UI tests of the app; run with `dotnet test UITests` after building the app.</summary>
[TestClass]
public sealed class UITests
{
    [TestMethod]
    public void Launches()
    {
        ClearStorage();
        using var automation = new UIA3Automation();
        using var app = Application.Launch(AppPath());
        try
        {
            var window = app.GetMainWindow(automation, TimeSpan.FromSeconds(10));
            Assert.IsNotNull(window);
            var project = typeof(UITests).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
                .Single(a => a.Key == "AppProject").Value!;
            using var pages = JsonDocument.Parse(File.ReadAllText(Path.Combine(project, "..", "..", "pages.json")));
            foreach (var page in pages.RootElement.EnumerateArray())
            {
                if (page.TryGetProperty("pending", out var pending) &&
                    pending.EnumerateArray().Any(platform => platform.GetString() == "windows")) continue;
                var id = page.GetProperty("id").GetString();
                var label = $"page:{id}";
                var entry = Screenshots.FindButton(window, label);
                Assert.IsNotNull(entry, $"Missing catalog entry {label}");
                entry.Patterns.ScrollItem.PatternOrDefault?.ScrollIntoView();
                entry.AsButton().Invoke();
                var back = Screenshots.FindButton(window, "Back");
                Assert.IsNotNull(back, $"Navigation to {label} did not complete");
                if (id is "lifecycle" or "keyboard")
                {
                    var text = id == "lifecycle" ? "Foreground: 0" : "Keyboard avoidance";
                    Assert.IsNotNull(Retry.WhileNull(() => window.FindFirstDescendant(cf => cf.ByName(text)),
                        TimeSpan.FromSeconds(5), ignoreException: true).Result, $"{id} did not render");
                }
                back.AsButton().Invoke();
                var returned = Retry.WhileFalse(() => Screenshots.FindButton(window, label) is not null,
                    TimeSpan.FromSeconds(5), ignoreException: true).Result;
                Assert.IsTrue(returned, $"Returning from {label} did not restore the catalog");
                Thread.Sleep(TimeSpan.FromMilliseconds(300)); // Let the native pop animation finish.
            }
        }
        finally
        {
            app.Close();
        }
    }

    [TestMethod]
    public void ListLoadsMoreAtTheEnd()
    {
        ClearStorage();
        using var automation = new UIA3Automation();
        using var app = Application.Launch(AppPath());
        try
        {
            var window = app.GetMainWindow(automation, TimeSpan.FromSeconds(10));
            Assert.IsNotNull(window);
            var entry = Screenshots.FindButton(window, "page:list");
            Assert.IsNotNull(entry);
            entry.Patterns.ScrollItem.PatternOrDefault?.ScrollIntoView();
            entry.AsButton().Invoke();
            Assert.IsNotNull(Retry.WhileNull(() => window.FindFirstDescendant(cf => cf.ByName("Row 2")),
                TimeSpan.FromSeconds(5), ignoreException: true).Result, "List did not render");
            Thread.Sleep(TimeSpan.FromSeconds(1)); // Let the page transition finish before selecting its scroll viewer.
            var scroll = Retry.WhileNull(() => window.FindAllDescendants()
                .LastOrDefault(element => element.Patterns.Scroll.PatternOrDefault is { } pattern && pattern.VerticallyScrollable.Value),
                TimeSpan.FromSeconds(5), ignoreException: true).Result;
            Assert.IsNotNull(scroll, "List scroll viewer was not found");
            var loaded = Retry.WhileFalse(() =>
            {
                scroll.Patterns.Scroll.Pattern.SetScrollPercent(-1, 100);
                return window.FindAllDescendants().Any(element =>
                {
                    var name = element.Properties.Name.ValueOrDefault ?? "";
                    if (!name.StartsWith("Row ", StringComparison.Ordinal)) return false;
                    var number = new string(name.Skip(4).TakeWhile(char.IsDigit).ToArray());
                    return int.TryParse(number, out var row) && row > 1000;
                });
            }, TimeSpan.FromSeconds(15), ignoreException: true).Result;
            var rows = window.FindAllDescendants().Select(element => element.Properties.Name.ValueOrDefault ?? "")
                .Where(name => name.StartsWith("Row ", StringComparison.Ordinal)).Take(20);
            Assert.IsTrue(loaded, $"Loading more rows did not fire; visible rows: {string.Join(", ", rows)}; scroll percent: {scroll.Patterns.Scroll.Pattern.VerticalScrollPercent.Value}");
        }
        finally
        {
            app.Close();
        }
    }

    internal static void ClearStorage()
    {
        var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "net.mioyi.weftui.showcase", "storage.json");
        if (File.Exists(path)) File.Delete(path);
    }

    /// <summary>The most recently built App.exe of the app project.</summary>
    internal static string AppPath()
    {
        var project = typeof(UITests).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
            .Single(a => a.Key == "AppProject").Value!;
        return new DirectoryInfo(Path.Combine(project, "bin"))
            .EnumerateFiles("App.exe", SearchOption.AllDirectories)
            .MaxBy(file => file.LastWriteTimeUtc)?.FullName
            ?? throw new FileNotFoundException($"App.exe is not built in {project}; build the app first");
    }
}
