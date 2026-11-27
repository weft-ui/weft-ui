import Foundation
import Testing
import SwiftUI
@testable import WeftKit

@Test @MainActor func lazySpliceAndBinding() {
    let session = WeftSession(bytecode: nil, resources: .main, layoutHash: 0, safeArea: true) { _, _, _ in nil }
    let owner = WeftScope(id: 1, session: session)
    let list = owner.lazyList(0)
    var destroyed: [UInt32] = []
    func destroy(_ scope: WeftScope) { destroyed.append(scope.id) }
    func item(_ id: UInt32) -> SpliceItem { SpliceItem(item: id, template: 0) }
    list.splice(index: 0, remove: 0, items: [item(1), item(2), item(3)], destroy: destroy)
    let child = WeftScope(id: 10, session: session)
    list.bind(item: 2, child: child, destroy: destroy)
    list.splice(index: 0, remove: 1, items: [item(4)], destroy: destroy)
    #expect(list.items.map(\.id) == [4, 2, 3])
    #expect(list.items[1].child?.id == 10)
    list.splice(index: 2, remove: 1, items: [item(5)], destroy: destroy)
    #expect(list.items.map(\.id) == [4, 2, 5])
    list.splice(index: 0, remove: 3, items: [item(2), item(6)], destroy: destroy)
    #expect(list.items.map(\.id) == [2, 6])
    #expect(list.items[0].child?.id == 10)
    list.bind(item: 2, child: nil, destroy: destroy)
    #expect(list.items[0].child == nil)
    #expect(destroyed == [10])
    let removed = WeftScope(id: 11, session: session)
    list.bind(item: 6, child: removed, destroy: destroy)
    list.splice(index: 1, remove: 1, items: [], destroy: destroy)
    #expect(destroyed == [10, 11])
}

@Test @MainActor func lazySectionGrouping() {
    let items = [
        WeftLazyItem(id: 1, template: 0), WeftLazyItem(id: 2, template: 1),
        WeftLazyItem(id: 3, template: 1), WeftLazyItem(id: 4, template: 0),
        WeftLazyItem(id: 5, template: 1)
    ]
    let groups = WeftLazyView<EmptyView, EmptyView>.groups(items)
    #expect(groups.map { $0.map(\.id) } == [[1, 2, 3], [4, 5]])
}

@Test @MainActor func lazyWindowRange() {
    #expect(WeftLazyList.range(count: 100, visible: [10, 11, 12]) == 7..<16)
    #expect(WeftLazyList.range(count: 4, visible: [0, 1]) == 0..<4)
    #expect(WeftLazyList.range(count: 4, visible: []) == nil)
    let frames: [UInt32: CGRect] = [
        1: CGRect(x: 0, y: -80, width: 100, height: 80),
        2: CGRect(x: 0, y: -10, width: 100, height: 80),
        3: CGRect(x: 0, y: 99, width: 100, height: 80),
        4: CGRect(x: 0, y: 100, width: 100, height: 80)
    ]
    #expect(WeftLazyList.visibleItems(frames, viewportHeight: 100) == [2, 3])
    let atEnd = Array(995..<1000)
    #expect(WeftLazyList.range(count: 1000, visible: atEnd) == 990..<1000)
    #expect(WeftLazyList.range(count: 1010, visible: atEnd) == 990..<1005)
    #expect(WeftLazyList.range(count: 1020, visible: atEnd)!.upperBound < 1020 - 5)
}
