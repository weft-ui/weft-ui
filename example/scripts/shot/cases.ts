import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pages, type Platform } from "../pages.ts";

export const settleMs = 1000;

export interface Shot {
  id: string;
  link: string;
  scheme: "light" | "dark";
  name: string;
  path: string;
}

export function prepareShots(platform: Platform): { directory: string; shots: Shot[] } {
  const directory = resolve("screenshots", "actual", platform);
  mkdirSync(directory, { recursive: true });
  const shots: Shot[] = [];
  // WEFT_SHOT_PAGES=a,b limits a run to those page ids (for example, the page a change affects).
  const only = process.env.WEFT_SHOT_PAGES?.split(",").filter(Boolean);
  const selected = pages(platform).filter(({ id }) => !only?.length || only.includes(id));
  if (only?.length && selected.length !== only.length) {
    throw new Error(`Unknown or unavailable page in WEFT_SHOT_PAGES=${only.join(",")} for ${platform}`);
  }
  for (const { id, link, dark } of selected) {
    shots.push({ id, link, scheme: "light", name: `${id}.png`, path: join(directory, `${id}.png`) });
    if (dark) {
      shots.push({ id, link, scheme: "dark", name: `${id}-dark.png`, path: join(directory, `${id}-dark.png`) });
    }
  }
  for (const { path } of shots) rmSync(path, { force: true });
  return { directory, shots };
}

export function command(executable: string, args: string[], options: ExecFileSyncOptions = {}): void {
  execFileSync(executable, args, { stdio: "inherit", ...options });
}

export function build(platform: Platform, env = process.env): void {
  const pnpm = process.env.npm_execpath;
  if (!pnpm) throw new Error(`Run this driver with pnpm --filter example shot:${platform}`);
  command(process.execPath, [pnpm, "run", `build:${platform}`], { env });
}
