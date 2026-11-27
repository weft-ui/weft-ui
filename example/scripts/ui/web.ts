import assert from "node:assert/strict";
import { chromium } from "playwright";
import { preview } from "vite";

const base = "http://127.0.0.1:4180";
const server = await preview({
  build: { outDir: "apps/web" },
  preview: { host: "127.0.0.1", port: 4180, strictPort: true },
});
try {
  const browser = await chromium.launch();
  try {
    // A fresh context gives the app a cold launch and empty storage.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.goto(`${base}/`);
      await page.getByText("Latest notes", { exact: true }).waitFor();
      for (const [name, content] of [
        ["发现", "Find inspiration for your next walk."],
        ["消息", "Updates from your trail community."],
        ["我的", "Hiking notes from the North Coast"],
        ["首页", "Latest notes"],
      ]) {
        const tab = page.getByRole("tab", { name: new RegExp(`^${name}`) });
        await tab.click();
        await page.getByText(content, { exact: true }).waitFor();
        assert.equal(await tab.getAttribute("aria-selected"), "true");
      }

      await page.getByText(/^NOTE 1\s+\//).click();
      await page.getByText("Trail comments (2)", { exact: true }).waitFor();
      await page.keyboard.press("Alt+ArrowLeft");
      await page.getByText("Latest notes", { exact: true }).waitFor();

      await page.getByRole("button", { name: "发布", exact: true }).first().click();
      await page.getByRole("dialog").getByText("Publish a note", { exact: true }).waitFor();
      await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByText("Latest notes", { exact: true }).waitFor();

      await page.getByRole("tab", { name: "我的", exact: true }).click();
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await page.getByRole("dialog").getByText("Welcome back to your journal.", { exact: true }).waitFor();
      await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Clear cache", exact: true }).click();
      const confirm = page.getByRole("dialog");
      await confirm.getByText("Clear cached data?", { exact: true }).waitFor();
      await confirm.getByRole("button", { name: "Clear", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Cache cleared" }).waitFor();

      // Enter the existing catalog through Discover, then open and return from an entry.
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await page.getByRole("tab", { name: "发现", exact: true }).click();
      await page.getByRole("button", { name: "组件画廊", exact: true }).click();
      await page.getByRole("button", { name: "page:hello", exact: true }).click();
      await page.getByText("Hello, Weft", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await page.getByRole("button", { name: "page:hello", exact: true }).waitFor();
    } finally {
      await page.close();
    }

    // A separate context ensures that the deep link is a genuine cold launch.
    const deep = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await deep.goto(`${base}/notes/3`);
      await deep.getByText("Trail comments (2)", { exact: true }).waitFor();
      assert.equal(new URL(deep.url()).pathname, "/notes/3");
      await deep.keyboard.press("Alt+ArrowLeft");
      await deep.getByText("Latest notes", { exact: true }).waitFor();
      assert.equal(new URL(deep.url()).pathname, "/feed");

      // Jump to each loaded end; the virtual list must request more rows repeatedly.
      const list = deep.locator(".w-virtual-spacer:visible").locator("..");
      const row500 = deep.getByText(/^NOTE 500\s+\//);
      for (let attempt = 0; attempt < 40 && !(await row500.isVisible()); attempt++) {
        const height = await list.evaluate((element) => {
          const height = element.scrollHeight;
          element.scrollTop = height;
          return height;
        });
        await deep.waitForFunction((previous) => {
          const spacer = document.querySelector<HTMLElement>(".w-page:not([hidden]) .w-virtual-spacer");
          return !!spacer && (spacer.parentElement!.scrollHeight > previous || /NOTE 500\s+\//.test(spacer.textContent ?? ""));
        }, height, { timeout: 5000 });
      }
      await row500.waitFor({ state: "visible" });
      await row500.scrollIntoViewIfNeeded();
    } finally {
      await deep.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  server.httpServer.close((error) => error ? reject(error) : resolve());
  await promise;
}
