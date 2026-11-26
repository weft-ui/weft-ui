/**
 * Plays a fixture script inside the native kernel (native/core). The C++
 * conformance host (native/core/tests/conformance.cpp) renders the ops,
 * performs the script's user actions through `weft_runtime_dispatch` like a
 * platform shell, and writes the ops log in the golden file format; this
 * side runs the app, the model changes and the flushes.
 *
 * The two sides talk through the host's `conformance` platform module:
 * `click` / `edit` ask the host to act on an element, `step` closes a step
 * of the ops log, `done` / `fail` end the run.
 */

import { run } from "@weft-ui/platform";
import { kernel } from "@weft-ui/runtime/native";
import { tick } from "@weft-ui/runtime/remote";
import type { Actions, AppLike, Script } from "../harness.ts";

interface Action {
  method: "click" | "edit" | "back" | "dismiss" | "tab";
  type?: string;
  index?: number;
  event?: string;
  value?: string | boolean | number;
}

function host(method: string, args: object): Promise<ArrayBuffer> {
  return kernel().call("conformance", method, JSON.stringify(args));
}

async function play<A extends AppLike>(script: Script<A>): Promise<void> {
  const app = script.create ? script.create(script.exports ?? {}, () => {}) : new script.App(script.model());
  script.setup(app, () => {});
  run(app);
  await tick();
  await host("step", { name: "mount" });
  for (const step of script.steps) {
    // Steps are synchronous, so the host performs their user actions afterwards, in order.
    const actions: Action[] = [];
    const ui: Actions = {
      back: () => void actions.push({ method: "back" }),
      dismiss: () => void actions.push({ method: "dismiss" }),
      tab: (index) => void actions.push({ method: "tab", index }),
      click: (type, index, event) => void actions.push({ method: "click", type, index, event }),
      focus: (type, index, value) => void actions.push({ method: "click", type, index, event: "onFocusChange", value }),
      edit: (type, index, value) => void actions.push({ method: "edit", type, index, value }),
    };
    step.run(ui, app.model);
    for (const { method, ...args } of actions) await host(method, args);
    await tick();
    await host("step", { name: step.name });
  }
  app.unmount();
}

/** Plays `script`, then reports `done`, or `fail` with the error. */
export function playNative<A extends AppLike>(script: Script<A>): void {
  play(script).then(
    () => host("done", {}),
    (error: unknown) => host("fail", { message: error instanceof Error ? (error.stack ?? error.message) : String(error) }),
  );
}
