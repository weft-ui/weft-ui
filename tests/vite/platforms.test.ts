// @vitest-environment node
import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { compileApp } from "@weft-ui/compiler";
import { CSS } from "@weft-ui/runtime/elements";
import { PLATFORMS } from "@weft-ui/runtime/protocol";
import weft, { type WeftOptions } from "@weft-ui/vite";
import { Window } from "happy-dom";
import { chromium } from "playwright";
import { createBuilder, preview } from "vite";
import { afterEach, beforeEach, expect, test } from "vitest";
import { launch } from "../src/miniprogram.ts";

const WEFT_ANDROID = fileURLToPath(new URL("../../native/android", import.meta.url));
const WEFT_LINUX = fileURLToPath(new URL("../../native/linux", import.meta.url));
const WEFT_WINUI = fileURLToPath(new URL("../../native/windows", import.meta.url));

const APP = `model Model {
    clicked: Bool,
    tint: String
}

event Click
event Mount

component App(model: Model) {
    Column(onMount = Mount) {
        if (model.clicked) {
            Text("You clicked!")
        } else {
            Text("Hello, world!")
        }
        Text("tinted", color = model.tint)
        Button(onClick = Click) {
            Text("Click me")
        }
    }
}
`;

const INDEX = `import { App } from "./App.weft";
import { platform, run, storage } from "@weft-ui/platform";

const app = new App({ clicked: false, tint: "red" });
app.onMount(async (model) => {
  model.clicked = (await storage.get("clicked")) === "true";
});
app.onClick((model) => {
  model.clicked = true;
  void storage.set("clicked", "true");
  void storage.set("os", platform.os);
});
run(app);
`;

const HTML = `<!doctype html>
<html><body><div id="app"></div><script type="module" src="/src/index.ts"></script></body></html>
`;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "weft-vite-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/App.weft"), APP);
  await writeFile(join(root, "src/index.ts"), INDEX);
  await writeFile(join(root, "index.html"), HTML);
  // The project resolves @weft-ui/platform and @weft-ui/runtime through this package's dependencies.
  const modules = realpathSync(fileURLToPath(new URL("../node_modules", import.meta.url)));
  await symlink(modules, join(root, "node_modules"), "junction");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function build(platform: string | undefined, options: WeftOptions = {}) {
  const previous = process.env.WEFT_PLATFORM;
  if (platform === undefined) delete process.env.WEFT_PLATFORM;
  else process.env.WEFT_PLATFORM = platform;
  try {
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [weft({
        platforms: PLATFORMS.filter((platform) => platform === "web" || platform === "wechat"),
        app: { id: "com.example.test", name: "Test \"App\"" },
        ...options,
      })],
    });
    await builder.buildApp();
  } finally {
    if (previous === undefined) delete process.env.WEFT_PLATFORM;
    else process.env.WEFT_PLATFORM = previous;
  }
}

/**
 * Lets the first flush and the storage round trips of a launched app run.
 * The bundle carries its own runtime copy, so there is no promise to await;
 * zero-delay macrotasks drain its microtask chains.
 */
async function settle() {
  for (let i = 0; i < 3; i++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve);
    await promise;
  }
}

/** The `wx` storage and request APIs, backed by a map. */
function fakeWx() {
  const stored = new Map<string, string>();
  type Callbacks = { key: string; data?: string; success?(result: object): void; fail?(error: object): void };
  return {
    stored,
    getStorage({ key, success, fail }: Callbacks) {
      if (stored.has(key)) success?.({ data: stored.get(key) });
      else fail?.({ errMsg: "getStorage:fail data not found" });
    },
    setStorage({ key, data, success }: Callbacks) {
      stored.set(key, data!);
      success?.({});
    },
    removeStorage({ key, success }: Callbacks) {
      stored.delete(key);
      success?.({});
    },
  };
}

test("an unset WEFT_PLATFORM builds the Web app into apps/web", async () => {
  await build(undefined);
  expect(existsSync(join(root, "apps/wechat"))).toBe(false);
  const html = await readFile(join(root, "apps/web/index.html"), "utf8");
  const script = /src="\/(assets\/[^"]+\.js)"/.exec(html)![1]!;

  const window = new Window();
  const { document } = window;
  document.body.innerHTML = '<div id="app"></div>';
  window.localStorage.setItem("clicked", "true");
  // The entry chunk has no imports; run it as a classic script in the window's context.
  window.eval(await readFile(join(root, "apps/web", script), "utf8"));
  await settle();
  const spans = [...document.querySelectorAll("#app span")];
  expect(spans.map((span) => span.textContent)).toEqual(["You clicked!", "tinted", "Click me"]);
  expect(spans[1]!.getAttribute("style")).toMatch(/color:\s*transparent/);
  await window.happyDOM.close();
});

