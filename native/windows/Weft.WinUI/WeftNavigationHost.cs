using System;
using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Windows.System;

namespace Weft.WinUI;

internal enum NavigationTransition { None, Push, Pop }

/// <summary>The complete navigation state received from the logic layer.</summary>
internal sealed record NavigationState(uint Tab, uint[] Tabs, uint[] Stack, uint Modal, uint Style)
{
    internal uint Current => Modal != 0 ? Modal : Stack.Length != 0 ? Stack[^1] : Tabs[(int)Tab];

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
    private NavigationState? state;
    private Storyboard? animation;

    internal WeftNavigationHost(WeftSession session, Panel root)
    {
        this.session = session;
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
                container.Children.Add(page.View);
            }
        }
        state = next;
        foreach (var (id, page) in pages)
        {
            page.SetBack(id == next.Current && (next.Modal != 0 || next.Stack.Length != 0), next.Modal != 0);
            page.View.Visibility = id == next.Current ? Visibility.Visible : Visibility.Collapsed;
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
            container.Children.Remove(page.View);
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
            back = new Button { Content = new SymbolIcon(Symbol.Back) };
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
            back.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
            back.Content = modal ? "×" : new SymbolIcon(Symbol.Back);
        }

        internal void Detach() => mount.Points[0].Mount([]);
    }

    private sealed class PageMount : WeftScope
    {
        internal PageMount(WeftSession session, Panel body) : base(0, session, 1) =>
            new WeftRegion(body).Point(this, 0);
    }
}
