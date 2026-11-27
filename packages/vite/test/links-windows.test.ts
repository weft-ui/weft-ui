// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { windowsAdapter } from "../src/windows.ts";
import type { RunTool } from "../src/native.ts";

test("Windows glue embeds the configured protocol and clears it when removed", () => {
  const dir = mkdtempSync(join(tmpdir(), "weft-windows-links-"));
  try {
    const adapter = windowsAdapter((async () => {}) as RunTool, dir);
    adapter.writeGlue(dir, dir, { scheme: "weftexample" });
    expect(readFileSync(join(dir, "WeftLinks.cs"), "utf8")).toContain('Scheme = "weftexample"');
    adapter.writeGlue(dir, dir, {});
    expect(readFileSync(join(dir, "WeftLinks.cs"), "utf8")).toContain("Scheme = null");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
