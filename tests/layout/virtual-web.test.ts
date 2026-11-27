// @vitest-environment node
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { createServer } from "vite";
import { expect, test } from "vitest";

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
