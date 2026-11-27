import type { Script } from "../../conformance/harness.ts";
import { RefreshFixture } from "./RefreshFixture.weft";

export const script: Script<RefreshFixture> = {
  dir: import.meta.dirname,
  entry: "RefreshFixture.weft",
  component: "RefreshFixture",
  App: RefreshFixture,
  model: () => ({ items: [], refreshing: false }),
  setup(app, log) {
    app.onRefresh((model) => { model.refreshing = true; log("refresh"); });
  },
  steps: [
    { name: "pull to refresh", run: (ui) => ui.refresh("List", 0) },
    { name: "finish refresh", run: (_, model) => { model.refreshing = false; } },
  ],
};
