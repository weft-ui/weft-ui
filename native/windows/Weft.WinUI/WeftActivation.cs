using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text.Json;
using Microsoft.UI.Dispatching;
using Microsoft.Windows.AppLifecycle;
using Windows.ApplicationModel.Activation;

namespace Weft.WinUI;

/// <summary>Registers and forwards unpackaged protocol activations to the single running app.</summary>
public static class WeftActivation
{
    private static readonly object Gate = new();
    private static readonly List<string> Pending = [];
    private static WeftSession? session;
    private static DispatcherQueue? queue;
    internal static string? LaunchUrl { get; private set; }

    /// <summary>Call on the main thread before creating the XAML application. Returns false in a redirected instance.</summary>
    public static bool Initialize(string? scheme)
    {
        var exe = Environment.ProcessPath ?? throw new InvalidOperationException("weft: cannot determine the executable path");
        if (scheme is not null)
            ActivationRegistrationManager.RegisterForProtocolActivation(scheme, "", "", exe);
        var id = Assembly.GetEntryAssembly()?.GetCustomAttributes<AssemblyMetadataAttribute>();
        string? key = null;
        if (id is not null)
            foreach (var item in id)
                if (item.Key == "WeftAppId") { key = item.Value; break; }
        var instance = AppInstance.FindOrRegisterForKey(key ?? exe);
        var args = AppInstance.GetCurrent().GetActivatedEventArgs();
        if (!instance.IsCurrent)
        {
            // Redirect on a worker so the STA entry point does not block WinRT callbacks.
            System.Threading.Tasks.Task.Run(async () => await instance.RedirectActivationToAsync(args)).GetAwaiter().GetResult();
            return false;
        }
        LaunchUrl = Url(args);
        instance.Activated += (_, activation) =>
        {
            var url = Url(activation);
            if (url is null) return;
            lock (Gate)
            {
                if (queue is null) Pending.Add(url);
                else Enqueue(url);
            }
        };
        return true;
    }

    private static string? Url(AppActivationArguments args) =>
        args.Kind == ExtendedActivationKind.Protocol && args.Data is IProtocolActivatedEventArgs protocol
            ? ProtocolUrl(protocol.Uri) : null;

    // WinRT canonicalizes authority-only URLs with a slash, changing /discover into /discover/.
    internal static string ProtocolUrl(Uri uri)
    {
        var url = uri.OriginalString;
        var authority = url.IndexOf("://", StringComparison.Ordinal);
        if (authority < 0) return url;
        var path = url.IndexOf('/', authority + 3);
        if (path < 0) return url;
        var suffix = url.IndexOfAny(['?', '#'], authority + 3);
        if (suffix >= 0 && suffix < path) return url;
        if (path + 1 == url.Length || url[path + 1] is '?' or '#') return url.Remove(path, 1);
        return url;
    }

    internal static void Attach(WeftSession value, DispatcherQueue dispatcher)
    {
        lock (Gate)
        {
            session = value;
            queue = dispatcher;
            foreach (var url in Pending) Enqueue(url);
            Pending.Clear();
        }
    }

    private static void Enqueue(string url) =>
        queue!.TryEnqueue(() => session!.Signal("link", JsonSerializer.Serialize(new { url })));
}
