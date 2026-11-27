// @vitest-environment node
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { createServer } from "vite";
import { expect, test } from "vitest";

test("virtual sections pin their header and refresh only for coarse touch", async () => {
  const server = await createServer({ root: fileURLToPath(new URL("../../", import.meta.url)), configFile: false, logLevel: "silent", server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ hasTouch: true });
    const port = (server.httpServer!.address() as AddressInfo).port;
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.addScriptTag({ type: "module", content: `
      import { LazyList, Row } from "/packages/runtime/src/index.ts";
      const scroll = document.createElement("div");
      scroll.id = "sections"; scroll.style.cssText = "height:200px;width:300px;overflow:auto";
      document.body.appendChild(scroll);
      const anchor = document.createComment(""); scroll.appendChild(anchor);
      const make = (value) => { const row = new Row(1, 0, 0, value); const f = document.createDocumentFragment(); const el = document.createElement("div"); el.textContent = String(value); el.style.height = "40px"; f.appendChild(el); row.init(f); return row; };
      window.refreshes = 0;
      window.ends = 0;
      const list = new LazyList(anchor, s => make(s.id), s => s.id, 1, {
        stickyHeaders: true, onRefresh: () => window.refreshes++, onEndReached: () => window.ends++,
        sections: { rows: s => s.rows, rowKey: (_, item) => item, createRow: (s, item) => { const row = make(item); row.setSection = () => {}; return row; } }
      });
      window.testList = list;
      list.set([{id:"A", rows:Array.from({length:100},(_,i)=>i)}, {id:"B", rows:[101]}]);
    ` });
    const list = page.locator("#sections");
    await list.evaluate(el => { el.scrollTop = 1200; });
    await expect.poll(() => list.locator(".w-virtual-item").first().evaluate(el => el.getBoundingClientRect().top)).toBeCloseTo(await list.evaluate(el => el.getBoundingClientRect().top), 0);
    expect(await list.locator(".w-virtual-item").first().textContent()).toBe("A");
    expect(await list.locator(".w-virtual-item").count()).toBeLessThan(30);
    await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect.poll(() => page.evaluate(() => (window as unknown as { ends: number }).ends)).toBe(1);
    await list.evaluate(el => { el.dispatchEvent(new Event("scroll")); });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => (window as unknown as { ends: number }).ends)).toBe(1);
    await list.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new CustomEvent("weft-refresh")); });
    expect(await page.evaluate(() => (window as unknown as { refreshes: number }).refreshes)).toBe(1);
    expect(await list.locator(".w-refresh-indicator").count()).toBe(0);
    await list.evaluate(el => {
      const start = new Touch({ identifier: 1, target: el, clientY: 10 });
      const end = new Touch({ identifier: 1, target: el, clientY: 100 });
      el.dispatchEvent(new TouchEvent("touchstart", { touches: [start] }));
      el.dispatchEvent(new TouchEvent("touchend", { changedTouches: [end] }));
    });
    expect(await page.evaluate(() => (window as unknown as { refreshes: number }).refreshes)).toBe(2);
    await page.evaluate(() => (window as unknown as { testList: { setRefreshing(value: boolean): void } }).testList.setRefreshing(true));
    expect(await list.locator(".w-refresh-indicator").count()).toBe(1);
    await page.evaluate(() => (window as unknown as { testList: { setRefreshing(value: boolean): void } }).testList.setRefreshing(false));
    expect(await list.locator(".w-refresh-indicator").count()).toBe(0);
  } finally {
    await browser.close();
    await server.close();
  }
}, 15_000);

test("virtual list scrolls through 10,000 items without mounting them all", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    configFile: false,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const port = (server.httpServer!.address() as AddressInfo).port;
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.addScriptTag({ type: "module", content: `
      import { LazyList, Row } from "/packages/runtime/src/index.ts";
      const template = document.createElement("template");
      template.innerHTML = '<div id="list" style="height:400px;width:300px;overflow:auto"></div>';
      const fragment = template.content.cloneNode(true);
      const scroll = fragment.firstChild;
      const anchor = document.createComment("");
      scroll.appendChild(anchor);
      const list = new LazyList(anchor, (item) => {
        const row = new Row(1, 0, 0, item);
        const fragment = document.createDocumentFragment();
        const element = document.createElement("div");
        element.textContent = "Row " + item;
        element.style.height = (36 + item % 3 * 8) + "px";
        fragment.appendChild(element);
        row.init(fragment);
        return row;
      }, (item) => item);
      list.set(Array.from({ length: 10_000 }, (_, i) => i));
      document.body.appendChild(fragment);
    ` });
    const list = page.locator("#list");
    await list.locator(".w-virtual-item").first().waitFor();
    await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => list.locator(".w-virtual-item").last().textContent()).toBe("Row 9999");
    expect(await list.locator(".w-virtual-item").count()).toBeLessThan(200);
  } finally {
    await browser.close();
    await server.close();
  }
}, 15_000);
