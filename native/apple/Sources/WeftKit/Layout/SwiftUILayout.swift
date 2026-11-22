import SwiftUI

private enum WeftSize: LayoutValueKey {
    static let defaultValue = WeftSizeConstraints()
}

private enum WeftGrow: LayoutValueKey {
    static let defaultValue: CGFloat = 0
}

private enum WeftFill: LayoutValueKey {
    static let defaultValue = false
}

private enum WeftMargin: LayoutValueKey {
    static let defaultValue = WeftInsets()
}

private enum WeftHidden: LayoutValueKey {
    static let defaultValue = false
}

private enum WeftSpacerKey: LayoutValueKey {
    static let defaultValue: WeftSpacerValue? = nil
}

private enum WeftParent: Sendable {
    case none
    case linear(WeftAxis, WeftCrossAlign)
    case stack
}

private struct WeftGrowth: Sendable {
    var grow: CGFloat = 0
    var fill = false
}

extension EnvironmentValues {
    @Entry var weftBorder: CGFloat = 0
}

private extension EnvironmentValues {
    @Entry var weftParent = WeftParent.none
    @Entry var weftSize = WeftSizeConstraints()
    @Entry var weftGrowth = WeftGrowth()
}

extension View {
    /// Sets content-box dimensions. Weft layouts, rather than SwiftUI frames, resolve the constraints.
    @MainActor public func weftFrame(
        width: CGFloat? = nil, height: CGFloat? = nil,
        minWidth: CGFloat? = nil, maxWidth: CGFloat? = nil,
        minHeight: CGFloat? = nil, maxHeight: CGFloat? = nil, aspectRatio: CGFloat? = nil
    ) -> some View {
        let size = WeftSizeConstraints(
            width: width, height: height, minWidth: minWidth, maxWidth: maxWidth,
            minHeight: minHeight, maxHeight: maxHeight, aspectRatio: aspectRatio)
        return environment(\.weftSize, size).layoutValue(key: WeftSize.self, value: size)
    }

    /// Sets a child's layout participation and its margins outside the border box.
    @MainActor public func weftChild(
        grow: CGFloat = 0, fill: Bool = false,
        margin: CGFloat? = nil, marginX: CGFloat? = nil, marginY: CGFloat? = nil,
        marginTop: CGFloat? = nil, marginBottom: CGFloat? = nil,
        marginStart: CGFloat? = nil, marginEnd: CGFloat? = nil
    ) -> some View {
        let edges = WeftInsets(
            top: marginTop ?? marginY ?? margin ?? 0, right: marginEnd ?? marginX ?? margin ?? 0,
            bottom: marginBottom ?? marginY ?? margin ?? 0, left: marginStart ?? marginX ?? margin ?? 0)
        return environment(\.weftGrowth, WeftGrowth(grow: grow, fill: fill))
            .layoutValue(key: WeftGrow.self, value: grow)
            .layoutValue(key: WeftFill.self, value: fill)
            .layoutValue(key: WeftMargin.self, value: edges)
    }

    /// Removes a hidden child from Weft layout, rendering, and interaction without destroying its state.
    @MainActor public func weftVisibility(hidden: Bool) -> some View {
        opacity(hidden ? 0 : 1)
            .allowsHitTesting(!hidden)
            .accessibilityHidden(hidden)
            .layoutValue(key: WeftHidden.self, value: hidden)
    }

    fileprivate func weftChildren(of parent: WeftParent) -> some View {
        environment(\.weftParent, parent)
            .environment(\.weftSize, WeftSizeConstraints())
            .environment(\.weftGrowth, WeftGrowth())
            .environment(\.weftBorder, 0)
    }
}

struct WeftSizing: DynamicProperty {
    @Environment(\.weftParent) private var parent
    @Environment(\.weftSize) var frame
    @Environment(\.weftGrowth) private var growth

