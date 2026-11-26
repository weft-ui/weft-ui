import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build, command, prepareShots } from "./cases.ts";

const { shots } = prepareShots("macos");
if (shots.length === 0) process.exit(0);

build("macos", { ...process.env, WEFT_NATIVE: "0" });
// Export attachments on the host because the macOS runner cannot write outside its container.
const result = resolve("apps/macos/build/screenshots.xcresult");
rmSync(result, { recursive: true, force: true });
command("xcodebuild", ["test", "-project", "apps/macos/App.xcodeproj", "-scheme", "App",
  "-destination", "platform=macOS", "-derivedDataPath", "apps/macos/build", "-parallel-testing-enabled", "NO",
  "-only-testing:UITests/Screenshots/testPages", "-resultBundlePath", result, "-quiet"], {
  env: { ...process.env, TEST_RUNNER_WEFT_PAGES: shots.map(({ id, scheme }) => `${id}:${scheme}`).join(",") },
});

const directory = mkdtempSync(join(tmpdir(), "weft-macos-shots-"));
try {
  command("xcrun", ["xcresulttool", "export", "attachments", "--path", result, "--output-path", directory, "--filter", "*.png"]);
  interface Attachment { suggestedHumanReadableName: string; exportedFileName: string }
  const tests: { attachments: Attachment[] }[] = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  const attachments = tests.flatMap((test) => test.attachments);
  for (const { name, path } of shots) {
    const prefix = `weft-${name.slice(0, -4)}_`;
    const attachment = attachments.find(({ suggestedHumanReadableName }) => suggestedHumanReadableName.startsWith(prefix));
    if (!attachment) throw new Error(`Missing screenshot attachment for ${name}`);
    copyFileSync(join(directory, attachment.exportedFileName), path);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
