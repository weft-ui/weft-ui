using System;
using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Weft.WinUI;

/// <summary>
/// One template instance of the view protocol. The generated views subclass
/// it per template: the constructor creates the template's controls and
/// places them into <see cref="Roots"/> and the regions of container elements,
/// and <see cref="Apply"/> writes value slots to them.
/// </summary>
public abstract class WeftScope
{
    /// <summary>Scope id assigned by the JS logic layer.</summary>
    public uint Id { get; }

    public WeftSession Session { get; }

    /// <summary>The page's navigation bar content, or null for an empty default bar.</summary>
    public UIElement? NavigationBar { get; protected set; }

    /// <summary>The template's top-level nodes; they render into the region the scope is mounted in.</summary>
    protected WeftRegion Roots { get; }

    /// <summary>Mount points by index, registered by <see cref="WeftRegion.Point"/>.</summary>
    internal WeftPoint[] Points { get; }

    /// <summary>The point the scope is mounted at, if any.</summary>
    internal WeftPoint? Parent { get; set; }

    protected WeftScope(uint id, WeftSession session, int points = 0)
    {
        Id = id;
        Session = session;
        Roots = new WeftRegion(this);
        Points = new WeftPoint[points];
    }

    private List<WeftPaintedElement>? painted;
    private List<WeftSpan>? paintedSpans;

    /// <summary>Tracks an element whose colors can refer to theme tokens.</summary>
    protected void TrackColors(WeftPaintedElement element)
    {
        element.AttachTheme(Session);
        (painted ??= []).Add(element);
    }

    /// <summary>Tracks an inline run whose color can refer to a theme token.</summary>
    protected void TrackColors(WeftSpan span)
    {
        span.AttachTheme(Session);
        (paintedSpans ??= []).Add(span);
    }

    internal void ReapplyColors()
    {
        if (painted is not null)
            foreach (var element in painted) element.ReapplyColors();
        if (paintedSpans is not null)
            foreach (var span in paintedSpans) span.ReapplyColors();
    }

    /// <summary>Writes value slot <paramref name="slot"/> (a <c>set</c> op).</summary>
    public virtual void Apply(int slot, WeftValue value) { }

    /// <summary>
    /// Reports that event slot <paramref name="slot"/> fired. The handler runs
    /// and its ops are applied before this returns; false means a controlled
    /// edit was refused and the control must show its value slot again.
    /// </summary>
    protected bool Dispatch(int slot, WeftValue? payload = null) => Session.Dispatch(Id, (uint)slot, payload);

    /// <summary>How many controls the scope renders into its parent's container.</summary>
    internal int Count => Roots.Count;

    /// <summary>Appends the controls the scope renders into its parent's container, in order.</summary>
    internal void Collect(List<UIElement> controls) => Roots.Collect(controls);
}

/// <summary>Scope 0: holds the root component instance at mount point 0.</summary>
internal sealed class WeftRootScope : WeftScope
{
    // WinUI content already has zero safe-area insets, so this does not affect layout.
    internal bool SafeArea { get; }

    public WeftRootScope(WeftSession session, Panel panel, bool safeArea) : base(0, session, 1)
    {
        SafeArea = safeArea;
        new WeftRegion(panel).Point(this, 0);
    }
}

/// <summary>
/// An ordered run of sibling nodes: the children of a container element, or
/// the top-level nodes of a scope. Mount points are placeholders replaced by
/// the controls of their child scopes, so a scope with top-level points has
/// no fixed number of controls; it renders into the container of the region
/// it is mounted in, at the position its point has there.
/// </summary>
public sealed class WeftRegion
{
    /// <summary><see cref="UIElement"/> or <see cref="WeftPoint"/>, in order.</summary>
    private readonly List<object> parts = [];
    private readonly Panel? panel;
    private readonly WeftScope? scope;

    /// <summary>The children of a container.</summary>
    internal WeftRegion(Panel panel) => this.panel = panel;

    /// <summary>The top-level nodes of a scope.</summary>
    internal WeftRegion(WeftScope scope)
    {
        this.scope = scope;
    }

