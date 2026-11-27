import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { nativeAdapter } from "../src/native.ts";

for (const links of [{ scheme: "weftexample" }, { scheme: "weftexample", hosts: ["example.com", "other.example"] }, {}]) {
  test(`generates Android deep-link registration for ${JSON.stringify(links)}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "weft-android-links-"));
    try {
      nativeAdapter("android", dir).writeGlue(dir, dir, links);
      const manifest = readFileSync(join(dir, "src/main/AndroidManifest.xml"), "utf8");
      const activity = readFileSync(join(dir, "src/main/kotlin/net/mioyi/weftui/generated/WeftLinkActivity.kt"), "utf8");
      if ("scheme" in links) {
        expect(manifest).toContain('android:scheme="weftexample"');
        expect(manifest).toContain('android:theme="@android:style/Theme.NoDisplay"');
        expect(manifest).toContain('android:name="android.intent.action.VIEW"');
        expect(manifest).toContain('android:name="android.intent.category.BROWSABLE"');
        expect(manifest).toContain('android:name="android.intent.category.DEFAULT"');
        expect(manifest).toContain('android:exported="true"');
      } else expect(manifest).not.toContain("<activity");
      if ("hosts" in links) {
        expect(manifest.match(/android:autoVerify="true"/g)).toHaveLength(2);
        for (const host of links.hosts!) expect(manifest).toContain(`android:scheme="https" android:host="${host}"`);
      } else expect(manifest).not.toContain("autoVerify");
      expect(activity).toContain("getLaunchIntentForPackage(packageName)");
      expect(activity).toContain("Intent.FLAG_ACTIVITY_SINGLE_TOP");
      expect(activity).toContain("launch.data = intent.data");
      expect(activity).toContain("finish()");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
