import XCTest

/// UI tests of the app; run with `xcodebuild test -scheme App -destination platform=macOS`.
final class UITests: XCTestCase {
    @MainActor
    func testLaunches() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
    }
}
