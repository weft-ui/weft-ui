// Generated from protocol/weft.protocol.json by protocol/generate.ts; do not edit.

namespace Weft.WinUI.Protocol;

internal static class WeftProtocol
{
    internal const byte Version = 3;

    internal const string FetchModule = "fetch";
    internal const string FetchRequest = "request";
    internal const string StorageModule = "storage";
    internal const string StorageGet = "get";
    internal const string StorageSet = "set";
    internal const string StorageRemove = "remove";
}

internal enum OpCode : byte
{
    Create = 1,
    Set = 2,
    Branch = 3,
    Rows = 4,
    Attach = 5,
    Splice = 6,
    Bind = 7,
    Nav = 8,
}

internal enum ModalStyle : uint
{
    Sheet = 0,
    FullScreen = 1,
}

internal enum ValueTag : byte
{
    False = 0,
    True = 1,
    Number = 2,
    String = 3,
    Strings = 4,
}

internal static class OpErrorKind
{
    internal const string Truncated = "truncated";
    internal const string Version = "version";
    internal const string Opcode = "opcode";
    internal const string Tag = "tag";
    internal const string Utf8 = "utf8";
}
