import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { writeAppleLinks } from "../src/apple.ts";

test("generates Apple URL registrations and associated domains", () => {
  const dir = mkdtempSync(join(tmpdir(), "weft-apple-links-"));
  try {
    writeAppleLinks(dir, { scheme: "weft", hosts: ["example.com", "a&b.example"] });
    expect(readFileSync(join(dir, "Info.plist"), "utf8")).toContain("<string>weft</string>");
    const entitlements = readFileSync(join(dir, "App.entitlements"), "utf8");
    expect(entitlements).toContain("com.apple.developer.associated-domains");
    expect(entitlements).toContain("applinks:example.com");
    expect(entitlements).toContain("applinks:a&amp;b.example");
    writeAppleLinks(dir, {});
    expect(readFileSync(join(dir, "Info.plist"), "utf8")).not.toContain("CFBundleURLTypes");
    expect(readFileSync(join(dir, "App.entitlements"), "utf8")).not.toContain("associated-domains");
    writeAppleLinks(dir, { scheme: "weft", hosts: [] });
    expect(readFileSync(join(dir, "App.entitlements"), "utf8")).not.toContain("associated-domains");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
