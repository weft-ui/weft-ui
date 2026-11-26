using System;
using System.Buffers;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Media;
using Weft.WinUI.Protocol;

namespace Weft.WinUI;

/// <summary>
/// One Weft app running in the native kernel: owns the kernel runtime and the
/// scope tree its ops build.
/// </summary>
/// <remarks>
/// The kernel runs on the UI thread: <c>commit</c> applies each batch of ops
/// to the scopes as it arrives, timers run on the thread's dispatcher queue,
/// and platform calls complete on it. The session lives as long as the app;
/// the kernel's callbacks keep it alive.
/// </remarks>
public sealed class WeftSession
{
    /// <summary>Creates the scope of template <paramref name="template"/> for a <c>create</c> op.</summary>
    public delegate WeftScope? Factory(uint template, uint id, WeftSession session);

    private readonly Factory make;
    private readonly Dictionary<uint, WeftScope> scopes = [];
    private readonly Panel root;
    private readonly UiOverlay ui;
    private WeftNavigationHost? navigation;
    private readonly WeftTab[]? tabs;
    private readonly Dictionary<int, string?> badges = [];
    private ElementTheme appliedTheme;
    private WindowEnvironment environment;
    private readonly ArrayBufferWriter<byte> environmentJson = new(192);
    private XamlRoot? xamlRoot;
    private bool environmentQueued;
    private readonly DispatcherQueue queue;
    private readonly DispatcherQueueTimer timer;
    /// <summary>When the timer fires, in <see cref="Environment.TickCount64"/> milliseconds.</summary>
    private long due;
    /// <summary>Whether a batch of ops is being applied; the kernel is not reentrant.</summary>
    private bool committing;
    /// <summary>The ops of the batch being applied, reused across commits.</summary>
    private readonly List<Op> batch = [];
    private bool failed;
    /// <summary>The last error the kernel logged: why <c>weft_runtime_new</c> failed.</summary>
    private string? lastError;
    private readonly nint runtime;
    /// <summary>The bytecode, 16-byte aligned, alive as long as the runtime.</summary>
    private unsafe byte* bytecode;
    private GCHandle selfHandle;

    internal WeftTheme? Theme { get; }
    internal ElementTheme ActualTheme => root.ActualTheme;

    /// <summary>
    /// Starts the app compiled to <c>weft/bundle.hbc</c> next to the executable,
    /// whose views implement the layout with hash <paramref name="layoutHash"/>,
    /// and returns its root layout, showing the startup error if the app failed.
    /// </summary>
    public static UIElement Start(ulong layoutHash, bool safeArea, Factory make, WeftTheme? theme = null, WeftTab[]? tabs = null)
    {
        // A ThemeResource stays live when the appearance changes, unlike a resource dictionary lookup.
        var root = new WeftLinearPanel(WeftAxis.Vertical, fillAvailable: true)
        {
            Style = (Style)XamlReader.Load("""
                <Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" TargetType="Panel">
                    <Setter Property="Background" Value="{ThemeResource ApplicationPageBackgroundThemeBrush}" />
                </Style>
                """),
        };
        var overlayRoot = new Grid();
        overlayRoot.Children.Add(root);
        _ = new WeftSession(Path.Combine(AppContext.BaseDirectory, "weft", "bundle.hbc"), layoutHash, safeArea, make, root, overlayRoot, theme, tabs);
        return overlayRoot;
    }

