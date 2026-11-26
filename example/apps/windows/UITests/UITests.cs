using System.Reflection;
using FlaUI.Core;
using FlaUI.UIA3;

namespace UITests;

/// <summary>UI tests of the app; run with `dotnet test UITests` after building the app.</summary>
[TestClass]
public sealed class UITests
{
    [TestMethod]
    public void Launches()
    {
        using var automation = new UIA3Automation();
        using var app = Application.Launch(AppPath());
        try
        {
            Assert.IsNotNull(app.GetMainWindow(automation, TimeSpan.FromSeconds(10)));
        }
        finally
        {
            app.Close();
        }
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
