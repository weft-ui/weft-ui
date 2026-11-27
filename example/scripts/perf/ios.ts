import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, command } from "../shot/cases.ts";

interface Device { name: string; udid: string; state: string }
interface Metric { displayName: string; identifier?: string; unitOfMeasurement: string; measurements: number[] }

const existingResult = process.env.WEFT_IOS_RESULT;
let destination = process.env.WEFT_IOS_DESTINATION;
if (!existingResult && !destination) {
  const requested = process.env.WEFT_IOS_DEVICE ?? "iPhone 17";
  const { devices }: { devices: Record<string, Device[]> } = JSON.parse(
    execFileSync("xcrun", ["simctl", "list", "devices", "available", "-j"], { encoding: "utf8" }),
  );
  const matches = Object.values(devices).flat().filter(({ name, udid }) => name === requested || udid === requested);
  const device = matches.find(({ state }) => state === "Booted") ?? matches.at(-1);
  if (!device) throw new Error(`iOS simulator ${requested} not found; set WEFT_IOS_DEVICE to its name or UDID`);
  if (device.state === "Shutdown") command("xcrun", ["simctl", "boot", device.udid]);
  command("xcrun", ["simctl", "bootstatus", device.udid, "-b"]);
  destination = `id=${device.udid}`;
}