    // SwiftUI proposes a length but does not distinguish exact from atMost.
    // The parent rule and the child's own values tell it which lengths are exact.
    var exactAxes: (width: Bool, height: Bool) {
        switch parent {
        case .none: return (false, false)
        case .stack: return (growth.fill, growth.fill)
        case let .linear(axis, align):
            let cross = growth.fill || align == .stretch
            let main = growth.grow.isFinite && growth.grow > 0
            return axis == .horizontal ? (main, cross) : (cross, main)
        }
    }

    func nativeSize(_ proposal: ProposedViewSize, ideal: CGSize) -> CGSize {
        frame.measure(WeftProposal(proposal, exact: exactAxes), padding: WeftInsets()) { _ in ideal }
    }
}

private extension WeftProposal {
    init(_ proposal: ProposedViewSize, exact: (width: Bool, height: Bool)) {
        func length(_ value: CGFloat?, exact: Bool) -> WeftProposedLength {
            guard let value, value.isFinite else { return .unbounded }
            return exact ? .exact(max(0, value)) : .atMost(max(0, value))
        }
        self.init(width: length(proposal.width, exact: exact.width), height: length(proposal.height, exact: exact.height))
    }

    var swiftUI: ProposedViewSize { ProposedViewSize(width: width.limit, height: height.limit) }
}

private struct WeftBox: Equatable {
    var constraints = WeftSizeConstraints()
    let insets: WeftInsets
    let border: CGFloat
    var exactWidth = false
    var exactHeight = false

    init(constraints: WeftSizeConstraints = .init(), padding: WeftInsets, border: CGFloat = 0,
         exact: (width: Bool, height: Bool)) {
        self.constraints = constraints
        self.border = border
        insets = WeftInsets(top: padding.top + border, right: padding.right + border,
                            bottom: padding.bottom + border, left: padding.left + border)
        (exactWidth, exactHeight) = exact
    }

    func proposal(_ swiftUI: ProposedViewSize) -> WeftProposal {
        WeftProposal(swiftUI, exact: (exactWidth, exactHeight))
    }

    func content(of outer: WeftProposal) -> WeftProposal {
        constraints.contentProposal(outer, padding: insets)
    }

    func outer(_ content: WeftProposal) -> WeftProposal {
        WeftProposal(width: content.width.inset(-insets.horizontal), height: content.height.inset(-insets.vertical))
    }

    func clamp(_ outerSize: CGSize) -> CGSize {
        let content = constraints.clamp(CGSize(
            width: outerSize.width - insets.horizontal, height: outerSize.height - insets.vertical))
        return CGSize(width: content.width + insets.horizontal, height: content.height + insets.vertical)
    }
}

private extension LayoutSubview {
    func weftChild(participates: Bool = true) -> WeftLayoutChild {
        let size = self[WeftSize.self]
        return WeftLayoutChild(width: size.width, height: size.height,
                               grow: participates ? self[WeftGrow.self] : 0,
                               fill: participates && self[WeftFill.self],
                               margin: self[WeftMargin.self], spacer: self[WeftSpacerKey.self])
    }
}

private extension LayoutSubviews {
    var weftVisible: Self {
        guard contains(where: { $0[WeftHidden.self] }) else { return self }
        return self[indices.lazy.filter { !self[$0][WeftHidden.self] }]
    }
}

private struct WeftLayoutCache {
    var proposal: WeftProposal?
    var result: WeftLayoutResult?
}

private protocol WeftContainer: Layout where Cache == WeftLayoutCache {
    var box: WeftBox { get }
    func layout(proposal: WeftProposal, subviews: Subviews) -> WeftLayoutResult
}

