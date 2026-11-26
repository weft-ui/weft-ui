import XCTest

final class Screenshots: XCTestCase {
    @MainActor
    func testPages() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let cases = env["WEFT_PAGES"] else { throw XCTSkip("Run pnpm --filter example shot:macos") }
        let pages = cases.split(separator: ",")

        for page in pages {
            let parts = page.split(separator: ":")
            let id = parts[0]
            let dark = parts[1] == "dark"
            let app = XCUIApplication()
            app.launchEnvironment["WEFT_SHOT_APPEARANCE"] = dark ? "dark" : "light"
            app.launchArguments = ["-NSQuitAlwaysKeepsWindows", "NO"]
            app.launch()
            defer { app.terminate() }
            app.activate()

            let window = app.windows.firstMatch
            if !window.exists { app.typeKey("n", modifierFlags: .command) }
            XCTAssertTrue(window.waitForExistence(timeout: 5), "No example window")
            let button = window.buttons["page:\(id)"]
            XCTAssertTrue(button.waitForExistence(timeout: 5), "No catalog button page:\(id)")
            let catalog = window.scrollViews.firstMatch
            for _ in 0..<10 where !button.isHittable { catalog.scroll(byDeltaX: 0, deltaY: -250) }
            XCTAssertTrue(button.isHittable, "Catalog button page:\(id) is off screen")
            button.click()
            Thread.sleep(forTimeInterval: 1)
            if id == "controls" { XCTAssertTrue(window.staticTexts["控件设置"].exists) }

            let screenshot = window.screenshot()
            let suffix = dark ? "-dark" : ""
            let attachment = XCTAttachment(data: screenshot.pngRepresentation, uniformTypeIdentifier: "public.png")
            attachment.name = "weft-\(id)\(suffix)"
            attachment.lifetime = .keepAlways
            add(attachment)
            if id == "controls" { checkControls(in: window, app: app) }
            if id == "tap" { checkTap(in: window) }
            if id == "overlays" { checkOverlays(in: app) }
        }
    }

    @MainActor
    private func checkOverlays(in app: XCUIApplication) {
        app.buttons["Alert"].click()
        XCTAssertTrue(app.buttons["OK"].waitForExistence(timeout: 5))
        app.buttons["OK"].click()
        XCTAssertTrue(app.staticTexts["Alert dismissed."].waitForExistence(timeout: 5))
        app.buttons["Confirm"].click()
        XCTAssertTrue(app.buttons["OK"].waitForExistence(timeout: 5))
        app.buttons["OK"].click()
        XCTAssertTrue(app.staticTexts["Confirmed."].waitForExistence(timeout: 5))
        app.buttons["Action sheet"].click()
        XCTAssertTrue(app.buttons["Second"].waitForExistence(timeout: 5))
        app.buttons["Second"].click()
        XCTAssertTrue(app.staticTexts["Selected option 2."].waitForExistence(timeout: 5))
        app.buttons["Toast"].click()
        let toast = app.staticTexts["This is a toast."]
        XCTAssertTrue(toast.waitForExistence(timeout: 5))
        XCTAssertTrue(toast.waitForNonExistence(timeout: 5))
    }

    @MainActor
    private func checkTap(in window: XCUIElement) {
        func checkCounts(_ rows: Int, _ cards: Int, _ buttons: Int, _ text: Int) {
            for label in ["Rows: \(rows)", "Cards: \(cards)", "Buttons: \(buttons)", "Text: \(text)"] {
                XCTAssertTrue(window.staticTexts[label].waitForExistence(timeout: 3), "Expected \(label)")
            }
        }

        let row = window.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Open details")).firstMatch
        let card = window.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Image card")).firstMatch
        checkCounts(0, 0, 0, 0)
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
        checkCounts(1, 0, 0, 0)
        card.click()
        checkCounts(1, 1, 0, 0)
        let nested = window.buttons["Nested actions"]
        nested.buttons["Save"].click()
        checkCounts(1, 1, 1, 0)
        nested.buttons["Preview"].click()
        checkCounts(1, 1, 1, 1)
    }

    @MainActor
    private func checkControls(in window: XCUIElement, app: XCUIApplication) {
        // macOS exposes switch-style Toggles as check boxes in its accessibility tree.
        let toggles = window.checkBoxes
        let lock = toggles.element(boundBy: 0)
        let alerts = toggles.element(boundBy: 1)
        let sounds = toggles.element(boundBy: 2)
        let checkbox = toggles.element(boundBy: 3)
        let slider = window.sliders.firstMatch
        let textAreas = window.descendants(matching: .any).matching(identifier: "WeftTextArea")
        let notes = textAreas.element(boundBy: 0)
        let regions = window.menuButtons
        let channel = regions["选择频道"]

        XCTAssertTrue(window.activityIndicators.firstMatch.exists)
        XCTAssertEqual(window.progressIndicators.element(boundBy: 0).value as? Double, 0.3)
        XCTAssertEqual(window.progressIndicators.element(boundBy: 1).value as? Double, 0.8)
        XCTAssertFalse(toggles.element(boundBy: 4).isEnabled)
        XCTAssertFalse(toggles.element(boundBy: 5).isEnabled)
        XCTAssertFalse(window.sliders.element(boundBy: 1).isEnabled)
        XCTAssertFalse(regions["不可更改"].isEnabled)
        XCTAssertFalse(textAreas.element(boundBy: 1).isEnabled)

        XCTAssertEqual(lock.value as? Int, 0)
        XCTAssertEqual(alerts.value as? Int, 1)
        XCTAssertEqual(sounds.value as? Int, 0)
        XCTAssertEqual(checkbox.value as? Int, 1)
        alerts.click()
        sounds.click()
        checkbox.click()
        XCTAssertEqual(alerts.value as? Int, 0)
        XCTAssertEqual(sounds.value as? Int, 1)
        XCTAssertEqual(checkbox.value as? Int, 0)

        slider.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)).click()
        XCTAssertFalse(window.staticTexts["音量 · 40%"].exists)
        let volume = slider.value as? Int
        XCTAssertNotNil(volume)
        regions["本地"].click()
        app.menuItems["远程"].click()
        XCTAssertTrue(regions["远程"].exists)
        XCTAssertTrue(channel.exists)
        notes.click()
        notes.typeText("note")
        XCTAssertEqual(notes.value as? String, "note")

        lock.click()
        XCTAssertEqual(lock.value as? Int, 1)
        alerts.click()
        sounds.click()
        checkbox.click()
        XCTAssertEqual(alerts.value as? Int, 0)
        XCTAssertEqual(sounds.value as? Int, 1)
        XCTAssertEqual(checkbox.value as? Int, 0)

        slider.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)).click()
        XCTAssertEqual(slider.value as? Int, volume)
        regions["远程"].click()
        app.menuItems["本地"].click()
        XCTAssertTrue(regions["远程"].exists)
        channel.click()
        app.menuItems["稳定版"].click()
        XCTAssertTrue(channel.exists)
        XCTAssertEqual(notes.value as? String, "note", "Locking must preserve the prior edit")
        notes.click()
        XCTAssertEqual(notes.value as? String, "note", "Focusing must preserve the prior edit")
        notes.typeText("x")
        XCTAssertEqual(notes.value as? String, "note")
    }
}
