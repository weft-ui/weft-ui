using System.Runtime.InteropServices;

namespace Weft.WinUI;

/// <summary>The C ABI of the native kernel (native/core/include/weft/runtime.h).</summary>
internal static unsafe partial class Native
{
    private const string Library = "weft_core";

    public const int LogDebug = 0;
    public const int LogInfo = 1;
    public const int LogWarn = 2;
    public const int LogError = 3;

    /// <summary><c>weft_host</c>: the shell's callbacks. C <c>bool</c> is one byte.</summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct Host
    {
        public uint Protocol;
        public nint Ctx;
        public delegate* unmanaged<nint, byte*, nuint, void> Commit;
        public delegate* unmanaged<nint, ulong, void> Schedule;
        public delegate* unmanaged<nint, byte*, byte> Supports;
        public delegate* unmanaged<nint, uint, byte*, byte*, byte*, nuint, void> Call;
        public delegate* unmanaged<nint, int, byte*, nuint, void> Log;
        public byte* Version;
        public byte* Environment;
    }

    [LibraryImport(Library, EntryPoint = "weft_runtime_new")]
    public static partial nint RuntimeNew(Host* host, byte* bytecode, nuint len, ulong layoutHash);

    [LibraryImport(Library, EntryPoint = "weft_runtime_tick")]
    public static partial void RuntimeTick(nint runtime);

    [LibraryImport(Library, EntryPoint = "weft_runtime_dispatch")]
    public static partial byte RuntimeDispatch(nint runtime, uint scope, uint handler, byte* payload, nuint len);

    [LibraryImport(Library, EntryPoint = "weft_runtime_resolve")]
    public static partial void RuntimeResolve(nint runtime, uint id, byte ok, byte* result, nuint len);

    [LibraryImport(Library, EntryPoint = "weft_runtime_environment")]
    public static partial void RuntimeEnvironment(nint runtime, byte* json, nuint len);

    [LibraryImport(Library, EntryPoint = "weft_runtime_free")]
    public static partial void RuntimeFree(nint runtime);

    [LibraryImport(Library, EntryPoint = "weft_stable_rows")]
    public static partial nuint StableRows(uint* oldRows, nuint oldLen, uint* newRows, nuint newLen, byte* stable);

    [LibraryImport("user32.dll")]
    public static partial uint GetDpiForSystem();

    [LibraryImport("kernel32.dll", EntryPoint = "OutputDebugStringW", StringMarshalling = StringMarshalling.Utf16)]
    public static partial void OutputDebugString(string message);
}
