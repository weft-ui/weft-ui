import SwiftUI
import Testing
@testable import WeftKit

@Test(arguments: [
    (nil, "a🙂b"), (-1, "a🙂b"), (0, ""), (1, "a"), (2, "a"),
    (3, "a🙂"), (4, "a🙂b"), (10, "a🙂b"),
] as [(CGFloat?, String)])
func limitsEditsWithoutSplittingUTF16Pairs(limit: CGFloat?, expected: String) {
    #expect(limitTextEdit("a🙂b", maxLength: limit) == expected)
}

@Test func countsCodeUnitsRatherThanGraphemes() {
    let combining = "e\u{0301}"
    #expect(limitTextEdit(combining, maxLength: 1) == "e")
    #expect(limitTextEdit("🙂", maxLength: 1).isEmpty)
}

@Test func requestsFocusOnlyOnValueEdges() {
    var request = TextFocusRequest()
    #expect(request.update(false) == nil)
    #expect(request.update(true) == true)
    // A user may have moved focus elsewhere since the request.
    #expect(request.update(true) == nil)
    #expect(request.update(false) == false)
    #expect(request.update(false) == nil)
    #expect(request.update(true) == true)
}

@Test func lifecycleDeduplicatesAndIgnoresInactive() {
    var state = LifecycleState()
    #expect(state.update(.active) == nil)
    #expect(state.update(.inactive) == nil)
    #expect(state.update(.background) == "background")
    #expect(state.update(.background) == nil)
    #expect(state.update(.inactive) == nil)
    #expect(state.update(.active) == "foreground")
    #expect(state.update(.active) == nil)
}

#if os(macOS)
import AppKit

@MainActor @Test func textAreaTruncatesBeforeDispatchAndRestoresRejectedEdit() {
    var proposals: [String] = []
    let coordinator = WeftTextArea(value: "a", placeholder: "Notes", maxLength: 3) { proposed in
        proposals.append(proposed)
        return "a"
    }.makeCoordinator()
    let editor = NSTextView()
    editor.delegate = coordinator
    editor.string = "a🙂z"
    editor.didChangeText()
    #expect(proposals == ["a🙂"])
    #expect(editor.string == "a")
}
#endif
