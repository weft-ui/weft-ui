import { navigation } from "@weft-ui/runtime/navigation";
import type { AppLike, Script } from "../../conformance/harness.ts";
import * as classes from "./Navigation.weft";

type FixtureApp = AppLike & { model: { Settings: typeof classes.Settings } };

export const script: Script<FixtureApp> = {
  dir: import.meta.dirname,
  entry: "Navigation.weft",
  component: "Notes",
  App: classes.Notes as unknown as Script<FixtureApp>["App"],
  exports: classes,
  model: () => ({ Settings: classes.Settings }),
  create(exports, log) {
    const { Notes, Home, Settings, Detail } = exports as unknown as typeof classes;
    const app = new Notes({
      Home: () => {
        const page = new Home({});
        page.onShow(() => log("home show"));
        page.onHide(() => log("home hide"));
        page.onOpen(() => navigation.push(Detail, { id: "1" }));
        return page;
      },
      Settings: () => {
        const page = new Settings({});
        page.onShow(() => log("settings show"));
        page.onHide(() => log("settings hide"));
        return page;
      },
      Detail: (params: { id: string; from?: string }) => {
        const page = new Detail(params);
        page.onShow(() => log(`detail ${params.id} show`));
        page.onHide(() => log(`detail ${params.id} hide`));
        page.onReplace(() => navigation.replace(Detail, { id: "2" }));
        page.onRoot(() => navigation.popToRoot());
        return page;
      },
    });
    Object.defineProperty(app, "model", { value: { Settings } });
    return app as unknown as FixtureApp;
  },
  setup() {},
  steps: [
    { name: "push detail", run: (ui) => ui.click("Button", 0) },
    { name: "back", run: (ui) => ui.back() },
    { name: "push again", run: (ui) => ui.click("Button", 0) },
    { name: "replace detail", run: (ui) => ui.click("Button", 0) },
    { name: "pop to root", run: (ui) => ui.click("Button", 1) },
    { name: "badge", run: (_ui, model) => navigation.setBadge(model.Settings, "3") },
    { name: "select settings", run: (ui) => ui.tab(1) },
    { name: "select home", run: (ui) => ui.tab(0) },
    { name: "push before tab", run: (ui) => ui.click("Button", 0) },
    { name: "switch clears stack", run: (_ui, model) => navigation.switchTab(model.Settings) },
    { name: "clear badge", run: (_ui, model) => navigation.setBadge(model.Settings, null) },
  ],
};