extension WeftContainer {
    func makeCache(subviews: Subviews) -> WeftLayoutCache { WeftLayoutCache() }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout WeftLayoutCache) -> CGSize {
        let outer = box.proposal(proposal)
        let inner = box.outer(box.content(of: outer))
        let result = layout(proposal: inner, subviews: subviews.weftVisible)
        cache.proposal = inner
        cache.result = result
        return box.clamp(result.size)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout WeftLayoutCache) {
        let visible = subviews.weftVisible
        let inner = box.outer(box.content(of: box.proposal(proposal)))
        let measured = cache.proposal == inner ? cache.result : nil
        let current = measured ?? layout(proposal: inner, subviews: visible)
        // A minimum constraint can enlarge the box after its ideal size was measured.
        let result = current.size == bounds.size ? current : layout(
            proposal: WeftProposal(width: .exact(bounds.width), height: .exact(bounds.height)), subviews: visible)
        for (subview, placement) in zip(visible, result.placements) {
            subview.place(
                at: CGPoint(x: bounds.minX + placement.frame.minX, y: bounds.minY + placement.frame.minY),
                anchor: .topLeading, proposal: placement.proposal.swiftUI)
        }
    }
}

private struct WeftLinear: WeftContainer {
    let axis: WeftAxis
    let gap: CGFloat
    let align: WeftCrossAlign
    let justify: WeftJustify
    let box: WeftBox
    var participates = true

    func layout(proposal: WeftProposal, subviews: Subviews) -> WeftLayoutResult {
        WeftLayoutAlgorithm.linear(axis: axis, gap: gap, align: align, justify: justify,
                                   padding: box.insets, proposal: proposal,
                                   children: subviews.map { $0.weftChild(participates: participates) }) {
            subviews[subviews.startIndex + $0].sizeThatFits($1.swiftUI)
        }
    }
}

private struct WeftStackLayout: WeftContainer {
    let alignment: WeftAlignment
    let box: WeftBox

    func layout(proposal: WeftProposal, subviews: Subviews) -> WeftLayoutResult {
        WeftLayoutAlgorithm.stack(alignment: alignment, padding: box.insets, proposal: proposal,
                                  children: subviews.map { $0.weftChild() }) {
            subviews[subviews.startIndex + $0].sizeThatFits($1.swiftUI)
        }
    }
}

/// A native control is measured inside a Weft box. The control may choose to draw smaller than its box.
private struct WeftLeafLayout: Layout {
    let box: WeftBox
    var viewport = false

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        box.constraints.measure(box.proposal(proposal), padding: box.insets) { content in
            guard let view = subviews.first else { return .zero }
            if !viewport { return view.sizeThatFits(content.swiftUI) }
            let size = view.sizeThatFits(box.outer(content).swiftUI)
            return CGSize(width: max(0, size.width - box.insets.horizontal),
                          height: max(0, size.height - box.insets.vertical))
        }
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        // Preserve the intrinsic measurement proposal for text and controls, but give scroll views their viewport.
        let content = box.content(of: box.proposal(proposal)).swiftUI
        subviews.first?.place(
            at: viewport ? bounds.origin : CGPoint(x: bounds.minX + box.insets.left, y: bounds.minY + box.insets.top),
            anchor: .topLeading, proposal: viewport ? ProposedViewSize(bounds.size) : content)
    }
}

private struct WeftConfiguredBox<Content: View>: View {
    @Environment(\.weftBorder) private var border
    private var sizing = WeftSizing()
    let padding: WeftInsets
    let content: (WeftBox) -> Content

    init(padding: WeftInsets, content: @escaping (WeftBox) -> Content) {
        self.padding = padding
        self.content = content
    }

    var body: some View {
        content(WeftBox(constraints: sizing.frame, padding: padding, border: border, exact: sizing.exactAxes))
    }
}

/// Places children on the specified axis using Weft's linear layout rules.
@MainActor public func weftLinear<Content: View>(
    axis: WeftAxis, gap: CGFloat = 0, align: WeftCrossAlign = .start,
    justify: WeftJustify = .start, padding: WeftInsets = .init(), @ViewBuilder content: () -> Content
) -> some View {
    let children = content()
    return WeftConfiguredBox(padding: padding) { box in
        WeftLinear(axis: axis, gap: gap, align: align, justify: justify, box: box) {
            children.weftChildren(of: .linear(axis, align))
        }
    }
}

/// Arranges a native button's label children without treating it as a Row for grow or fill.
@MainActor public func weftButtonLabel<Content: View>(@ViewBuilder content: () -> Content) -> some View {
    WeftButtonLabel(content: content())
}

