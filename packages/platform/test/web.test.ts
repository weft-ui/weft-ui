// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { fetch, isSupported, lifecycle, platform, PlatformError, run, storage } from "../src/web.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.body.innerHTML = "";
});

test("lifecycle tracks visibility and preserves the initial URL", () => {
  const background = vi.fn(); const foreground = vi.fn(); const memory = vi.fn();
  const stop = lifecycle.onBackground(background);
  const stopForeground = lifecycle.onForeground(foreground);
  const stopMemory = lifecycle.onMemoryWarning(memory);
  const initial = lifecycle.launch.url;
  history.pushState({}, "", "/another");
  expect(lifecycle.launch.url).toBe(initial);
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(lifecycle.state).toBe("background");
  expect(background).toHaveBeenCalledOnce();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(foreground).toHaveBeenCalledOnce();
  expect(memory).not.toHaveBeenCalled();
  stop(); stopForeground(); stopMemory(); vi.restoreAllMocks();
});

test("fetch delegates the URL, headers and binary body to the browser", async () => {
  const response = new Response("hello", { status: 201 });
  const nativeFetch = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", nativeFetch);
  const body = new Uint8Array([1, 2, 3]).buffer;
  const init = { method: "POST", headers: { "X-Test": "yes" }, body };

  expect(isSupported("fetch")).toBe(true);
  expect(await fetch("https://example.test/data", init)).toBe(response);
  expect(nativeFetch).toHaveBeenCalledExactlyOnceWith("https://example.test/data", init);
  expect(await response.text()).toBe("hello");
});

test("fetch preserves browser network failures", async () => {
  const error = new TypeError("network unavailable");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
  await expect(fetch("https://example.test")).rejects.toBe(error);
});

test("storage round-trips strings and removes keys", async () => {
  expect(isSupported("storage")).toBe(true);
  expect(await storage.get("theme")).toBeNull();
  await storage.set("theme", "深色 🌙");
  expect(localStorage.getItem("theme")).toBe("深色 🌙");
  expect(await storage.get("theme")).toBe("深色 🌙");
  await storage.remove("theme");
  expect(await storage.get("theme")).toBeNull();
});

test("storage rejects host errors instead of throwing synchronously", async () => {
  const error = new Error("quota exceeded");
  vi.stubGlobal("localStorage", { setItem() { throw error; } });
  await expect(storage.set("theme", "dark")).rejects.toBe(error);
});

test("run mounts into #app and reports a missing root clearly", () => {
  const app = { mount: vi.fn(), unmount: vi.fn() };
  expect(() => run(app)).toThrow('weft: run() requires an element with id "app"');
  const target = document.createElement("main");
  target.id = "app";
  document.body.append(target);
  run(app);
  expect(app.mount).toHaveBeenCalledExactlyOnceWith(target);
  expect(app.unmount).not.toHaveBeenCalled();
});

test("missing fetch rejects with the public PlatformError", async () => {
  vi.stubGlobal("fetch", undefined);
  expect(isSupported("fetch")).toBe(false);
  const result = fetch("https://example.test");
  expect(result).toBeInstanceOf(Promise);
  await expect(result).rejects.toBeInstanceOf(PlatformError);
  await expect(result).rejects.toMatchObject({
    api: "fetch", name: "PlatformError", message: "fetch is not supported on web",
  });
});

test.each(["missing", "blocked"])("%s localStorage rejects with PlatformError", async (mode) => {
  vi.stubGlobal("localStorage", undefined);
  if (mode === "blocked") {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new DOMException("Access denied", "SecurityError"); },
    });
  }
  expect(isSupported("storage")).toBe(false);
  for (const result of [storage.get("key"), storage.set("key", "value"), storage.remove("key")]) {
    expect(result).toBeInstanceOf(Promise);
    await expect(result).rejects.toBeInstanceOf(PlatformError);
    await expect(result).rejects.toMatchObject({
      api: "storage", name: "PlatformError", message: "storage is not supported on web",
    });
  }
});

test("platform reports the browser user agent", () => {
  expect(platform.os).toBe("web");
  expect(platform.version).toBe(navigator.userAgent);
});
