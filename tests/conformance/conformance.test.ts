/**
 * Protocol conformance: every fixture runs its script on the headless
 * renderer, the mini program and the Web. After every step all platforms
 * must render the same neutral tree and their host handlers must have seen
 * the same events. The headless renderer's ops are compared with the
 * fixture's golden file; run with `WEFT_UPDATE_SNAPSHOTS=1` to rewrite them.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { type AppLike, type Driver, type Script, buildFixture, headless, web, wechat } from "./harness.ts";
import { script as board } from "../fixtures/board/script.ts";
import { script as controls } from "../fixtures/controls/script.ts";
import { script as gallery } from "../fixtures/gallery/script.ts";
import { script as inputs } from "../fixtures/inputs/script.ts";
import { script as language } from "../fixtures/language/script.ts";
import { script as navigation } from "../fixtures/navigation/script.ts";
import { script as tap } from "../fixtures/tap/script.ts";
import { script as theme } from "../fixtures/theme/script.ts";
import { script as todo } from "../fixtures/todo/script.ts";

const fixtures: [string, Script<AppLike>][] = [
  ["todo", todo as unknown as Script<AppLike>],
  ["board", board as unknown as Script<AppLike>],
  ["controls", controls as unknown as Script<AppLike>],
  ["gallery", gallery as unknown as Script<AppLike>],
  ["inputs", inputs as unknown as Script<AppLike>],
  ["language", language as unknown as Script<AppLike>],
  ["navigation", navigation as unknown as Script<AppLike>],
  ["tap", tap as unknown as Script<AppLike>],
  ["theme", theme as unknown as Script<AppLike>],
];

test.each(fixtures)("%s renders alike on every platform and matches its golden ops", async (name, script) => {
  const built = await buildFixture(script);
  const renderer = headless(script, built);
  const drivers: Driver<AppLike>[] = [renderer, await wechat(script, built), web(script)];
  const golden: string[] = [];
  let seen = 0;

  const check = (step: string) => {
    const [reference, ...others] = drivers;
    for (const driver of others) {
      expect(driver.tree(), `${driver.name} after "${step}"`).toEqual(reference!.tree());
      expect(driver.log, `${driver.name} events after "${step}"`).toEqual(reference!.log);
    }
    const batches = renderer.renderer.batches.slice(seen);
    seen = renderer.renderer.batches.length;
    golden.push(`# ${step}`);
    golden.push(...(batches.length === 0 ? ["(no ops)"] : batches.map((lines) => lines.join("\n"))));
    golden.push("");
  };

  try {
    for (const driver of drivers) await driver.settle();
    check("mount");
    for (const step of script.steps) {
      for (const driver of drivers) {
        (driver.app as AppLike & { $activate?(): void }).$activate?.();
        step.run(driver, driver.app.model);
        await driver.settle();
      }
      check(step.name);
    }
    if (name === "controls") expect(renderer.log).toEqual(["switch true", "slider 45", "picker 0", "note First\nSecond", "picker 1"]);
    if (name === "inputs") expect(renderer.log).toEqual(["draft abcde", "submit", "focus true", "note a😀bc", "note abcd", "focus false"]);
    if (name === "language") expect(renderer.log).toEqual(["Rated 1", "Rated 2", "Rated 4", "Rated 5"]);
    if (name === "tap") expect(renderer.log).toEqual(["row", "button", "text", "image"]);
    if (name === "navigation") expect(renderer.log).toEqual([
      "home show", "home hide", "detail 1 show", "detail 1 hide", "home show",
      "home hide", "detail 1 show", "detail 1 hide", "detail 2 show", "detail 2 hide", "home show",
      "home hide", "settings show", "settings hide", "home show", "home hide", "detail 1 show", "detail 1 hide", "settings show",
    ]);
    for (const driver of drivers) driver.app.unmount();
  } finally {
    for (const driver of drivers) driver.dispose?.();
    await rm(built.out, { recursive: true, force: true });
  }

  const path = join(import.meta.dirname, `./golden/${name}.ops`);
  const text = golden.join("\n");
  if (process.env.WEFT_UPDATE_SNAPSHOTS) writeFileSync(path, text);
  else expect(text, `golden/${name}.ops (run with WEFT_UPDATE_SNAPSHOTS=1 to update)`).toBe(readFileSync(path, "utf8"));
});
