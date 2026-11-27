import XCTest

final class PerformanceTests: XCTestCase {
    @MainActor
    func testColdLaunch() {
        let app = XCUIApplication()
        let options = XCTMeasureOptions()
        options.iterationCount = 5
        measure(metrics: [XCTApplicationLaunchMetric()], options: options) {
            app.launch()
        }
    }

    @MainActor
    func testScrolling() {
        continueAfterFailure = false
        let app = openBench(count: 10_000)
        let options = XCTMeasureOptions()
        options.iterationCount = 1
        measure(metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric], options: options) {
            for _ in 0..<20 { app.swipeUp(velocity: .fast) }
        }
    }

    @MainActor
    func testMemory100() {
        measureMemory(count: 100)
    }

    @MainActor
    func testMemory10000() {
        measureMemory(count: 10_000)
    }

    @MainActor
    private func openBench(count: Int) -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        app.open(URL(string: "weftexample://bench/feed?count=\(count)")!)
        XCTAssertTrue(app.navigationBars["Feed benchmark"].waitForExistence(timeout: 30))
        return app
    }

    @MainActor
    private func measureMemory(count: Int) {
        continueAfterFailure = false
        let app = openBench(count: count)
        for _ in 0..<20 { app.swipeUp(velocity: .fast) }
        let options = XCTMeasureOptions()
        options.iterationCount = 1
        measure(metrics: [XCTMemoryMetric(application: app)], options: options) {
            XCTAssertTrue(app.navigationBars["Feed benchmark"].exists)
        }
    }
}
