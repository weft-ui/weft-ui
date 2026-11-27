import XCTest

/// UI tests of the app; run with `xcodebuild test -scheme App -destination platform=macOS`.
final class UITests: XCTestCase {
    @MainActor
    func testBackShortcutWithFocusedInput() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10))
        let entry = window.buttons["page:keyboard"]
        let catalog = window.scrollViews.firstMatch
        for _ in 0..<10 where !entry.isHittable { catalog.scroll(byDeltaX: 0, deltaY: -250) }
        XCTAssertTrue(entry.isHittable)
        entry.click()
        let field = window.textFields["Field 1"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.click()
        app.typeKey("[", modifierFlags: .command)
        XCTAssertTrue(entry.waitForExistence(timeout: 5))
    }

    @MainActor
    func testListLoadsMore() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10))
        let entry = window.buttons["page:list"]
        let catalog = window.scrollViews.firstMatch
        for _ in 0..<10 where !entry.isHittable { catalog.scroll(byDeltaX: 0, deltaY: -250) }
        XCTAssertTrue(entry.isHittable)
        entry.click()
        XCTAssertTrue(window.staticTexts["Row 1 — a longer note from the trail"].waitForExistence(timeout: 5))
        let list = window.scrollViews.firstMatch
        func lastVisibleRow() -> Int {
            let viewport = list.frame
            return window.staticTexts.allElementsBoundByIndex.compactMap { element -> Int? in
                guard element.frame.intersects(viewport) else { return nil }
                let words = ((element.value as? String) ?? element.label).split(separator: " ")
                guard words.count >= 2, words[0] == "Row" else { return nil }
                return Int(words[1])
            }.max() ?? 0
        }
        for _ in 0..<30 {
            let last = lastVisibleRow()
            if last > 1000 { break }
            list.scroll(byDeltaX: 0, deltaY: last < 900 ? -10000 : -500)
        }
        XCTAssertGreaterThan(lastVisibleRow(), 1000, "Reaching the end should append rows")
        Thread.sleep(forTimeInterval: 1)
        list.scroll(byDeltaX: 0, deltaY: -10000)
        XCTAssertLessThan(lastVisibleRow(), 1100, "A settled window should not repeatedly load hundreds of rows")
    }

    @MainActor
    func testLaunches() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let bundleID = "net.mioyi.weftui.showcase"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: bundleID))
        defaults.removePersistentDomain(forName: bundleID)
        defaults.synchronize()
        app.launchArguments = ["-NSQuitAlwaysKeepsWindows", "NO", "-ApplePersistenceIgnoreState", "YES"]
        app.launch()
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10))
        XCTAssertTrue(window.buttons["page:hello"].waitForExistence(timeout: 5))
        let entries = window.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "page:"))
            .allElementsBoundByIndex.map(\.label)
        XCTAssertFalse(entries.isEmpty)
        for label in entries {
            let entry = window.buttons[label]
            let catalog = window.scrollViews.firstMatch
            for _ in 0..<10 where !entry.isHittable { catalog.scroll(byDeltaX: 0, deltaY: -250) }
            XCTAssertTrue(entry.isHittable, "Catalog entry \(label) is off screen")
            entry.click()
            XCTAssertTrue(entry.waitForNonExistence(timeout: 5), "Catalog did not navigate to \(label)")
            app.typeKey("[", modifierFlags: .command)
            XCTAssertTrue(entry.waitForExistence(timeout: 5), "Catalog did not return after \(label)")
        }
    }
}
