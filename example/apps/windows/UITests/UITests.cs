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
