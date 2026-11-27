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
            OpenGallery(window);
            using var pages = JsonDocument.Parse(File.ReadAllText(Path.Combine(project, "..", "..", "pages.json")));
            foreach (var page in pages.RootElement.EnumerateArray())
            {
                if (page.TryGetProperty("link", out _)) continue;
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
                if (id == "overlays")
                {
                    Thread.Sleep(TimeSpan.FromMilliseconds(300)); // Wait for the push animation before measuring.
                    var title = window.FindAllDescendants(cf => cf.ByName("Overlays"))
                        .Where(element => element.Properties.ControlType.ValueOrDefault == FlaUI.Core.Definitions.ControlType.Text)
                        .MinBy(element => element.BoundingRectangle.Top);
                    Assert.IsNotNull(title, "Navigation title not found");
                    Assert.IsTrue(title.BoundingRectangle.Left >= back.BoundingRectangle.Right,
                        $"Title overlaps back button: title {title.BoundingRectangle}, back {back.BoundingRectangle}");
                }
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
            OpenGallery(window);
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

    [TestMethod]
    public void ProtocolActivationOpensAndForwardsLinks()
    {
        ClearStorage();
        using var automation = new UIA3Automation();
        // Registration is persistent but must happen once before the first protocol launch.
        using (var registration = Application.Launch(AppPath()))
        {
            Assert.IsNotNull(registration.GetMainWindow(automation, TimeSpan.FromSeconds(10)));
            registration.Close();
            Assert.IsTrue(Retry.WhileFalse(() => !System.Diagnostics.Process.GetProcessesByName("App")
                .Any(p => !p.HasExited && p.MainWindowTitle == "Weft Showcase"),
                TimeSpan.FromSeconds(10), ignoreException: true).Result);
        }
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("weftexample://showcase/list") { UseShellExecute = true });
        var process = Retry.WhileNull(() => System.Diagnostics.Process.GetProcessesByName("App")
            .FirstOrDefault(p => !p.HasExited && p.MainWindowTitle == "Weft Showcase"),
            TimeSpan.FromSeconds(15), ignoreException: true).Result;
        Assert.IsNotNull(process, "Protocol launch did not open the app");
        using var app = Application.Attach(process.Id);
        try
        {
            var window = app.GetMainWindow(automation, TimeSpan.FromSeconds(10));
            Assert.IsNotNull(window);
            Assert.IsNotNull(Retry.WhileNull(() => window.FindFirstDescendant(cf => cf.ByName("Row 2")),
                TimeSpan.FromSeconds(10), ignoreException: true).Result, "Cold link did not open the list");
            SaveLinkScreenshot(window, "cold");
            Screenshots.FindButton(window, "Back")!.AsButton().Invoke();
            Assert.IsNotNull(FindNamed(window, "Latest notes"), "Back did not return to Feed");
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("weftexample://showcase/overlays") { UseShellExecute = true });
            Assert.IsNotNull(Screenshots.FindButton(window, "Alert"), "Running link did not open overlays");
            SaveLinkScreenshot(window, "running");
            Assert.AreEqual(1, System.Diagnostics.Process.GetProcessesByName("App").Count(p => !p.HasExited && p.MainWindowTitle == "Weft Showcase"));
        }
        finally { app.Close(); }
    }

    [TestMethod]
    public void FieldnotesNavigationAndPagination()
    {
        ClearStorage();
        using var automation = new UIA3Automation();
        using var app = Application.Launch(AppPath());
        try
        {
            var window = app.GetMainWindow(automation, TimeSpan.FromSeconds(10));
            Assert.IsNotNull(window);
            var headerTitle = FindNamed(window, "Fieldnotes");
            var headerAction = Screenshots.FindButton(window, "发布");
            Assert.IsNotNull(headerTitle);
            Assert.IsNotNull(headerAction);
            Assert.IsTrue(headerTitle.BoundingRectangle.Left - window.BoundingRectangle.Left >= 16,
                $"Root title needs a leading inset: {headerTitle.BoundingRectangle}");
            var titleCenter = headerTitle.BoundingRectangle.Top + headerTitle.BoundingRectangle.Height / 2.0;
            var actionCenter = headerAction.BoundingRectangle.Top + headerAction.BoundingRectangle.Height / 2.0;
            Assert.IsTrue(Math.Abs(titleCenter - actionCenter) <= 5,
                $"Header title and action must be vertically aligned: {headerTitle.BoundingRectangle}, {headerAction.BoundingRectangle}");
            SelectTab(window, "发现");
            Assert.IsNotNull(Screenshots.FindButton(window, "组件画廊"));
            SelectTab(window, "消息");
            Assert.IsNotNull(FindNamed(window, "Updates from your trail community."));
            SelectTab(window, "我的");
            Assert.IsNotNull(FindNamed(window, "Mara Chen"));
            Click(window, "Log in");
            Assert.IsNotNull(FindNamed(window, "Welcome back to your journal."));
            Click(window, "Cancel");
            Click(window, "Settings");
            Click(window, "Clear cache");
            Assert.IsNotNull(FindNamed(window, "Clear cached data?"));
            Click(window, "Clear");
            Assert.IsNotNull(FindNamed(window, "✓ Cache cleared"));
            Click(window, "Back");
            SelectTab(window, "首页");
            var heading = FindNamed(window, "Latest notes");
            Assert.IsNotNull(heading);
            Assert.IsTrue(heading.BoundingRectangle.Width >= 100, "Tab navigation must not squeeze the feed at narrow widths");
            Click(window, "发布");
            Assert.IsNotNull(FindNamed(window, "Publish a note"));
            Click(window, "Cancel");
            var note = FindNamed(window, "NOTE 1  /  MOUNTAINS  /  6 MIN READ");
            Assert.IsNotNull(note);
            note.Click();
            Assert.IsNotNull(FindNamed(window, "Trail comments (2)"));
            Click(window, "Back");
            Assert.IsNotNull(FindNamed(window, "Latest notes"));
            var scroll = Retry.WhileNull(() => window.FindAllDescendants()
                .LastOrDefault(element => element.Patterns.Scroll.PatternOrDefault is { } pattern && pattern.VerticallyScrollable.Value),
                TimeSpan.FromSeconds(5), ignoreException: true).Result;
            Assert.IsNotNull(scroll);
            var loaded = Retry.WhileFalse(() => {
                scroll.Patterns.Scroll.Pattern.SetScrollPercent(-1, 100);
                return window.FindAllDescendants().Any(element => {
                    var name = element.Properties.Name.ValueOrDefault ?? "";
                    if (!name.StartsWith("NOTE ", StringComparison.Ordinal)) return false;
                    var digits = new string(name.Skip(5).TakeWhile(char.IsDigit).ToArray());
                    return int.TryParse(digits, out var row) && row >= 500;
                });
            }, TimeSpan.FromSeconds(45), ignoreException: true).Result;
            Assert.IsTrue(loaded, "Feed did not load through row 500");
        }
        finally { app.Close(); }
    }

    [TestMethod]
    public void ColdNoteLinkReturnsToFeed()
    {
        ClearStorage();
        using var automation = new UIA3Automation();
        using (var registration = Application.Launch(AppPath()))
        {
            Assert.IsNotNull(registration.GetMainWindow(automation, TimeSpan.FromSeconds(10)));
            registration.Close();
            Assert.IsTrue(Retry.WhileFalse(() => !System.Diagnostics.Process.GetProcessesByName("App")
                .Any(p => !p.HasExited && p.MainWindowTitle == "Weft Showcase"),
                TimeSpan.FromSeconds(10), ignoreException: true).Result);
        }
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("weftexample://notes/3") { UseShellExecute = true });
        var process = Retry.WhileNull(() => System.Diagnostics.Process.GetProcessesByName("App")
            .FirstOrDefault(p => !p.HasExited && p.MainWindowTitle == "Weft Showcase"),
            TimeSpan.FromSeconds(15), ignoreException: true).Result;
        Assert.IsNotNull(process);
        using var app = Application.Attach(process.Id);
        try
        {
            var window = app.GetMainWindow(automation, TimeSpan.FromSeconds(10));
            Assert.IsNotNull(window);
            Assert.IsNotNull(FindNamed(window, "Trail comments (2)"));
            Assert.IsNotNull(FindNamed(window, "The long way up Juniper Ridge"));
            Click(window, "Back");
            Assert.IsNotNull(FindNamed(window, "Latest notes"));
        }
        finally { app.Close(); }
    }

    [TestMethod]
    public void ColdLinksOpenTabPages()
    {
        ClearStorage();
        using var automation = new UIA3Automation();
        using (var registration = Application.Launch(AppPath()))
        {
            Assert.IsNotNull(registration.GetMainWindow(automation, TimeSpan.FromSeconds(10)));
            registration.Close();
            Assert.IsTrue(Retry.WhileFalse(() => !System.Diagnostics.Process.GetProcessesByName("App")
                .Any(p => !p.HasExited && p.MainWindowTitle == "Weft Showcase"),
                TimeSpan.FromSeconds(10), ignoreException: true).Result);
        }
        foreach (var (link, marker) in new[] {
            ("discover", "组件画廊"), ("inbox", "Updates from your trail community."), ("me", "Mara Chen") })
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("weftexample://" + link) { UseShellExecute = true });
            var process = Retry.WhileNull(() => System.Diagnostics.Process.GetProcessesByName("App")
                .FirstOrDefault(p => !p.HasExited && p.MainWindowTitle == "Weft Showcase"),
                TimeSpan.FromSeconds(15), ignoreException: true).Result;
            Assert.IsNotNull(process, $"Cold protocol launch failed for {link}");
            using var app = Application.Attach(process.Id);
            try
            {
                var window = app.GetMainWindow(automation, TimeSpan.FromSeconds(10));
                Assert.IsNotNull(window);
                Assert.IsNotNull(FindNamed(window, marker), $"Cold protocol launch did not open {link}");
            }
            finally { app.Close(); }
            Assert.IsTrue(Retry.WhileFalse(() => !System.Diagnostics.Process.GetProcessesByName("App")
                .Any(p => !p.HasExited && p.MainWindowTitle == "Weft Showcase"),
                TimeSpan.FromSeconds(10), ignoreException: true).Result);
        }
    }

    private static AutomationElement? FindNamed(FlaUI.Core.AutomationElements.Window window, string name) =>
        Retry.WhileNull(() => window.FindFirstDescendant(cf => cf.ByName(name)),
            TimeSpan.FromSeconds(10), ignoreException: true).Result;

    private static void Click(FlaUI.Core.AutomationElements.Window window, string label)
    {
        var button = Screenshots.FindButton(window, label);
        Assert.IsNotNull(button, $"Missing button {label}");
        button.Patterns.ScrollItem.PatternOrDefault?.ScrollIntoView();
        button.AsButton().Invoke();
    }

    private static void SelectTab(FlaUI.Core.AutomationElements.Window window, string label)
    {
        var item = FindNamed(window, label);
        Assert.IsNotNull(item, $"Missing tab {label}");
        var selectable = item.Patterns.SelectionItem.PatternOrDefault is not null ? item : item.Parent;
        Assert.IsNotNull(selectable);
        selectable.Patterns.SelectionItem.Pattern.Select();
    }

    private static void OpenGallery(FlaUI.Core.AutomationElements.Window window)
    {
        SelectTab(window, "发现");
        Click(window, "组件画廊");
    }

    private static void SaveLinkScreenshot(FlaUI.Core.AutomationElements.Window window, string name)
    {
        var directory = Environment.GetEnvironmentVariable("WEFT_LINK_SHOT_DIR");
        if (directory is null) return;
        Thread.Sleep(TimeSpan.FromSeconds(1)); // Allow the navigation transition to finish.
        Screenshots.CaptureWindow(window, Path.Combine(directory, name + ".png"), null);
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
