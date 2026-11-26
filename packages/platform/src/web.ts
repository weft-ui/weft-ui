import type { PlatformModule } from "@weft-ui/runtime/protocol";
import { Environment, type EnvironmentData } from "./environment.ts";
import { PlatformError } from "./error.ts";
import { createUI } from "./ui.ts";
import type { App, RequestInit, Response } from "./index.d.ts";

export { PlatformError } from "./error.ts";
export type { App, RequestInit, Response } from "./index.d.ts";

function localStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function supportedStorage(): Storage {
  const storage = localStorage();
  if (!storage) throw new PlatformError("storage", "web");
  return storage;
}

/** Mounts a generated app into the document's #app element. */
export function run(app: App): void {
  const target = document.getElementById("app");
  if (!target) throw new Error('weft: run() requires an element with id "app"');
  app.mount(target as never);
}

/** Uses the browser's fetch implementation, rejecting when unavailable. */
export async function fetch(url: string, init?: RequestInit): Promise<Response> {
  if (!isSupported("fetch")) throw new PlatformError("fetch", "web");
  return globalThis.fetch(url, init);
}

/** Promise-based access to browser localStorage. */
export const storage = {
  async get(key: string): Promise<string | null> {
    return supportedStorage().getItem(key);
  },
  async set(key: string, value: string): Promise<void> {
    supportedStorage().setItem(key, value);
  },
  async remove(key: string): Promise<void> {
    supportedStorage().removeItem(key);
  },
};

const UI_CSS = `
dialog.weft-ui{border:0;border-radius:16px;padding:24px;max-width:min(90vw,420px);box-sizing:border-box;background:#fff;color:#171717;box-shadow:0 12px 40px #0004}
dialog.weft-ui::backdrop{background:#0008}.weft-ui h2{font-size:1.2rem;margin:0 0 12px}.weft-ui p{white-space:pre-wrap;margin:0 0 20px}.weft-ui button{font:inherit;cursor:pointer;border:0;border-radius:8px;padding:10px 16px;background:#eaeaea;color:inherit}.weft-ui .weft-actions{display:flex;justify-content:flex-end;gap:8px}.weft-ui .weft-destructive{color:#d22}
dialog.weft-sheet{position:fixed;inset:auto 0 0;margin:auto;width:100%;max-width:600px;border-radius:16px 16px 0 0}.weft-sheet .weft-actions{flex-direction:column}.weft-toast{position:fixed;z-index:2147483647;bottom:max(24px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);background:#333;color:white;border-radius:999px;padding:12px 20px;box-shadow:0 4px 16px #0004;white-space:pre-wrap}
@media(prefers-color-scheme:dark){dialog.weft-ui{background:#292929;color:#fff}.weft-ui button{background:#444}.weft-ui .weft-destructive{color:#ff7070}.weft-toast{background:#eee;color:#111}}`;

function uiStyles(): void {
  if (document.querySelector("style[data-weft-ui]")) return;
  const style = document.createElement("style");
  style.dataset.weftUi = "";
  style.textContent = UI_CSS;
  document.head.append(style);
}

function dialog<T>(title: string | undefined, message: string | undefined, choices: { text: string; value: T; destructive?: boolean }[], dismissed: T, sheet = false): Promise<T> {
  uiStyles();
  return new Promise((resolve, reject) => {
    const element = document.createElement("dialog");
    element.className = sheet ? "weft-ui weft-sheet" : "weft-ui";
    if (title) {
      const heading = document.createElement("h2");
      heading.textContent = title;
      element.append(heading);
    }
    if (message) {
      const body = document.createElement("p");
      body.textContent = message;
      element.append(body);
    }
    const actions = document.createElement("div");
    actions.className = "weft-actions";
    let result = dismissed;
    for (const choice of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = choice.text;
      if (choice.destructive) button.className = "weft-destructive";
      button.addEventListener("click", () => { result = choice.value; element.close(); });
      actions.append(button);
    }
    element.append(actions);
    element.addEventListener("click", (event) => {
      if (event.target === element) element.close();
    });
    element.addEventListener("close", () => { element.remove(); resolve(result); }, { once: true });
    document.body.append(element);
    try { element.showModal(); } catch (error) { element.remove(); reject(error); }
  });
}

let toastElement: HTMLElement | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export const ui = createUI({
  alert: (options) => dialog(options.title, options.message, [{ text: options.confirmText ?? "OK", value: undefined }], undefined),
  confirm: (options) => dialog(options.title, options.message, [
    { text: options.cancelText ?? "Cancel", value: false },
    { text: options.confirmText ?? "OK", value: true, destructive: options.destructive },
  ], false),
  actionSheet: (options) => dialog(options.title, undefined, [
    ...options.options.map((text, index) => ({ text, value: index as number | null, destructive: index === options.destructiveIndex })),
    { text: options.cancelText ?? "Cancel", value: null },
  ], null, true),
  toast(message, options) {
    uiStyles();
    clearTimeout(toastTimer);
    toastElement?.remove();
    toastElement = document.createElement("div");
    toastElement.className = "weft-toast";
    toastElement.setAttribute("role", "status");
    toastElement.textContent = `${options.icon === "success" ? "✓ " : options.icon === "error" ? "✕ " : ""}${message}`;
    document.body.append(toastElement);
    toastTimer = setTimeout(() => { toastElement?.remove(); toastElement = undefined; }, options.duration === "long" ? 3000 : 1500);
  },
});

const COLOR_SCHEME = "(prefers-color-scheme: dark)";
const SAFE_AREA = { top: "top", bottom: "bottom", start: "left", end: "right" } as const;

function readEnvironment(): EnvironmentData {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const inset = (edge: keyof typeof SAFE_AREA) => parseFloat(style.getPropertyValue(`--weft-safe-${edge}`)) || 0;
  return {
    colorScheme: window.matchMedia(COLOR_SCHEME).matches ? "dark" : "light",
    screen: { width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio },
    safeArea: { top: inset("top"), bottom: inset("bottom"), start: inset("start"), end: inset("end") },
  };
}

function observeEnvironment(notify: () => void): void {
  const style = document.documentElement.style;
  for (const [edge, side] of Object.entries(SAFE_AREA)) {
    style.setProperty(`--weft-safe-${edge}`, `env(safe-area-inset-${side}, 0px)`);
  }
  window.matchMedia(COLOR_SCHEME).addEventListener("change", notify);
  window.addEventListener("resize", notify);
  // A monitor/DPR change need not resize the viewport in logical pixels.
  function watchScale(): void {
    window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener("change", () => {
      watchScale();
      notify();
    }, { once: true });
  }
  watchScale();
}

class WebPlatform extends Environment {
  readonly os = "web";
  get version(): string {
    return typeof navigator === "object" && navigator !== null ? navigator.userAgent : "";
  }
}

/** Browser platform, user agent and window environment. */
export const platform = /* @__PURE__ */ new WebPlatform(readEnvironment, observeEnvironment);

/** Checks whether the browser currently exposes the requested capability. */
export function isSupported(api: PlatformModule): boolean {
  if (api === "ui") return typeof document !== "undefined" && typeof HTMLDialogElement !== "undefined";
  return api === "fetch" ? typeof globalThis.fetch === "function" : localStorage() !== null;
}