    /// <summary>Appends a static control.</summary>
    public void Add(UIElement element)
    {
        parts.Add(element);
        if (panel is not null) Insert(panel.Children.Count, element);
    }

    /// <summary>Appends mount point <paramref name="index"/> of <paramref name="owner"/>.</summary>
    public void Point(WeftScope owner, int index)
    {
        var point = new WeftPoint(this);
        owner.Points[index] = point;
        parts.Add(point);
    }

    internal int Count
    {
        get
        {
            var count = 0;
            foreach (var part in parts) count += part is WeftPoint point ? point.Count : 1;
            return count;
        }
    }

    internal void Collect(List<UIElement> controls)
    {
        foreach (var part in parts)
        {
            if (part is WeftPoint point)
            {
                foreach (var child in point.Children) child.Collect(controls);
            }
            else
            {
                controls.Add((UIElement)part);
            }
        }
    }

    /// <summary>
    /// The container region and index where the controls of <paramref name="point"/>
    /// start, or null while the scope holding it is not mounted.
    /// </summary>
    internal static (WeftRegion Container, int Index)? Locate(WeftPoint point)
    {
        var region = point.Region;
        var index = region.Offset(point);
        while (region.panel is null)
        {
            var parent = region.scope!.Parent;
            if (parent is null) return null;
            index += parent.Offset(region.scope);
            region = parent.Region;
            index += region.Offset(parent);
        }
        return (region, index);
    }

    /// <summary>Number of controls before <paramref name="point"/> in this region.</summary>
    private int Offset(WeftPoint point)
    {
        var offset = 0;
        foreach (var part in parts)
        {
            if (part == point) return offset;
            offset += part is WeftPoint other ? other.Count : 1;
        }
        throw new InvalidOperationException("the point belongs to another region");
    }

    /// <summary>The controls of the container.</summary>
    internal UIElementCollection Controls => panel!.Children;

    /// <summary>Inserts <paramref name="controls"/> into the container at <paramref name="index"/>.</summary>
    internal void Insert(int index, List<UIElement> controls)
    {
        foreach (var control in controls) Insert(index++, control);
    }

    /// <summary>Inserts <paramref name="control"/> into the container at <paramref name="index"/>.</summary>
    private void Insert(int index, UIElement control)
    {
        // The panel resolves alignment itself. Native control styles must not override its frame.
        if (control is FrameworkElement element)
        {
            element.HorizontalAlignment = HorizontalAlignment.Stretch;
            element.VerticalAlignment = VerticalAlignment.Stretch;
        }
        panel!.Children.Insert(index, control);
    }

    /// <summary>Removes <paramref name="count"/> controls of the container from <paramref name="index"/> on.</summary>
    internal void Remove(int index, int count)
    {
        var children = panel!.Children;
        for (var i = 0; i < count; i++) children.RemoveAt(index);
    }
}

/// <summary>A mount point: where the controls of its child scopes are placed.</summary>
internal sealed class WeftPoint(WeftRegion region)
{
    public WeftRegion Region { get; } = region;

    /// <summary>The mounted scopes, in order.</summary>
    public IReadOnlyList<WeftScope> Children { get; private set; } = [];

    public int Count
    {
        get
        {
            var count = 0;
            foreach (var child in Children) count += child.Count;
            return count;
        }
    }

    /// <summary>Number of controls before <paramref name="child"/> at this point.</summary>
    public int Offset(WeftScope child)
    {
        var offset = 0;
        foreach (var other in Children)
        {
            if (other == child) return offset;
            offset += other.Count;
        }
        throw new InvalidOperationException("the scope is not mounted at this point");
    }

