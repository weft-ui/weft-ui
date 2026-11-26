import { navigation } from "@weft-ui/runtime/navigation";
import type { AppLike, Script } from "../../conformance/harness.ts";
import * as classes from "./Navigation.weft";

type FixtureApp = AppLike & { model: Record<string, never> };

export const script: Script<FixtureApp> = {
  dir: import.meta.dirname,
  entry: "Navigation.weft",
  component: "Notes",
  App: classes.Notes as unknown as Script<FixtureApp>["App"],
  exports: classes,
  model: () => ({}),
  create(exports, log) {
    const { Notes, Home, Detail } = exports as unknown as typeof classes;
    const app = new Notes({
      Home: () => {
        const page = new Home({});
        page.onShow(() => log("home show"));
        page.onHide(() => log("home hide"));
        page.onOpen(() => navigation.push(Detail, { id: "1" }));
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
    Object.defineProperty(app, "model", { value: {} });
    return app as unknown as FixtureApp;
  },
  setup() {},
  steps: [
    { name: "push detail", run: (ui) => ui.click("Button", 0) },
    { name: "back", run: (ui) => ui.back() },
    { name: "push again", run: (ui) => ui.click("Button", 0) },
    { name: "replace detail", run: (ui) => ui.click("Button", 0) },
    { name: "pop to root", run: (ui) => ui.click("Button", 1) },
  ],
};
