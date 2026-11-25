using System;
using System.IO;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Foundation;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

namespace Weft.WinUI;

/// <summary><c>Image</c>: a bundled bitmap or icon, or a remote bitmap.</summary>
public sealed class WeftImage : WeftDecoratedElement
{
    internal const int MaxImageBytes = 16 * 1024 * 1024;
    internal const ulong MaxImagePixels = 16_777_216UL;

    private const string AssetPrefix = "asset:";
    private readonly WeftImageContent content = new();
    private WeftBrush placeholder;
    private string? src;
    private string? assetName;
    private WeftAssets.ImageVariant? variant;
    private XamlRoot? root;
    private bool selected;
    private CancellationTokenSource? loadCts;

    public WeftImage(Action? tap = null)
    {
        Box.RoundContent = true;
        Box.Border.Child = content;
        Box.Loaded += OnLoaded;
        Box.Unloaded += OnUnloaded;
        content.Image.ImageOpened += (_, _) =>
        {
            content.Opened();
            BackgroundOverride = null;
        };
        content.Image.ImageFailed += (_, args) =>
        {
#if DEBUG
            if (assetName is not null) WeftLog.Write(Native.LogWarn, $"weft: cannot load image asset `{assetName}`: {args.ErrorMessage}");
#endif
            Load(null, 1);
        };
        if (tap is not null) Box.EnableTap(tap);
    }

    public string Src
    {
        set
        {
            if (src == value) return;
            src = value;
            assetName = value.StartsWith(AssetPrefix, StringComparison.Ordinal) ? value[AssetPrefix.Length..] : null;
            selected = false;
            variant = null;
            UpdateRoot(assetName is null ? null : Box.XamlRoot);
            CancelLoad();
            if (assetName is null)
            {
                Load(null, 1);
                if (ValidatedRemoteUri(value) is { } uri)
                {
                    loadCts = new CancellationTokenSource();
                    _ = LoadRemoteAsync(value, uri, loadCts.Token);
                }
            }
            else if (root is not null)
            {
                SelectAsset(root.RasterizationScale);
            }
            else
            {
                // Wait for the visual tree so the initial decode uses the right density.
                Load(null, 1);
            }
        }
    }

    public WeftImageFit Fit { set => content.Fit = value; }

    public WeftColor Placeholder
    {
        set
        {
            var brush = placeholder.Set(value, Theme, Appearance);
            if (!content.IsOpened) BackgroundOverride = brush;
        }
    }

    internal override void ReapplyColors()
    {
        base.ReapplyColors();
        placeholder.Reapply(Theme, Appearance);
    }

    private void OnLoaded(object sender, RoutedEventArgs args)
    {
        if (assetName is null) return;
        UpdateRoot(Box.XamlRoot);
        if (root is not null) SelectAsset(root.RasterizationScale);
    }

    private void OnUnloaded(object sender, RoutedEventArgs args)
    {
        UpdateRoot(null);
        CancelLoad();
    }

    internal static Uri? ValidatedRemoteUri(string? value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return null;
        return uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
            || uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            ? uri
            : null;
    }

    internal static bool WithinPixelLimit(uint width, uint height) =>
        width > 0 && height > 0 && (ulong)width * height <= MaxImagePixels;

    private void CancelLoad()
    {
        loadCts?.Cancel();
        loadCts?.Dispose();
        loadCts = null;
    }

    private async Task LoadRemoteAsync(string expectedSrc, Uri uri, CancellationToken token)
    {
        try
        {
            var bytes = await PlatformModules.ReadHttpBytesAsync(uri, MaxImageBytes, token);
            if (token.IsCancellationRequested || src != expectedSrc) return;
            using var stream = new InMemoryRandomAccessStream();
            await stream.WriteAsync(bytes.AsBuffer()).AsTask(token);
            await stream.FlushAsync().AsTask(token);
            stream.Seek(0);
            var decoder = await BitmapDecoder.CreateAsync(stream).AsTask(token);
            if (!WithinPixelLimit(decoder.PixelWidth, decoder.PixelHeight))
            {
                WeftLog.Write(Native.LogWarn, $"weft: image `{expectedSrc}` exceeds {MaxImagePixels} pixel limit");
                return;
            }
            if (token.IsCancellationRequested || src != expectedSrc) return;
            stream.Seek(0);
            var bitmap = new BitmapImage();
            await bitmap.SetSourceAsync(stream).AsTask(token);
            if (token.IsCancellationRequested || src != expectedSrc) return;
            Load(bitmap, 1);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception error)
        {
            WeftLog.Write(Native.LogWarn, $"weft: cannot load remote image `{expectedSrc}`: {error.Message}");
        }
    }

    private void UpdateRoot(XamlRoot? next)
    {
        if (root == next) return;
        if (root is not null) root.Changed -= OnRootChanged;
        root = next;
        if (root is not null) root.Changed += OnRootChanged;
    }

    private void OnRootChanged(XamlRoot sender, XamlRootChangedEventArgs args) => SelectAsset(sender.RasterizationScale);

