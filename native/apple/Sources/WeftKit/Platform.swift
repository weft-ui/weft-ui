import Foundation

/// The platform modules of the shell; byte formats in
/// protocol/SPEC.md ("Platform calls").
enum PlatformModules {
    static let supported: Set<String> = [WeftProtocol.fetchModule, WeftProtocol.storageModule, WeftProtocol.uiModule]

    static func call(_ module: String, _ method: String, _ args: Data) async throws -> Data {
        switch (module, method) {
        case (WeftProtocol.fetchModule, WeftProtocol.fetchRequest):
            try await fetch(args)
        case (WeftProtocol.storageModule, WeftProtocol.storageGet),
             (WeftProtocol.storageModule, WeftProtocol.storageSet),
             (WeftProtocol.storageModule, WeftProtocol.storageRemove):
            try storage(method, args)
        default:
            throw PlatformFailure("weft: \(module).\(method) is not implemented")
        }
    }

    static let maxFetchBytes = 32 * 1024 * 1024

    static func validatedFetchURL(_ text: String) throws -> URL {
        guard let url = URL(string: text),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            throw PlatformFailure("weft: unsupported fetch URL \(text)")
        }
        return url
    }

    /// `fetch.request` through URLSession.
    private static func fetch(_ args: Data) async throws -> Data {
        let (head, body) = try unframe(args)
        guard let text = head["url"] as? String else {
            throw PlatformFailure("weft: invalid URL \(head["url"] ?? "")")
        }
        let url = try validatedFetchURL(text)
        var request = URLRequest(url: url)
        request.httpMethod = head["method"] as? String ?? "GET"
        for (name, value) in head["headers"] as? [String: String] ?? [:] {
            request.setValue(value, forHTTPHeaderField: name)
        }
        if !body.isEmpty {
            request.httpBody = body
        }
        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw PlatformFailure("weft: fetch expected an HTTP response")
        }
        if http.expectedContentLength > Int64(maxFetchBytes) {
            throw PlatformFailure("weft: fetch response exceeds \(maxFetchBytes) bytes")
        }
        var data = Data()
        if http.expectedContentLength > 0 {
            data.reserveCapacity(Int(http.expectedContentLength))
        }
        for try await byte in bytes {
            if data.count >= maxFetchBytes {
                throw PlatformFailure("weft: fetch response exceeds \(maxFetchBytes) bytes")
            }
            data.append(byte)
        }
        return try frame(["status": http.statusCode], data)
    }

    /// `storage.get` / `set` / `remove` on the standard user defaults.
    private static func storage(_ method: String, _ args: Data) throws -> Data {
        guard let args = try JSONSerialization.jsonObject(with: args) as? [String], let key = args.first else {
            throw PlatformFailure("weft: storage.\(method) expects a JSON array of strings")
        }
        let defaults = UserDefaults.standard
        let name = "weft.storage.\(key)"
        switch method {
        case WeftProtocol.storageGet:
            guard let value = defaults.string(forKey: name) else { return Data("null".utf8) }
            return try JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed)
        case WeftProtocol.storageSet:
            guard args.count == 2 else { throw PlatformFailure("weft: storage.set expects [key, value]") }
            defaults.set(args[1], forKey: name)
        default:
            defaults.removeObject(forKey: name)
        }
        return Data()
    }

    /// Splits `u32 head length (LE) | head (UTF-8 JSON) | body`.
    static func unframe(_ data: Data) throws -> (head: [String: Any], body: Data) {
        let bytes = [UInt8](data)
        guard bytes.count >= 4 else { throw PlatformFailure("weft: truncated frame") }
        let length = Int(UInt32(bytes[0]) | UInt32(bytes[1]) << 8 | UInt32(bytes[2]) << 16 | UInt32(bytes[3]) << 24)
        guard length <= bytes.count - 4,
              let head = try JSONSerialization.jsonObject(with: Data(bytes[4..<4 + length])) as? [String: Any]
        else { throw PlatformFailure("weft: invalid frame head") }
        return (head, Data(bytes[(4 + length)...]))
    }

    static func frame(_ head: [String: Any], _ body: Data) throws -> Data {
        let json = try JSONSerialization.data(withJSONObject: head)
        var data = Data()
        withUnsafeBytes(of: UInt32(json.count).littleEndian) { data.append(contentsOf: $0) }
        data.append(json)
        data.append(body)
        return data
    }
}

/// A failed platform call; its description rejects the call's promise.
struct PlatformFailure: LocalizedError {
    let errorDescription: String?

    init(_ message: String) {
        errorDescription = message
    }
}
