import SwiftUI

#if os(macOS)
import AppKit
#else
import UIKit
#endif

// The `edit` closure dispatches the event and returns the slot's value to
// restore when an edit was refused, or nil when accepted.

/// Intrinsic width of an `Input` (CSS inputs default to about 20 characters).
private let inputWidth: CGFloat = 200

func limitTextEdit(_ value: String, maxLength: CGFloat?) -> String {
    guard let maxLength, maxLength >= 0, let limit = Int(exactly: maxLength) else { return value }
    let utf16 = value.utf16
    guard var end = utf16.index(utf16.startIndex, offsetBy: limit, limitedBy: utf16.endIndex),
          end != utf16.endIndex else { return value }
    if (0xDC00...0xDFFF).contains(utf16[end]) {
        utf16.formIndex(before: &end)
    }
    return String(decoding: utf16[..<end], as: UTF16.self)
}

/// Tracks the requested value, independently of where keyboard focus actually is.
struct TextFocusRequest {
    private var previous = false

    mutating func update(_ focused: Bool) -> Bool? {
        guard previous != focused else { return nil }
        previous = focused
        return focused
    }
}

private struct TextInputFocus: ViewModifier {
    let focused: Bool
    let onFocusChange: (@MainActor (Bool) -> Void)?
    @FocusState private var actual: Bool
    @State private var request = TextFocusRequest()
    @Environment(\.isEnabled) private var isEnabled

    func body(content: Content) -> some View {
        content.focused($actual)
            .onChange(of: focused, initial: true) { _, focused in
                if let desired = request.update(focused), !desired || isEnabled {
                    actual = desired
                }
            }
            .onChange(of: actual) { _, actual in onFocusChange?(actual) }
    }
}

private struct TextDraft<Content: View>: View {
    let value: String
    let maxLength: CGFloat?
    let edit: @MainActor (String) -> String?
    let content: (Binding<String>) -> Content
    @State private var draft: String

    init(value: String, maxLength: CGFloat?, edit: @escaping @MainActor (String) -> String?,
         @ViewBuilder content: @escaping (Binding<String>) -> Content) {
        self.value = value
        self.maxLength = maxLength
        self.edit = edit
        self.content = content
        _draft = State(initialValue: value)
    }

    var body: some View {
        content($draft)
            .onChange(of: value) { _, value in draft = value }
            .onChange(of: draft) { _, proposed in
                guard proposed != value else { return }
                let limited = limitTextEdit(proposed, maxLength: maxLength)
                // Restore the local edit buffer even when the slot did not change.
                let accepted = edit(limited) ?? limited
                if proposed != accepted { draft = accepted }
            }
    }
}

/// A native single-line text or password field.
public struct WeftInput: View {
    private let text: String
    private let placeholder: String
    private let type: WeftInputType
    private let returnKey: WeftReturnKey?
    private let maxLength: CGFloat?
    private let focused: Bool
    private let onSubmit: (@MainActor () -> Void)?
    private let onFocusChange: (@MainActor (Bool) -> Void)?
    private let edit: @MainActor (String) -> String?
    private var sizing = WeftSizing()

    public init(text: String, placeholder: String?, type: WeftInputType = .text, returnKey: WeftReturnKey? = nil,
                maxLength: CGFloat? = nil, focused: Bool = false, onSubmit: (@MainActor () -> Void)? = nil,
                onFocusChange: (@MainActor (Bool) -> Void)? = nil, edit: @escaping @MainActor (String) -> String?) {
        self.text = text
        self.placeholder = placeholder ?? ""
        self.type = type
        self.returnKey = returnKey
        self.maxLength = maxLength
        self.focused = focused
        self.onSubmit = onSubmit
        self.onFocusChange = onFocusChange
        self.edit = edit
    }

    public var body: some View {
        InputLayout(sizing: sizing) {
            TextDraft(value: text, maxLength: maxLength, edit: edit) { draft in
                field(draft)
                    .textFieldStyle(.roundedBorder)
                    .modifier(TextInputFocus(focused: focused, onFocusChange: onFocusChange))
                    .onSubmit { onSubmit?() }
            }
        }
    }

    @ViewBuilder private func field(_ draft: Binding<String>) -> some View {
        let field = Group {
            if type == .password {
                SecureField(placeholder, text: draft)
            } else {
                TextField(placeholder, text: draft)
            }
        }
        #if os(iOS)
        field.keyboardType(keyboardType).submitLabel(submitLabel)
        #else
        field
        #endif
    }

