/**
 * Native platforms (iOS, macOS, Android, Windows, Linux): every API is a
 * platform module of the shell, reached through the kernel's `__weft.call`.
 * The wire format of each module is specified in
 * protocol/SPEC.md ("Platform calls").
 */

import { NativeSink, kernel, onSignal } from "@weft-ui/runtime/native";
import { createLifecycle } from "./lifecycle.ts";

const appLifecycle = createLifecycle(() => {
  const launch = JSON.parse(kernel().launch) as { url?: string | null };
  return launch.url ?? null;
}, (change, memory) => {
  onSignal("lifecycle", json => {
    const { state } = JSON.parse(json) as { state: string };
    if (state === "foreground" || state === "background") change(state);
  });
  onSignal("memory", memory);
});
export const lifecycle = appLifecycle.api;
import type { PlatformModule } from "@weft-ui/runtime/protocol";
import { Environment, type EnvironmentData } from "./environment.ts";
import { PlatformError } from "./error.ts";
import { frame, unframe } from "./frame.ts";
import { createUI } from "./ui.ts";
import type { App, RequestInit, Response } from "./index.d.ts";

export { PlatformError } from "./error.ts";
export { navigation } from "@weft-ui/runtime/navigation";
export type { App, RequestInit, Response } from "./index.d.ts";

const os = __WEFT_PLATFORM__;
const decoder = new TextDecoder();

/** Mounts the app into the native views of the kernel that runs the bundle. */
export function run(app: App): void {
  appLifecycle.init();
  app.mount(new NativeSink() as never);
}

/** Sends a request through the shell's `fetch` module. */
export async function fetch(url: string, init?: RequestInit): Promise<Response> {
  if (!isSupported("fetch")) throw new PlatformError("fetch", os);
  const head = { url, method: init?.method ?? "GET", headers: init?.headers ?? {} };
  const { head: result, body } = unframe(await kernel().call("fetch", "request", frame(head, init?.body)));
  const { status } = result as { status: number };
  let text: string | undefined;
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() { return text ??= decoder.decode(body); },
    async json() { return JSON.parse(text ??= decoder.decode(body)) as unknown; },
    async arrayBuffer() { return body; },
  };
}

/** Calls a `storage` method with JSON arguments and returns its JSON result (`undefined` if empty). */
async function store(method: string, args: string[]): Promise<unknown> {
  if (!isSupported("storage")) throw new PlatformError("storage", os);
  const result = await kernel().call("storage", method, JSON.stringify(args));
  return result.byteLength === 0 ? undefined : JSON.parse(decoder.decode(result));
}

/** Persistent string storage of the shell's `storage` module. */
export const storage = {
  async get(key: string): Promise<string | null> {
    return (await store("get", [key])) as string | null;
  },
  async set(key: string, value: string): Promise<void> {
    await store("set", [key, value]);
  },
  async remove(key: string): Promise<void> {
    await store("remove", [key]);
  },
};

async function callUI(method: string, options: object): Promise<unknown> {
  if (!isSupported("ui")) throw new PlatformError("ui", os);
  const result = await kernel().call("ui", method, JSON.stringify(options));
  return result.byteLength === 0 ? undefined : JSON.parse(decoder.decode(result));
}

export const ui = createUI({
  async alert(options) { await callUI("alert", options); },
  async confirm(options) { return await callUI("confirm", options) as boolean; },
  async actionSheet(options) { return await callUI("actionSheet", options) as number | null; },
  toast(message, options) {
    if (!isSupported("ui")) throw new PlatformError("ui", os);
    void callUI("toast", { message, ...options }).catch((error: unknown) => console.error(error));
  },
});

class NativePlatform extends Environment {
  readonly os = os;
  get version(): string { return globalThis.__weft?.version ?? ""; }
}

/** The native platform and the environment reported by its shell. */
export const platform = /* @__PURE__ */ new NativePlatform(
  () => JSON.parse(kernel().environment) as EnvironmentData,
  (notify) => kernel().listen(notify),
);

/** Whether the shell implements the API's platform module. */
export function isSupported(api: PlatformModule): boolean {
  return globalThis.__weft?.supports(api) ?? false;
}
