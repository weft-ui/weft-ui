import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { run } from "../../packages/platform/src/wechat.ts";
import { navigation } from "@weft-ui/runtime/navigation";
import { tick } from "@weft-ui/runtime/remote";
import { compile, loadView } from "../src/miniprogram.ts";

test("host page loads reconstruct the stack without replacing known pages", async () => {
  const out = await mkdtemp(join(tmpdir(), "weft-wx-reconstruct-"));
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = { App: globals.App, wx: globals.wx, getCurrentPages: globals.getCurrentPages };
  try {
    await compile({ entries: [join(import.meta.dirname, "../fixtures/navigation/Navigation.weft")], outDir: out });
    // The generated module only exists after compile().
    const { Notes, Home, Settings, Detail, Modal } = await import(pathToFileURL(join(out, "Navigation.js")).href);
    const created: string[] = [];
    const app = new Notes({
      Home: () => { created.push("Home"); return new Home({}); },
      Settings: () => new Settings({}),
      Detail: (params: { id: string }) => { created.push(params.id); return new Detail(params); },
      Modal: () => new Modal({}),
    });
    type PageOptions = Record<string, (this: object, ...args: never[]) => void>;
    const registered: { app?: { onShow(options: object): void; weft: { page(name: string): PageOptions } } } = {};
    globals.App = (options: NonNullable<typeof registered.app>) => { registered.app = options; };
    globals.wx = {
      getLaunchOptionsSync: () => ({}), onMemoryWarning: () => {}, setNavigationBarTitle: () => {},
      navigateTo: () => {},
    };
    const pages: object[] = [];
    globals.getCurrentPages = () => pages;
    run(app);
    registered.app!.onShow({});
    const mount = (name: string, path: string, query: Record<string, string>) => {
      const callbacks = registered.app!.weft.page(name);
      const instance = { route: path, selectComponent: () => loadView(out), setData: () => {} };
      pages.push(instance);
      callbacks.onLoad!.call(instance, query as never);
      callbacks.onReady!.call(instance);
      return instance;
    };
    mount("Home", "weft/pages/home/index", {});
    await tick();
    navigation.push(Detail, { id: "known" });
    await tick();
    mount("Detail", "weft/pages/detail/index", { id: "known", __w: "1" });
    await tick();
    const opened: string[] = [];
    const unsubscribe = navigation.onOpen((_route, url) => { opened.push(url); return false; });
    registered.app!.onShow({ path: "weft/pages/detail/index", query: { id: "shared", from: "search & more" } });
    mount("Detail", "weft/pages/detail/index", { id: "shared", from: "search & more" });
    await tick();
    expect(created).toEqual(["Home", "known", "shared"]);
    expect(navigation.stack).toEqual([
      { page: "Home", params: {} },
      { page: "Detail", params: { id: "known", from: "feed" } },
      { page: "Detail", params: { id: "shared", from: "search & more" } },
    ]);
    expect(opened).toEqual(["/weft/pages/detail/index?id=shared&from=search%20%26%20more"]);
    unsubscribe();
    app.unmount();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globals[key]; else globals[key] = value;
    }
    await rm(out, { recursive: true, force: true });
  }
});

test("relaunch refreshes the title after the replacement page is mounted", async () => {
  const out = await mkdtemp(join(tmpdir(), "weft-wx-relaunch-title-"));
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = { App: globals.App, wx: globals.wx, getCurrentPages: globals.getCurrentPages };
  try {
    await compile({ entries: [join(import.meta.dirname, "../fixtures/navigation/Navigation.weft")], outDir: out });
    // The compiled fixture is created at a temporary path at runtime.
    const { Notes, Home, Settings, Detail, Modal } = await import(pathToFileURL(join(out, "Navigation.js")).href);
    const app = new Notes({ Home: () => new Home({}), Settings: () => new Settings({}), Detail: (params: object) => new Detail(params), Modal: () => new Modal({}) });
    const registered: { app?: { weft: { page(name: string): Record<string, (this: object, ...args: never[]) => void> } } } = {};
    let title = "";
    globals.App = (options: NonNullable<typeof registered.app>) => { registered.app = options; };
    globals.wx = { getLaunchOptionsSync: () => ({}), onMemoryWarning: () => {}, setNavigationBarTitle: (options: { title: string }) => { title = options.title; } };
    const pages: object[] = [];
    globals.getCurrentPages = () => pages;
    run(app);
    const mount = (name: string, query: Record<string, string>) => {
      const callbacks = registered.app!.weft.page(name);
      const instance = { route: `weft/pages/${name.toLowerCase()}/index`, selectComponent: () => loadView(out), setData: () => {} };
      pages.splice(0, pages.length, instance);
      callbacks.onLoad!.call(instance, query as never);
      callbacks.onReady!.call(instance);
    };
    mount("Home", {});
    await tick();
    expect(title).toBe("Home");
    mount("Detail", { id: "3" });
    await tick();
    expect(title).toBe("Note 3");
    app.unmount();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globals[key]; else globals[key] = value;
    }
    await rm(out, { recursive: true, force: true });
  }
});

