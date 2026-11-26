import { setTimeout } from "node:timers/promises";
import { chromium } from "playwright";
import { preview } from "vite";
import { build, prepareShots, settleMs } from "./cases.ts";
import { compare } from "./compare.ts";

build("web");
const { shots } = prepareShots("web");
const server = await preview({
  build: { outDir: "apps/web" },
  preview: { host: "127.0.0.1", port: 4179, strictPort: true },
});
try {
  const browser = await chromium.launch();
  try {
    for (const { id, scheme, path } of shots) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        colorScheme: scheme,
      });
      try {
        await page.goto("http://127.0.0.1:4179/");
        await page.getByRole("button", { name: `page:${id}`, exact: true }).click();
        await setTimeout(settleMs);
        await page.screenshot({ path });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  server.httpServer.close((error) => error ? reject(error) : resolve());
  await promise;
}
compare("web", shots);
