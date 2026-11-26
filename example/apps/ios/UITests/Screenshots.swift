import XCTest

final class Screenshots: XCTestCase {
    @MainActor
    func testPages() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let cases = env["WEFT_PAGES"] else { throw XCTSkip("Run pnpm --filter example shot:ios") }
        let pages = cases.split(separator: ",")
        let directory = URL(fileURLWithPath: try XCTUnwrap(env["WEFT_SHOT_DIR"]), isDirectory: true)
        let suffix = env["WEFT_APPEARANCE"] == "dark" ? "-dark" : ""

        for id in pages {
            let app = XCUIApplication()
            app.launch()
            defer { app.terminate() }

            let button = app.buttons["page:\(id)"]
            XCTAssertTrue(button.waitForExistence(timeout: 5), "No catalog button page:\(id)")
            for _ in 0..<10 where !button.isHittable { app.swipeUp() }
            XCTAssertTrue(button.isHittable, "Catalog button page:\(id) is off screen")
            button.tap()
            Thread.sleep(forTimeInterval: 1)

            let screenshot = XCUIScreen.main.screenshot()
            try screenshot.pngRepresentation.write(to: directory.appendingPathComponent("\(id)\(suffix).png"))
            if id == "appearance" { checkVisibility(in: app) }
            if id == "controls" { checkControls(in: app) }
            if id == "inputs" { checkInputs(in: app) }
            if id == "tap" { checkTap(in: app) }
            if id == "form" { checkForm(in: app) }
            if id == "overlays" { checkOverlays(in: app) }
        }
    }

    @MainActor
    private func checkOverlays(in app: XCUIApplication) {
        app.buttons["Alert"].tap()
        XCTAssertTrue(app.alerts.buttons["OK"].waitForExistence(timeout: 5))
        app.alerts.buttons["OK"].tap()
        XCTAssertTrue(app.staticTexts["Alert dismissed."].waitForExistence(timeout: 5))
        app.buttons["Confirm"].tap()
        XCTAssertTrue(app.alerts.buttons["OK"].waitForExistence(timeout: 5))
        app.alerts.buttons["OK"].tap()
        XCTAssertTrue(app.staticTexts["Confirmed."].waitForExistence(timeout: 5))
        app.buttons["Action sheet"].tap()
        XCTAssertTrue(app.buttons["Second"].waitForExistence(timeout: 5))
        app.buttons["Second"].tap()
        XCTAssertTrue(app.staticTexts["Selected option 2."].waitForExistence(timeout: 5))
        app.buttons["Toast"].tap()
        let toast = app.staticTexts["This is a toast."]
        XCTAssertTrue(toast.waitForExistence(timeout: 5))
        XCTAssertTrue(toast.waitForNonExistence(timeout: 5))
    }

    @MainActor
    private func checkForm(in app: XCUIApplication) {
        let bio = app.textViews["Where do you like to walk?"]
        let agreement = app.buttons["Checkbox"]
        let submit = app.buttons["Create account"]
        XCTAssertTrue(bio.exists)
        XCTAssertTrue(agreement.exists)
        XCTAssertTrue(submit.exists)
        XCTAssertEqual(bio.frame.height, 52, accuracy: 1)
        XCTAssertLessThan(bio.frame.maxY, agreement.frame.minY)
        XCTAssertEqual(submit.frame.width, bio.frame.width, accuracy: 1)
        XCTAssertEqual(submit.frame.height, 44, accuracy: 1)
    }

    @MainActor
    private func checkTap(in app: XCUIApplication) {
        func checkCounts(_ rows: Int, _ cards: Int, _ buttons: Int, _ text: Int) {
            for label in ["Rows: \(rows)", "Cards: \(cards)", "Buttons: \(buttons)", "Text: \(text)"] {
                XCTAssertTrue(app.staticTexts[label].waitForExistence(timeout: 3), "Expected \(label)")
            }
        }

        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Open details")).firstMatch
        let card = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Image card")).firstMatch
        checkCounts(0, 0, 0, 0)
        // Releasing outside cancels; the empty space in the center still accepts a tap.
        let center = row.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let outside = row.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: -1))
        center.press(forDuration: 0.1, thenDragTo: outside)
        checkCounts(0, 0, 0, 0)
        center.tap()
        checkCounts(1, 0, 0, 0)
        card.tap()
        checkCounts(1, 1, 0, 0)
        card.buttons.firstMatch.tap()
        checkCounts(1, 2, 0, 0)
        app.buttons["Save"].tap()
        checkCounts(1, 2, 1, 0)
        app.buttons["Preview"].tap()
        checkCounts(1, 2, 1, 1)
    }

    @MainActor
    private func checkInputs(in app: XCUIApplication) {
        let field = app.textFields["搜索，提交后清空"]
        let password = app.secureTextFields["输入密码"]
        let request = app.buttons["聚焦文本框"]
        let release = app.buttons["放弃焦点"]
        let focused = app.staticTexts["已聚焦"]
        let blurred = app.staticTexts["未聚焦"]

        XCTAssertTrue(blurred.exists)
        request.tap()
        XCTAssertTrue(focused.waitForExistence(timeout: 5))
        release.tap()
        XCTAssertTrue(blurred.waitForExistence(timeout: 5))

        field.tap()
        XCTAssertTrue(focused.waitForExistence(timeout: 5))
        XCTAssertTrue(request.exists, "User focus must not write back to focused")
        request.tap()
        password.tap()
        XCTAssertTrue(blurred.waitForExistence(timeout: 5))
        XCTAssertTrue(release.exists, "User blur must not write back or refocus the field")
        release.tap()

        request.tap()
        XCTAssertTrue(focused.waitForExistence(timeout: 5))
        let prefix = String(repeating: "a", count: 19)
        field.typeText(prefix + "🙂")
        XCTAssertEqual(field.value as? String, prefix)
        field.typeText("bcd")
        XCTAssertEqual(field.value as? String, prefix + "b")
        let search = app.keyboards.buttons["Search"]
        XCTAssertTrue(search.exists)
        search.tap()
        XCTAssertTrue(app.staticTexts["0/20"].waitForExistence(timeout: 5))
        XCTAssertEqual(field.value as? String, "搜索，提交后清空")
    }

    @MainActor
    private func checkControls(in app: XCUIApplication) {
        let lock = app.switches.element(boundBy: 0)
        let alerts = app.switches.element(boundBy: 1)
        let sounds = app.switches.element(boundBy: 2)
        let checkbox = app.buttons.matching(identifier: "Checkbox").firstMatch
        let slider = app.sliders.firstMatch
        let notes = app.textFields.firstMatch
        let region = app.buttons["本地"]
        let channel = app.buttons["选择频道"]

        XCTAssertTrue(app.activityIndicators.firstMatch.exists)
        XCTAssertTrue(app.progressIndicators.matching(NSPredicate(format: "value == %@", "30%")).firstMatch.exists)
        XCTAssertTrue(app.progressIndicators.matching(NSPredicate(format: "value == %@", "80%")).firstMatch.exists)
        XCTAssertFalse(app.switches.element(boundBy: 3).isEnabled)
        XCTAssertFalse(app.buttons.matching(identifier: "Checkbox").element(boundBy: 1).isEnabled)
        XCTAssertFalse(app.sliders.element(boundBy: 1).isEnabled)
        XCTAssertFalse(app.buttons["不可更改"].isEnabled)
        XCTAssertFalse(app.textFields.element(boundBy: 1).isEnabled)

        XCTAssertEqual(lock.value as? String, "0")
        XCTAssertEqual(alerts.value as? String, "1")
        alerts.tap()
        XCTAssertEqual(alerts.value as? String, "0")
        sounds.tap()
        XCTAssertEqual(sounds.value as? String, "1")
        checkbox.tap()
        XCTAssertEqual(checkbox.value as? String, "0")
        slider.adjust(toNormalizedSliderPosition: 0.8)
        XCTAssertFalse(app.staticTexts["音量 · 40%"].exists)
        let volume = slider.value as? String ?? ""
        XCTAssertTrue(app.staticTexts["音量 · \(volume)"].exists)
        region.tap()
        app.buttons["远程"].tap()
        XCTAssertTrue(app.buttons["远程"].exists)
        XCTAssertTrue(channel.exists)
        notes.tap()
        notes.typeText("x\nz")
        XCTAssertEqual(notes.value as? String, "x\nz")

        lock.tap()
        XCTAssertEqual(lock.value as? String, "1")
        alerts.tap()
        XCTAssertEqual(alerts.value as? String, "0")
        sounds.tap()
        XCTAssertEqual(sounds.value as? String, "1")
        checkbox.tap()
        XCTAssertEqual(checkbox.value as? String, "0")
        slider.adjust(toNormalizedSliderPosition: 0.2)
        XCTAssertEqual(slider.value as? String, volume)
        XCTAssertTrue(app.staticTexts["音量 · \(volume)"].exists)
        app.buttons["远程"].tap()
        app.buttons["本地"].tap()
        XCTAssertTrue(app.buttons["远程"].exists)
        channel.tap()
        app.buttons["稳定版"].tap()
        XCTAssertTrue(channel.exists)
        notes.tap()
        notes.typeText("y")
        XCTAssertEqual(notes.value as? String, "x\nz")
    }

    @MainActor
    private func checkVisibility(in app: XCUIApplication) {
        let card = app.staticTexts["This card leaves no gap when hidden."]
        let end = app.staticTexts["End of grid"]
        XCTAssertTrue(card.exists)
        XCTAssertTrue(end.exists)
        let shownEnd = end.frame.minY
        let cardHeight = card.frame.height

        app.buttons["Hide card"].tap()
        XCTAssertTrue(card.waitForNonExistence(timeout: 5))
        XCTAssertGreaterThan(shownEnd - end.frame.minY, cardHeight)

        app.buttons["Show card"].tap()
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        XCTAssertEqual(end.frame.minY, shownEnd, accuracy: 1)
    }
}
