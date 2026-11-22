import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, command, prepareShots } from "./cases.ts";
import { compare } from "./compare.ts";

const { shots } = prepareShots("ios");
if (shots.length === 0) process.exit(0);

const requested = process.env.WEFT_IOS_DEVICE ?? "iPhone 17";
interface Device { name: string; udid: string; state: string }
const { devices }: { devices: Record<string, Device[]> } = JSON.parse(
  execFileSync("xcrun", ["simctl", "list", "devices", "available", "-j"], { encoding: "utf8" }),
);
const matches = Object.values(devices).flat().filter(({ name, udid }) => name === requested || udid === requested);
const device = matches.find(({ state }) => state === "Booted") ?? matches.at(-1);
if (!device) throw new Error(`iOS simulator ${requested} not found; set WEFT_IOS_DEVICE to its name or UDID`);
// xcodebuild test below builds the app and test runner for this simulator.
build("ios", { ...process.env, WEFT_NATIVE: "0" });
const { udid } = device;
if (device.state === "Shutdown") command("xcrun", ["simctl", "boot", udid]);
command("xcrun", ["simctl", "bootstatus", udid, "-b"]);
// The language and region change line breaking, glyph widths and the status bar clock;
// pin the ones the baselines use. The system UI only picks up a change after a reboot.
const defaults = (...args: string[]) =>
  execFileSync("xcrun", ["simctl", "spawn", udid, "defaults", ...args], { encoding: "utf8" });
const readDefault = (key: string) => {
  try {
    return defaults("read", "-g", key).replace(/[\s"]/g, "");
  } catch {
    return "";
  }
};
if (readDefault("AppleLocale") !== "zh_CN" || readDefault("AppleLanguages") !== "(zh-Hans-CN)") {
  defaults("write", "-g", "AppleLocale", "zh_CN");
  defaults("write", "-g", "AppleLanguages", "-array", "zh-Hans-CN");
  command("xcrun", ["simctl", "shutdown", udid]);
  command("xcrun", ["simctl", "boot", udid]);
  command("xcrun", ["simctl", "bootstatus", udid, "-b"]);
}
const directory = mkdtempSync(join(tmpdir(), "weft-ios-shots-"));
try {
  command("xcrun", ["simctl", "status_bar", udid, "override", "--time", "9:41", "--batteryState", "charged",
    "--batteryLevel", "100", "--dataNetwork", "wifi", "--cellularBars", "4", "--wifiBars", "3"]);
  for (const scheme of ["light", "dark"] as const) {
    const ids = shots.filter((shot) => shot.scheme === scheme).map(({ id }) => id);
    if (!ids.length) continue;
    command("xcrun", ["simctl", "ui", udid, "appearance", scheme]);
    command("xcodebuild", ["test", "-project", "apps/ios/App.xcodeproj", "-scheme", "App",
      "-destination", `id=${udid}`, "-derivedDataPath", "apps/ios/build", "-parallel-testing-enabled", "NO",
      "-only-testing:UITests/Screenshots/testPages", "-quiet"], {
      env: {
        ...process.env,
        TEST_RUNNER_WEFT_PAGES: ids.join(","),
        TEST_RUNNER_WEFT_SHOT_DIR: directory,
        TEST_RUNNER_WEFT_APPEARANCE: scheme,
      },
    });
  }
  for (const { name, path } of shots) copyFileSync(join(directory, name), path);
} finally {
  rmSync(directory, { recursive: true, force: true });
  command("xcrun", ["simctl", "ui", udid, "appearance", "light"]);
  command("xcrun", ["simctl", "status_bar", udid, "clear"]);
}
compare("ios", shots);
