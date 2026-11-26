import { copyFileSync, globSync, rmSync } from "node:fs";
import { join } from "node:path";
import { build, command, prepareShots } from "./cases.ts";
import { compare } from "./compare.ts";

const { shots } = prepareShots("android");
if (shots.length === 0) process.exit(0);

const gradleShots = "apps/android/app/build/outputs/connected_android_test_additional_output/debugAndroidTest/connected";
// connectedDebugAndroidTest builds and installs both the app and its runner.
build("android", { ...process.env, WEFT_NATIVE: "0" });
try {
  for (const scheme of ["light", "dark"] as const) {
    const batch = shots.filter((shot) => shot.scheme === scheme);
    if (!batch.length) continue;
    command("adb", ["shell", "cmd", "uimode", "night", scheme === "dark" ? "yes" : "no"]);
    rmSync(gradleShots, { recursive: true, force: true });
    command("apps/android/gradlew", ["-p", "apps/android", ":app:connectedDebugAndroidTest",
      "-Pandroid.testInstrumentationRunnerArguments.class=net.mioyi.weftui.app.ScreenshotTest",
      `-Pandroid.testInstrumentationRunnerArguments.pages=${batch.map(({ id }) => id).join(",")}`,
      `-Pandroid.testInstrumentationRunnerArguments.appearance=${scheme}`]);
    for (const { name, path } of batch) {
      const files = globSync(join(gradleShots, "*", name));
      if (files.length !== 1) throw new Error(`Expected one Gradle screenshot for ${name}, got ${files.length}`);
      copyFileSync(files[0]!, path);
    }
  }
} finally {
  command("adb", ["shell", "cmd", "uimode", "night", "no"]);
}
compare("android", shots);