    #if os(iOS)
    private var keyboardType: UIKeyboardType {
        switch type {
        case .text, .password: .default
        case .number: .numberPad
        case .email: .emailAddress
        case .phone: .phonePad
        }
    }

    private var submitLabel: SubmitLabel {
        switch returnKey {
        case nil: .return
        case .done: .done
        case .go: .go
        case .next: .next
        case .search: .search
        case .send: .send
        }
    }
    #endif
}

private struct InputLayout: Layout {
    let sizing: WeftSizing
    var idealHeight: CGFloat? = nil

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let height = idealHeight ?? subviews.first?.sizeThatFits(.unspecified).height ?? 0
        return sizing.nativeSize(proposal, ideal: CGSize(width: inputWidth, height: height))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size))
    }
}

/// A binding to the value slot, rather than independent state in the control.
/// Refused edits invalidate the control even when the value slot did not change.
private struct WeftControl<Value, Content: View>: View {
    let value: Value
    let edit: @MainActor (Value) -> Value?
    let content: (Binding<Value>) -> Content
    @State private var rejection = 0

    var body: some View {
        _ = rejection
        return content(Binding(get: { value }, set: {
            if edit($0) != nil { rejection &+= 1 }
        }))
    }
}

/// A native checkbox on macOS and a square checkmark button on iOS.
@MainActor public func WeftCheckbox(checked: Bool, edit: @escaping @MainActor (Bool) -> Bool?) -> some View {
    #if os(macOS)
    WeftControl(value: checked, edit: edit) { binding in
        Toggle("", isOn: binding).labelsHidden().toggleStyle(.checkbox)
    }
    #else
    Button {
        _ = edit(!checked)
    } label: {
        Image(systemName: checked ? "checkmark.square.fill" : "square")
    }
    .accessibilityLabel("Checkbox")
    .accessibilityValue(checked ? "1" : "0")
    #endif
}

/// A native on/off switch.
@MainActor public func weftSwitch(checked: Bool, edit: @escaping @MainActor (Bool) -> Bool?) -> some View {
    WeftControl(value: checked, edit: edit) { binding in
        Toggle("", isOn: binding).labelsHidden().toggleStyle(.switch)
    }
}

#if os(macOS)
/// A multiline text field with three lines reserved for its content.
public struct WeftTextArea: NSViewRepresentable {
    private let value: String
    private let placeholder: String
    private let maxLength: CGFloat?
    private let focused: Bool
    private let onFocusChange: (@MainActor (Bool) -> Void)?
    private let edit: @MainActor (String) -> String?
    private var sizing = WeftSizing()

    public init(value: String, placeholder: String, maxLength: CGFloat? = nil, focused: Bool = false,
                onFocusChange: (@MainActor (Bool) -> Void)? = nil, edit: @escaping @MainActor (String) -> String?) {
        self.value = value
        self.placeholder = placeholder
        self.maxLength = maxLength
        self.focused = focused
        self.onFocusChange = onFocusChange
        self.edit = edit
    }

    public func makeCoordinator() -> Coordinator { Coordinator(self) }

    public func makeNSView(context: Context) -> NSScrollView {
        let scroll = TextAreaScrollView()
        scroll.borderType = .bezelBorder
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        let editor = context.coordinator.editor
        editor.autoresizingMask = [.width]
        editor.isVerticallyResizable = true
        editor.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        editor.textContainer?.containerSize = editor.maxSize
        editor.textContainer?.widthTracksTextView = true
        scroll.documentView = editor
        editor.isRichText = false
        editor.font = .systemFont(ofSize: NSFont.systemFontSize)
        editor.textContainerInset = NSSize(width: 2, height: 4)
        editor.string = value
        let coordinator = context.coordinator
        editor.delegate = coordinator
        editor.onFocusChange = { [weak coordinator] focused in coordinator?.area.onFocusChange?(focused) }
        editor.setAccessibilityIdentifier("WeftTextArea")
        return scroll
    }

    public func updateNSView(_ scroll: NSScrollView, context: Context) {
        let coordinator = context.coordinator
        coordinator.area = self
        let editor = coordinator.editor
        let enabled = context.environment.isEnabled
        editor.isEditable = enabled
        editor.isSelectable = enabled
        editor.setAccessibilityEnabled(enabled)
        editor.placeholder = placeholder
        editor.setAccessibilityPlaceholderValue(placeholder)
        if editor.string != value, !editor.hasMarkedText() {
            editor.string = value
        }
        editor.requestFocus(focused)
    }