    private void SelectAsset(double scale)
    {
        if (assetName is not string name) return;
        var next = WeftAssets.Current?.FindImage(name, scale);
        if (selected && next == variant) return;
        selected = true;
        variant = next;
        if (next is null)
        {
#if DEBUG
            WeftLog.Write(Native.LogWarn, $"weft: missing image asset `{assetName}`");
#endif
            Load(null, 1);
            return;
        }
        var uri = new Uri(WeftAssets.UriPrefix + next.File);
        Load(next.IsSvg ? new SvgImageSource(uri) : new BitmapImage(uri), next.Scale);
    }

    private void Load(ImageSource? source, int scale)
    {
        BackgroundOverride = placeholder.Brush;
        content.SetSource(source, scale);
    }
}

internal sealed class WeftImageContent : Panel
{
    private readonly RectangleGeometry viewport = new();
    internal Image Image { get; } = new() { Stretch = Stretch.UniformToFill };
    internal bool IsOpened { get; private set; }
    private int scale = 1;
    private bool exactWidth, exactHeight;
    private Size? svgSize;
    private Size intrinsic;

    internal WeftImageContent()
    {
        Children.Add(Image);
        Image.Clip = viewport;
    }

    internal WeftImageFit Fit
    {
        set => Image.Stretch = value switch
        {
            WeftImageFit.Contain => Stretch.Uniform,
            WeftImageFit.Fill => Stretch.Fill,
            _ => Stretch.UniformToFill,
        };
    }

    internal void SetSource(ImageSource? source, int density)
    {
        IsOpened = false;
        scale = density;
        svgSize = null;
        Image.Source = source;
        InvalidateMeasure();
    }

    internal void Opened()
    {
        IsOpened = true;
        InvalidateMeasure();
    }

    internal void SetProposal(LayoutProposal proposal)
    {
        if (exactWidth == proposal.Width.IsExact && exactHeight == proposal.Height.IsExact) return;
        (exactWidth, exactHeight) = (proposal.Width.IsExact, proposal.Height.IsExact);
        InvalidateMeasure();
    }

    protected override Size MeasureOverride(Size available)
    {
        var proposal = new LayoutProposal(new(available.Width, exactWidth), new(available.Height, exactHeight));
        var needsIntrinsic = Image.Stretch == Stretch.UniformToFill || !exactWidth || !exactHeight;
        intrinsic = !IsOpened || !needsIntrinsic ? default : Image.Source switch
        {
            BitmapImage bitmap => new Size((double)bitmap.PixelWidth / scale, (double)bitmap.PixelHeight / scale),
            SvgImageSource => svgSize ??= MeasureSvg(),
            _ => default,
        };
        var desired = MeasureImage(proposal, intrinsic);
        var bounds = ImageBounds(desired);
        Image.Measure(new Size(bounds.Width, bounds.Height));
        return desired;
    }

    private Size MeasureSvg()
    {
        Image.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        return Image.DesiredSize;
    }

    internal static Size MeasureImage(LayoutProposal proposal, Size intrinsic)
    {
        var (width, height) = (proposal.Width, proposal.Height);
        if (intrinsic.Width <= 0 || intrinsic.Height <= 0)
            return new Size(width.Resolve(0), height.Resolve(0));
        if (width.IsExact) return new Size(width.Value, height.Resolve(width.Value * intrinsic.Height / intrinsic.Width));
        if (height.IsExact) return new Size(width.Resolve(height.Value * intrinsic.Width / intrinsic.Height), height.Value);
        var scale = Math.Min(1, Math.Min(width.Value / intrinsic.Width, height.Value / intrinsic.Height));
        return new Size(intrinsic.Width * scale, intrinsic.Height * scale);
    }

    private Rect ImageBounds(Size box) => Image.Stretch == Stretch.UniformToFill
        ? CoverBounds(box, intrinsic)
        : new Rect(0, 0, box.Width, box.Height);

    // WinUI can anchor UniformToFill to the left or top; arrange an aspect-sized image
    // ourselves so the viewport cuts equal amounts off both ends, as on the Web.
    internal static Rect CoverBounds(Size box, Size intrinsic)
    {
        if (intrinsic.Width <= 0 || intrinsic.Height <= 0) return new Rect(0, 0, box.Width, box.Height);
        var scale = Math.Max((double)box.Width / intrinsic.Width, (double)box.Height / intrinsic.Height);
        var width = intrinsic.Width * scale;
        var height = intrinsic.Height * scale;
        return new Rect((box.Width - width) / 2, (box.Height - height) / 2, width, height);
    }

    protected override Size ArrangeOverride(Size finalSize)
    {
        var bounds = ImageBounds(finalSize);
        Image.Arrange(bounds);
        var clip = new Rect(-bounds.X, -bounds.Y, finalSize.Width, finalSize.Height);
        if (viewport.Rect != clip) viewport.Rect = clip;
        return finalSize;
    }
}
