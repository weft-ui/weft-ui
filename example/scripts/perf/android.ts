import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { build, command } from "../shot/cases.ts";

const pkg = "net.mioyi.weftui.showcase";
const activity = `${pkg}/net.mioyi.weftui.app.MainActivity`;
const adb = (...args: string[]) => execFileSync("adb", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });

build("android", { ...process.env, WEFT_NATIVE: "0" });
command("apps/android/gradlew", ["-p", "apps/android", "-PweftBenchmark", ":app:installBenchmark", ":app:installBenchmarkAndroidTest"]);

const starts: number[] = [];
for (let i = 0; i < 10; i++) {
  adb("shell", "am", "force-stop", pkg);
  const output = adb("shell", "am", "start", "-W", "-n", activity);
  const time = /^TotalTime:\s*(\d+)\s*$/m.exec(output);
  if (!time || !/^Status:\s*ok\s*$/m.test(output)) throw new Error(`Cold start failed:\n${output}`);
  starts.push(Number(time[1]));
}
starts.sort((a, b) => a - b);
const coldStartMs = (starts[4]! + starts[5]!) / 2;

function measure(scenario: string, name: string): string {
  adb("shell", "am", "force-stop", pkg);
  const output = adb("shell", "am", "instrument", "-w", "-r", "-e", "class",
    "net.mioyi.weftui.app.PerformanceTests", "-e", "scenario", scenario,
    `${pkg}.test/androidx.test.runner.AndroidJUnitRunner`);
  if (!/^INSTRUMENTATION_CODE:\s*-1\s*$/m.test(output) || /INSTRUMENTATION_FAILED|FAILURES!!!|INSTRUMENTATION_STATUS: (?:Error|stack)=/m.test(output)) {
    throw new Error(`Android performance instrumentation failed (${scenario}):\n${output}`);
  }
  const match = new RegExp(`^INSTRUMENTATION_STATUS: ${name}=([A-Za-z0-9+/=]+)\\s*$`, "m").exec(output);
  if (!match) throw new Error(`Missing ${name} from instrumentation:\n${output}`);
  return Buffer.from(match[1]!, "base64").toString("utf8");
}
const gfx = measure("scroll", "weft_gfxinfo");
const frames = /Total frames rendered:\s*(\d+)/.exec(gfx);
const janky = /Janky frames:\s*(\d+)/.exec(gfx);
if (!frames || !janky || Number(frames[1]) === 0) throw new Error(`Invalid gfxinfo:\n${gfx}`);
const jankRatio = Number(janky[1]) / Number(frames[1]);
function pss(text: string): number {
  const match = /TOTAL PSS:\s*([\d,]+)/.exec(text) ?? /^\s*TOTAL\s+([\d,]+)/m.exec(text);
  if (!match) throw new Error(`Missing TOTAL PSS in meminfo:\n${text}`);
  return Number(match[1]!.replaceAll(",", ""));
}
const memory100 = pss(measure("memory100", "weft_meminfo_100"));
const memory10000 = pss(measure("memory10000", "weft_meminfo_10000"));
const memoryDeltaMiB = (memory10000 - memory100) / 1024;
const report = { coldStartMs, jankRatio, memoryDeltaMiB };
mkdirSync("perf", { recursive: true });
writeFileSync("perf/android.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(report);
if (coldStartMs > 1200 || jankRatio > 0.05 || memoryDeltaMiB > 30_000_000 / 1_048_576) {
  console.error("Android performance budget exceeded (1200 ms, 5% jank, 30 MB).");
  process.exitCode = 1;
}
