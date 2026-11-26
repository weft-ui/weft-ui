import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { Platform } from "../pages.ts";
import type { Shot } from "./cases.ts";

const maxDifference = 0.001;

export function compare(platform: Platform, shots: Shot[]): void {
  const baselineDir = join("screenshots", "baseline", platform);
  const diffDir = join("screenshots", "diff", platform);
  const update = process.env.WEFT_UPDATE_SNAPSHOTS === "1";
  for (const { name, path } of shots) {
    const baseline = join(baselineDir, name);
    const diffPath = join(diffDir, name);
    rmSync(diffPath, { force: true });
    if (update) {
      mkdirSync(baselineDir, { recursive: true });
      copyFileSync(path, baseline);
      console.log(`Updated ${baseline}`);
      continue;
    }
    if (!existsSync(baseline)) {
      console.error(`Missing ${baseline}. Run with WEFT_UPDATE_SNAPSHOTS=1 to record it.`);
      process.exitCode = 1;
      continue;
    }

    const expected = PNG.sync.read(readFileSync(baseline));
    const actual = PNG.sync.read(readFileSync(path));
    const { width, height } = actual;
    if (width !== expected.width || height !== expected.height) {
      // No pixel-to-pixel comparison is possible; show the two images side by side.
      const diff = new PNG({ width: expected.width + width, height: Math.max(expected.height, height), fill: true });
      PNG.bitblt(expected, diff, 0, 0, expected.width, expected.height, 0, 0);
      PNG.bitblt(actual, diff, 0, 0, width, height, expected.width, 0);
      mkdirSync(diffDir, { recursive: true });
      writeFileSync(diffPath, PNG.sync.write(diff));
      console.error(`${platform}/${name}: expected ${expected.width}×${expected.height}, got ${width}×${height}; see ${diffPath}`);
      process.exitCode = 1;
      continue;
    }

    const diff = new PNG({ width, height });
    const ratio = pixelmatch(expected.data, actual.data, diff.data, width, height, { threshold: 0.1 }) / (width * height);
    if (ratio > maxDifference) {
      mkdirSync(diffDir, { recursive: true });
      writeFileSync(diffPath, PNG.sync.write(diff));
      console.error(`${platform}/${name}: ${(ratio * 100).toFixed(3)}% differs (limit 0.1%); see ${diffPath}`);
      process.exitCode = 1;
    } else {
      console.log(`${platform}/${name}: ${(ratio * 100).toFixed(3)}% differs`);
    }
  }
}
