import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { linuxAdapter } from "../src/linux.ts";

test("writes and removes the Linux scheme registration", () => {
  const project = mkdtempSync(join(tmpdir(), "weft linux "));
  const generated = join(project, "weft");
  mkdirSync(generated);
  try {
    const adapter = linuxAdapter(async () => {}, "/shell");
    adapter.writeGlue(generated, project, { scheme: "weftexample" });
    const desktop = readFileSync(join(generated, "app.desktop"), "utf8");
    expect(desktop).toContain("MimeType=x-scheme-handler/weftexample;\n");
    expect(desktop).toContain(`Exec="${join(project, "build/app")}" %u\n`);
    adapter.writeGlue(generated, project, {});
    expect(() => readFileSync(join(generated, "app.desktop"))).toThrow();
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
