using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;

namespace Weft.WinUI;

/// <summary>Page title and actions displayed by the navigation host.</summary>
public sealed class WeftNavigationBar
{
    private readonly Grid grid = new();
    private readonly TextBlock title = new() { VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
    private readonly StackPanel actions = new() { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };

    public WeftNavigationBar()
    {
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.Children.Add(title);
        Grid.SetColumn(actions, 1);
        grid.Children.Add(actions);
    }

    public UIElement Element => grid;
    public string Title { set => title.Text = value; }
    public bool Hidden { set => grid.Visibility = value ? Visibility.Collapsed : Visibility.Visible; }
    public void Add(WeftBarButton button) => actions.Children.Add(button.Element);
}

/// <summary>An accessible action in a page's navigation bar.</summary>
public sealed class WeftBarButton
{
    private readonly Button button = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel content = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly ImageIcon image = new() { Visibility = Visibility.Collapsed };
    private readonly TextBlock text = new() { VerticalAlignment = VerticalAlignment.Center };
    private string icon = "";
    private XamlRoot? root;

    public WeftBarButton(Action? tap)
    {
        content.Children.Add(image);
        content.Children.Add(text);
        button.Content = content;
        if (tap is not null) button.Click += (_, _) => tap();
        button.Loaded += (_, _) => UpdateRoot(button.XamlRoot);
        button.Unloaded += (_, _) => UpdateRoot(null);
    }

    public UIElement Element => button;
    public string Label
    {
        set
        {
            text.Text = value;
            text.Visibility = value.Length == 0 ? Visibility.Collapsed : Visibility.Visible;
            AutomationProperties.SetName(button, value);
        }
    }
    public bool Disabled { set => button.IsEnabled = !value; }
    public string Icon { set { icon = value; UpdateIcon(); } }

    private void UpdateRoot(XamlRoot? next)
    {
        if (root == next) return;
        if (root is not null) root.Changed -= RootChanged;
        root = next;
        if (root is not null) root.Changed += RootChanged;
        UpdateIcon();
    }

    private void RootChanged(XamlRoot sender, XamlRootChangedEventArgs args) => UpdateIcon();

    private void UpdateIcon()
    {
        var asset = icon.StartsWith("asset:", StringComparison.Ordinal)
            ? WeftAssets.Current?.FindImage(icon[6..], root?.RasterizationScale ?? 1)
            : null;
        image.Visibility = asset is null ? Visibility.Collapsed : Visibility.Visible;
        if (asset is null)
        {
            image.Source = null;
            return;
        }
        var uri = new Uri(WeftAssets.UriPrefix + asset.File);
        image.Source = asset.IsSvg ? new SvgImageSource(uri) : new BitmapImage(uri);
    }
}
