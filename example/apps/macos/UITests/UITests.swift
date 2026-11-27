import XCTest

/// UI tests of the app; run with `xcodebuild test -scheme App -destination platform=macOS`.
final class UITests: XCTestCase {
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