test("safeArea: false opts out of root padding and changes the layout hash", async () => {
  await build("web,wechat", { safeArea: false });

  const html = await readFile(join(root, "apps/web/index.html"), "utf8");
  const script = /src="\/(assets\/[^"]+\.js)"/.exec(html)![1]!;
  const window = new Window();
  try {
    window.document.body.innerHTML = '<div id="app"></div>';
    window.eval(await readFile(join(root, "apps/web", script), "utf8"));
    await settle();
    expect(window.document.querySelector("#app.w-root:not(.w-safe)")).not.toBeNull();
  } finally {
    await window.happyDOM.close();
  }

  const wxml = await readFile(join(root, "apps/wechat/weft/index.wxml"), "utf8");
  expect(wxml).toContain('class="w-root"');
  expect(wxml).not.toContain("w-safe");

  const defaults = await compileApp(["App.weft"], "wechat", () => APP);
  const optedOut = await compileApp(["App.weft"], "wechat", () => APP, { safeArea: false });
  expect(JSON.parse(defaults.layout).safeArea).toBe(true);
  expect(JSON.parse(optedOut.layout).safeArea).toBe(false);
  expect(optedOut.layoutHash).not.toBe(defaults.layoutHash);
});

async function writeThemeFixture() {
  await writeFile(join(root, "src/Palette.weft"), `theme { accent = "#0a84ff" dark "#409cff" }`);
  await writeFile(join(root, "src/Styles.weft"), `
import "./Palette.weft"
style Accent { color = theme.accent }
`);
  await writeFile(join(root, "src/App.weft"), `
import "./Styles.weft"
model Model { tint: Color, unknown: Color }
component App(model: Model) {
  Text("accent", style = Accent)
  Text("dynamic", color = model.tint)
  Text("unknown", color = model.unknown)
}
`);
  await writeFile(join(root, "src/index.ts"), `
import { App } from "./App.weft";
import { run } from "@weft-ui/platform";
run(new App({ tint: "@accent", unknown: "@notRegistered" }));
`);
}

