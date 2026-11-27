import type { PlatformModule } from "@weft-ui/runtime/protocol";
import { createLifecycle } from "./lifecycle.ts";

let visibility: (state: "foreground" | "background") => void = () => {};
const appLifecycle = createLifecycle(() => {
  const options = wx.getLaunchOptionsSync();
  if (!options.path) return null;
  const query = Object.entries(options.query ?? {}).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  return `/${options.path.replace(/^\//, "")}${query ? `?${query}` : ""}`;
}, (change, memory) => { visibility = change; wx.onMemoryWarning(memory); });
export const lifecycle = appLifecycle.api;
import { view, wechatRouteURL, type View, type WechatSink } from "@weft-ui/runtime/wechat";
import type { PageClass } from "@weft-ui/runtime/navigation";
import { Environment, type EnvironmentData } from "./environment.ts";
import { PlatformError } from "./error.ts";
import { createUI } from "./ui.ts";
import type { App as WeftApp, ColorScheme, RequestInit, Response } from "./index.d.ts";

export { PlatformError } from "./error.ts";
export { navigation } from "@weft-ui/runtime/navigation";
export type { App, RequestInit, Response } from "./index.d.ts";

interface Failure {
  errMsg: string;
}

interface Wx {
  getLaunchOptionsSync(): { path?: string; query?: Record<string, string> };
  onMemoryWarning(listener: () => void): void;
  showModal(options: { title?: string; content?: string; showCancel: boolean; confirmText: string; cancelText?: string; confirmColor?: string; success(result: { confirm: boolean }): void; fail(error: Failure): void }): void;
  showActionSheet(options: { alertText?: string; itemList: string[]; success(result: { tapIndex: number }): void; fail(error: Failure): void }): void;
  showToast(options: { title: string; icon: "none" | "success" | "error"; duration: number }): void;
  request(options: {
    url: string;
    method?: string;
    header?: Record<string, string>;
    data?: string | ArrayBuffer;
    responseType: "arraybuffer";
    success(result: { statusCode: number; data: ArrayBuffer }): void;
    fail(error: Failure): void;
  }): void;
  getStorage(options: {
    key: string;
    success(result: { data: string }): void;
    fail(error: Failure): void;
  }): void;
  setStorage(options: {
    key: string;
    data: string;
    success(): void;
    fail(error: Failure): void;
  }): void;
  removeStorage(options: {
    key: string;
    success(): void;
    fail(error: Failure): void;
  }): void;
  getAppBaseInfo(): { version: string; theme?: ColorScheme };
  getWindowInfo(): {
    windowWidth: number;
    windowHeight: number;
    pixelRatio: number;
    screenTop: number;
    safeArea?: { top: number; bottom: number; left: number; right: number };
  };
  onThemeChange(listener: () => void): void;
  onWindowResize(listener: () => void): void;
}

declare const wx: Wx;
declare function App(options: {
  onShow(options: { path?: string; query?: Record<string, string> }): void;
  onHide(): void;
  weft: {
    view: typeof view;
    mount(target: never): void;
    unmount(): void;
    page(name: string): object;
  };
}): void;
declare function getCurrentPages(): unknown[];

// Decode UTF-8 without relying on TextDecoder in mini program logic layers.
// Invalid sequences use U+FFFD, consuming only their valid prefix.
function decodeUtf8(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let text = "";
  let i = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (i < bytes.length) {
    const first = bytes[i++];
    if (first < 0x80) {
      text += String.fromCharCode(first);
      continue;
    }
    let remaining: number;
    let point: number;
    let lower = 0x80;
    let upper = 0xbf;
    if (first >= 0xc2 && first <= 0xdf) {
      remaining = 1;
      point = first & 0x1f;
    } else if (first >= 0xe0 && first <= 0xef) {
      remaining = 2;
      point = first & 0x0f;
      if (first === 0xe0) lower = 0xa0;
      if (first === 0xed) upper = 0x9f;
    } else if (first >= 0xf0 && first <= 0xf4) {
      remaining = 3;
      point = first & 0x07;
      if (first === 0xf0) lower = 0x90;
      if (first === 0xf4) upper = 0x8f;
    } else {
      text += "\ufffd";
      continue;
    }
    while (remaining > 0 && i < bytes.length && bytes[i] >= lower && bytes[i] <= upper) {
      point = (point << 6) | (bytes[i++] & 0x3f);
      remaining--;
      lower = 0x80;
      upper = 0xbf;
    }
    text += remaining === 0 ? String.fromCodePoint(point) : "\ufffd";
  }
  return text;
}

