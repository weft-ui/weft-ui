/**
 * Bundles every conformance fixture for the native kernel with
 * `@weft-ui/vite`, exactly like `WEFT_PLATFORM=android vite build`, and copies `bundle.hbc` and
 * `layout.json` to `<out>/<fixture>/`. Run by CTest (native/core/tests).
 *
 *   node tests/conformance/native/build.ts <out>
 */

import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import weft from "@weft-ui/vite";
import { createBuilder } from "vite";

if (process.argv.length !== 3) {
  console.error("usage: node tests/conformance/native/build.ts <out>");
  process.exit(2);
}
const out = resolve(process.argv[2]!);
const fixtures = join(import.meta.dirname, "../../fixtures").replaceAll("\\", "/");
const driver = join(import.meta.dirname, "driver.ts").replaceAll("\\", "/");
// Android supports list refresh, unlike desktop targets, so its bundle retains
// the refresh bindings that the platform-independent kernel must exercise.
process.env.WEFT_PLATFORM = "android";
// Only the bundle is needed, not the app's CMake project.
process.env.WEFT_NATIVE = "0";
for (const name of readdirSync(fixtures)) {
  const root = mkdtempSync(join(tmpdir(), `weft-native-${name}-`));
  try {
    writeFileSync(
      join(root, "index.ts"),
      `import { playNative } from ${JSON.stringify(driver)};\n` +
        `import { script } from ${JSON.stringify(`${fixtures}/${name}/script.ts`)};\n` +
        "playNative(script);\n",
    );
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: "error",
      plugins: [weft({ platforms: ["android"], include: `${fixtures}/${name}/*.weft`, entry: "index.ts", dts: false })],
    });
    await builder.buildApp();
    const generated = join(root, "apps/android/weft");
    mkdirSync(join(out, name), { recursive: true });
    cpSync(join(generated, "src/main/assets/weft/bundle.hbc"), join(out, name, "bundle.hbc"));
    cpSync(join(generated, "layout.json"), join(out, name, "layout.json"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
