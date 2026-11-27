import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import automator from "miniprogram-automator";
import type Element from "miniprogram-automator/out/Element.js";
import type { ScrollViewElement } from "miniprogram-automator/out/Element.js";
import type Page from "miniprogram-automator/out/Page.js";

// Run from example after build:wechat; DevTools must be signed in with its service port enabled.
const cliPath = process.env.WEFT_WECHAT_CLI
  ?? (process.platform === "darwin" ? "/Applications/wechatwebdevtools.app/Contents/MacOS/cli" : undefined);
if (!cliPath || !existsSync(cliPath)) throw new Error("Set WEFT_WECHAT_CLI to the WeChat DevTools command-line executable");
const miniProgram = await automator.launch({ cliPath, projectPath: resolve("apps/wechat") });

async function current(slug: string): Promise<Page> {
  const deadline = Date.now() + 5000;
  do {
    const page = await miniProgram.currentPage();
    if (page?.path.replace(/^\//, "").endsWith(`weft/pages/${slug}/index`)) {
      await page.waitFor("#weft");
      return page;
    }
    await setTimeout(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${slug}`);
}

async function findText(page: Page, text: string, root = "#weft"): Promise<Element | undefined> {
  const view = await page.$(root);
  if (!view) return undefined;
  const elements: Element[] = await view.$$("text");
  for (const element of elements) if ((await element.text()).trim() === text) return element;
  return undefined;
}

async function text(page: Page, label: string, root = "#weft"): Promise<Element> {
  const deadline = Date.now() + 5000;
  do {
    const element = await findText(page, label, root);
    if (element) return element;
    await setTimeout(100);
  } while (Date.now() < deadline);
  throw new Error(`Missing ${JSON.stringify(label)} in ${root} on ${page.path}`);
}

async function absent(page: Page, label: string, root: string): Promise<void> {
  const deadline = Date.now() + 5000;
  do {
    if (!await findText(page, label, root)) return;
    await setTimeout(100);
  } while (Date.now() < deadline);
  throw new Error(`Still showing ${JSON.stringify(label)} in ${root}`);
}

async function tapButton(page: Page, label: string, root = "#weft"): Promise<void> {
  const deadline = Date.now() + 5000;
  do {
    const view = await page.$(root);
    const buttons: Element[] = view ? await view.$$("button") : [];
    for (const button of buttons) {
      if ((await button.text()).trim() !== label) continue;
      const scroll = await view!.$("scroll-view") as ScrollViewElement | null;
      if (scroll) {
        const top = Number((await button.offset()).top) - Number((await scroll.offset()).top);
        if (top < 0 || top + Number((await button.size()).height) > Number((await scroll.size()).height)) {
          await scroll.scrollTo(0, Math.max(0, top));
        }
      }
      await button.tap();
      return;
    }
    await setTimeout(100);
  } while (Date.now() < deadline);
  throw new Error(`Missing button ${JSON.stringify(label)} in ${root} on ${page.path}`);
}

try {
  await miniProgram.callWxMethod("clearStorageSync");
  await miniProgram.reLaunch("/weft/pages/feed/index");
  let page = await current("feed");
  await text(page, "Latest notes");

  for (const [slug, label] of [["discover", "Find inspiration for your next walk."], ["inbox", "Updates from your trail community."], ["me", "Mara Chen"], ["feed", "Latest notes"]]) {
    await miniProgram.switchTab(`/weft/pages/${slug}/index`);
    page = await current(slug);
    await text(page, label);
    if (slug === "discover") {
      await tapButton(page, "组件画廊");
      const catalog = await current("catalog");
      await tapButton(catalog, "page:hello");
      await current("hello-page");
      await miniProgram.navigateBack();
      await current("catalog");
      await miniProgram.navigateBack();
      await current("discover");
    }
  }

  await (await text(page, "NOTE 1  /  MOUNTAINS  /  6 MIN READ")).tap();
  page = await current("detail");
  await text(page, "The long way up Juniper Ridge");
  await miniProgram.navigateBack();
  page = await current("feed");
  await text(page, "Latest notes");

  await tapButton(page, "发布");
  await text(page, "Publish a note", "#modal");
  await tapButton(page, "Cancel", "#modal");
  await absent(page, "Publish a note", "#modal");
  await text(page, "Latest notes");

  await miniProgram.switchTab("/weft/pages/me/index");
  page = await current("me");
  await tapButton(page, "Log in");
  await text(page, "Welcome back to your journal.", "#modal");
  await tapButton(page, "Cancel", "#modal");
  await absent(page, "Welcome back to your journal.", "#modal");
  await text(page, "Mara Chen");
  await tapButton(page, "Settings");
  page = await current("social-settings");
  await tapButton(page, "Clear cache");
  await miniProgram.native().confirmModal();
  // Native toast overlays are not exposed by miniprogram-automator's selector API.
  // Confirmation is exercised, but the transient toast cannot be asserted here.
  await text(page, "Make your journal your own.");

  // WeChat deep links address the generated page, with route parameters in the query.
  // reLaunch resets the host page stack but does not restart the DevTools process.
  await miniProgram.reLaunch("/weft/pages/detail/index?id=3");
  page = await current("detail");
  assert.equal(String(page.query.id), "3");
  await text(page, "The long way up Juniper Ridge");
  // A relaunched non-tab page has no native back stack. DevTools' native
  // goHome did not return to Feed in DevTools, so switchTab exercises the destination.
  await miniProgram.switchTab("/weft/pages/feed/index");
  page = await current("feed");
  await text(page, "Latest notes");

  const view = await page.$("#weft");
  const list = await view?.$("scroll-view") as ScrollViewElement | null;
  if (!list) throw new Error("Feed has no scroll-view");
  // Each trip to the end requests another 50 notes; wait for virtualized rows.
  let row500 = false;
  for (let i = 0; i < 20 && !row500; i++) {
    await list.scrollTo(0, 100_000_000);
    await setTimeout(300);
    row500 = Boolean(await findText(page, "NOTE 500  /  COAST  /  4 MIN READ"));
  }
  assert.ok(row500, "Feed did not load and render row 500");
  console.log("WeChat UI flows passed");
} finally {
  await miniProgram.close();
}