private struct WeftButtonLabel<Content: View>: View {
    let content: Content
    private var sizing = WeftSizing()

    init(content: Content) {
        self.content = content
    }

    var body: some View {
        let exact = sizing.exactAxes
        let frame = sizing.frame
        let ratio = frame.aspectRatio.map { $0.isFinite && $0 > 0 } ?? false
        let width = frame.width != nil || exact.width
        let height = frame.height != nil || exact.height
        WeftLinear(axis: .horizontal, gap: 0, align: .center, justify: .start,
                   box: WeftBox(padding: .init(), exact: (false, false)), participates: false) {
            content.weftChildren(of: .none)
        }
        .frame(minWidth: frame.minWidth.map { max(0, $0) }, maxWidth: width || (ratio && height) ? .infinity : nil,
               minHeight: frame.minHeight.map { max(0, $0) }, maxHeight: height || (ratio && width) ? .infinity : nil)
        .contentShape(Rectangle())
    }
}

/// Places children back-to-front, aligned inside a common content box.
@MainActor public func weftStack<Content: View>(
    alignment: WeftAlignment = .topStart, padding: WeftInsets = .init(), @ViewBuilder content: () -> Content
) -> some View {
    let children = content()
    return WeftConfiguredBox(padding: padding) { box in
        WeftStackLayout(alignment: alignment, box: box) {
            children.weftChildren(of: .stack)
        }
    }
}

/// Applies content-box sizing and optional padding to a native control.
@MainActor public func weftLeaf<Content: View>(padding: WeftInsets = .init(), @ViewBuilder content: () -> Content) -> some View {
    let child = content()
    return WeftConfiguredBox(padding: padding) { box in
        WeftLeafLayout(box: box) { child }
    }
}

// The image is drawn into its final content box after intrinsic measurement, so fitting cannot resize that box.
private struct WeftImageLayout: Layout {
    let box: WeftBox
    let intrinsic: CGSize

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        box.constraints.measure(box.proposal(proposal), padding: box.insets) {
            $0.imageIdeal(intrinsic: intrinsic)
        }
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let content = ProposedViewSize(width: max(0, bounds.width - box.insets.horizontal),
                                       height: max(0, bounds.height - box.insets.vertical))
        subviews.first?.place(at: CGPoint(x: bounds.minX + box.insets.left, y: bounds.minY + box.insets.top),
                             anchor: .topLeading, proposal: content)
    }
}

@MainActor func weftImageBox<Content: View>(intrinsic: CGSize, @ViewBuilder content: () -> Content) -> some View {
    let child = content()
    return WeftConfiguredBox(padding: .init()) { box in
        WeftImageLayout(box: box, intrinsic: intrinsic) { child }
    }
}

/// A single-axis scroll viewport whose contents use the same linear layout as Row and Column.
@MainActor public func weftScroll<Content: View>(
    direction: WeftAxis = .vertical, gap: CGFloat = 0, align: WeftCrossAlign = .start,
    indicators: Bool = true, padding: WeftInsets = .init(), @ViewBuilder content: () -> Content
) -> some View {
    let children = content()
    return WeftConfiguredBox(padding: padding) { box in
        WeftLeafLayout(box: box, viewport: true) {
            ScrollView(direction == .horizontal ? .horizontal : .vertical, showsIndicators: indicators) {
                WeftLinear(axis: direction, gap: gap, align: align, justify: .start,
                           box: WeftBox(padding: padding, exact: (direction == .vertical, direction == .horizontal))) {
                    children.weftChildren(of: .linear(direction, align))
                }
            }
            // Padding can scroll with the content; the border stays outside the viewport.
            .padding(box.border)
        }
    }
}

/// An invisible linear child with zero cross-axis size and an optional fixed main-axis length.
public struct WeftSpacer: View {
    private let size: CGFloat?

    public init(size: CGFloat? = nil) { self.size = size }

    public var body: some View {
        Color.clear.layoutValue(key: WeftSpacerKey.self, value: WeftSpacerValue(size: size))
    }
}
