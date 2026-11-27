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
        app.typeKey("[", modifierFlags: .command)
        XCTAssertTrue(app.staticTexts["Latest notes"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testRunningLink() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-NSQuitAlwaysKeepsWindows", "NO", "-ApplePersistenceIgnoreState", "YES"]
        app.launch()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(app.windows.count, 1)
        app.open(URL(string: "weftexample://showcase/overlays")!)
        XCTAssertTrue(app.staticTexts["No overlay opened yet."].waitForExistence(timeout: 10))
        XCTAssertEqual(app.windows.count, 1)
        attach("deep-link-running")
        app.open(URL(string: "weftexample://showcase/list")!)
        XCTAssertTrue(app.staticTexts["Row 1 — a longer note from the trail"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.windows.count, 1)
    }

    @MainActor
    private func attach(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
