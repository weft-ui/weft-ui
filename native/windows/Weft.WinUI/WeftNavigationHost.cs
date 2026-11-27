using System;
using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.System;

namespace Weft.WinUI;

/// <summary>Display metadata for one application tab.</summary>
public sealed record WeftTab(string Title, string Icon, string ActiveIcon);

internal enum NavigationTransition { None, Push, Pop }

/// <summary>The complete navigation state received from the logic layer.</summary>
internal sealed record NavigationState(uint Tab, uint[] Tabs, uint[] Stack, uint Modal, uint Style)
{
    internal uint Underlying => Stack.Length != 0 ? Stack[^1] : Tabs[(int)Tab];
    internal uint Current => Modal != 0 ? Modal : Underlying;

    internal HashSet<uint> Pages()
    {
        var pages = new HashSet<uint>();
        foreach (var id in Tabs) if (id != 0) pages.Add(id);
        foreach (var id in Stack) if (id != 0) pages.Add(id);
        if (Modal != 0) pages.Add(Modal);
        return pages;
    }

    internal NavigationState? Back()
    {
        if (Modal != 0) return this with { Modal = 0, Style = 0 };
        if (Stack.Length == 0) return null;
        return this with { Stack = Stack[..^1] };
    }

    internal NavigationState SelectTab(uint tab) => this with { Tab = tab, Stack = [], Modal = 0, Style = 0 };

    internal string SignalJson() => $"{{\"tab\":{Tab},\"stack\":[{string.Join(",", Stack)}],\"modal\":{Modal}}}";

    internal static NavigationTransition Diff(NavigationState? old, NavigationState next)
    {
        if (old is null || old.Tab != next.Tab || old.Modal != 0 || next.Modal != 0 ||
            !old.Tabs.AsSpan().SequenceEqual(next.Tabs)) return NavigationTransition.None;
        if (next.Stack.Length == old.Stack.Length + 1 &&
            old.Stack.AsSpan().SequenceEqual(next.Stack.AsSpan(0, old.Stack.Length))) return NavigationTransition.Push;
        if (next.Stack.Length < old.Stack.Length &&
            next.Stack.AsSpan().SequenceEqual(old.Stack.AsSpan(0, next.Stack.Length))) return NavigationTransition.Pop;
        return NavigationTransition.None;
    }
}