    /// <summary>
    /// Replaces the children (<c>branch</c>, <c>rows</c> and <c>attach</c> ops).
    /// Children kept in the same relative order (the longest such run, from the
    /// kernel's <c>weft_stable_rows</c>) keep their controls in place; the rest
    /// are moved, inserted or removed, so focused controls in unmoved rows
    /// stay focused.
    /// </summary>
    public void Mount(IReadOnlyList<WeftScope> children)
    {
        var old = Children;
        Children = children;
        foreach (var child in old)
        {
            if (child.Parent == this) child.Parent = null;
        }
        foreach (var child in children) child.Parent = this;
        // Controls are only placed once the point's scope renders into a container;
        // until then mounting its scope places the whole subtree.
        if (WeftRegion.Locate(this) is not { } at) return;
        var (container, start) = at;

        // Remove the controls of children that are gone, last first so earlier offsets stay valid.
        var kept = new HashSet<WeftScope>(children);
        var offsets = new int[old.Count];
        var offset = start;
        for (var i = 0; i < old.Count; i++)
        {
            offsets[i] = offset;
            offset += old[i].Count;
        }
        var survivors = new List<WeftScope>(old.Count);
        var end = offset;
        for (var i = old.Count - 1; i >= 0; i--)
        {
            if (kept.Contains(old[i]))
            {
                survivors.Add(old[i]);
                continue;
            }
            var count = old[i].Count;
            container.Remove(offsets[i], count);
            end -= count;
        }
        survivors.Reverse();

        var stable = StableRows(survivors, children);
        var survivorIndices = new Dictionary<WeftScope, int>(survivors.Count);
        for (var i = 0; i < survivors.Count; i++) survivorIndices[survivors[i]] = i;

        var keepInPlace = new bool[survivors.Count];
        for (var i = 0; i < children.Count; i++)
        {
            if (stable[i]) keepInPlace[survivorIndices[children[i]]] = true;
        }

        // Remove non-stable survivors right-to-left using their known offsets in O(N).
        var survivorOffsets = new int[survivors.Count];
        var pos = start;
        for (var i = 0; i < survivors.Count; i++)
        {
            survivorOffsets[i] = pos;
            pos += survivors[i].Count;
        }
        for (var i = survivors.Count - 1; i >= 0; i--)
        {
            if (keepInPlace[i]) continue;
            var count = survivors[i].Count;
            container.Remove(survivorOffsets[i], count);
            end -= count;
        }

        var stableOffsets = new Dictionary<WeftScope, int>(survivors.Count);
        pos = start;
        for (var i = 0; i < survivors.Count; i++)
        {
            if (!keepInPlace[i]) continue;
            stableOffsets[survivors[i]] = pos;
            pos += survivors[i].Count;
        }

        var controls = new List<UIElement>();
        // Place the children last to first in front of `anchor`, the index where the next child's controls start.
        var anchor = end;
        for (var i = children.Count - 1; i >= 0; i--)
        {
            var child = children[i];
            if (stable[i])
            {
                anchor = stableOffsets[child];
                continue;
            }
            controls.Clear();
            child.Collect(controls);
            container.Insert(anchor, controls);
        }
    }

    /// <summary>For each child of <paramref name="next"/>, whether its controls keep their place.</summary>
    private static unsafe bool[] StableRows(List<WeftScope> previous, IReadOnlyList<WeftScope> next)
    {
        var result = new bool[next.Count];
        if (previous.Count == 0 || next.Count == 0) return result;
        Span<uint> oldRows = previous.Count <= 256 ? stackalloc uint[previous.Count] : new uint[previous.Count];
        Span<uint> newRows = next.Count <= 256 ? stackalloc uint[next.Count] : new uint[next.Count];
        Span<byte> stable = next.Count <= 1024 ? stackalloc byte[next.Count] : new byte[next.Count];
        for (var i = 0; i < previous.Count; i++) oldRows[i] = previous[i].Id;
        for (var i = 0; i < next.Count; i++) newRows[i] = next[i].Id;
        fixed (uint* o = oldRows, n = newRows)
        fixed (byte* s = stable)
        {
            Native.StableRows(o, (nuint)oldRows.Length, n, (nuint)newRows.Length, s);
        }
        for (var i = 0; i < next.Count; i++) result[i] = stable[i] != 0;
        return result;
    }
}
