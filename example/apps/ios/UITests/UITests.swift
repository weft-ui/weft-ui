import XCTest

/// The example's click flow over every built-in element; run with
/// `pnpm --filter example test:ios`.
final class UITests: XCTestCase {
    @MainActor
    func testClickFlow() throws {
        let app = XCUIApplication()
        app.launch()

        // Button and `if`.
        app.buttons["Click me"].tap()
        XCTAssertTrue(app.staticTexts["You clicked!"].waitForExistence(timeout: 5))

        // A controlled input: drafts longer than 12 characters are refused and rolled back.
        let field = app.textFields["New todo"]
        let add = app.buttons["Add"]
        XCTAssertFalse(add.isEnabled)
        field.tap()
        field.typeText("Buy milk and")
        XCTAssertEqual(field.value as? String, "Buy milk and")
        // Send the rejected keystroke separately so XCTest does not queue more
        // input while the native field is restoring the accepted draft.
        field.typeText("x")
        XCTAssertEqual(field.value as? String, "Buy milk and")
        XCTAssertTrue(add.isEnabled)

        // `for` rows.
        add.tap()
        XCTAssertTrue(app.staticTexts["Buy milk and"].waitForExistence(timeout: 5))
        field.typeText("Eggs")
        add.tap()
        XCTAssertTrue(app.staticTexts["2 todos"].waitForExistence(timeout: 5))

        // The checkmark buttons in the rows expose their checked state.
        let checkboxes = app.buttons.matching(identifier: "Checkbox")
        let first = checkboxes.element(boundBy: 0)
        XCTAssertEqual(first.value as? String, "0")
        first.tap()
        XCTAssertEqual(first.value as? String, "1")
        XCTAssertEqual(checkboxes.element(boundBy: 1).value as? String, "0")

        // Removing the first row keeps the second.
        app.buttons.matching(identifier: "Remove").element(boundBy: 0).tap()
        XCTAssertTrue(app.staticTexts["1 todos"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Buy milk and"].exists)
        XCTAssertTrue(app.staticTexts["Eggs"].exists)
        XCTAssertEqual(checkboxes.element(boundBy: 0).value as? String, "0")
    }

    @MainActor
    func testScrollViewport() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()

        let scroll = app.scrollViews.firstMatch
        XCTAssertTrue(scroll.waitForExistence(timeout: 5))
        XCTAssertEqual(app.scrollViews.count, 1, "Only the explicit Scroll should scroll")
        let field = scroll.textFields["New todo"]
        let add = scroll.buttons["Add"]
        field.tap()
        for _ in 0..<24 {
            field.typeText("x")
            add.tap()
        }

        let footer = scroll.staticTexts["24 todos"]
        XCTAssertFalse(footer.isHittable)
        capture("ios-example-before-scroll")
        for _ in 0..<12 where !footer.isHittable { scroll.swipeUp() }
        XCTAssertTrue(footer.isHittable)
        scroll.swipeUp()
        let bottom = footer.frame
        capture("ios-example-bottom")
        scroll.swipeUp()
        XCTAssertEqual(footer.frame, bottom)
        capture("ios-example-after-extra-swipe")
    }

    @MainActor
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
