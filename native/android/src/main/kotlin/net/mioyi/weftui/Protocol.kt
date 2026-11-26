// Generated from protocol/weft.protocol.json by protocol/generate.ts; do not edit.

package net.mioyi.weftui

internal object WeftProtocol {
    const val VERSION = 3

    const val FETCH_MODULE = "fetch"
    const val FETCH_REQUEST = "request"
    const val STORAGE_MODULE = "storage"
    const val STORAGE_GET = "get"
    const val STORAGE_SET = "set"
    const val STORAGE_REMOVE = "remove"
}

internal object OpCode {
    const val CREATE = 1
    const val SET = 2
    const val BRANCH = 3
    const val ROWS = 4
    const val ATTACH = 5
}

internal object ValueTag {
    const val FALSE = 0
    const val TRUE = 1
    const val NUMBER = 2
    const val STRING = 3
    const val STRINGS = 4
}

internal object OpErrorKind {
    const val TRUNCATED = "truncated"
    const val VERSION = "version"
    const val OPCODE = "opcode"
    const val TAG = "tag"
    const val UTF8 = "utf8"
}
