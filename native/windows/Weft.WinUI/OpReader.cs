using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Text;
using Weft.WinUI.Protocol;

namespace Weft.WinUI;

internal readonly record struct SpliceItem(uint Item, uint Template);

/// <summary>
/// One decoded op. <see cref="Arg"/> is the field after the scope: the
/// template (create), slot (set) or point (branch / rows / attach);
/// <see cref="Child"/> is the child of branch / attach and
/// <see cref="Rows"/> the children of rows.
/// </summary>
internal readonly record struct Op(OpCode Code, uint Scope, uint Arg, uint Child, WeftValue Value, uint[]? Rows,
    uint Index = 0, uint Remove = 0, SpliceItem[]? Items = null, uint[]? Tabs = null, uint[]? Stack = null,
    uint Modal = 0, uint Style = 0, uint Item = 0);

/// <summary>Why a batch of ops could not be decoded or applied.</summary>
internal sealed class OpException(string message, string? kind = null) : Exception(message)
{
    /// <summary>The protocol error kind for decoding failures; null for application failures.</summary>
    public string? Kind { get; } = kind;
}

/// <summary>Decodes one batch of ops in the binary encoding.</summary>
internal ref struct OpReader
{
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    private readonly ReadOnlySpan<byte> bytes;
    private int offset;

    private OpReader(ReadOnlySpan<byte> bytes)
    {
        if (bytes.IsEmpty) throw new OpException("truncated batch", "truncated");
        if (bytes[0] != WeftProtocol.Version) throw new OpException($"unknown encoding version {bytes[0]}", "version");
        this.bytes = bytes;
        offset = 1;
    }

    /// <summary>Decodes the next op; false at the end of the batch.</summary>
    private bool Next(out Op op)
    {
        op = default;
        if (offset >= bytes.Length) return false;
        var code = (OpCode)Byte();
        switch (code)
        {
            case OpCode.Create:
                op = new Op(code, U32(), U32(), 0, default, null);
                break;
            case OpCode.Set:
                op = new Op(code, U32(), U32(), 0, Value(), null);
                break;
            case OpCode.Branch or OpCode.Attach:
                op = new Op(code, U32(), U32(), U32(), default, null);
                break;
            case OpCode.Rows:
                var scope = U32();
                var list = U32();
                var count = U32();
                if (count > (uint)(bytes.Length - offset) / 4) throw new OpException("truncated rows", "truncated");
                var rows = new uint[count];
                for (var i = 0; i < rows.Length; i++) rows[i] = U32();
                op = new Op(code, scope, list, 0, default, rows);
                break;
            case OpCode.Splice:
                var spliceScope = U32();
                var point = U32();
                var index = U32();
                var remove = U32();
                var itemCount = U32();
                if (itemCount > (uint)(bytes.Length - offset) / 8) throw new OpException("truncated splice", "truncated");
                var items = new SpliceItem[itemCount];
                for (var i = 0; i < items.Length; i++) items[i] = new(U32(), U32());
                op = new Op(code, spliceScope, point, 0, default, null, index, remove, items);
                break;
            case OpCode.Bind:
                var bindScope = U32();
                var bindPoint = U32();
                var item = U32();
                op = new Op(code, bindScope, bindPoint, U32(), default, null, Item: item);
                break;
            case OpCode.Nav:
                var tab = U32();
                var tabs = ReadU32List();
                var stack = ReadU32List();
                op = new Op(code, tab, 0, 0, default, null, Tabs: tabs, Stack: stack, Modal: U32(), Style: U32());
                break;
            default:
                throw new OpException($"unknown opcode {(byte)code}", "opcode");
        }
        return true;
    }

    /// <summary>
    /// Decodes the whole batch <paramref name="bytes"/> into the cleared
    /// <paramref name="ops"/>. Throws <see cref="OpException"/> when any op
    /// fails to decode, so a malformed batch applies none of its ops.
    /// </summary>
    public static void ReadAll(ReadOnlySpan<byte> bytes, List<Op> ops)
    {
        ops.Clear();
        var reader = new OpReader(bytes);
        while (reader.Next(out var op)) ops.Add(op);
    }

    private ReadOnlySpan<byte> Take(uint count)
    {
        if (count > (uint)(bytes.Length - offset)) throw new OpException("truncated batch", "truncated");
        var span = bytes.Slice(offset, (int)count);
        offset += (int)count;
        return span;
    }

    private uint[] ReadU32List()
    {
        var count = U32();
        if (count > (uint)(bytes.Length - offset) / 4) throw new OpException("truncated list", "truncated");
        var result = new uint[count];
        for (var i = 0; i < result.Length; i++) result[i] = U32();
        return result;
    }

    private byte Byte() => Take(1)[0];

    private uint U32() => BinaryPrimitives.ReadUInt32LittleEndian(Take(4));

    private WeftValue Value()
    {
        var tag = Byte();
        return (ValueTag)tag switch
        {
            ValueTag.False => WeftValue.Of(false),
            ValueTag.True => WeftValue.Of(true),
            ValueTag.Number => WeftValue.Of(BinaryPrimitives.ReadDoubleLittleEndian(Take(8))),
            ValueTag.String => WeftValue.Of(ReadString()),
            ValueTag.Strings => ReadStrings(),
            _ => throw new OpException($"unknown value tag {tag}", "tag"),
        };
    }

    private WeftValue ReadStrings()
    {
        var count = U32();
        if (count > (uint)(bytes.Length - offset) / 4) throw new OpException("truncated batch", "truncated");
        if (count == 0) return WeftValue.Of(Array.Empty<string>());
        var strings = new string[(int)count];
        for (var i = 0; i < strings.Length; i++) strings[i] = ReadString();
        return WeftValue.Of(strings);
    }

    private string ReadString()
    {
        var length = U32();
        var utf8 = Take(length);
        try
        {
            return StrictUtf8.GetString(utf8);
        }
        catch (DecoderFallbackException error)
        {
            throw new OpException(error.Message, "utf8");
        }
    }
}
