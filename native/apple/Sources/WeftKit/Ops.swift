struct SpliceItem: Equatable {
    let item: UInt32
    let template: UInt32
}

/// One view protocol op (protocol/SPEC.md, "Ops").
enum Op: Equatable {
    case create(scope: UInt32, template: UInt32)
    case set(scope: UInt32, slot: UInt32, value: WeftValue)
    case branch(scope: UInt32, point: UInt32, child: UInt32)
    case rows(scope: UInt32, point: UInt32, children: [UInt32])
    case attach(scope: UInt32, point: UInt32, child: UInt32)
    case splice(scope: UInt32, point: UInt32, index: UInt32, remove: UInt32, items: [SpliceItem])
    case bind(scope: UInt32, point: UInt32, item: UInt32, child: UInt32)
    case nav(tab: UInt32, tabs: [UInt32], stack: [UInt32], modal: UInt32, style: UInt32)
}

/// Why a batch of ops could not be decoded.
enum OpError: Error, Equatable {
    case version(UInt8)
    case truncated
    case opcode(UInt8)
    case tag(UInt8)
    case utf8

    var kind: String {
        switch self {
        case .version: "version"
        case .truncated: "truncated"
        case .opcode: "opcode"
        case .tag: "tag"
        case .utf8: "utf8"
        }
    }
}

/// Decodes one batch of ops in the binary encoding.
struct OpReader {
    private let bytes: UnsafeRawBufferPointer
    private var offset = 1

    /// Decodes the whole batch before returning any ops to the caller.
    static func readAll(_ bytes: UnsafeRawBufferPointer) throws(OpError) -> [Op] {
        var reader = try OpReader(bytes)
        var ops: [Op] = []
        while let op = try reader.next() { ops.append(op) }
        return ops
    }

    private init(_ bytes: UnsafeRawBufferPointer) throws(OpError) {
        guard let version = bytes.first else { throw .truncated }
        guard version == WeftProtocol.version else { throw .version(version) }
        self.bytes = bytes
    }

    /// The next op, or `nil` at the end of the batch.
    private mutating func next() throws(OpError) -> Op? {
        guard offset < bytes.count else { return nil }
        let rawOpcode = try byte()
        guard let opcode = OpCode(rawValue: rawOpcode) else { throw .opcode(rawOpcode) }
        switch opcode {
        case .create:
            return .create(scope: try u32(), template: try u32())
        case .set:
            return .set(scope: try u32(), slot: try u32(), value: try value())
        case .branch:
            return .branch(scope: try u32(), point: try u32(), child: try u32())
        case .rows:
            let scope = try u32(), point = try u32(), count = try u32()
            guard Int(count) <= (bytes.count - offset) / 4 else { throw .truncated }
            var children: [UInt32] = []
            children.reserveCapacity(Int(count))
            for _ in 0..<count { children.append(try u32()) }
            return .rows(scope: scope, point: point, children: children)
        case .attach:
            return .attach(scope: try u32(), point: try u32(), child: try u32())
        case .splice:
            let scope = try u32(), point = try u32(), index = try u32(), remove = try u32(), count = try u32()
            guard Int(count) <= (bytes.count - offset) / 8 else { throw .truncated }
            var items: [SpliceItem] = []
            items.reserveCapacity(Int(count))
            for _ in 0..<count { items.append(SpliceItem(item: try u32(), template: try u32())) }
            return .splice(scope: scope, point: point, index: index, remove: remove, items: items)
        case .bind:
            return .bind(scope: try u32(), point: try u32(), item: try u32(), child: try u32())
        case .nav:
            return .nav(tab: try u32(), tabs: try u32List(), stack: try u32List(), modal: try u32(), style: try u32())
        }
    }

    private mutating func u32List() throws(OpError) -> [UInt32] {
        let count = try u32()
        guard Int(count) <= (bytes.count - offset) / 4 else { throw .truncated }
        var values: [UInt32] = []
        values.reserveCapacity(Int(count))
        for _ in 0..<count { values.append(try u32()) }
        return values
    }

    private mutating func take(_ count: Int) throws(OpError) -> UnsafeRawBufferPointer {
        guard count <= bytes.count - offset else { throw .truncated }
        defer { offset += count }
        return UnsafeRawBufferPointer(rebasing: bytes[offset..<offset + count])
    }

    private mutating func byte() throws(OpError) -> UInt8 {
        try take(1)[0]
    }

    private mutating func u32() throws(OpError) -> UInt32 {
        UInt32(littleEndian: try take(4).loadUnaligned(as: UInt32.self))
    }

    private mutating func value() throws(OpError) -> WeftValue {
        let rawTag = try byte()
        guard let tag = ValueTag(rawValue: rawTag) else { throw .tag(rawTag) }
        switch tag {
        case .false: return .bool(false)
        case .true: return .bool(true)
        case .number: return .number(Double(bitPattern: UInt64(littleEndian: try take(8).loadUnaligned(as: UInt64.self))))
        case .string:
            return .string(try string())
        case .strings:
            let count = Int(try u32())
            guard count <= (bytes.count - offset) / 4 else { throw .truncated }
            var strings: [String] = []
            strings.reserveCapacity(count)
            for _ in 0..<count { strings.append(try string()) }
            return .strings(strings)
        }
    }

    private mutating func string() throws(OpError) -> String {
        let payload = try take(Int(try u32()))
        let invalid = transcode(payload.makeIterator(), from: UTF8.self, to: UTF8.self, stoppingOnError: true) { _ in }
        guard !invalid else { throw .utf8 }
        return String(decoding: payload, as: UTF8.self)
    }
}
