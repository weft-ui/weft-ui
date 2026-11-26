// Generated from protocol/weft.protocol.json by protocol/generate.ts; do not edit.

enum WeftProtocol {
    static let version: UInt8 = 3

    static let fetchModule = "fetch"
    static let fetchRequest = "request"
    static let storageModule = "storage"
    static let storageGet = "get"
    static let storageSet = "set"
    static let storageRemove = "remove"
    static let uiModule = "ui"
    static let uiAlert = "alert"
    static let uiConfirm = "confirm"
    static let uiActionSheet = "actionSheet"
    static let uiToast = "toast"
    static let navigationModule = "navigation"
    static let navigationBadge = "badge"
}

enum OpCode: UInt8 {
    case create = 1
    case set = 2
    case branch = 3
    case rows = 4
    case attach = 5
    case splice = 6
    case bind = 7
    case nav = 8
}

enum ModalStyle: UInt32 {
    case sheet = 0
    case fullScreen = 1
}

enum ValueTag: UInt8 {
    case `false` = 0
    case `true` = 1
    case number = 2
    case string = 3
    case strings = 4
}

enum OpErrorKind: String {
    case truncated = "truncated"
    case version = "version"
    case opcode = "opcode"
    case tag = "tag"
    case utf8 = "utf8"
}