    private unsafe WeftSession(string bundle, ulong layoutHash, bool safeArea, Factory make, Panel root, Grid overlayRoot, WeftTheme? theme, WeftTab[]? tabs)
    {
        this.tabs = tabs;
        this.make = make;
        this.root = root;
        ui = new UiOverlay(overlayRoot);
        Theme = theme;
        appliedTheme = ActualTheme;
        queue = DispatcherQueue.GetForCurrentThread()
            ?? throw new InvalidOperationException("weft: the session must start on a UI thread");
        timer = queue.CreateTimer();
        timer.IsRepeating = false;
        timer.Tick += (_, _) =>
        {
            timer.Stop();
            if (runtime != 0) Native.RuntimeTick(runtime);
        };
        scopes[0] = new WeftRootScope(this, root, safeArea);

        byte[] data;
        try
        {
            data = File.ReadAllBytes(bundle);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            Fail($"weft: cannot read the bundle {bundle}: {error.Message}");
            return;
        }
        // The kernel needs 4-byte aligned bytecode that outlives the runtime.
        bytecode = (byte*)NativeMemory.AlignedAlloc((nuint)Math.Max(data.Length, 1), 16);
        data.CopyTo(new Span<byte>(bytecode, data.Length));

        try
        {
            var version = Encoding.UTF8.GetBytes(Environment.OSVersion.Version + "\0");
            environment = WindowEnvironment.Initial();
            environment.WriteJson(environmentJson);
            environmentJson.GetSpan(1)[0] = 0;
            environmentJson.Advance(1);
            // The runtime calls back for as long as the app runs; freed below only if startup fails.
            selfHandle = GCHandle.Alloc(this);
            fixed (byte* versionBytes = version, jsonBytes = environmentJson.WrittenSpan)
            {
                var host = new Native.Host
                {
                    Protocol = WeftProtocol.Version,
                    Ctx = GCHandle.ToIntPtr(selfHandle),
                    Commit = &OnCommit,
                    Schedule = &OnSchedule,
                    Supports = &OnSupports,
                    Call = &OnCall,
                    Log = &OnLog,
                    Version = versionBytes,
                    Environment = jsonBytes,
                    Launch = null,
                };
                runtime = Native.RuntimeNew(&host, bytecode, (nuint)data.Length, layoutHash);
            }
            if (runtime == 0)
            {
                ReleaseStartupResources();
                Fail(lastError ?? "weft: the app failed to start");
                return;
            }
        }
        catch
        {
            if (runtime == 0) ReleaseStartupResources();
            throw;
        }

        root.Loaded += (_, _) =>
        {
            if (xamlRoot is not null) xamlRoot.Changed -= OnXamlRootChanged;
            xamlRoot = root.XamlRoot;
            if (xamlRoot is not null) xamlRoot.Changed += OnXamlRootChanged;
            QueueEnvironment();
        };
        root.Unloaded += (_, _) =>
        {
            if (xamlRoot is not null) xamlRoot.Changed -= OnXamlRootChanged;
            xamlRoot = null;
        };
        root.SizeChanged += (_, _) => QueueEnvironment();
        root.ActualThemeChanged += (_, _) => QueueEnvironment();
    }

    private void OnXamlRootChanged(XamlRoot sender, XamlRootChangedEventArgs args) => QueueEnvironment();

    private void QueueEnvironment()
    {
        // Do not enter the kernel from a XAML change that occurred during a commit.
        if (!environmentQueued) environmentQueued = queue.TryEnqueue(UpdateEnvironment);
    }

    private unsafe void UpdateEnvironment()
    {
        environmentQueued = false;
        if (xamlRoot is null) return;
        var appearance = ActualTheme;
        if (appliedTheme != appearance)
        {
            appliedTheme = appearance;
            foreach (var scope in scopes.Values) scope.ReapplyColors();
        }
        var size = xamlRoot.Size;
        var updated = new WindowEnvironment(appearance == ElementTheme.Dark,
            size.Width, size.Height, xamlRoot.RasterizationScale);
        if (environment == updated) return;
        environment = updated;
        updated.WriteJson(environmentJson);
        fixed (byte* json = environmentJson.WrittenSpan)
        {
            Native.RuntimeEnvironment(runtime, json, (nuint)environmentJson.WrittenCount);
        }
    }

    /// <summary>Reports event slot <paramref name="slot"/> of <paramref name="scope"/>; see <see cref="WeftScope.Dispatch"/>.</summary>
    internal unsafe bool Dispatch(uint scope, uint slot, WeftValue? payload)
    {
        if (committing)
        {
            Debug.Fail("weft: an event was dispatched while ops were applied");
            return true;
        }
        if (runtime == 0) return true;
        var bytes = new List<byte>();
        payload?.Encode(bytes);
        fixed (byte* data = CollectionsMarshal.AsSpan(bytes))
        {
            return Native.RuntimeDispatch(runtime, scope, slot, data, (nuint)bytes.Count) != 0;
        }
    }

    internal void Window(uint scope, uint point, uint start, uint end)
    {
        if (committing)
        {
            Debug.Fail("weft: a window was requested while ops were applied");
            return;
        }
        if (runtime != 0) Native.RuntimeWindow(runtime, scope, point, start, end);
    }