function response(status: number, data: ArrayBuffer): Response {
  let decoded: string | undefined;

  return {
    status,
    ok: status >= 200 && status < 300,
    async text() { return decoded ??= decodeUtf8(data); },
    async json() { return JSON.parse(decoded ??= decodeUtf8(data)) as unknown; },
    async arrayBuffer() { return data; },
  };
}

/** Registers the app lifecycle and generated-view factory with the WeChat host. */
export function run(app: WeftApp): void {
  appLifecycle.init();
  let sink: WechatSink | undefined;
  const application = app as WeftApp & {
    $config?: { pages: readonly PageClass[]; tabs?: readonly { page: PageClass }[] };
    $initialRoute?(url: string): void;
    $restore?(urls: readonly string[]): void;
    $open?(url: string, host?: boolean): boolean;
  };
  type HostPage = {
    route?: string;
    options?: Record<string, string>;
    selectComponent(id: string): View;
    setData(data: Record<string, unknown>): void;
    $weftIndex: number;
    $weftQuery: Record<string, string>;
    $weftPath?: string;
    $weftView?: View;
  };
  const pageURL = (path: string, query: Readonly<Record<string, string>>) => {
    const args = Object.entries(query).filter(([key]) => key !== "__w")
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
    return `/${path.replace(/^\//, "")}${args ? `?${args}` : ""}`;
  };
  let shown = false;
  let incoming: string | null = null;
  App({
    onShow: (options) => {
      visibility("foreground");
      if (shown && options?.path) incoming = pageURL(options.path, options.query ?? {});
      shown = true;
    },
    onHide: () => visibility("background"),
    weft: {
      view,
      mount: (target) => app.mount(target),
      unmount: () => app.unmount(),
      page: (name) => ({
        onLoad(this: HostPage, query: Record<string, string>) {
          this.$weftQuery = query;
          this.$weftPath = this.route ?? `weft/pages/${name.replace(/([A-Z])/g, (letter, _match, offset: number) => `${offset ? "-" : ""}${letter.toLowerCase()}`)}/index`;
          if (query.__w) sink?.selectTab(name);
        },
        onReady(this: HostPage) {
          const hostPages = getCurrentPages() as HostPage[];
          const isTab = application.$config?.tabs?.some(tab => tab.page.$route.name === name) ?? false;
          this.$weftIndex = isTab ? 0 : hostPages.length - 1;
          const component = this.selectComponent("#weft");
          this.$weftView = component;
          const pages = application.$config?.pages ?? [];
          const path = this.$weftPath ?? this.route ?? "";
          const route = wechatRouteURL(pages, path, this.$weftQuery ?? {});
          if (!sink) {
            sink = component.$sink;
            sink?.configurePages(pages);
            sink?.configureTabs(application.$config?.tabs?.map(tab => tab.page.$route.name) ?? []);
            if (route) application.$initialRoute?.(route);
            app.mount(component as never);
          } else if (!this.$weftQuery?.__w) {
            const routes = hostPages.map(page => wechatRouteURL(pages, page.$weftPath ?? page.route ?? "", page.$weftQuery ?? page.options ?? {}));
            if (routes.every((url): url is string => url !== null)) application.$restore?.(routes);
            if (incoming || !isTab) application.$open?.(incoming ?? pageURL(path, this.$weftQuery ?? {}), true);
            incoming = null;
          }
          sink?.bindPage(this.$weftIndex, component);
          sink?.bindModal(this.selectComponent("#modal"), this, this.$weftIndex);
          sink?.showPage(this.$weftIndex);
        },
        onShow(this: HostPage) {
          const isTab = application.$config?.tabs?.some(tab => tab.page.$route.name === name) ?? false;
          if (isTab && this.$weftView) {
            sink?.selectTab(name);
            if (this.$weftView) {
              sink?.bindPage(0, this.$weftView);
              sink?.bindModal(this.selectComponent("#modal"), this, 0);
            }
          }
          if (this.$weftView) {
            if (incoming) { application.$open?.(incoming, true); incoming = null; }
            sink?.showPage(this.$weftIndex);
          }
        },
        $dismissed() {
          sink?.dismissed();
        },
        onUnload(this: HostPage) {
          sink?.unloadPage(this.$weftIndex, this.$weftView);
        },
      }),
    },
  });
}

/** Sends a binary request through wx.request and exposes portable body readers. */
export async function fetch(url: string, init?: RequestInit): Promise<Response> {
  if (!isSupported("fetch")) throw new PlatformError("fetch", "wechat");
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: init?.method,
      header: init?.headers,
      data: init?.body,
      responseType: "arraybuffer",
      success: ({ statusCode, data }) => resolve(response(statusCode, data)),
      fail: ({ errMsg }) => reject(new TypeError(errMsg)),
    });
  });
}