const directory = existingResult ? null : mkdtempSync(join(tmpdir(), "weft-ios-perf-"));
const result = existingResult ?? join(directory!, "performance.xcresult");
let success = false;
try {
  if (!existingResult) {
    build("ios", { ...process.env, WEFT_NATIVE: "0" });
    command("xcodebuild", ["test", "-project", "apps/ios/App.xcodeproj", "-scheme", "Performance",
      "-destination", destination!, "-derivedDataPath", "apps/ios/build",
      "-parallel-testing-enabled", "NO", "-only-testing:UITests/PerformanceTests",
      "-resultBundlePath", result, "-quiet"]);
  }

  const results: unknown = JSON.parse(execFileSync("xcrun", ["xcresulttool", "get", "test-results", "metrics",
    "--path", result], { encoding: "utf8" }));
  function metrics(test: string): Metric[] {
    const found: Metric[] = [];
    let matchingTests = 0;
    function visit(value: unknown, selected = false): void {
      if (Array.isArray(value)) { value.forEach((item) => visit(item, selected)); return; }
      if (!value || typeof value !== "object") return;
      const object = value as Record<string, unknown>;
      if (typeof object.testIdentifier === "string") {
        const parts = object.testIdentifier.split("/");
        selected = parts.at(-2) === "PerformanceTests" && parts.at(-1)?.replace(/\(\)$/, "") === test;
        if (selected) matchingTests++;
      }
      if (selected && typeof object.displayName === "string" && typeof object.unitOfMeasurement === "string" &&
          Array.isArray(object.measurements) && object.measurements.every((v) => typeof v === "number")) {
        found.push(object as unknown as Metric);
      } else Object.values(object).forEach((item) => visit(item, selected));
    }
    visit(results);
    if (matchingTests !== 1) throw new Error(`Expected one result for ${test}, got ${matchingTests}`);
    return found;
  }

  function select(all: Metric[], pattern: RegExp, description: string): Metric {
    const matches = all.filter((metric) => pattern.test(`${metric.displayName} ${metric.identifier ?? ""}`));
    if (matches.length !== 1 || !matches[0]!.measurements.length ||
        matches[0]!.measurements.some((value) => !Number.isFinite(value))) {
      throw new Error(`Expected one ${description} metric with finite measurements; got ${JSON.stringify(all)}`);
    }
    return matches[0]!;
  }
  function average(metric: Metric): number {
    return metric.measurements.reduce((sum, value) => sum + value, 0) / metric.measurements.length;
  }
  function milliseconds(metric: Metric): number {
    const unit = metric.unitOfMeasurement.toLowerCase();
    if (["s", "sec", "seconds"].includes(unit)) return average(metric) * 1000;
    if (["ms", "milliseconds"].includes(unit)) return average(metric);
    throw new Error(`Unknown launch time unit: ${metric.unitOfMeasurement}`);
  }
  function mebibytes(metric: Metric): number {
    const unit = metric.unitOfMeasurement.toLowerCase();
    const factor: Record<string, number> = { b: 1, bytes: 1, kb: 1000, kib: 1024, mb: 1_000_000, mib: 1_048_576, gb: 1_000_000_000, gib: 1_073_741_824 };
    if (!(unit in factor)) throw new Error(`Unknown memory unit: ${metric.unitOfMeasurement}`);
    return average(metric) * factor[unit]! / 1_048_576;
  }

  const launch = select(metrics("testColdLaunch"), /launch/i, "launch");
  if (launch.measurements.length !== 5) throw new Error(`Expected five launch measurements, got ${launch.measurements.length}`);
  const scrolling = metrics("testScrolling");
  const hitchPattern = /(?:hitch(?:es)?[ ._-]*(?:count|number)|(?:count|number)[ ._-]*(?:of[ ._-]*)?hitch)/i;
  const framePattern = /(?:frame[ ._-]*count|count[ ._-]*(?:of[ ._-]*)?frames)/i;
  const { devices }: { devices: Record<string, Device[]> } = JSON.parse(
    execFileSync("xcrun", ["simctl", "list", "devices", "-j"], { encoding: "utf8" }),
  );
  const simulatorIds = new Set(Object.values(devices).flat().map(({ udid }) => udid));
  const testResults = results as { testIdentifier: string; testRuns: { device: { deviceId: string } }[] }[];
  const scrollResult = testResults.find(({ testIdentifier }) => testIdentifier.endsWith("/testScrolling()"));
  const simulator = !!scrollResult?.testRuns.length && scrollResult.testRuns.every(({ device }) => simulatorIds.has(device.deviceId));
  const hasHitches = scrolling.some((metric) => hitchPattern.test(`${metric.displayName} ${metric.identifier ?? ""}`));
  const hasFrames = scrolling.some((metric) => framePattern.test(`${metric.displayName} ${metric.identifier ?? ""}`));
  let jankRatio: number | null = null;
  if (hasHitches || hasFrames || !simulator) {
    const hitches = select(scrolling, hitchPattern, "hitch count");
    const frames = select(scrolling, framePattern, "frame count");
    const frameCount = frames.measurements.reduce((total, value) => total + value, 0);
    if (frameCount <= 0) throw new Error("Scrolling metric has no frames");
    jankRatio = hitches.measurements.reduce((total, value) => total + value, 0) / frameCount;
  }
  const memory100 = select(metrics("testMemory100"), /(?:peak.*(?:memory|physical)|(?:memory|physical).*peak)/i, "100-item peak memory");
  const memory10000 = select(metrics("testMemory10000"), /(?:peak.*(?:memory|physical)|(?:memory|physical).*peak)/i, "10000-item peak memory");
  const report = {
    coldStartMs: milliseconds(launch),
    jankRatio,
    memoryDeltaMiB: mebibytes(memory10000) - mebibytes(memory100),
    ...(jankRatio === null ? { notes: "hitch metrics are not reported on the simulator" } : {}),
  };
  mkdirSync("perf", { recursive: true });
  writeFileSync("perf/ios.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (report.coldStartMs > 800 || report.jankRatio === null || report.jankRatio > 0.05 || report.memoryDeltaMiB > 30_000_000 / 1_048_576) {
    console.error("iOS performance budget exceeded");
    process.exitCode = 1;
  } else {
    success = true;
  }
} finally {
  if (success && directory) rmSync(directory, { recursive: true, force: true });
  else if (!success) console.error(`iOS performance results retained at ${result}`);
}
