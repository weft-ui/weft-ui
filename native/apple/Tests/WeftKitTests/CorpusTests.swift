import Foundation
import Testing
@testable import WeftKit
#if os(macOS)
import AppKit
#endif

private typealias JSONObject = [String: Any]

func corpusData(_ file: String) throws -> Data {
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { root.deleteLastPathComponent() }
    return try Data(contentsOf: root.appendingPathComponent("protocol/corpus/\(file).json"))
}

private func corpus(_ file: String) throws -> JSONObject {
    try #require(JSONSerialization.jsonObject(with: corpusData(file)) as? JSONObject)
}

private func hexBytes(_ test: JSONObject) throws -> [UInt8] {
    let hex = try #require(test["hex"] as? String).filter { !$0.isWhitespace }
    var bytes: [UInt8] = []
    bytes.reserveCapacity(hex.count / 2)
    var start = hex.startIndex
    while start < hex.endIndex {
        let end = try #require(hex.index(start, offsetBy: 2, limitedBy: hex.endIndex))
        bytes.append(try #require(UInt8(hex[start..<end], radix: 16)))
        start = end
    }
    return bytes
}

private func expectedValue(_ json: Any?) throws -> WeftValue {
    let value = try #require(json as? JSONObject)
    if let bool = value["bool"] as? Bool { return .bool(bool) }
    if let number = value["number"] as? Double { return .number(number) }
    if let strings = value["strings"] as? [String] { return .strings(strings) }
    return .string(try #require(value["string"] as? String))
}

private func expectedOp(_ json: JSONObject) throws -> Op {
    func field(_ name: String) throws -> UInt32 {
        try #require(json[name] as? UInt32)
    }
    let op = try #require(json["op"] as? String)
    switch op {
    case "create": return .create(scope: try field("scope"), template: try field("template"))
    case "set": return .set(scope: try field("scope"), slot: try field("slot"), value: try expectedValue(json["value"]))
    case "branch": return .branch(scope: try field("scope"), point: try field("point"), child: try field("child"))
    case "rows": return .rows(scope: try field("scope"), point: try field("point"), children: try #require(json["children"] as? [UInt32]))
    case "attach": return .attach(scope: try field("scope"), point: try field("point"), child: try field("child"))
    case "splice":
        let items = try #require(json["items"] as? [JSONObject]).map { item in
            SpliceItem(item: try #require(item["item"] as? UInt32), template: try #require(item["template"] as? UInt32))
        }
        return .splice(scope: try field("scope"), point: try field("point"), index: try field("index"), remove: try field("remove"), items: items)
    case "bind": return .bind(scope: try field("scope"), point: try field("point"), item: try field("item"), child: try field("child"))
    case "nav":
        let style = try #require(json["style"] as? String)
        let rawStyle: UInt32
        switch style {
        case "sheet": rawStyle = ModalStyle.sheet.rawValue
        case "fullScreen": rawStyle = ModalStyle.fullScreen.rawValue
        default: throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Unknown modal style: \(style)"))
        }
        return .nav(tab: try field("tab"), tabs: try #require(json["tabs"] as? [UInt32]), stack: try #require(json["stack"] as? [UInt32]), modal: try field("modal"), style: rawStyle)
    default: throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Unknown corpus op: \(op)"))
    }
}

private func decode(_ bytes: [UInt8]) throws -> [Op] {
    try bytes.withUnsafeBytes(OpReader.readAll)
}

@Test func decodesOpsCorpus() throws {
    let corpus = try corpus("ops")
    for test in try #require(corpus["cases"] as? [JSONObject]) {
        let name = try #require(test["name"] as? String)
        let bytes = try hexBytes(test)
        if let kind = test["error"] as? String {
            do {
                _ = try decode(bytes)
                Issue.record("\(name): expected \(kind)")
            } catch let error as OpError {
                #expect(error.kind == kind, "\(name)")
            }
        } else {
            let expected = try #require(test["ops"] as? [JSONObject]).map(expectedOp)
            #expect(try decode(bytes) == expected, "\(name)")
        }
    }
}

@Test @MainActor func malformedOpsDoNotCreateScopes() throws {
    let cases = try #require(corpus("ops")["cases"] as? [JSONObject])
    let test = try #require(cases.first { $0["name"] as? String == "unknown-opcode-after-create" })
    let bytes = try hexBytes(test)
    var createdScopes: [UInt32] = []
    let session = WeftSession(bytecode: nil, resources: .main, layoutHash: 0, safeArea: true) { _, id, session in
        createdScopes.append(id)
        return WeftScope(id: id, session: session)
    }

    bytes.withUnsafeBytes { session.commit($0) }

    #expect(session.failure?.hasPrefix("weft: malformed ops") == true)
    #expect(createdScopes.isEmpty)
}

@Test @MainActor func unsupportedOpsRejectTheWholeBatch() throws {
    let cases = try #require(corpus("ops")["cases"] as? [JSONObject])
    for name in ["splice-rows", "bind"] {
        let test = try #require(cases.first { $0["name"] as? String == name })
        let encoded = try hexBytes(test)
        let bytes: [UInt8] = [WeftProtocol.version, OpCode.create.rawValue, 1, 0, 0, 0, 1, 0, 0, 0] + encoded.dropFirst()
        var createdScopes: [UInt32] = []
        let session = WeftSession(bytecode: nil, resources: .main, layoutHash: 0, safeArea: true) { _, id, session in
            createdScopes.append(id)
            return WeftScope(id: id, session: session)
        }
        bytes.withUnsafeBytes { session.commit($0) }
        #expect(session.failure?.hasPrefix("weft: cannot apply ops") == true, "\(name)")
        #expect(createdScopes.isEmpty, "\(name)")
    }
}

@Test func handlesValuesCorpus() throws {
    let corpus = try corpus("values")
    for test in try #require(corpus["cases"] as? [JSONObject]) {
        let name = try #require(test["name"] as? String)
        let value = try expectedValue(test["value"])
        if case .strings = value {
            let batch: [UInt8] = [WeftProtocol.version, OpCode.set.rawValue, 0, 0, 0, 0, 0, 0, 0, 0]
            #expect(try decode(batch + hexBytes(test)) == [.set(scope: 0, slot: 0, value: value)], "\(name)")
        } else {
            var bytes: [UInt8] = []
            value.encode(into: &bytes)
            #expect(try bytes == hexBytes(test), "\(name)")
        }
    }
}

@Test func pickerReadsStringsSlot() throws {
    let cases = try #require(corpus("values")["cases"] as? [JSONObject])
    let test = try #require(cases.first { $0["name"] as? String == "strings-non-ascii" })
    let options = try #require((test["value"] as? JSONObject)?["strings"] as? [String])
    let batch: [UInt8] = [WeftProtocol.version, OpCode.set.rawValue, 0, 0, 0, 0, 0, 0, 0, 0]
    guard case let .set(_, _, value) = try #require(decode(batch + hexBytes(test)).first) else {
        Issue.record("Picker options must be delivered by a set op")
        return
    }
    #expect(value.strings == options)
    #expect(pickerLabel(selected: 1, options: value.strings, placeholder: "Choose") == options[1])
    #expect(pickerLabel(selected: -1, options: value.strings, placeholder: "Choose") == "Choose")
    #expect(pickerLabel(selected: CGFloat(options.count), options: value.strings, placeholder: "Choose") == "Choose")
}

@Test(arguments: [(19.999999999, 20.0), (3.5, 4.0), (-3.5, -4.0), (0.0, 0.0)])
func sliderRoundsItsIntegerPayload(input: Double, expected: Double) {
    #expect(roundedSliderValue(input) == expected)
}

#if os(macOS)
@Test @MainActor func textAreaRestoresTheNativeEditBuffer() {
    var value = ""
    var locked = false
    var proposals: [String] = []
    let coordinator = WeftTextArea(value: value, placeholder: "Notes") { proposed in
        proposals.append(proposed)
        if locked { return value }
        value = proposed
        return nil
    }.makeCoordinator()
    let editor = NSTextView()
    editor.delegate = coordinator

    editor.string = "first\nsecond"
    editor.didChangeText()
    #expect(value == "first\nsecond")
    #expect(editor.string == value)

    locked = true
    editor.string = "first\nsecond edited"
    editor.didChangeText()
    #expect(editor.string == "first\nsecond")
    #expect(proposals == ["first\nsecond", "first\nsecond edited"])
}
#endif

// Compare header JSON without depending on object key order or input formatting.
private func canonicalJSON(_ json: JSONObject) throws -> Data {
    try JSONSerialization.data(withJSONObject: json, options: .sortedKeys)
}

@Test func platformFramesMatchCorpus() throws {
    let corpus = try corpus("frames")
    for test in try #require(corpus["requests"] as? [JSONObject]) {
        let name = try #require(test["name"] as? String)
        let expectedHead = try #require(test["head"] as? JSONObject)
        let expectedBody = Data(try #require(test["body"] as? String).utf8)
        let (head, body) = try PlatformModules.unframe(Data(hexBytes(test)))
        #expect(try canonicalJSON(head) == canonicalJSON(expectedHead), "\(name)")
        #expect(body == expectedBody, "\(name)")
    }
    for test in try #require(corpus["responses"] as? [JSONObject]) {
        let name = try #require(test["name"] as? String)
        let expectedHead = try #require(test["head"] as? JSONObject)
        let expectedBody = Data(try #require(test["body"] as? String).utf8)
        let frame = try PlatformModules.frame(expectedHead, expectedBody)
        try #require(frame.count >= 4, "\(name)")
        let length = Int(UInt32(littleEndian: frame.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }))
        try #require(length <= frame.count - 4, "\(name)")
        let head = try #require(JSONSerialization.jsonObject(with: frame[4..<4 + length]) as? JSONObject, "\(name)")
        #expect(try canonicalJSON(head) == canonicalJSON(expectedHead), "\(name)")
        #expect(frame.dropFirst(4 + length) == expectedBody, "\(name)")
    }
    for test in try #require(corpus["malformed"] as? [JSONObject]) {
        let name = try #require(test["name"] as? String)
        let frame = try Data(hexBytes(test))
        #expect(throws: (any Error).self, "\(name)") { try PlatformModules.unframe(frame) }
    }
}