    internal unsafe void Signal(string name, string json)
    {
        if (committing)
        {
            Debug.Fail("weft: a signal was sent while ops were applied");
            return;
        }
        if (runtime == 0) return;
        byte[] nameBytes = Encoding.UTF8.GetBytes(name + "\0");
        byte[] jsonBytes = Encoding.UTF8.GetBytes(json + "\0");
        fixed (byte* namePtr = nameBytes, jsonPtr = jsonBytes)
        {
            Native.RuntimeSignal(runtime, namePtr, jsonPtr, (nuint)(jsonBytes.Length - 1));
        }
    }

    private void Commit(ReadOnlySpan<byte> bytes)
    {
        if (failed) return;
        committing = true;
        try
        {
            OpReader.ReadAll(bytes, batch);
            foreach (ref readonly var op in CollectionsMarshal.AsSpan(batch))
                if (op.Code is OpCode.Splice or OpCode.Bind)
                    throw new OpException("lazy lists are not supported by these views");
            foreach (ref readonly var op in CollectionsMarshal.AsSpan(batch)) Apply(op);
        }
        catch (Exception error)
        {
            Fail($"weft: cannot apply ops ({error.Message})");
        }
        finally
        {
            batch.Clear();
            committing = false;
        }
    }

    private void Apply(in Op op)
    {
        switch (op.Code)
        {
            case OpCode.Create:
                scopes[op.Scope] = make(op.Arg, op.Scope, this)
                    ?? throw new OpException($"the views have no template {op.Arg}");
                break;
            case OpCode.Set:
                if (scopes.TryGetValue(op.Scope, out var scope)) scope.Apply((int)op.Arg, op.Value);
                break;
            case OpCode.Branch:
                Mount(op.Scope, op.Arg, op.Child == 0 ? [] : [op.Child]);
                break;
            case OpCode.Attach:
                Mount(op.Scope, op.Arg, [op.Child]);
                break;
            case OpCode.Rows:
                Mount(op.Scope, op.Arg, op.Rows!);
                break;
            case OpCode.Nav:
                if (navigation is null)
                {
                    navigation = new WeftNavigationHost(this, root, tabs);
                    foreach (var (index, text) in badges) navigation.SetBadge(index, text);
                }
                navigation.Apply(new NavigationState(op.Scope, op.Tabs!, op.Stack!, op.Modal, op.Style));
                break;
        }
    }

    /// <summary>
    /// Mounts the scopes <paramref name="ids"/> at <paramref name="index"/> of
    /// <paramref name="parent"/>; children no longer mounted there are
    /// destroyed with their descendants.
    /// </summary>
    private void Mount(uint parent, uint index, uint[] ids)
    {
        if (!scopes.TryGetValue(parent, out var scope)) return;
        if (index >= scope.Points.Length) throw new OpException($"scope {parent} has no mount point {index}");
        var point = scope.Points[(int)index];
        var kept = new HashSet<uint>(ids);
        foreach (var old in point.Children)
        {
            if (!kept.Contains(old.Id)) Destroy(old);
        }
        var children = new List<WeftScope>(ids.Length);
        foreach (var id in ids)
        {
            if (scopes.TryGetValue(id, out var child)) children.Add(child);
        }
        point.Mount(children);
    }

    internal WeftScope Page(uint id) => scopes.TryGetValue(id, out var scope)
        ? scope : throw new OpException($"navigation references missing scope {id}");

    internal void DestroyPage(uint id)
    {
        if (scopes.TryGetValue(id, out var scope)) Destroy(scope);
    }

    private void Destroy(WeftScope scope)
    {
        scopes.Remove(scope.Id);
        foreach (var point in scope.Points)
        {
            foreach (var child in point.Children) Destroy(child);
        }
    }

    private void Schedule(ulong delay)
    {
        var ms = (long)Math.Min(delay, int.MaxValue);
        var at = Environment.TickCount64 + ms;
        if (timer.IsRunning && at >= due) return;
        due = at;
        timer.Stop();
        timer.Interval = TimeSpan.FromMilliseconds(ms);
        timer.Start();
    }