test("Web theme colors follow light and dark appearance in a built app", async () => {
  await writeThemeFixture();
  await build("web");
  const server = await preview({
    root,
    configFile: false,
    logLevel: "silent",
    build: { outDir: "apps/web" },
    preview: { host: "127.0.0.1", port: 0 },
  });
  try {
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("preview server has no TCP address");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(`http://127.0.0.1:${address.port}`);
      for (const [colorScheme, expected] of [["light", "rgb(10, 132, 255)"], ["dark", "rgb(64, 156, 255)"]] as const) {
        await page.emulateMedia({ colorScheme });
        for (const text of ["accent", "dynamic"]) {
          const color = await page.getByText(text, { exact: true }).evaluate((node) => getComputedStyle(node).color);
          expect(color).toBe(expected);
        }
      }
      const unknown = await page.getByText("unknown", { exact: true }).evaluate((node) => getComputedStyle(node).color);
      expect(unknown).toBe("rgba(0, 0, 0, 0)");
      expect(await page.locator("style[data-weft-theme]").count()).toBe(1);
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
}, 15_000);

test("WeChat generates a theme stylesheet and resolves dynamic theme colors", async () => {
  await writeThemeFixture();
  await build("wechat");
  const project = join(root, "apps/wechat");
  const config: { darkmode?: boolean } = JSON.parse(await readFile(join(project, "app.json"), "utf8"));
  expect(config.darkmode).toBe(true);
  expect(await readFile(join(project, "weft/view.wxss"), "utf8")).toBe(
    `${CSS}.w-root{--weft-accent:#0a84ffff;}\n@media (prefers-color-scheme: dark){.w-root{--weft-accent:#409cffff;}}\n`,
  );
  const program = launch(project, { wx: fakeWx() });
  try {
    await settle();
    expect(program.view.texts()).toEqual(["accent", "dynamic", "unknown"]);
    expect(program.view.all("text").map((node) => node.attrs.style)).toEqual([
      "color:var(--weft-accent)", "color:var(--weft-accent)", "color:transparent",
    ]);
  } finally {
    program.unload();
  }
});

test("Web navigation preserves pages across browser back and refresh", async () => {
  await writeFile(join(root, "src/App.weft"), `
event Open
page Home() { Button(onClick = Open) { Text("Open detail") } }
page Detail(id: String) path "/notes/{id}" { NavBar(title = "Detail") Text(id) }
app Notes { start = Home }
`);
  await writeFile(join(root, "src/index.ts"), `
import { Home, Detail, Notes } from "./App.weft";
import { navigation, run } from "@weft-ui/platform";
run(new Notes({
  Home: () => { const page = new Home({}); page.onOpen(() => navigation.push(Detail, { id: "42" })); return page; },
  Detail: (params) => new Detail(params),
}));
`);
  await build("web");
  const server = await preview({ root, configFile: false, logLevel: "silent", build: { outDir: "apps/web" }, preview: { host: "127.0.0.1", port: 0 } });
  try {
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("preview server has no TCP address");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${address.port}/`);
      await page.getByText("Open detail").click();
      await page.waitForURL("**/notes/42");
      expect(await page.getByText("42", { exact: true }).count()).toBe(1);
      await page.reload();
      expect(await page.getByText("42", { exact: true }).count()).toBe(1);
      await page.goBack();
      await page.getByText("Open detail").waitFor();
    } finally { await browser.close(); }
  } finally { await server.close(); }
}, 15_000);

test("Web tabs replace the root history entry and retain their pages", async () => {
  await mkdir(join(root, "res/icons"), { recursive: true });
  for (const name of ["home", "home_on", "settings", "settings_on"]) {
    await writeFile(join(root, `res/icons/${name}.svg`), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  }
  await writeFile(join(root, "src/App.weft"), `
event Open
event SelectSettings
page Home() { Button(onClick = Open) { Text("Open detail") } }
page Settings() { Text("Settings page") }
page Detail() { Button(onClick = SelectSettings) { Text("Switch to settings") } }
app Notes { tabs {
  Home(title = "Home", icon = "asset:home", activeIcon = "asset:home_on")
  Settings(title = "Settings", icon = "asset:settings", activeIcon = "asset:settings_on")
} }
`);
  await writeFile(join(root, "src/index.ts"), `
import { Home, Settings, Detail, Notes } from "./App.weft";
import { navigation, run } from "@weft-ui/platform";
run(new Notes({
  Home: () => { const page = new Home({}); page.onOpen(() => navigation.push(Detail)); return page; },
  Settings: () => new Settings({}),
  Detail: () => { const page = new Detail({}); page.onSelectSettings(() => navigation.switchTab(Settings)); return page; },
}));
navigation.setBadge(Settings, "3");
`);
  await build("web", { assets: "res" });
  const server = await preview({ root, configFile: false, logLevel: "silent", build: { outDir: "apps/web" }, preview: { host: "127.0.0.1", port: 0 } });
  try {
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("preview server has no TCP address");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${address.port}/`);
      const tabs = page.getByRole("tablist");
      const home = tabs.getByRole("tab", { name: "Home" });
      const settings = tabs.getByRole("tab", { name: "Settings 3" });
      expect(await home.getAttribute("aria-selected")).toBe("true");
      expect(await home.locator("img").getAttribute("src")).toContain("home_on");
      const length = await page.evaluate(() => history.length);
      await settings.click();
      await page.waitForURL("**/settings");
      expect(await page.evaluate(() => history.length)).toBe(length);
      expect(await settings.getAttribute("aria-selected")).toBe("true");
      await home.click();
      await page.getByText("Open detail").click();
      await page.waitForURL("**/detail");
      expect(await tabs.isHidden()).toBe(true);
      await page.getByText("Switch to settings").click();
      await page.waitForURL("**/settings");
      await page.getByText("Settings page").waitFor();
      await home.click();
      await page.getByText("Open detail").click();
      await page.goBack();
      await page.waitForURL("**/home");
      await page.getByText("Open detail").waitFor();
    } finally { await browser.close(); }
  } finally { await server.close(); }
}, 15_000);

test("WeChat emits tab bar images and preserves user tab bar settings", async () => {
  await writeFile(join(root, "src/App.weft"), `
page Home() { Text("home") }
page Settings() { Text("settings") }
app Notes { tabs {
  Home(title = "Home", icon = "asset:home", activeIcon = "asset:home_on")
  Settings(title = "Settings", icon = "asset:settings")
} }
`);
  await writeFile(join(root, "src/index.ts"), `
import { Home, Settings, Notes } from "./App.weft";
import { run } from "@weft-ui/platform";
run(new Notes({ Home: () => new Home({}), Settings: () => new Settings({}) }));
`);
  const images = join(root, "assets/images");
  await mkdir(images, { recursive: true });
  for (const name of ["home.png", "home_on.jpg", "settings.jpeg"]) await writeFile(join(images, name), name);
  const project = join(root, "apps/wechat");
  await mkdir(project, { recursive: true });
  await writeFile(join(project, "app.json"), JSON.stringify({ pages: ["custom/page"], tabBar: { color: "#123456", borderStyle: "white" } }));
  await build("wechat");
  const manifest = JSON.parse(await readFile(join(project, "app.json"), "utf8"));
  expect(manifest.pages[0]).toBe("weft/pages/home/index");
  expect(manifest.tabBar.color).toBe("#123456");
  expect(manifest.tabBar.borderStyle).toBe("white");
  expect(manifest.tabBar.list).toEqual([
    { pagePath: "weft/pages/home/index", text: "Home", iconPath: "weft/assets/tab/home.png", selectedIconPath: "weft/assets/tab/home_on.jpg" },
    { pagePath: "weft/pages/settings/index", text: "Settings", iconPath: "weft/assets/tab/settings.jpeg", selectedIconPath: "weft/assets/tab/settings.jpeg" },
  ]);
  for (const name of ["home.png", "home_on.jpg", "settings.jpeg"]) {
    expect(await readFile(join(project, "weft/assets/tab", name), "utf8")).toBe(name);
  }
});