/// <summary>A stack of retained page views; navigation state remains owned by JS.</summary>
internal sealed class WeftNavigationHost
{
    private readonly WeftSession session;
    private readonly Grid container = new();
    private readonly Dictionary<uint, PageView> pages = [];
    private readonly WeftTab[]? tabs;
    private readonly NavigationView? tabView;
    private readonly Grid tabPages = new();
    private readonly Grid overlay = new() { Visibility = Visibility.Collapsed };
    private readonly Border scrim = new() { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(128, 0, 0, 0)) };
    private readonly Border card = new();
    private bool selecting;
    private NavigationState? state;
    private Storyboard? animation;

    internal WeftNavigationHost(WeftSession session, Panel root, WeftTab[]? tabs)
    {
        this.session = session;
        this.tabs = tabs;
        if (tabs is not null)
        {
            tabView = new NavigationView
            {
                PaneDisplayMode = NavigationViewPaneDisplayMode.Top,
                IsSettingsVisible = false,
                IsBackButtonVisible = NavigationViewBackButtonVisible.Collapsed,
                IsPaneToggleButtonVisible = false,
                Content = tabPages,
            };
            foreach (var tab in tabs) tabView.MenuItems.Add(new NavigationViewItem { Content = tab.Title });
            tabView.SelectionChanged += OnSelectionChanged;
            tabView.Loaded += (_, _) => UpdateIcons();
            container.Children.Add(tabView);
        }
        scrim.PointerPressed += (_, args) =>
        {
            if (state is { Modal: not 0, Style: 0 }) { Back(); args.Handled = true; }
        };
        card.Style = (Style)Microsoft.UI.Xaml.Markup.XamlReader.Load("""
            <Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" TargetType="Border">
                <Setter Property="Background" Value="{ThemeResource ApplicationPageBackgroundThemeBrush}" />
            </Style>
            """);
        overlay.Children.Add(scrim);
        overlay.Children.Add(card);
        Canvas.SetZIndex(overlay, 2);
        container.Children.Add(overlay);
        container.SetValue(WeftLayout.GrowProperty, 1.0);
        container.SetValue(WeftLayout.FillProperty, true);
        root.Children.Add(container);
        root.AddHandler(UIElement.KeyDownEvent, new KeyEventHandler(OnKeyDown), true);
        root.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler(OnPointerPressed), true);
    }

    internal void Apply(NavigationState next)
    {
        if (next.Tab >= next.Tabs.Length || next.Tabs[(int)next.Tab] == 0)
            throw new OpException("navigation has no current tab page");
        var retained = next.Pages();
        foreach (var id in retained) _ = session.Page(id);
        var transition = NavigationState.Diff(state, next);
        var previous = state?.Current ?? 0;
        StopAnimation();
        foreach (var id in retained)
        {
            if (!pages.ContainsKey(id))
            {
                var page = new PageView(session, session.Page(id), Back);
                pages.Add(id, page);
                if (id == next.Modal) card.Child = page.View;
                else if (tabView is not null && Array.IndexOf(next.Tabs, id) >= 0) tabPages.Children.Add(page.View);
                else container.Children.Add(page.View);
            }
        }
        state = next;
        var sheet = next.Style == 0;
        overlay.Visibility = next.Modal == 0 ? Visibility.Collapsed : Visibility.Visible;
        scrim.Visibility = sheet ? Visibility.Visible : Visibility.Collapsed;
        card.HorizontalAlignment = HorizontalAlignment.Stretch;
        card.VerticalAlignment = VerticalAlignment.Stretch;
        card.MaxWidth = sheet ? 600 : double.PositiveInfinity;
        card.MaxHeight = sheet ? 700 : double.PositiveInfinity;
        card.Margin = sheet ? new Thickness(24) : new Thickness(0);
        card.CornerRadius = sheet ? new CornerRadius(12) : new CornerRadius(0);
        if (tabView is not null)
        {
            selecting = true;
            tabView.SelectedItem = tabView.MenuItems[(int)next.Tab];
            selecting = false;
            tabView.Visibility = next.Stack.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
            UpdateIcons();
            transition = NavigationTransition.None;
        }
        foreach (var (id, page) in pages)
        {
            page.SetBack(id == next.Current && (next.Modal != 0 || next.Stack.Length != 0), id == next.Modal);
            page.View.Visibility = id == next.Current || id == next.Underlying ? Visibility.Visible : Visibility.Collapsed;
        }
        if (transition != NavigationTransition.None && previous != 0 && previous != next.Current && pages.TryGetValue(previous, out var outgoing))
        {
            var incoming = pages[next.Current];
            outgoing.View.Visibility = Visibility.Visible;
            // The incoming page must be above the outgoing page on push, and below it on pop.
            Canvas.SetZIndex(incoming.View, transition == NavigationTransition.Push ? 1 : 0);
            Canvas.SetZIndex(outgoing.View, transition == NavigationTransition.Push ? 0 : 1);
            var width = container.ActualWidth > 0 ? container.ActualWidth : 300;
            animation = new Storyboard();
            AddSlide(animation, incoming.Transform, transition == NavigationTransition.Push ? width : -width, 0);
            AddSlide(animation, outgoing.Transform, 0, transition == NavigationTransition.Push ? -width : width);
            var running = animation;
            running.Completed += (_, _) =>
            {
                if (animation != running) return;
                StopAnimation();
                Prune();
            };
            running.Begin();
        }
        else Prune();
    }

    internal void SetBadge(int index, string? text)
    {
        if (tabView is null || index < 0 || index >= tabView.MenuItems.Count) return;
        var item = (NavigationViewItem)tabView.MenuItems[index];
        item.InfoBadge = text is null ? null : text.Length == 0 ? new InfoBadge()
            : int.TryParse(text, out var number) && number >= 0 ? new InfoBadge { Value = number }
            : new InfoBadge { IconSource = new FontIconSource { Glyph = text } };
    }

    private void UpdateIcons()
    {
        if (tabView is null || tabs is null) return;
        for (var i = 0; i < tabs.Length; i++)
        {
            var item = (NavigationViewItem)tabView.MenuItems[i];
            var name = state?.Tab == (uint)i ? tabs[i].ActiveIcon : tabs[i].Icon;
            var asset = name.StartsWith("asset:", StringComparison.Ordinal)
                ? WeftAssets.Current?.FindImage(name[6..], tabView.XamlRoot?.RasterizationScale ?? 1) : null;
            if (asset is null) { item.Icon = null; continue; }
            var uri = new Uri(WeftAssets.UriPrefix + asset.File);
            item.Icon = new ImageIcon { Source = asset.IsSvg ? new SvgImageSource(uri) : new BitmapImage(uri) };
        }
    }

    private void OnSelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (selecting || state is null || args.SelectedItem is null) return;
        var index = sender.MenuItems.IndexOf(args.SelectedItem);
        if (index < 0 || index == state.Tab) return;
        var next = state.SelectTab((uint)index);
        if (next.Tabs[index] != 0) Apply(next);
        session.Signal("navigation", next.SignalJson());
    }

    private static void AddSlide(Storyboard storyboard, TranslateTransform transform, double from, double to)
    {
        var slide = new DoubleAnimation { From = from, To = to, Duration = new Duration(TimeSpan.FromMilliseconds(250)) };
        Storyboard.SetTarget(slide, transform);
        Storyboard.SetTargetProperty(slide, "X");
        storyboard.Children.Add(slide);
    }

    private void StopAnimation()
    {
        if (animation is null) return;
        animation.Stop();
        animation = null;
        foreach (var (id, page) in pages)
        {
            page.Transform.X = 0;
            page.View.Visibility = id == state?.Current ? Visibility.Visible : Visibility.Collapsed;
        }
    }

    private void Prune()
    {
        if (state is null) return;
        var retained = state.Pages();
        var removed = new List<uint>();
        foreach (var id in pages.Keys) if (!retained.Contains(id)) removed.Add(id);
        foreach (var id in removed)
        {
            var page = pages[id];
            if (card.Child == page.View) card.Child = null;
            else if (!tabPages.Children.Remove(page.View)) container.Children.Remove(page.View);
            page.Detach();
            pages.Remove(id);
            session.DestroyPage(id);
        }
    }

    private void Back()
    {
        var next = state?.Back();
        if (next is null) return;
        Apply(next);
        session.Signal("navigation", next.SignalJson());
    }

    private void OnKeyDown(object sender, KeyRoutedEventArgs args)
    {
        if ((args.Key == VirtualKey.Left && args.KeyStatus.IsMenuKeyDown) ||
            (args.Key == VirtualKey.Escape && state?.Modal != 0))
        {
            if (state?.Back() is null) return;
            Back();
            args.Handled = true;
        }
    }

    private void OnPointerPressed(object sender, PointerRoutedEventArgs args)
    {
        if (!args.GetCurrentPoint(container).Properties.IsXButton1Pressed || state?.Back() is null) return;
        Back();
        args.Handled = true;
    }

    private sealed class PageView
    {
        internal readonly Grid View = new();
        internal readonly TranslateTransform Transform = new();
        private readonly Button back;
        private readonly Grid header;
        private readonly WeftScope mount;

        internal PageView(WeftSession session, WeftScope page, Action onBack)
        {
            View.RenderTransform = Transform;
            View.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            View.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            header = new Grid { MinHeight = 48 };
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            back = new Button { Content = new SymbolIcon(Symbol.Back), Visibility = Visibility.Collapsed };
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(back, "Back");
            back.Click += (_, _) => onBack();
            header.Children.Add(back);
            if (page.NavigationBar is FrameworkElement bar)
            {
                Grid.SetColumn(bar, 1);
                header.Children.Add(bar);
                if (bar.Visibility == Visibility.Collapsed) header.Visibility = Visibility.Collapsed;
            }
            View.Children.Add(header);
            var body = new WeftLinearPanel(WeftAxis.Vertical, fillAvailable: true);
            Grid.SetRow(body, 1);
            View.Children.Add(body);
            mount = new PageMount(session, body);
            mount.Points[0].Mount(new WeftScope[] { page });
        }

        internal void SetBack(bool visible, bool modal)
        {
            var appearing = visible && back.Visibility != Visibility.Visible;
            back.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
            header.Padding = new Thickness(visible ? 0 : 20, 0, 20, 0);
            // NavigationView leaves breathing room between its back button and header.
            header.ColumnSpacing = visible ? 12 : 0;
            back.Content = modal ? "×" : new SymbolIcon(Symbol.Back);
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(back, modal ? "Close" : "Back");
            if (appearing)
            {
                // WinUI can transfer focus to the new back button as a page appears.
                // Treat that automatic transfer as programmatic, not keyboard navigation.
                back.DispatcherQueue.TryEnqueue(() =>
                {
                    if (back.FocusState != FocusState.Unfocused) back.Focus(FocusState.Programmatic);
                });
            }
        }

        internal void Detach() => mount.Points[0].Mount([]);
    }

    private sealed class PageMount : WeftScope
    {
        internal PageMount(WeftSession session, Panel body) : base(0, session, 1) =>
            new WeftRegion(body).Point(this, 0);
    }
}
