using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Shapes;

namespace Weft.WinUI;

/// <summary><c>Spinner</c>: an active <see cref="ProgressRing"/>.</summary>
public sealed class WeftSpinner : WeftPaintedElement
{
    private readonly ProgressRing ring = new() { IsActive = true, Width = 20, Height = 20 };
    private WeftBrush foreground;

    protected override FrameworkElement Control => ring;
    public WeftColor Color { set => ring.Foreground = foreground.Set(value, Theme, Appearance); }
    internal override void ReapplyColors() => foreground.Reapply(Theme, Appearance);
}

/// <summary><c>Progress</c>: a <see cref="ProgressBar"/> with a 0–1 range.</summary>
public sealed class WeftProgress : WeftPaintedElement
{
    private readonly ProgressBar bar = new() { Maximum = 1, Height = 4 };
    private WeftBrush foreground;

    public WeftProgress()
    {
        Fill = true;
        Color = WeftColor.Rgba(0x007affff);
    }

    protected override FrameworkElement Control => bar;
    public double Value { set => bar.Value = SanitizeProgress(value); }
    public WeftColor Color { set => bar.Foreground = foreground.Set(value, Theme, Appearance); }
    internal override void ReapplyColors() => foreground.Reapply(Theme, Appearance);

    internal static double SanitizeProgress(double value) =>
        double.IsFinite(value) ? Math.Clamp(value, 0, 1) : 0;
}

/// <summary><c>Divider</c>: a one-DIP <see cref="Rectangle"/> with a theme-aware stroke.</summary>
public sealed class WeftDivider : WeftPaintedElement
{
    [ThreadStatic]
    private static Style? defaultStyle;
    private readonly Rectangle line = new();
    private WeftBrush fill;

    public WeftDivider(bool vertical = false)
    {
        // A XAML theme reference follows light/dark changes; a brush lookup is a snapshot.
        line.Style = defaultStyle ??= (Style)XamlReader.Load("""
            <Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" TargetType="Rectangle">
                <Setter Property="Fill" Value="{ThemeResource DividerStrokeColorDefaultBrush}" />
            </Style>
            """);
        if (vertical) line.Width = 1;
        else line.Height = 1;
        Fill = true;
    }

    protected override FrameworkElement Control => line;
    public WeftColor Color { set => line.Fill = fill.Set(value, Theme, Appearance); }
    internal override void ReapplyColors() => fill.Reapply(Theme, Appearance);
}