test("WeChat rejects SVG tab icons", async () => {
  await writeFile(join(root, "src/App.weft"), `
page Home() { Text("home") }
page Settings() { Text("settings") }
app Notes { tabs {
  Home(title = "Home", icon = "asset:home")
  Settings(title = "Settings", icon = "asset:home")
} }
`);
  await writeFile(join(root, "src/index.ts"), `
import { Home, Settings, Notes } from "./App.weft";
import { run } from "@weft-ui/platform";
run(new Notes({ Home: () => new Home({}), Settings: () => new Settings({}) }));
`);
  await mkdir(join(root, "assets/icons"), { recursive: true });
  await writeFile(join(root, "assets/icons/home.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await expect(build("wechat")).rejects.toThrow("weft: tab icon `home` must be a PNG or JPEG image on wechat");
});

test("WeChat app builds one generated page per route and preserves user app settings", async () => {
  await writeFile(join(root, "src/App.weft"), `
page Home() { NavBar(title = "Home") Text("home") }
page Detail(id: String) { NavBar(hidden = true) Text(id) }
app Notes { start = Home }
`);
  await writeFile(join(root, "src/index.ts"), `
import { Home, Detail, Notes } from "./App.weft";
import { run } from "@weft-ui/platform";
run(new Notes({ Home: () => new Home({}), Detail: (params) => new Detail(params) }));
`);
  const project = join(root, "apps/wechat");
  await mkdir(project, { recursive: true });
  await writeFile(join(project, "app.json"), JSON.stringify({ pages: ["custom/page", "weft/index"], window: { backgroundColor: "#123456" } }));
  await build("wechat");
  const manifest = JSON.parse(await readFile(join(project, "app.json"), "utf8"));
  expect(manifest.pages).toEqual(["weft/pages/home/index", "weft/pages/detail/index", "custom/page"]);
  expect(manifest.window.backgroundColor).toBe("#123456");
  const home = JSON.parse(await readFile(join(project, "weft/pages/home/index.json"), "utf8"));
  const detail = JSON.parse(await readFile(join(project, "weft/pages/detail/index.json"), "utf8"));
  expect(home.navigationBarTitleText).toBe("Home");
  expect(detail.navigationStyle).toBe("custom");
  for (const page of ["home", "detail"]) {
    for (const extension of ["js", "json", "wxml", "wxss"]) {
      expect(existsSync(join(project, `weft/pages/${page}/index.${extension}`))).toBe(true);
    }
  }
});

test("WEFT_PLATFORM=wechat generates a mini program project that runs", async () => {
  await build("wechat");
  const project = join(root, "apps/wechat");
  expect((await readdir(project)).sort()).toEqual([".gitignore", "app.js", "app.json", "project.config.json", "weft"]);
  expect((await readdir(join(project, "weft"))).sort())
    .toEqual(["index.js", "index.json", "index.wxml", "index.wxss", "js", "view.js", "view.json", "view.wxml", "view.wxss"]);
  expect(await readdir(join(project, "weft/js"))).toEqual(["index.js"]);
  expect(JSON.parse(await readFile(join(project, "app.json"), "utf8")).window.navigationBarTitleText).toBe("Test \"App\"");
  expect(existsSync(join(root, "apps/web"))).toBe(false);

  const wx = fakeWx();
  const program = launch(project, { wx });
  await settle();
  const { view } = program;
  expect(view.texts()).toEqual(["Hello, world!", "tinted", "Click me"]);
  expect(String(view.all("text")[1]!.attrs.style)).toContain("color:transparent");

  view.tap(view.all("button")[0]!);
  await settle();
  expect(view.texts()).toEqual(["You clicked!", "tinted", "Click me"]);
  expect(Object.fromEntries(wx.stored)).toEqual({ clicked: "true", os: "wechat" });

  // A relaunch reads the stored state back on mount.
  program.unload();
  const relaunched = launch(project, { wx });
  await settle();
  expect(relaunched.view.texts()[0]).toBe("You clicked!");
});

test("WeChat carries layout context through branches, rows, components and slots", async () => {
  await writeFile(join(root, "src/App.weft"), `
model Model { inset: Int, labels: String[] }
component Leaf(label: String) {
  Text(label)
}
component Relay(label: String) {
  Leaf(label)
}
component Slot(body: Children) {
  body
}
component App(model: Model) {
  state filled = true
  Stack(padding = 2, paddingX = model.inset, paddingStart = 7) {
    Text("direct", fill = true)
    if (filled) { Relay("branch") }
    for (label in model.labels; key = label) {
      Text(label, fill = filled)
    }
    Slot { Relay("slot") }
    Column { Relay("ordinary") }
  }
  Scroll(direction = "horizontal", indicators = filled, gap = model.inset, align = "end") {
    Relay("horizontal")
    Spacer(size = 12)
    Spacer()
  }
  Scroll { Text("vertical") }
  Row {
    Text("static-grow", grow = 1.5)
    Text("dynamic-grow", grow = if (filled) 2.0 else 0.0, minWidth = 9)
  }
  Scroll(indicators = false, grow = 0, fill = false) {}
  Button(onClick = { filled = !filled }) { Text("toggle") }
}
`);
  await writeFile(join(root, "src/index.ts"), `
import { App } from "./App.weft";
import { run } from "@weft-ui/platform";
run(new App({ inset: 5, labels: ["loop"] }));
`);
  await build("wechat");
  const project = join(root, "apps/wechat");
  expect(await readFile(join(project, "weft/view.wxss"), "utf8")).toBe(CSS);
  const program = launch(project, { wx: fakeWx() });
  try {
    await settle();
    const { view } = program;
    const textNodes = () => Object.fromEntries(view.all("text").map((node) => [String(node.children[0]), node] as const));
    const initial = textNodes();
    expect(Object.fromEntries(Object.entries(initial).map(([label, node]) => [label, node.attrs.class]))).toEqual({
      direct: "w-text w-in-stack w-fill", branch: "w-text w-in-stack", loop: "w-text w-in-stack w-fill",
      slot: "w-text w-in-stack", ordinary: "w-text", horizontal: "w-text w-in-scroll",
      vertical: "w-text w-in-scroll", toggle: "w-text", "static-grow": "w-text w-grow", "dynamic-grow": "w-text w-grow",
    });
    expect(initial["dynamic-grow"]?.attrs.style).toBe("flex:2 1 0px;min-width:0;min-height:0;min-width:9px");
    expect(view.all("view").find((node) => node.attrs.class === "w-stack")?.attrs.style).toBe(
      "padding-top:2px;padding-right:2px;padding-bottom:2px;padding-left:2px;padding-left:5px;padding-right:5px;padding-left:7px",
    );
    expect(view.all("view").filter((node) => node.attrs.class === "w-spacer w-in-scroll").map((node) => node.attrs.style))
      .toEqual(["flex:0 0 12px", undefined]);
    const [horizontal, vertical, hiddenIndicators] = view.all("scroll-view");
    expect(horizontal?.attrs).toMatchObject({
      class: "w-scroll-h w-grow w-fill", "enable-flex": "", enhanced: "", "show-scrollbar": true,
    });
    expect(horizontal?.attrs).toHaveProperty("scroll-x");
    expect(horizontal?.attrs).not.toHaveProperty("scroll-y");
    expect(horizontal?.attrs).not.toHaveProperty("style");
    expect(view.all("view").find((node) => node.attrs.class === "w-scroll-content-h")?.attrs.style)
      .toBe("gap:5px;align-items:flex-end");
    expect(vertical?.attrs).toMatchObject({ class: "w-scroll-v w-grow w-fill", "show-scrollbar": true });
    expect(vertical?.attrs).toHaveProperty("scroll-y");
    expect(hiddenIndicators?.attrs).toMatchObject({ class: "w-scroll-v", "show-scrollbar": false });

    view.tap(view.all("button")[0]!);
    await settle();
    const updated = textNodes();
    expect(updated).not.toHaveProperty("branch");
    expect(updated.loop?.attrs.class).toBe("w-text w-in-stack");
    expect(updated["dynamic-grow"]?.attrs.class).toBe("w-text");
    expect(updated["dynamic-grow"]?.attrs.style).toBe("flex:0 1 auto;min-width:9px");
    expect(view.all("scroll-view")[0]?.attrs["show-scrollbar"]).toBe(false);
  } finally {
    program.unload();
  }
});

test("WeChat builds a JavaScript entry into a custom apps directory", async () => {
  const apps = "projects";
  await rename(join(root, "src/index.ts"), join(root, "src/index.js"));
  await mkdir(join(root, apps));
  await writeFile(join(root, apps, "App.weft"), APP);
  await mkdir(join(root, "apps"));
  await writeFile(join(root, "apps/App.weft"), APP);

  await build("wechat", { apps, dts: true });
  expect(existsSync(join(root, "apps/wechat"))).toBe(false);
  expect(existsSync(join(root, apps, "App.d.weft.ts"))).toBe(false);
  expect(existsSync(join(root, "apps/App.d.weft.ts"))).toBe(true);

  const program = launch(join(root, apps, "wechat"), { wx: fakeWx() });
  await settle();
  expect(program.view.texts()).toEqual(["Hello, world!", "tinted", "Click me"]);
});

test("the template is copied once, the generated area is rewritten on every build", async () => {
  await build("wechat");
  const project = join(root, "apps/wechat");
  await writeFile(join(project, "app.json"), '{"pages": ["weft/index"]}\n');
  await writeFile(join(project, "weft/stale.js"), "");
  await writeFile(join(project, "weft/js/stale.js"), "");
  await build("wechat");
  expect(await readFile(join(project, "app.json"), "utf8")).toBe('{"pages": ["weft/index"]}\n');
  expect(existsSync(join(project, "weft/stale.js"))).toBe(false);
  expect(existsSync(join(project, "weft/js/stale.js"))).toBe(false);
  expect(existsSync(join(project, "weft/view.wxml"))).toBe(true);
});

test("a comma-separated WEFT_PLATFORM builds each platform", async () => {
  await build("web, wechat");
  expect(existsSync(join(root, "apps/web/index.html"))).toBe(true);
  expect(existsSync(join(root, "apps/wechat/weft/js/index.js"))).toBe(true);
});

test("a native platform bundles the logic for the kernel and compiles it to Hermes bytecode", async () => {
  const previous = process.env.WEFT_NATIVE;
  process.env.WEFT_NATIVE = "0";
  try {
    await build("linux", { platforms: ["linux"] });
  } finally {
    if (previous === undefined) delete process.env.WEFT_NATIVE;
    else process.env.WEFT_NATIVE = previous;
  }
  const generated = join(root, "apps/linux/weft");
  expect((await readdir(generated)).sort()).toEqual(["CMakeLists.txt", "Generated.cpp", "bundle.hbc", "js", "layout.json"]);
  // The Hermes bytecode file magic, little-endian.
  const hbc = await readFile(join(generated, "bundle.hbc"));
  expect(hbc.readBigUInt64LE(0)).toBe(0x1f1903c103bc1fc6n);
  const layout = JSON.parse(await readFile(join(generated, "layout.json"), "utf8"));
  expect(layout.templates[0].label).toBe("App");
  // `@weft-ui/platform` resolves to the native implementation, which mounts through the kernel.
  const bundle = await readFile(join(generated, "js/index.js"), "utf8");
  expect(bundle).toContain("__weft");
  expect(bundle).toContain(layout.hash);
});

test("Apple platforms generate an Xcode project around the WeftApp package", async () => {
  const previous = process.env.WEFT_NATIVE;
  process.env.WEFT_NATIVE = "0";
  try {
    await build("ios", { platforms: ["ios"] });
  } finally {
    if (previous === undefined) delete process.env.WEFT_NATIVE;
    else process.env.WEFT_NATIVE = previous;
  }
  const project = join(root, "apps/ios");
  expect((await readdir(project)).sort()).toEqual([".gitignore", "App", "App.xcodeproj", "UITests", "weft"]);
  expect((await readdir(join(project, "weft"))).sort())
    .toEqual(["Generated.swift", "Package.swift", "bundle.hbc", "js", "layout.json"]);
  const pbxproj = await readFile(join(project, "App.xcodeproj/project.pbxproj"), "utf8");
  expect(pbxproj).toContain('PRODUCT_NAME = "Test \\"App\\"";');
  expect(pbxproj).toContain('PRODUCT_BUNDLE_IDENTIFIER = "com.example.test";');
  const scheme = await readFile(join(project, "App.xcodeproj/xcshareddata/xcschemes/App.xcscheme"), "utf8");
  expect(scheme).toContain('BuildableName = "Test &quot;App&quot;.app"');
  // The views implement the layout the bundle was compiled with.
  const { hash } = JSON.parse(await readFile(join(project, "weft/layout.json"), "utf8"));
  expect(await readFile(join(project, "weft/Generated.swift"), "utf8")).toContain(`layoutHash: 0x${hash},`);
  expect(await readFile(join(project, "weft/Package.swift"), "utf8")).toMatch(/\.package\(path: ".*native\/apple"\)/);
});

test("Android generates a Gradle project around the generated module", async () => {
  const previous = process.env.WEFT_NATIVE;
  process.env.WEFT_NATIVE = "0";
  try {
    await build("android", { platforms: ["android"] });
  } finally {
    if (previous === undefined) delete process.env.WEFT_NATIVE;
    else process.env.WEFT_NATIVE = previous;
  }
  const project = join(root, "apps/android");
  expect((await readdir(project)).sort())
    .toEqual([".gitignore", "app", "build.gradle.kts", "gradle", "gradle.properties", "gradlew", "gradlew.bat", "settings.gradle.kts", "weft"]);
  expect((await stat(join(project, "gradlew"))).mode & 0o111).not.toBe(0);
  expect((await readdir(join(project, "weft"))).sort())
    .toEqual(["build.gradle.kts", "js", "layout.json", "settings.gradle.kts", "src"]);
  expect(await readFile(join(project, "app/build.gradle.kts"), "utf8")).toContain('applicationId = "com.example.test"');
  expect(await readFile(join(project, "app/src/main/res/values/strings.xml"), "utf8"))
    .toContain('<string name="app_name">Test \\&quot;App\\&quot;</string>');
  // The bytecode is an asset of the generated module, the views implement the layout it was compiled with.
  const hbc = await readFile(join(project, "weft/src/main/assets/weft/bundle.hbc"));
  expect(hbc.readBigUInt64LE(0)).toBe(0x1f1903c103bc1fc6n);
  const { hash } = JSON.parse(await readFile(join(project, "weft/layout.json"), "utf8"));
  expect(await readFile(join(project, "weft/src/main/kotlin/Generated.kt"), "utf8")).toContain(`layoutHash = 0x${hash}uL`);
  // The shell is referenced relative to the project, so it builds wherever the workspace is.
  const settings = await readFile(join(project, "weft/settings.gradle.kts"), "utf8");
  const shell = relative(realpathSync(project), WEFT_ANDROID).replaceAll("\\", "/");
  expect(settings).toContain(`project(":weft-android").projectDir = settingsDir.resolve("${shell}")`);
  expect(existsSync(join(WEFT_ANDROID, "build.gradle.kts"))).toBe(true);
});

test("Windows generates a dotnet project around the generated views", async () => {
  const previous = process.env.WEFT_NATIVE;
  process.env.WEFT_NATIVE = "0";
  try {
    await build("windows", { platforms: ["windows"] });
  } finally {
    if (previous === undefined) delete process.env.WEFT_NATIVE;
    else process.env.WEFT_NATIVE = previous;
  }
  const project = join(root, "apps/windows");
  expect((await readdir(project)).sort())
    .toEqual([".gitignore", "App.csproj", "App.xaml", "App.xaml.cs", "UITests", "app.manifest", "weft"]);
  expect((await readdir(join(project, "weft"))).sort())
    .toEqual(["Generated.cs", "Weft.targets", "bundle.hbc", "js", "layout.json"]);
  const csproj = await readFile(join(project, "App.csproj"), "utf8");
  expect(csproj).toContain("<Product>Test &quot;App&quot;</Product>");
  expect(csproj).toContain('<AssemblyMetadata Include="WeftAppId" Value="com.example.test" />');
  expect(await readFile(join(project, "App.xaml.cs"), "utf8")).toContain('Title = "Test \\"App\\""');
  // The views implement the layout the bundle was compiled with.
  const { hash } = JSON.parse(await readFile(join(project, "weft/layout.json"), "utf8"));
  expect(await readFile(join(project, "weft/Generated.cs"), "utf8")).toContain(`LayoutHash = 0x${hash}UL;`);
  // The shell is referenced relative to the generated area, so the project builds wherever the workspace is.
  const targets = await readFile(join(project, "weft/Weft.targets"), "utf8");
  const shell = relative(realpathSync(join(project, "weft")), WEFT_WINUI).replaceAll("/", "\\");
  expect(targets).toContain(`<Import Project="$(MSBuildThisFileDirectory)${shell}\\Weft.WinUI.targets" />`);
  expect(existsSync(join(WEFT_WINUI, "Weft.WinUI.targets"))).toBe(true);
});

test("Linux generates a CMake project around the generated views", async () => {
  const previous = process.env.WEFT_NATIVE;
  process.env.WEFT_NATIVE = "0";
  try {
    await build("linux", { platforms: ["linux"] });
  } finally {
    if (previous === undefined) delete process.env.WEFT_NATIVE;
    else process.env.WEFT_NATIVE = previous;
  }
  const project = join(root, "apps/linux");
  expect((await readdir(project)).sort()).toEqual([".gitignore", "CMakeLists.txt", "main.cpp", "tests", "weft"]);
  const main = await readFile(join(project, "main.cpp"), "utf8");
  expect(main).toContain('kAppId = "com.example.test";');
  expect(main).toContain('kAppName = "Test \\"App\\"";');
  // The views implement the layout the bundle was compiled with.
  const { hash } = JSON.parse(await readFile(join(project, "weft/layout.json"), "utf8"));
  expect(await readFile(join(project, "weft/Generated.cpp"), "utf8")).toContain(`kLayoutHash = 0x${hash}ull;`);
  // The shell is referenced relative to the generated area, so the project builds wherever the workspace is.
  const lists = await readFile(join(project, "weft/CMakeLists.txt"), "utf8");
  const shell = relative(realpathSync(join(project, "weft")), WEFT_LINUX).replaceAll("\\", "/");
  expect(lists).toContain(`add_subdirectory("\${CMAKE_CURRENT_LIST_DIR}/${shell}" weft-linux)`);
  expect(existsSync(join(WEFT_LINUX, "CMakeLists.txt"))).toBe(true);
});

test("compile errors fail the build with rendered diagnostics", async () => {
  await writeFile(join(root, "src/Broken.weft"), "component Broken() {\n    Text(1)\n}\n");
  await expect(build("wechat")).rejects.toThrow(/mismatched types: expected `String`, found `Int`[\s\S]*Broken\.weft:2:/);
});

test("WEFT_PLATFORM must name a configured platform", async () => {
  await expect(build("mac")).rejects.toThrow(/unknown platform "mac"/);
  await expect(build("ios")).rejects.toThrow(/"ios" is not in the platforms option/);
});

test("default app.id derives com.example.<name> when omitted", async () => {
  const prevNative = process.env.WEFT_NATIVE;
  const prevPlatform = process.env.WEFT_PLATFORM;
  process.env.WEFT_NATIVE = "0";
  process.env.WEFT_PLATFORM = "android";
  try {
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [weft({ platforms: ["android"] })],
    });
    await builder.buildApp();
  } finally {
    if (prevNative === undefined) delete process.env.WEFT_NATIVE;
    else process.env.WEFT_NATIVE = prevNative;
    if (prevPlatform === undefined) delete process.env.WEFT_PLATFORM;
    else process.env.WEFT_PLATFORM = prevPlatform;
  }
  const gradle = await readFile(join(root, "apps/android/app/build.gradle.kts"), "utf8");
  expect(gradle).toMatch(/applicationId = "com\.example\.weftvite[a-z0-9]*"/);
});

