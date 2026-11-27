import SwiftUI
import Observation

struct WeftLazyItem: Identifiable {
    let id: UInt32
    let template: UInt32
    var child: WeftScope?
}

@MainActor @Observable
public final class WeftLazyList {
    var items: [WeftLazyItem] = []
    @ObservationIgnored private weak var scope: WeftScope?
    @ObservationIgnored private let point: Int
    @ObservationIgnored private var visible: Set<UInt32> = []
    @ObservationIgnored private var indices: [UInt32: Int] = [:]
    @ObservationIgnored private var scheduled = false
    @ObservationIgnored private var heights: [UInt32: CGFloat] = [:]
    @ObservationIgnored private var measurements: [UInt32: (sum: CGFloat, count: Int)] = [:]

    init(scope: WeftScope, point: Int) {
        self.scope = scope
        self.point = point
    }

    func splice(index: Int, remove: Int, items inserted: [SpliceItem], destroy: (WeftScope) -> Void) {
        guard index >= 0, remove >= 0, index <= items.count, remove <= items.count - index else { return }
        let replacementIDs = Set(inserted.map(\.item))
        let retained = Dictionary(uniqueKeysWithValues: items[index..<(index + remove)].filter { replacementIDs.contains($0.id) }.map { ($0.id, $0) })
        for item in items[index..<(index + remove)] where !replacementIDs.contains(item.id) {
            if let child = item.child { destroy(child) }
            visible.remove(item.id)
            heights.removeValue(forKey: item.id)
        }
        items.replaceSubrange(index..<(index + remove), with: inserted.map {
            WeftLazyItem(id: $0.item, template: $0.template, child: retained[$0.item]?.child)
        })
        indices.removeAll(keepingCapacity: true)
        for (index, item) in items.enumerated() { indices[item.id] = index }
        scheduleWindow()
    }

    func bind(item id: UInt32, child: WeftScope?, destroy: (WeftScope) -> Void) {
        guard let index = indices[id] else { return }
        if let old = items[index].child, old.id != child?.id { destroy(old) }
        items[index].child = child
    }

    func setVisible(_ ids: Set<UInt32>) {
        guard visible != ids else { return }
        visible = ids
        scheduleWindow()
    }

    func measure(_ id: UInt32, template: UInt32, height: CGFloat) {
        guard height > 0, heights[id] != height else { return }
        var total = measurements[template] ?? (sum: 0, count: 0)
        if let old = heights[id] { total.sum -= old; total.count -= 1 }
        heights[id] = height
        total.sum += height
        total.count += 1
        measurements[template] = total
    }

    func estimate(_ template: UInt32) -> CGFloat {
        guard let total = measurements[template], total.count > 0 else { return 44 }
        return total.sum / CGFloat(total.count)
    }

    static func visibleItems(_ frames: [UInt32: CGRect], viewportHeight: CGFloat) -> Set<UInt32> {
        Set(frames.compactMap { id, frame in
            frame.maxY > 0 && frame.minY < viewportHeight ? id : nil
        })
    }

    static func range(count: Int, visible: [Int]) -> Range<Int>? {
        guard let first = visible.min(), let last = visible.max(), count > 0 else { return nil }
        let screen = last - first + 1
        return max(0, first - screen)..<min(count, last + 1 + screen)
    }

    private func scheduleWindow() {
        guard !scheduled else { return }
        scheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.scheduled = false
            guard let scope = self.scope,
                  let range = Self.range(count: self.items.count, visible: self.visible.compactMap({ self.indices[$0] })) else { return }
            scope.session.window(scope: scope.id, point: UInt32(self.point), start: UInt32(range.lowerBound), end: UInt32(range.upperBound))
        }
    }
}

private struct WeftLazyFrames: PreferenceKey {
    static let defaultValue: [UInt32: CGRect] = [:]
    static func reduce(value: inout [UInt32: CGRect], nextValue: () -> [UInt32: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

public struct WeftLazyView<Header: View, Footer: View>: View {
    let list: WeftLazyList
    let columns: Int
    let sections: Bool
    let gap: CGFloat
    let indicators: Bool
    let stickyHeaders: Bool
    let refreshing: () -> Bool
    let onRefresh: (() -> Void)?
    let header: Header
    let footer: Footer

    public init(list: WeftLazyList, columns: Int, sections: Bool, gap: CGFloat, indicators: Bool, stickyHeaders: Bool, refreshing: @escaping () -> Bool, onRefresh: (() -> Void)?, @ViewBuilder header: () -> Header, @ViewBuilder footer: () -> Footer) {
        self.list = list
        self.columns = columns
        self.sections = sections
        self.gap = gap
        self.indicators = indicators
        self.stickyHeaders = stickyHeaders
        self.refreshing = refreshing
        self.onRefresh = onRefresh
        self.header = header()
        self.footer = footer()
    }

    static func groups(_ items: [WeftLazyItem]) -> [[WeftLazyItem]] {
        var groups: [[WeftLazyItem]] = []
        for item in items {
            if item.template == 0 || groups.isEmpty { groups.append([]) }
            groups[groups.count - 1].append(item)
        }
        return groups
    }

    @ViewBuilder private func row(_ item: WeftLazyItem) -> some View {
        Group {
            if let child = item.child {
                weftLazyItem { child.view }
            } else {
                Color.clear.frame(height: list.estimate(item.template))
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(GeometryReader { geometry in
            Color.clear
                .preference(key: WeftLazyFrames.self, value: [item.id: geometry.frame(in: .named("weft-lazy"))])
                .onAppear {
                    if item.child != nil { list.measure(item.id, template: item.template, height: geometry.size.height) }
                }
                .onChange(of: geometry.size.height) { _, height in
                    if item.child != nil { list.measure(item.id, template: item.template, height: height) }
                }
        })
    }

    @ViewBuilder private var content: some View {
        if columns > 1 {
            LazyVStack(spacing: gap) {
                weftLazyItem { header }.frame(maxWidth: .infinity, alignment: .topLeading)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: gap, alignment: .top), count: columns), spacing: gap) {
                    ForEach(list.items) { item in row(item) }
                }
                weftLazyItem { footer }.frame(maxWidth: .infinity, alignment: .topLeading)
            }
        } else {
            LazyVStack(spacing: gap, pinnedViews: stickyHeaders ? [.sectionHeaders] : []) {
                weftLazyItem { header }.frame(maxWidth: .infinity, alignment: .topLeading)
                if stickyHeaders && sections {
                    ForEach(Self.groups(list.items), id: \.first!.id) { group in
                        if let first = group.first {
                            Section { ForEach(Array(group.dropFirst())) { item in row(item) } } header: { row(first) }
                        }
                    }
                } else {
                    ForEach(list.items) { item in row(item) }
                }
                weftLazyItem { footer }.frame(maxWidth: .infinity, alignment: .topLeading)
            }
        }
    }

    public var body: some View {
        #if os(iOS)
        Group {
            if let onRefresh {
                scroll.refreshable {
                    onRefresh()
                    while refreshing() && !Task.isCancelled {
                        try? await Task.sleep(for: .milliseconds(50))
                    }
                }
            } else {
                scroll
            }
        }
        #else
        scroll
        #endif
    }

    private var scroll: some View {
        GeometryReader { viewport in
            ScrollView(.vertical, showsIndicators: indicators) { content }
                .coordinateSpace(name: "weft-lazy")
                .onPreferenceChange(WeftLazyFrames.self) { frames in
                    list.setVisible(WeftLazyList.visibleItems(frames, viewportHeight: viewport.size.height))
                }
        }
    }
}
