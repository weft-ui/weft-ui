using System;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Weft.WinUI.Protocol;

namespace Weft.WinUI;

internal sealed record UiOptions(string Title, string Message, string ConfirmText, string CancelText,
    bool Destructive, string[] Options, int? DestructiveIndex, string Icon, string Duration)
{
    internal static UiOptions Parse(byte[] json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        string Text(string name, string fallback = "") => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString()! : fallback;
        var options = root.TryGetProperty("options", out var list) && list.ValueKind == JsonValueKind.Array
            ? Array.ConvertAll(list.EnumerateArray().ToArray(), item => item.GetString()!) : [];
        return new(Text("title"), Text("message"), Text("confirmText", "OK"), Text("cancelText", "Cancel"),
            root.TryGetProperty("destructive", out var destructive) && destructive.ValueKind == JsonValueKind.True,
            options, root.TryGetProperty("destructiveIndex", out var index) && index.TryGetInt32(out var i) ? i : null,
            Text("icon", "none"), Text("duration", "short"));
    }
}

/// <summary>Serializes dialogs while allowing toasts to replace one another independently.</summary>
internal sealed class DialogQueue
{
    private Task tail = Task.CompletedTask;

    internal Task<T> Enqueue<T>(Func<Task<T>> show)
    {
        var result = Run(tail, show);
        tail = result;
        return result;
    }

    private static async Task<T> Run<T>(Task previous, Func<Task<T>> show)
    {
        try { await previous; } catch { /* A failed dialog must not block the queue. */ }
        return await show();
    }
}

internal sealed class UiOverlay
{
    private readonly Grid root;
    private readonly DialogQueue dialogs = new();
    private readonly TaskCompletionSource loaded = new();
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer toastTimer;
    private Border? toast;

    internal UiOverlay(Grid root)
    {
        this.root = root;
        root.Loaded += (_, _) => loaded.TrySetResult();
        toastTimer = root.DispatcherQueue.CreateTimer();
        toastTimer.IsRepeating = false;
        toastTimer.Tick += (_, _) => ClearToast();
    }

    internal Task<byte[]> Call(string method, byte[] args)
    {
        var options = UiOptions.Parse(args);
        if (method == WeftProtocol.UiToast)
        {
            ShowToast(options);
            return Task.FromResult(Array.Empty<byte>());
        }
        if (method == WeftProtocol.UiActionSheet && (options.Options.Length < 1 || options.Options.Length > 6))
            throw new ArgumentOutOfRangeException(nameof(args), "action sheet requires 1 to 6 options");
        if (method is not (WeftProtocol.UiAlert or WeftProtocol.UiConfirm or WeftProtocol.UiActionSheet))
            throw new InvalidOperationException($"weft: ui.{method} is not implemented");
        return dialogs.Enqueue(() => ShowDialog(method, options));
    }

    private async Task<byte[]> ShowDialog(string method, UiOptions options)
    {
        await loaded.Task;
        var dialog = new ContentDialog { XamlRoot = root.XamlRoot, Title = options.Title };
        int? selection = null;
        if (method == WeftProtocol.UiActionSheet)
        {
            var list = new StackPanel { Spacing = 8 };
            for (var i = 0; i < options.Options.Length; i++)
            {
                var index = i;
                var button = new Button { Content = options.Options[i], HorizontalAlignment = HorizontalAlignment.Stretch };
                if (options.DestructiveIndex == i) button.Foreground = new SolidColorBrush(Microsoft.UI.Colors.Red);
                button.Click += (_, _) => { selection = index; dialog.Hide(); };
                list.Children.Add(button);
            }
            dialog.Content = list;
            dialog.CloseButtonText = options.CancelText;
        }
        else
        {
            dialog.Content = new TextBlock { Text = options.Message, TextWrapping = TextWrapping.Wrap };
            dialog.PrimaryButtonText = options.ConfirmText;
            if (method == WeftProtocol.UiConfirm) dialog.CloseButtonText = options.CancelText;
            if (options.Destructive)
            {
                var style = new Style(typeof(Button));
                style.Setters.Add(new Setter(Control.ForegroundProperty, new SolidColorBrush(Microsoft.UI.Colors.Red)));
                dialog.PrimaryButtonStyle = style;
            }
        }
        var result = await dialog.ShowAsync();
        return EncodeResult(method, result == ContentDialogResult.Primary, selection);
    }

    internal static byte[] EncodeResult(string method, bool confirmed, int? selected) => method switch
    {
        WeftProtocol.UiConfirm => Encoding.UTF8.GetBytes(confirmed ? "true" : "false"),
        WeftProtocol.UiActionSheet => Encoding.UTF8.GetBytes(selected?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "null"),
        _ => Array.Empty<byte>(),
    };

    private void ShowToast(UiOptions options)
    {
        ClearToast();
        var icon = options.Icon switch { "success" => "✓ ", "error" => "✕ ", _ => "" };
        toast = new Border
        {
            Background = new SolidColorBrush(Microsoft.UI.Colors.Black), CornerRadius = new CornerRadius(24),
            Padding = new Thickness(20, 10, 20, 10), Margin = new Thickness(20, 20, 20, 40),
            HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom,
            Child = new TextBlock { Text = icon + options.Message, Foreground = new SolidColorBrush(Microsoft.UI.Colors.White), TextWrapping = TextWrapping.Wrap },
            IsHitTestVisible = false,
        };
        root.Children.Add(toast);
        toastTimer.Interval = TimeSpan.FromSeconds(options.Duration == "long" ? 3 : 1.5);
        toastTimer.Start();
    }

    private void ClearToast()
    {
        toastTimer.Stop();
        if (toast is not null) root.Children.Remove(toast);
        toast = null;
    }
}