test("dts: true writes .d.weft.ts declarations that typecheck with allowArbitraryExtensions", async () => {
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      allowArbitraryExtensions: true,
      strict: true,
      noEmit: true,
      types: [],
    },
    include: ["src/**/*.ts"],
  }));
  await writeFile(
    join(root, "src/Consumer.ts"),
    'import { App } from "./App.weft";\nexport const instance = new App({ clicked: false, tint: "red" });\n',
  );
  await build("web,wechat", { dts: true });
  expect(existsSync(join(root, "src/App.d.weft.ts"))).toBe(true);
  const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
  await promisify(execFile)(process.execPath, [tsc, "--noEmit", "-p", join(root, "tsconfig.json")], { cwd: root });
});

test("Windows Weft.targets and Linux CMakeLists escape special path characters", async () => {
  const customShells = join(root, "shells & $%");
  await mkdir(join(customShells, "windows"), { recursive: true });
  await mkdir(join(customShells, "linux"), { recursive: true });
  await cp(join(WEFT_WINUI, "package.json"), join(customShells, "windows/package.json"));
  await cp(join(WEFT_LINUX, "package.json"), join(customShells, "linux/package.json"));
  const previous = process.env.WEFT_NATIVE;
  process.env.WEFT_NATIVE = "0";
  try {
    await build("windows,linux", { platforms: ["windows", "linux"], native: customShells });
  } finally {
    if (previous === undefined) delete process.env.WEFT_NATIVE;
    else process.env.WEFT_NATIVE = previous;
  }
  const targets = await readFile(join(root, "apps/windows/weft/Weft.targets"), "utf8");
  expect(targets).toContain("shells &amp; %24%25\\windows\\Weft.WinUI.targets");
  const cmake = await readFile(join(root, "apps/linux/weft/CMakeLists.txt"), "utf8");
  expect(cmake).toContain("shells & \\$%/linux");
});
