using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Weft.WinUI.Protocol;

namespace Weft.WinUI;

/// <summary>The platform modules of the shell; byte formats in protocol/SPEC.md ("Platform calls").</summary>
internal static class PlatformModules
{
    internal const int MaxFetchBytes = 32 * 1024 * 1024;
    public static readonly HashSet<string> Supported = [WeftProtocol.FetchModule, WeftProtocol.StorageModule];

    private static readonly HttpClient Http = new();

    public static Task<byte[]> Call(string module, string method, byte[] args) => (module, method) switch
    {
        (WeftProtocol.FetchModule, WeftProtocol.FetchRequest) => Fetch(args),
        (WeftProtocol.StorageModule, WeftProtocol.StorageGet or WeftProtocol.StorageSet or WeftProtocol.StorageRemove) =>
            Storage.Default.CallAsync(method, args),
        _ => throw new InvalidOperationException($"weft: {module}.{method} is not implemented"),
    };

    internal static Uri ValidatedHttpUri(string? url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (!uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) &&
             !uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException($"weft: unsupported URL {url}");
        }
        return uri;
    }

    internal static async Task<byte[]> ReadBoundedAsync(Stream stream, int maxBytes, CancellationToken ct = default)
    {
        using var outStream = new MemoryStream();
        var buffer = new byte[8192];
        while (true)
        {
            var read = await stream.ReadAsync(buffer, ct);
            if (read == 0) break;
            if (outStream.Length + read > maxBytes)
            {
                throw new InvalidOperationException($"weft: response exceeds {maxBytes} byte limit");
            }
            outStream.Write(buffer, 0, read);
        }
        return outStream.ToArray();
    }

    internal static async Task<byte[]> ReadHttpBytesAsync(Uri uri, int maxBytes, CancellationToken ct = default)
    {
        using var response = await Http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength > maxBytes)
        {
            throw new InvalidOperationException($"weft: response exceeds {maxBytes} byte limit");
        }
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        return await ReadBoundedAsync(stream, maxBytes, ct);
    }

    /// <summary><c>fetch.request</c> through <see cref="HttpClient"/>.</summary>
    private static async Task<byte[]> Fetch(byte[] args)
    {
        var (head, body) = Unframe(args);
        var uri = ValidatedHttpUri(head["url"]?.GetValue<string>());
        using var request = new HttpRequestMessage(new HttpMethod(head["method"]?.GetValue<string>() ?? "GET"), uri);
        if (body.Length > 0) request.Content = new ByteArrayContent(body);
        foreach (var (name, value) in head["headers"]?.AsObject() ?? new JsonObject())
        {
            var text = value?.GetValue<string>() ?? "";
            // Content headers such as Content-Type belong to the body.
            if (!request.Headers.TryAddWithoutValidation(name, text)) request.Content?.Headers.TryAddWithoutValidation(name, text);
        }
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
        if (response.Content.Headers.ContentLength > MaxFetchBytes)
        {
            throw new InvalidOperationException($"weft: fetch response exceeds {MaxFetchBytes} byte limit");
        }
        await using var stream = await response.Content.ReadAsStreamAsync();
        var data = await ReadBoundedAsync(stream, MaxFetchBytes);
        return Frame(new JsonObject { ["status"] = (int)response.StatusCode }, data);
    }

    /// <summary>Splits <c>u32 head length (LE) | head (UTF-8 JSON) | body</c>.</summary>
    internal static (JsonObject Head, byte[] Body) Unframe(byte[] data)
    {
        if (data.Length < 4) throw new InvalidOperationException("weft: truncated frame");
        var length = BinaryPrimitives.ReadUInt32LittleEndian(data);
        if (length > data.Length - 4 || JsonNode.Parse(data.AsSpan(4, (int)length)) is not JsonObject head)
        {
            throw new InvalidOperationException("weft: invalid frame head");
        }
        return (head, data[(4 + (int)length)..]);
    }

    internal static byte[] Frame(JsonObject head, byte[] body)
    {
        var json = Encoding.UTF8.GetBytes(head.ToJsonString());
        var data = new byte[4 + json.Length + body.Length];
        BinaryPrimitives.WriteUInt32LittleEndian(data, (uint)json.Length);
        json.CopyTo(data, 4);
        body.CopyTo(data, 4 + json.Length);
        return data;
    }
}

