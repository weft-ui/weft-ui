import XCTest

/// UI tests of the app; run with
/// `xcodebuild test -scheme App -destination 'platform=iOS Simulator,name=<device>'`.
final class UITests: XCTestCase {
    @MainActor
    func testLifecyclePage() {
        let app = XCUIApplication()
        app.launch()
        let entry = app.buttons["page:lifecycle"]
        for _ in 0..<10 where !entry.isHittable { app.swipeUp() }
        XCTAssertTrue(entry.waitForExistence(timeout: 10))
        entry.tap()
        XCTAssertTrue(app.staticTexts["Foreground: 0"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Background: 0"].exists)
        XCTAssertTrue(app.staticTexts["Memory warnings: 0"].exists)
    }

    @MainActor
    func testLaunches() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["page:hello"].waitForExistence(timeout: 10))
        let entries = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "page:"))
            .allElementsBoundByIndex.map(\.label)
        XCTAssertFalse(entries.isEmpty)
        for label in entries {
            let entry = app.buttons[label]
            for _ in 0..<10 where !entry.isHittable { app.swipeUp() }
            XCTAssertTrue(entry.isHittable, "Catalog entry \(label) is off screen")
            entry.tap()
            let back = app.navigationBars.buttons.firstMatch
            XCTAssertTrue(back.waitForExistence(timeout: 5), "No back button for \(label)")
            back.tap()
            XCTAssertTrue(entry.waitForExistence(timeout: 5), "Catalog did not return after \(label)")
        }
    }
}
