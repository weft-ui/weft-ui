using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;

namespace Weft.WinUI;

/// <summary>A virtualized vertical list or fixed-column grid.</summary>
public sealed class WeftLazyList : WeftPaddedElement
{
    private readonly StackPanel panel = new();
    private readonly ScrollViewer scroll;
    private readonly ItemsRepeater repeater;
    private readonly ObservableCollection<LazyItems.Item> source = [];
    private readonly LazyItems items = new();
    private readonly Dictionary<uint, WeftScope> bound = [];
    private readonly Dictionary<uint, WeftPoint> realized = [];
    private readonly Dictionary<Grid, uint> elements = [];
    private readonly LazyEstimates heights = new();
    private readonly DispatcherQueue dispatcher;
    private WeftScope? owner;
    private WeftPoint? point;
    private uint pointIndex;
    private bool queued;
    private int columns;
    private double gap;

    public WeftLazyList(bool grid)
    {
        columns = grid ? 1 : 0;
        dispatcher = DispatcherQueue.GetForCurrentThread();
        repeater = new ItemsRepeater
        {
            ItemsSource = source,
            ItemTemplate = (DataTemplate)XamlReader.Load("<DataTemplate xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\"><Grid/></DataTemplate>"),
            Layout = grid ? new UniformGridLayout() : new StackLayout(),
        };
        repeater.ElementPrepared += Prepared;
        repeater.ElementClearing += Clearing;
        scroll = new ScrollViewer
        {
            Content = panel,
            HorizontalScrollMode = ScrollMode.Disabled,
            VerticalScrollMode = ScrollMode.Enabled,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Top,
            ZoomMode = ZoomMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        };
        scroll.SizeChanged += (_, _) => UpdateLayout();
        scroll.ViewChanged += (_, _) => QueueWindow();
        Box.Border.Child = scroll;
        Children = new WeftRegion(panel);
        Grow = 1;
        Fill = true;
    }

    public WeftRegion Children { get; }
    public double Gap { set { gap = Math.Max(0, value); UpdateLayout(); } }
    public int Columns { set { columns = Math.Max(1, value); UpdateLayout(); } }
    public bool Indicators { set => scroll.VerticalScrollBarVisibility = value ? ScrollBarVisibility.Auto : ScrollBarVisibility.Hidden; }

    /// <summary>Registers the lazy point at its position among static header and footer nodes.</summary>
    public void Point(WeftScope scope, int index)
    {
        owner = scope;
        pointIndex = (uint)index;
        point = new WeftPoint(Children) { Lazy = this };
        scope.Points[index] = point;
        Children.Add(repeater);
    }

    private void UpdateLayout()
    {
        panel.Spacing = gap;
        if (repeater.Layout is StackLayout stack) stack.Spacing = gap;
        if (repeater.Layout is UniformGridLayout grid)
        {
            grid.MinColumnSpacing = gap;
            grid.MinRowSpacing = gap;
            grid.MaximumRowsOrColumns = columns;
            grid.MinItemWidth = Math.Max(0, (scroll.ViewportWidth - gap * (columns - 1)) / columns);
        }
    }

    internal IReadOnlyList<uint> Splice(uint index, uint remove, SpliceItem[] inserted)
    {
        var removed = items.Splice(index, remove, inserted);
        for (var i = 0; i < remove; i++) source.RemoveAt((int)index);
        for (var i = 0; i < inserted.Length; i++) source.Insert((int)index + i, items.Items[(int)index + i]);
        foreach (var id in removed) bound.Remove(id);
        UpdateOwned();
        QueueWindow();
        return removed;
    }

    internal uint Bind(uint id, WeftScope? child)
    {
        var previous = items.Bind(id, child?.Id ?? 0);
        if (previous != 0) bound.Remove(previous);
        if (child is not null) bound[child.Id] = child;
        if (realized.TryGetValue(id, out var target))
        {
            foreach (var (element, itemId) in elements)
                if (itemId == id) element.MinHeight = child is null ? 44 : 0;
            target.Mount(child is null ? Array.Empty<WeftScope>() : new[] { child });
        }
        UpdateOwned();
        return previous;
    }

    private void UpdateOwned() => point?.SetLazyChildren(new List<WeftScope>(bound.Values));

    private void Prepared(ItemsRepeater sender, ItemsRepeaterElementPreparedEventArgs args)
    {
        var item = source[args.Index];
        var element = (Grid)args.Element;
        element.MinHeight = heights.Estimate(item.Template);
        var region = new WeftRegion(element);
        var target = region.CreatePoint();
        elements[element] = item.Id;
        realized[item.Id] = target;
        if (item.Child != 0 && bound.TryGetValue(item.Child, out var child))
        {
            element.MinHeight = 0;
            target.Mount(new[] { child });
        }
        element.SizeChanged += Measured;
        QueueWindow();
    }

    private void Measured(object sender, SizeChangedEventArgs args)
    {
        var element = (Grid)sender;
        if (!elements.TryGetValue(element, out var id) || !items.TryGet(id, out var item) ||
            item is null || item.Child == 0) return;
        heights.Record(item.Template, args.NewSize.Height);
    }

    private void Clearing(ItemsRepeater sender, ItemsRepeaterElementClearingEventArgs args)
    {
        var element = (Grid)args.Element;
        element.SizeChanged -= Measured;
        if (elements.Remove(element, out var id) && realized.Remove(id, out var target)) target.Mount([]);
        QueueWindow();
    }

    private void QueueWindow()
    {
        if (!queued) queued = dispatcher.TryEnqueue(RequestWindow);
    }

    private void RequestWindow()
    {
        queued = false;
        if (owner is null || source.Count == 0 || elements.Count == 0) return;
        var range = LazyEstimates.Range(source.Count, elements.Keys.Select(repeater.GetElementIndex));
        if (range is not { } window) return;
        var (start, end) = window;
        owner.Session.Window(owner.Id, pointIndex, start, end);
    }
}