    private void Call(uint id, string module, string method, byte[] args)
    {
        // Runs after the kernel's callback returns: the kernel is not reentrant.
        queue.TryEnqueue(async () =>
        {
            bool ok;
            byte[] result;
            try
            {
                if (module == "navigation" && method == "badge")
                {
                    using var json = JsonDocument.Parse(args);
                    var index = json.RootElement.GetProperty("tab").GetInt32();
                    var text = json.RootElement.GetProperty("text").GetString();
                    badges[index] = text;
                    navigation?.SetBadge(index, text);
                    result = [];
                }
                else result = await (module == WeftProtocol.UiModule
                    ? ui.Call(method, args) : PlatformModules.Call(module, method, args));
                ok = true;
            }
            catch (Exception error)
            {
                result = Encoding.UTF8.GetBytes(error.Message);
                ok = false;
            }
            Resolve(id, ok, result);
        });
    }

    private unsafe void Resolve(uint id, bool ok, byte[] result)
    {
        if (runtime == 0) return;
        fixed (byte* data = result)
        {
            Native.RuntimeResolve(runtime, id, ok ? (byte)1 : (byte)0, data, (nuint)result.Length);
        }
    }

    /// <summary>Shows <paramref name="message"/> instead of the app's views.</summary>
    private void Fail(string message)
    {
        WeftLog.Write(Native.LogError, message);
        failed = true;
        root.Children.Clear();
        root.Children.Add(new TextBlock
        {
            Text = message,
            Foreground = new SolidColorBrush(Colors.Red),
            Margin = new Thickness(16),
            TextWrapping = TextWrapping.Wrap,
        });
    }

    // Kernel callbacks; every one arrives on the UI thread. Exceptions must not
    // unwind into the kernel.

    private unsafe void ReleaseStartupResources()
    {
        if (selfHandle.IsAllocated) selfHandle.Free();
        if (bytecode != null)
        {
            NativeMemory.AlignedFree(bytecode);
            bytecode = null;
        }
    }

    private static WeftSession From(nint ctx) => (WeftSession)GCHandle.FromIntPtr(ctx).Target!;

    private static unsafe string Utf8(byte* text) => Marshal.PtrToStringUTF8((nint)text) ?? "";

    [UnmanagedCallersOnly]
    private static unsafe void OnCommit(nint ctx, byte* ops, nuint len)
    {
        try
        {
            var session = From(ctx);
            session.Commit(new ReadOnlySpan<byte>(ops, checked((int)len)));
        }
        catch (Exception error)
        {
            WeftLog.Write(Native.LogError, $"weft: commit callback failed ({error.Message})");
        }
    }

    [UnmanagedCallersOnly]
    private static void OnSchedule(nint ctx, ulong delay)
    {
        try
        {
            From(ctx).Schedule(delay);
        }
        catch (Exception error)
        {
            WeftLog.Write(Native.LogError, $"weft: cannot schedule a tick ({error.Message})");
        }
    }

    [UnmanagedCallersOnly]
    private static unsafe byte OnSupports(nint ctx, byte* module)
    {
        try
        {
            return module != null && (Utf8(module) == "navigation" || PlatformModules.Supported.Contains(Utf8(module))) ? (byte)1 : (byte)0;
        }
        catch
        {
            return 0;
        }
    }

    [UnmanagedCallersOnly]
    private static unsafe void OnCall(nint ctx, uint id, byte* module, byte* method, byte* args, nuint len)
    {
        try
        {
            var bytes = new ReadOnlySpan<byte>(args, checked((int)len)).ToArray();
            From(ctx).Call(id, Utf8(module), Utf8(method), bytes);
        }
        catch (Exception error)
        {
            WeftLog.Write(Native.LogError, $"weft: platform call dispatch failed ({error.Message})");
        }
    }

    [UnmanagedCallersOnly]
    private static unsafe void OnLog(nint ctx, int level, byte* message, nuint len)
    {
        try
        {
            var text = Encoding.UTF8.GetString(message, checked((int)len));
            WeftLog.Write(level, text);
            if (level >= Native.LogError) From(ctx).lastError = text;
        }
        catch (Exception error)
        {
            WeftLog.Write(Native.LogError, $"weft: log callback failed ({error.Message})");
        }
    }
}

/// <summary>Console messages and diagnostics, written with <c>OutputDebugString</c>.</summary>
internal static class WeftLog
{
    private static readonly string[] Levels = ["debug", "info", "warn", "error"];

    public static void Write(int level, string message) =>
        Native.OutputDebugString($"[weft {Levels[Math.Clamp(level, 0, Levels.Length - 1)]}] {message}\n");
}
