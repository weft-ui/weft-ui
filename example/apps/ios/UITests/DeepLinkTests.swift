import XCTest

final class DeepLinkTests: XCTestCase {
    @MainActor
    func testColdAndRunningLinks() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        app.open(URL(string: "weftexample://showcase/list")!)
        XCTAssertTrue(app.staticTexts["Row 1 — a longer note from the trail"].waitForExistence(timeout: 10))
        attach("deep-link-cold")
        let back = app.navigationBars.buttons.firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        back.tap()
        XCTAssertTrue(app.staticTexts["Latest notes"].waitForExistence(timeout: 5))
        app.open(URL(string: "weftexample://showcase/overlays")!)
        XCTAssertTrue(app.staticTexts["No overlay opened yet."].waitForExistence(timeout: 10))
        attach("deep-link-running")
    }

    @MainActor
    private func attach(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