test("cold page launch decodes route parameters and shows its dynamic title", async () => {
  const out = await mkdtemp(join(tmpdir(), "weft-wx-navigation-"));
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = { App: globals.App, wx: globals.wx, getCurrentPages: globals.getCurrentPages };
  try {
    await compile({ entries: [join(import.meta.dirname, "../fixtures/navigation/Navigation.weft")], outDir: out });
    // The generated module does not exist until compile() has completed.
    const { Notes, Home, Settings, Detail, Modal } = await import(pathToFileURL(join(out, "Navigation.js")).href);
    const app = new Notes({ Home: () => new Home({}), Settings: () => new Settings({}), Detail: (params: object) => new Detail(params), Modal: () => new Modal({}) });
    const registered: { app?: { weft: { page(name: string): Record<string, (this: object, ...args: never[]) => void> } } } = {};
    let title = "";
    globals.App = (options: NonNullable<typeof registered.app>) => { registered.app = options; };
    globals.wx = { getLaunchOptionsSync: () => ({}), onMemoryWarning: () => {}, setNavigationBarTitle: (options: { title: string }) => { title = options.title; } };
    const pages: object[] = [];
    globals.getCurrentPages = () => pages;
    run(app);
    const component = loadView(out);
    const modalView = loadView(out);
    const page = registered.app!.weft.page("Detail");
    const instance = { selectComponent: (selector: string) => selector === "#modal" ? modalView : component, setData: () => {} };
    pages.push(instance);
    page.onLoad!.call(instance, { id: "a/b", from: "search & more" } as never);
    page.onReady!.call(instance);
    await tick();
    expect(navigation.stack).toEqual([{ page: "Detail", params: { id: "a/b", from: "search & more" } }]);
    expect(title).toBe("Note a/b");
    const keyboard = component as typeof component & { $keyboard(event: object): void };
    keyboard.$keyboard({ currentTarget: { id: "w1-1", dataset: {} }, detail: { height: 220 } });
    expect(component.data.kh).toBe(220);
    expect(component.data.kf).toBe("w1-1");
    expect(component.render()[0].attrs.style).toBe("padding-bottom:220px");
    keyboard.$keyboard({ currentTarget: { id: "w1-1", dataset: {} }, detail: { height: 0 } });
    expect(component.data.kh).toBe(0);
    title = "changed by another page";
    page.onShow!.call(instance);
    expect(title).toBe("Note a/b");
    app.unmount();

    const homeApp = new Notes({ Home: () => new Home({}), Settings: () => new Settings({}), Detail: (params: object) => new Detail(params), Modal: () => new Modal({}) });
    run(homeApp);
    const home = registered.app!.weft.page("Home");
    const homeView = loadView(out);
    const homeModalView = loadView(out);
    const homeInstance = { selectComponent: (selector: string) => selector === "#modal" ? homeModalView : homeView, setData: () => {} };
    pages[0] = homeInstance;
    home.onLoad!.call(homeInstance, {} as never);
    home.onReady!.call(homeInstance);
    await tick();
    expect(title).toBe("Home");
    title = "other";
    home.onShow!.call(homeInstance);
    expect(title).toBe("Home");
    homeApp.unmount();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globals[key]; else globals[key] = value;
    }
    await rm(out, { recursive: true, force: true });
  }
});
