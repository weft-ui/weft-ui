using System;
using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;
using Windows.Graphics;

namespace Weft.WinUI;

internal sealed class LifecycleState
{
    private bool background;

    internal string? Update(bool next)
    {
        if (background == next) return null;
        background = next;
        return next ? "{\"state\":\"background\"}" : "{\"state\":\"foreground\"}";
    }
}

/// <summary>Window helpers for app templates.</summary>
public static partial class WeftWindow
{
    /// <summary>Resizes <paramref name="window"/> to a size in DIPs at the DPI of its monitor.</summary>
    public static void Resize(Window window, double width, double height)
    {
        var scale = GetDpiForWindow(WinRT.Interop.WindowNative.GetWindowHandle(window)) / 96.0;
        window.AppWindow.Resize(new SizeInt32((int)Math.Round(width * scale), (int)Math.Round(height * scale)));
    }

    [LibraryImport("user32.dll")]
    private static partial uint GetDpiForWindow(nint window);
}