/** Promise-based access to WeChat's persistent string storage. */
export const storage = {
  async get(key: string): Promise<string | null> {
    if (!isSupported("storage")) throw new PlatformError("storage", "wechat");
    return new Promise((resolve, reject) => {
      wx.getStorage({
        key,
        success: ({ data }) => resolve(data),
        fail: ({ errMsg }) => {
          if (errMsg.includes("data not found")) resolve(null);
          else reject(new Error(errMsg));
        },
      });
    });
  },
  async set(key: string, value: string): Promise<void> {
    if (!isSupported("storage")) throw new PlatformError("storage", "wechat");
    return new Promise((resolve, reject) => {
      wx.setStorage({
        key,
        data: value,
        success: () => resolve(),
        fail: ({ errMsg }) => reject(new Error(errMsg)),
      });
    });
  },
  async remove(key: string): Promise<void> {
    if (!isSupported("storage")) throw new PlatformError("storage", "wechat");
    return new Promise((resolve, reject) => {
      wx.removeStorage({
        key,
        success: () => resolve(),
        fail: ({ errMsg }) => reject(new Error(errMsg)),
      });
    });
  },
};

// WeChat rejects a call whose optional parameters are present but undefined.
function defined<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export const ui = createUI({
  alert(options) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    if (!isSupported("ui")) return Promise.reject(new PlatformError("ui", "wechat"));
    wx.showModal({ ...defined({ title: options.title, content: options.message }), showCancel: false, confirmText: options.confirmText ?? "OK", success: () => resolve(), fail: (error) => reject(new Error(error.errMsg)) });
    return promise;
  },
  confirm(options) {
    const { promise, resolve, reject } = Promise.withResolvers<boolean>();
    if (!isSupported("ui")) return Promise.reject(new PlatformError("ui", "wechat"));
    wx.showModal({ ...defined({ title: options.title, content: options.message, confirmColor: options.destructive ? "#d22" : undefined }), showCancel: true, confirmText: options.confirmText ?? "OK", cancelText: options.cancelText ?? "Cancel", success: (result) => resolve(result.confirm), fail: (error) => error.errMsg.includes("cancel") ? resolve(false) : reject(new Error(error.errMsg)) });
    return promise;
  },
  actionSheet(options) {
    const { promise, resolve, reject } = Promise.withResolvers<number | null>();
    if (!isSupported("ui")) return Promise.reject(new PlatformError("ui", "wechat"));
    wx.showActionSheet({ ...defined({ alertText: options.title }), itemList: [...options.options], success: (result) => resolve(result.tapIndex), fail: (error) => error.errMsg.includes("cancel") ? resolve(null) : reject(new Error(error.errMsg)) });
    return promise;
  },
  toast(message, options) {
    if (!isSupported("ui")) throw new PlatformError("ui", "wechat");
    wx.showToast({ title: message, icon: options.icon ?? "none", duration: options.duration === "long" ? 3000 : 1500 });
  },
});

function readEnvironment(): EnvironmentData {
  const { windowWidth, windowHeight, pixelRatio, screenTop, safeArea } = wx.getWindowInfo();
  return {
    colorScheme: wx.getAppBaseInfo().theme,
    screen: { width: windowWidth, height: windowHeight, scale: pixelRatio },
    // WeChat reports safe-area edges relative to the screen, not the window.
    safeArea: safeArea && {
      top: Math.max(0, safeArea.top - screenTop),
      bottom: Math.max(0, screenTop + windowHeight - safeArea.bottom),
      start: Math.max(0, safeArea.left),
      end: Math.max(0, windowWidth - safeArea.right),
    },
  };
}

function observeEnvironment(notify: () => void): void {
  wx.onThemeChange(notify);
  wx.onWindowResize(notify);
}

class WechatPlatform extends Environment {
  readonly os = "wechat";
  get version(): string { return wx.getAppBaseInfo().version; }
}

/** WeChat host version and window environment; imports do not access wx. */
export const platform = /* @__PURE__ */ new WechatPlatform(readEnvironment, observeEnvironment);

/** Checks whether all host functions for the requested capability exist. */
export function isSupported(api: PlatformModule): boolean {
  if (typeof wx === "undefined") return false;
  if (api === "ui") return typeof wx.showModal === "function" && typeof wx.showActionSheet === "function" && typeof wx.showToast === "function";
  if (api === "navigation") return "switchTab" in wx && "setTabBarBadge" in wx;
  return api === "fetch"
    ? typeof wx.request === "function"
    : typeof wx.getStorage === "function"
      && typeof wx.setStorage === "function"
      && typeof wx.removeStorage === "function";
}