    public func sizeThatFits(_ proposal: ProposedViewSize, nsView scroll: NSScrollView, context: Context) -> CGSize? {
        let editor = context.coordinator.editor
        let lineHeight = editor.layoutManager?.defaultLineHeight(for: editor.font ?? .systemFont(ofSize: NSFont.systemFontSize)) ?? 0
        let height = lineHeight * 3 + 2 * editor.textContainerInset.height + 2
        return sizing.nativeSize(proposal, ideal: CGSize(width: inputWidth, height: height))
    }

    @MainActor
    public final class Coordinator: NSObject, NSTextViewDelegate {
        fileprivate let editor = TextAreaEditor()
        fileprivate var area: WeftTextArea

        init(_ area: WeftTextArea) { self.area = area }

        public func textDidChange(_ notification: Notification) {
            guard let editor = notification.object as? NSTextView, !editor.hasMarkedText() else { return }
            let proposed = editor.string
            let limited = limitTextEdit(proposed, maxLength: area.maxLength)
            let accepted = area.edit(limited) ?? limited
            // Restore the AppKit edit buffer even when the value slot did not change.
            if accepted != proposed {
                let caret = min(editor.selectedRange().location, accepted.utf16.count)
                editor.string = accepted
                editor.setSelectedRange(NSRange(location: caret, length: 0))
            }
        }
    }
}

private final class TextAreaScrollView: NSScrollView {
    override func layout() {
        super.layout()
        guard let editor = documentView as? NSTextView else { return }
        let height = contentSize.height
        if editor.minSize.height != height { editor.minSize.height = height }
        if editor.frame.height < height {
            editor.setFrameSize(NSSize(width: editor.frame.width, height: height))
        }
    }
}

private final class TextAreaEditor: NSTextView {
    var placeholder = "" {
        didSet { if placeholder != oldValue { needsDisplay = true } }
    }
    var onFocusChange: ((Bool) -> Void)?
    private var focusRequest = TextFocusRequest()
    private var pendingFocus: Bool?

    func requestFocus(_ focused: Bool) {
        guard let desired = focusRequest.update(focused) else { return }
        pendingFocus = desired
        applyPendingFocus()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        applyPendingFocus()
    }

    private func applyPendingFocus() {
        guard pendingFocus != nil, window != nil else { return }
        // Wait until the representable update (including attachment) is complete.
        Task { @MainActor [weak self] in
            guard let self, let window, let desired = pendingFocus else { return }
            pendingFocus = nil
            if desired, isEditable {
                window.makeFirstResponder(self)
            } else if !desired, window.firstResponder === self {
                window.makeFirstResponder(nil)
            }
        }
    }

    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        if accepted { reportFocus(true) }
        return accepted
    }

    override func resignFirstResponder() -> Bool {
        let accepted = super.resignFirstResponder()
        if accepted { reportFocus(false) }
        return accepted
    }

    private func reportFocus(_ focused: Bool) {
        // Dispatch after AppKit finishes changing its first responder.
        Task { @MainActor [weak self] in self?.onFocusChange?(focused) }
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard string.isEmpty, !placeholder.isEmpty, let font else { return }
        let padding = textContainer?.lineFragmentPadding ?? 0
        let origin = NSPoint(x: textContainerInset.width + padding, y: textContainerInset.height)
        (placeholder as NSString).draw(at: origin, withAttributes: [
            .font: font,
            .foregroundColor: NSColor.placeholderTextColor,
        ])
    }
}
#else
/// A multiline text field with three lines reserved for its content by default.
public struct WeftTextArea: View {
    private let value: String
    private let placeholder: String
    private let maxLength: CGFloat?
    private let focused: Bool
    private let onFocusChange: (@MainActor (Bool) -> Void)?
    private let edit: @MainActor (String) -> String?
    @Environment(\.isEnabled) private var isEnabled
    private var sizing = WeftSizing()

    public init(value: String, placeholder: String, maxLength: CGFloat? = nil, focused: Bool = false,
                onFocusChange: (@MainActor (Bool) -> Void)? = nil, edit: @escaping @MainActor (String) -> String?) {
        self.value = value
        self.placeholder = placeholder
        self.maxLength = maxLength
        self.focused = focused
        self.onFocusChange = onFocusChange
        self.edit = edit
    }

    public var body: some View {
        TextDraft(value: value, maxLength: maxLength, edit: edit) { draft in
            Group {
                let frame = sizing.frame
                if frame.height != nil || frame.minHeight != nil || frame.maxHeight != nil ||
                    frame.aspectRatio != nil || sizing.exactAxes.height {
                    boundedEditor(draft)
                } else {
                    TextField("", text: draft, prompt: Text(placeholder), axis: .vertical)
                        .lineLimit(3, reservesSpace: true)
                        .textFieldStyle(.roundedBorder)
                }
            }
            .modifier(TextInputFocus(focused: focused, onFocusChange: onFocusChange))
        }
    }

