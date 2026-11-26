import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build, command, prepareShots } from "./cases.ts";

const { directory, shots } = prepareShots("windows");
if (shots.length === 0) process.exit(0);

if (process.platform === "win32") {
  build("windows");
  command("dotnet", ["test", "apps/windows/UITests", "--filter", "FullyQualifiedName~Screenshots", "-nologo"], {
    env: {
      ...process.env,
      WEFT_PAGES: shots.map(({ id, scheme }) => `${id}:${scheme}`).join(","),
      WEFT_SHOT_DIR: directory,
    },
  });
} else if (process.platform === "darwin") {
  command("/tmp/weft-win.sh", ["/tmp/win-sync.ps1"]);
  const pages = [...new Set(shots.map(({ id }) => id))].join(",");
  const temporary = mkdtempSync(join(tmpdir(), "weft-win-shot-"));
  try {
    const path = join(temporary, "shot.ps1");
    const script = readFileSync(resolve("scripts/shot/windows.ps1"), "utf8");
    writeFileSync(path, `$env:WEFT_SHOT_PAGES = '${pages}'\n${script}`);
    command("/tmp/weft-win.sh", [path]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
} else {
  throw new Error("Run shot:windows on Windows or from macOS through /tmp/weft-win.sh");
}
for (const { path } of shots) {
  if (!existsSync(path)) throw new Error(`Missing screenshot: ${path}`);
}
