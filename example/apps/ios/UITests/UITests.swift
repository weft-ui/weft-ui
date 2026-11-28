import XCTest

/// UI tests of the app; run with
/// `xcodebuild test -scheme App -destination 'platform=iOS Simulator,name=<device>'`.
final class UITests: XCTestCase {
    @MainActor
    private func openCatalog(_ app: XCUIApplication) {
        app.launch()
        let discover = app.buttons["发现"]
        XCTAssertTrue(discover.waitForExistence(timeout: 10))
        discover.tap()
        let gallery = app.buttons["组件画廊"]
        XCTAssertTrue(gallery.waitForExistence(timeout: 5))
        gallery.tap()
    }

    @MainActor
    func testFieldnotesNavigation() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["Latest notes"].waitForExistence(timeout: 10))
        app.buttons["发现"].tap()
        XCTAssertTrue(app.buttons["组件画廊"].waitForExistence(timeout: 5))
        app.buttons["消息"].tap()
        XCTAssertTrue(app.staticTexts["Updates from your trail community."].waitForExistence(timeout: 5))
        app.buttons["我的"].tap()
        XCTAssertTrue(app.staticTexts["Mara Chen"].waitForExistence(timeout: 5))
        for _ in 0..<5 where !app.buttons["Log in"].isHittable { app.swipeUp() }
        app.buttons["Log in"].tap()
        XCTAssertTrue(app.staticTexts["Welcome back to your journal."].waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.staticTexts["Mara Chen"].waitForExistence(timeout: 5))
        for _ in 0..<5 where !app.buttons["Settings"].isHittable { app.swipeUp() }
        app.buttons["Settings"].tap()
        app.buttons["Clear cache"].tap()
        XCTAssertTrue(app.alerts.buttons["Clear"].waitForExistence(timeout: 5))
        app.alerts.buttons["Clear"].tap()
        XCTAssertTrue(app.staticTexts["Cache cleared"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["首页"].tap()
        XCTAssertTrue(app.staticTexts["Latest notes"].waitForExistence(timeout: 5))
        app.buttons["发布"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Publish a note"].waitForExistence(timeout: 5))
        for _ in 0..<5 where !app.buttons["Cancel"].isHittable { app.swipeUp() }
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.staticTexts["Latest notes"].waitForExistence(timeout: 5))
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "NOTE 1")).firstMatch.tap()
        XCTAssertTrue(app.textFields["Add a comment"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Latest notes"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testFeedLoadsMore() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["Latest notes"].waitForExistence(timeout: 10))
        let started = Date()
        // The kicker of a note after the initial 200, such as "NOTE 201  /  Ridge".
        let appended = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@",
            "NOTE (20[1-9]|2[1-9][0-9]|[3-9][0-9]{2}|[1-9][0-9]{3,}) .*")).firstMatch
        // Fling: `swipeUp` scrolls about one card, so reaching note 200 took minutes.
        let lower = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
        let upper = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
        var flings = 0
        while !appended.exists && flings < 100 {
            lower.press(forDuration: 0, thenDragTo: upper, withVelocity: XCUIGestureVelocity(20_000), thenHoldForDuration: 0)
            flings += 1
        }
        print("Feed scroll seconds: \(Date().timeIntervalSince(started)); flings: \(flings)")
        XCTAssertTrue(appended.exists, "Feed should append rows beyond its initial 200")
    }

    @MainActor
    func testColdNoteLink() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        app.open(URL(string: "weftexample://notes/3")!)
        XCTAssertTrue(app.textFields["Add a comment"].waitForExistence(timeout: 10))
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Latest notes"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testLifecyclePage() {
        let app = XCUIApplication()
        openCatalog(app)
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
        openCatalog(app)
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

    @MainActor
    func testListPullToRefresh() {
        continueAfterFailure = false
        let app = XCUIApplication()
        openCatalog(app)
        let entry = app.buttons["page:list"]
        for _ in 0..<10 where !entry.isHittable { app.swipeUp() }
        XCTAssertTrue(entry.waitForExistence(timeout: 10))
        entry.tap()

        let first = app.staticTexts["Row 1 — a longer note from the trail"]
        XCTAssertTrue(first.waitForExistence(timeout: 5))
        app.swipeUp()
        app.swipeDown()
        XCTAssertTrue(first.waitForExistence(timeout: 5))

        // Record the accessibility tree; SwiftUI's refresh indicator may not be exposed.
        app.swipeDown()
        print(app.debugDescription)
        XCTAssertTrue(first.waitForExistence(timeout: 5))
        XCTAssertTrue(first.isHittable, "The list should settle back at its first row after refresh")
    }

    @MainActor
    func testKeyboardAvoidance() {
        continueAfterFailure = false
        let app = XCUIApplication()
        openCatalog(app)
        let entry = app.buttons["page:keyboard"]
        for _ in 0..<10 where !entry.isHittable { app.swipeUp() }
        XCTAssertTrue(entry.waitForExistence(timeout: 10))
        entry.tap()
        let last = app.textFields["Field 12"]
        for _ in 0..<10 where !last.isHittable { app.swipeUp() }
        XCTAssertTrue(last.isHittable)
        last.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        let message = app.textFields["Message"]
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        XCTAssertLessThanOrEqual(last.frame.maxY, keyboard.frame.minY - 15)
        XCTAssertLessThanOrEqual(message.frame.maxY, keyboard.frame.minY)
    }
}
