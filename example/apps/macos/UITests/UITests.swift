import XCTest

/// UI tests of the app; run with `xcodebuild test -scheme App -destination platform=macOS`.
final class UITests: XCTestCase {
    @MainActor
    private func openCatalog(_ app: XCUIApplication) {
        app.launchArguments = ["-NSQuitAlwaysKeepsWindows", "NO", "-ApplePersistenceIgnoreState", "YES"]
        app.launch()
        app.activate()
        if !app.windows.firstMatch.waitForExistence(timeout: 5) { app.typeKey("n", modifierFlags: .command) }
        let back = app.windows.firstMatch.buttons["Back"]
        for _ in 0..<5 where back.exists { back.click() }
        let discover = app.windows.firstMatch.tabs["发现"]
        XCTAssertTrue(discover.waitForExistence(timeout: 10))
        discover.click()
        let gallery = app.windows.firstMatch.buttons["组件画廊"]
        XCTAssertTrue(gallery.waitForExistence(timeout: 5))
        gallery.click()
    }

    @MainActor
    func testFieldnotesNavigation() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-NSQuitAlwaysKeepsWindows", "NO", "-ApplePersistenceIgnoreState", "YES"]
        app.launch()
        app.activate()
        let window = app.windows.firstMatch
        XCTAssertTrue(window.staticTexts["Latest notes"].waitForExistence(timeout: 10))
        window.tabs["发现"].click()
        XCTAssertTrue(window.buttons["组件画廊"].waitForExistence(timeout: 5))
        app.windows.firstMatch.tabs.matching(NSPredicate(format: "label BEGINSWITH %@", "消息")).firstMatch.click()
        XCTAssertTrue(app.windows.firstMatch.staticTexts["Updates from your trail community."].waitForExistence(timeout: 5))
        app.windows.firstMatch.tabs["我的"].click()
        XCTAssertTrue(app.windows.firstMatch.staticTexts["Mara Chen"].waitForExistence(timeout: 5))
        let scroll = app.scrollViews.firstMatch
        for _ in 0..<5 where !app.windows.firstMatch.buttons["Log in"].isHittable { scroll.scroll(byDeltaX: 0, deltaY: -250) }
        app.windows.firstMatch.buttons["Log in"].click()
        XCTAssertTrue(app.windows.firstMatch.staticTexts["Welcome back to your journal."].waitForExistence(timeout: 5))
        app.windows.firstMatch.buttons["Cancel"].click()
        XCTAssertTrue(app.windows.firstMatch.staticTexts["Mara Chen"].waitForExistence(timeout: 5))
        for _ in 0..<5 where !app.windows.firstMatch.buttons["Settings"].isHittable { scroll.scroll(byDeltaX: 0, deltaY: -250) }
        app.windows.firstMatch.buttons["Settings"].click()
        app.windows.firstMatch.buttons["Clear cache"].click()
        XCTAssertTrue(app.buttons["Clear"].waitForExistence(timeout: 5))
        app.buttons["Clear"].click()
        XCTAssertTrue(app.windows.firstMatch.staticTexts["Cache cleared"].waitForExistence(timeout: 5))
        app.typeKey("[", modifierFlags: .command)
        app.windows.firstMatch.tabs["首页"].click()
        XCTAssertTrue(app.windows.firstMatch.staticTexts["Latest notes"].waitForExistence(timeout: 5))
        app.windows.firstMatch.buttons["发布"].firstMatch.click()
        XCTAssertTrue(app.windows.firstMatch.staticTexts["Publish a note"].waitForExistence(timeout: 5))
        app.windows.firstMatch.buttons["Cancel"].click()
        XCTAssertTrue(app.windows.firstMatch.staticTexts["Latest notes"].waitForExistence(timeout: 5))
        app.windows.firstMatch.buttons.matching(NSPredicate(format: "label CONTAINS %@", "NOTE 1")).firstMatch.click()
        XCTAssertTrue(app.textFields["Add a comment"].waitForExistence(timeout: 5))
        app.typeKey("[", modifierFlags: .command)
        XCTAssertTrue(app.windows.firstMatch.staticTexts["Latest notes"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testColdNoteLink() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        app.open(URL(string: "weftexample://notes/3")!)
        app.activate()
        XCTAssertTrue(app.textFields["Add a comment"].waitForExistence(timeout: 10))
        app.activate()
        app.typeKey("[", modifierFlags: .command)
        XCTAssertTrue(app.windows.firstMatch.staticTexts["Latest notes"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testFeedLoadsMore() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-NSQuitAlwaysKeepsWindows", "NO", "-ApplePersistenceIgnoreState", "YES"]
        app.launch()
        app.activate()
        XCTAssertTrue(app.windows.firstMatch.staticTexts["Latest notes"].waitForExistence(timeout: 10))
        let list = app.scrollViews.firstMatch
        func lastVisibleNote() -> Int {
            app.buttons.allElementsBoundByIndex.compactMap { element in
                guard element.frame.intersects(list.frame) else { return nil }
                let text = element.label
                guard text.hasPrefix("NOTE ") else { return nil }
                return Int(text.dropFirst(5).split(separator: " ").first ?? "")
            }.max() ?? 0
        }
        for _ in 0..<60 where lastVisibleNote() < 500 { list.scroll(byDeltaX: 0, deltaY: -10000) }
        XCTAssertGreaterThanOrEqual(lastVisibleNote(), 500, "Feed should load through row 500")
    }

    @MainActor
    func testBackShortcutWithFocusedInput() {
        continueAfterFailure = false
        let app = XCUIApplication()
        openCatalog(app)
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
        openCatalog(app)
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
        openCatalog(app)
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
