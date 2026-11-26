import XCTest

/// UI tests of the app; run with
/// `xcodebuild test -scheme App -destination 'platform=iOS Simulator,name=<device>'`.
final class UITests: XCTestCase {
    @MainActor
    func testLaunches() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
    }
}