    private func boundedEditor(_ draft: Binding<String>) -> some View {
        // The rounded-border TextField reserves three lines even when the box is shorter.
        // A scrolling text editor can honor the box height without cutting off its text.
        InputLayout(sizing: sizing, idealHeight: 3 * UIFont.preferredFont(forTextStyle: .body).lineHeight + 10) {
            TextEditor(text: draft)
                .scrollContentBackground(.hidden)
                .overlay(alignment: .topLeading) {
                    if draft.wrappedValue.isEmpty {
                        Text(placeholder)
                            .foregroundStyle(Color(uiColor: .placeholderText))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 8)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
                .background(isEnabled ? Color.clear : Color(uiColor: .secondarySystemBackground))
                .overlay {
                    RoundedRectangle(cornerRadius: 5).strokeBorder(.quaternary)
                        .allowsHitTesting(false)
                }
                .accessibilityLabel(placeholder)
        }
    }
}
#endif

/// A native slider with an integral event payload.
@MainActor public func weftSlider(
    value: CGFloat, min: CGFloat, max: CGFloat, step: CGFloat, edit: @escaping @MainActor (Double) -> Double?
) -> some View {
    let params = sanitizedSliderParams(value: value, min: min, max: max, step: step)
    return WeftControl(value: params.value, edit: { edit(roundedSliderValue($0)) }) { binding in
        Slider(value: binding,
               in: params.lower...params.upper,
               step: params.step)
            .disabled(!params.valid)
    }
}

func sanitizedSliderParams(value: CGFloat, min: CGFloat, max: CGFloat, step: CGFloat)
    -> (value: Double, lower: Double, upper: Double, step: Double, valid: Bool) {
    let lower = Double(min)
    let upper = Double(max)
    let increment = Double(step)
    let valid = lower.isFinite && upper.isFinite && lower < upper
    let raw = Double(value)
    let clamped = valid ? Swift.min(Swift.max(raw.isFinite ? raw : lower, lower), upper) : 0
    return (
        value: clamped,
        lower: valid ? lower : 0,
        upper: valid ? upper : 1,
        step: increment.isFinite && increment > 0 ? increment : 1,
        valid: valid
    )
}

func roundedSliderValue(_ value: Double) -> Double {
    value.rounded()
}

/// A menu labeled by the selected option, or the placeholder if none is selected.
@MainActor public func weftPicker(
    selected: CGFloat, options: [String], placeholder: String, edit: @escaping @MainActor (Double) -> Double?
) -> some View {
    Menu {
        ForEach(options.indices, id: \.self) { index in
            Button(options[index]) { _ = edit(Double(index)) }
        }
    } label: {
        Text(pickerLabel(selected: selected, options: options, placeholder: placeholder))
    }
}

func pickerLabel(selected: CGFloat, options: [String], placeholder: String) -> String {
    guard let index = Int(exactly: selected), options.indices.contains(index) else { return placeholder }
    return options[index]
}

/// A native indeterminate progress indicator.
@MainActor @ViewBuilder public func weftSpinner(color: WeftColor?) -> some View {
    #if os(macOS)
    if let color {
        // AppKit's busy indicator ignores tint and SwiftUI color effects.
        let tint = color.resolved
        TimelineView(.animation) { timeline in
            let phase = timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1)
            Circle().trim(from: 0, to: 0.75)
                .stroke(tint, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                .rotationEffect(.degrees(phase * 360))
                .frame(width: 18, height: 18)
                .padding(1)
        }
        .accessibilityRepresentation { ProgressView() }
    } else {
        ProgressView()
    }
    #else
    ProgressView().tint(color?.resolved)
    #endif
}

func clampedProgressValue(_ value: CGFloat) -> Double {
    let raw = Double(value)
    return raw.isFinite ? Swift.min(Swift.max(raw, 0), 1) : 0
}

/// A native progress bar displaying a fraction from zero to one.
@MainActor public func weftProgress(value: CGFloat, color: WeftColor?) -> some View {
    ProgressView(value: clampedProgressValue(value)).tint(color?.resolved)
}

/// A horizontal or vertical native separator.
@MainActor @ViewBuilder public func weftDivider(vertical: Bool, color: WeftColor?) -> some View {
    let line = Divider().overlay { color?.resolved }
    if vertical {
        HStack(spacing: 0) { line }
    } else {
        VStack(spacing: 0) { line }
    }
}
