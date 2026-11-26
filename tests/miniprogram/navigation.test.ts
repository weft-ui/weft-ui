import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { run } from "../../packages/platform/src/wechat.ts";
import { navigation } from "@weft-ui/runtime/navigation";
import { tick } from "@weft-ui/runtime/remote";
import { compile, loadView } from "../src/miniprogram.ts";

test("cold page launch decodes route parameters and shows its dynamic title", async () => {
  const out = await mkdtemp(join(tmpdir(), "weft-wx-navigation-"));
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = { App: globals.App, wx: globals.wx, getCurrentPages: globals.getCurrentPages };
  try {
    await compile({ entries: [join(import.meta.dirname, "../fixtures/navigation/Navigation.weft")], outDir: out });
    // The generated module does not exist until compile() has completed.
    const { Notes, Home, Detail } = await import(pathToFileURL(join(out, "Navigation.js")).href);
    const app = new Notes({ Home: () => new Home({}), Detail: (params: object) => new Detail(params) });
    const registered: { app?: { weft: { page(name: string): Record<string, (this: object, ...args: never[]) => void> } } } = {};
    let title = "";
    globals.App = (options: NonNullable<typeof registered.app>) => { registered.app = options; };
    globals.wx = { setNavigationBarTitle: (options: { title: string }) => { title = options.title; } };
    const pages: object[] = [];
    globals.getCurrentPages = () => pages;
    run(app);
    const component = loadView(out);
    const page = registered.app!.weft.page("Detail");
    const instance = { selectComponent: () => component };
    pages.push(instance);
    page.onLoad!.call(instance, { id: "a/b", from: "search & more" } as never);
    page.onReady!.call(instance);
    await tick();
    expect(navigation.stack.at(-1)).toEqual({ page: "Detail", params: { id: "a/b", from: "search & more" } });
    expect(title).toBe("Note a/b");
    title = "changed by another page";
    page.onShow!.call(instance);
    expect(title).toBe("Note a/b");
    app.unmount();

    const homeApp = new Notes({ Home: () => new Home({}), Detail: (params: object) => new Detail(params) });
    run(homeApp);
    const home = registered.app!.weft.page("Home");
    const homeView = loadView(out);
    const homeInstance = { selectComponent: () => homeView };
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