internal sealed class StorageStore(string filePath)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private Dictionary<string, string>? values;

    internal static string[] ParseStringArray(string method, byte[] args)
    {
        JsonNode? parsed;
        try
        {
            parsed = JsonNode.Parse(args);
        }
        catch (JsonException)
        {
            throw new InvalidOperationException($"weft: storage.{method} expects a JSON array of strings");
        }
        if (parsed is not JsonArray array || array.Count == 0)
        {
            throw new InvalidOperationException($"weft: storage.{method} expects a JSON array of strings");
        }
        var result = new string[array.Count];
        for (var i = 0; i < array.Count; i++)
        {
            if (array[i] is not JsonValue v || v.GetValueKind() != JsonValueKind.String)
            {
                throw new InvalidOperationException($"weft: storage.{method} expects a JSON array of strings");
            }
            result[i] = v.GetValue<string>();
        }
        return result;
    }

    public async Task<byte[]> CallAsync(string method, byte[] args)
    {
        var list = ParseStringArray(method, args);
        await gate.WaitAsync().ConfigureAwait(false);
        try
        {
            return await Task.Run(() => CallLocked(method, list)).ConfigureAwait(false);
        }
        finally
        {
            gate.Release();
        }
    }

    private byte[] CallLocked(string method, string[] list)
    {
        var key = list[0];
        var stored = values ??= Load();
        switch (method)
        {
            case WeftProtocol.StorageGet:
                return JsonSerializer.SerializeToUtf8Bytes(stored.GetValueOrDefault(key));
            case WeftProtocol.StorageSet:
            {
                if (list.Length != 2) throw new InvalidOperationException("weft: storage.set expects [key, value]");
                var hadOld = stored.TryGetValue(key, out var oldVal);
                stored[key] = list[1];
                try
                {
                    Save(stored);
                }
                catch
                {
                    if (hadOld) stored[key] = oldVal!;
                    else stored.Remove(key);
                    throw;
                }
                return [];
            }
            default:
            {
                if (!stored.TryGetValue(key, out var oldVal)) return [];
                stored.Remove(key);
                try
                {
                    Save(stored);
                }
                catch
                {
                    stored[key] = oldVal;
                    throw;
                }
                return [];
            }
        }
    }

    private Dictionary<string, string> Load()
    {
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllBytes(filePath)) ?? [];
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    /// <summary>Writes the file through a temporary one, so a crash never leaves it half written.</summary>
    private void Save(Dictionary<string, string> stored)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
        var temporary = filePath + ".tmp";
        File.WriteAllBytes(temporary, JsonSerializer.SerializeToUtf8Bytes(stored));
        File.Move(temporary, filePath, overwrite: true);
    }
}

/// <summary>
/// <c>storage.get</c> / <c>set</c> / <c>remove</c>: a JSON object of strings in
/// <c>%LOCALAPPDATA%\&lt;app id&gt;\storage.json</c>. The app id is the
/// <c>WeftAppId</c> assembly metadata of the app (set by the project
/// template), else the app's assembly name.
/// </summary>
internal static class Storage
{
    internal static readonly StorageStore Default = new(FilePath);

    private static string FilePath
    {
        get
        {
            var app = Assembly.GetEntryAssembly();
            var id = app?.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(a => a.Key == "WeftAppId")?.Value;
            if (string.IsNullOrEmpty(id)) id = app?.GetName().Name ?? "Weft";
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), id, "storage.json");
        }
    }
}
