import type { PlatformModule } from "@weft-ui/runtime/protocol";
import { Environment, type EnvironmentData } from "./environment.ts";
import { PlatformError } from "./error.ts";
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
  return api === "fetch" ? typeof globalThis.fetch === "function" : localStorage() !== null;
}
