import type { PlatformModule } from "@weft-ui/runtime/protocol";
import { view, type View, type WechatSink } from "@weft-ui/runtime/wechat";
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
  let sink: WechatSink | undefined;
  const application = app as WeftApp & {
    $config?: { pages: readonly PageClass[]; tabs?: readonly { page: PageClass }[] };
    $initialRoute?(url: string): void;
  };
  type HostPage = {
    selectComponent(id: string): View;
    $weftIndex: number;
    $weftQuery: Record<string, string>;
    $weftView?: View;
  };
  App({
    weft: {
      view,
      mount: (target) => app.mount(target),
      unmount: () => app.unmount(),
      page: (name) => ({
        onLoad(this: HostPage, query: Record<string, string>) {
          this.$weftQuery = query;
          sink?.selectTab(name);
        },
        onReady(this: HostPage) {
          const isTab = application.$config?.tabs?.some(tab => tab.page.$route.name === name) ?? false;
          this.$weftIndex = isTab ? 0 : getCurrentPages().length - 1;
          const component = this.selectComponent("#weft");
          this.$weftView = component;
          if (!sink) {
            sink = component.$sink;
            const pages = application.$config?.pages ?? [];
            sink?.configurePages(pages);
            sink?.configureTabs(application.$config?.tabs?.map(tab => tab.page.$route.name) ?? []);
            const route = pages.find((page) => page.$route.name === name)?.$route;
            if (route) {
              const query = this.$weftQuery ?? {};
              const path = route.path.map((segment) => segment.startsWith("{") && segment.endsWith("}")
                ? encodeURIComponent(query[segment.slice(1, -1)] ?? "") : segment).join("/");
              const args = Object.entries(query).filter(([key]) => key !== "__w")
                .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
              application.$initialRoute?.(`/${path}${args ? `?${args}` : ""}`);
            }
            app.mount(component as never);
          }
          sink?.bindPage(this.$weftIndex, component);
          sink?.showPage(this.$weftIndex);
        },
        onShow(this: HostPage) {
          const isTab = application.$config?.tabs?.some(tab => tab.page.$route.name === name) ?? false;
          if (isTab) {
            sink?.selectTab(name);
            if (this.$weftView) sink?.bindPage(0, this.$weftView);
          }
          if (this.$weftView) sink?.showPage(this.$weftIndex);
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

export const ui = createUI({
  alert(options) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    if (!isSupported("ui")) return Promise.reject(new PlatformError("ui", "wechat"));
    wx.showModal({ title: options.title, content: options.message, showCancel: false, confirmText: options.confirmText ?? "OK", success: () => resolve(), fail: (error) => reject(new Error(error.errMsg)) });
    return promise;
  },
  confirm(options) {
    const { promise, resolve, reject } = Promise.withResolvers<boolean>();
    if (!isSupported("ui")) return Promise.reject(new PlatformError("ui", "wechat"));
    wx.showModal({ title: options.title, content: options.message, showCancel: true, confirmText: options.confirmText ?? "OK", cancelText: options.cancelText ?? "Cancel", confirmColor: options.destructive ? "#d22" : undefined, success: (result) => resolve(result.confirm), fail: (error) => error.errMsg.includes("cancel") ? resolve(false) : reject(new Error(error.errMsg)) });
    return promise;
  },
  actionSheet(options) {
    const { promise, resolve, reject } = Promise.withResolvers<number | null>();
    if (!isSupported("ui")) return Promise.reject(new PlatformError("ui", "wechat"));
    wx.showActionSheet({ alertText: options.title, itemList: [...options.options], success: (result) => resolve(result.tapIndex), fail: (error) => error.errMsg.includes("cancel") ? resolve(null) : reject(new Error(error.errMsg)) });
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
