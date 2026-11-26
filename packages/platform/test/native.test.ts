import { onSignal, type Kernel } from "@weft-ui/runtime/native";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import type * as Native from "../src/native.ts";

// Vite defines `__WEFT_PLATFORM__` in builds and the module reads it on load,
// so it is imported dynamically once the global exists.
(globalThis as { __WEFT_PLATFORM__?: string }).__WEFT_PLATFORM__ = "ios";
let native: typeof Native;
beforeAll(async () => {
  native = await import("../src/native.ts");
});

interface Call {
  module: string;
  method: string;
  args: Uint8Array;
}

/** A kernel whose shell implements `modules`, answering calls with `reply`. */
function installKernel(modules: string[], reply: (call: Call) => Uint8Array | string) {
  const calls: Call[] = [];
  const encoder = new TextEncoder();
  const kernel: Kernel = {
    protocol: 3,
    version: "17.4",
    environment: "{}",
    launch: "{}",
    on: vi.fn(),
    listen: vi.fn(),
    open: vi.fn(),
    commit: vi.fn(),
    close: vi.fn(),
    supports: (module) => modules.includes(module),
    async call(module, method, args) {
      const bytes = typeof args === "string" ? encoder.encode(args) : new Uint8Array(args as ArrayBuffer);
      const call = { module, method, args: bytes };
      calls.push(call);
      const result = reply(call);
      const out = typeof result === "string" ? encoder.encode(result) : result;
      return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
    },
  };
  globalThis.__weft = kernel;
  return { kernel, calls };
}

/** `u32 head length | JSON head | body`, the framing of the fetch module. */
function frame(head: unknown, body: string): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(head));
  const rest = new TextEncoder().encode(body);
  const bytes = new Uint8Array(4 + json.length + rest.length);
  new DataView(bytes.buffer).setUint32(0, json.length, true);
  bytes.set(json, 4);
  bytes.set(rest, 4 + json.length);
  return bytes;
}

afterEach(() => {
  delete globalThis.__weft;
});

test("native signal subscriptions share kernel callbacks and unsubscribe independently", () => {
  const { kernel } = installKernel([], () => "");
  const first = vi.fn();
  const second = vi.fn();
  const other = vi.fn();
  const offFirst = onSignal("lifecycle", first);
  const offSecond = onSignal("lifecycle", second);
  const offOther = onSignal("memory", other);
  expect(kernel.on).toHaveBeenCalledTimes(2);
  const registrations = vi.mocked(kernel.on).mock.calls;
  const lifecycle = registrations[0]![1];
  const memory = registrations[1]![1];
  lifecycle('{"state":"background"}');
  expect(first).toHaveBeenCalledWith('{"state":"background"}');
  expect(second).toHaveBeenCalledWith('{"state":"background"}');
  expect(other).not.toHaveBeenCalled();
  offFirst();
  lifecycle('{"state":"foreground"}');
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(2);
  memory("{}");
  expect(other).toHaveBeenCalledWith("{}");
  offSecond();
  offOther();
});

test("storage sends JSON arguments to the storage module", async () => {
  const stored = new Map<string, string>();
  const { calls } = installKernel(["storage"], ({ method, args }) => {
    const [key, value] = JSON.parse(new TextDecoder().decode(args)) as string[];
    if (method === "set") stored.set(key!, value!);
    if (method === "remove") stored.delete(key!);
    return method === "get" ? JSON.stringify(stored.get(key!) ?? null) : "";
  });
  expect(await native.storage.get("k")).toBeNull();
  await native.storage.set("k", "v");
  expect(await native.storage.get("k")).toBe("v");
  await native.storage.remove("k");
  expect(stored.size).toBe(0);
  expect(calls.map((c) => `${c.module}.${c.method}`)).toEqual([
    "storage.get", "storage.set", "storage.get", "storage.remove",
  ]);
});

test("fetch frames the request and reads the framed response", async () => {
  const { calls } = installKernel(["fetch"], () => frame({ status: 201 }, '{"ok":true}'));
  const response = await native.fetch("https://example.com", { method: "POST", headers: { a: "b" }, body: "hi" });
  expect(response.status).toBe(201);
  expect(response.ok).toBe(true);
  expect(await response.json()).toEqual({ ok: true });
  expect(new TextDecoder().decode(await response.arrayBuffer())).toBe('{"ok":true}');
  const args = calls[0]!.args;
  expect(args).toEqual(frame({ url: "https://example.com", method: "POST", headers: { a: "b" } }, "hi"));
});

test("APIs the shell does not implement reject with PlatformError", async () => {
  installKernel([], () => "");
  expect(native.isSupported("fetch")).toBe(false);
  await expect(native.fetch("https://example.com")).rejects.toThrow(new native.PlatformError("fetch", "ios"));
  await expect(native.storage.get("k")).rejects.toBeInstanceOf(native.PlatformError);
});

test("ui rejects when unsupported and forwards JSON when supported", async () => {
  installKernel([], () => "");
  expect(native.isSupported("ui")).toBe(false);
  await expect(native.ui.alert({})).rejects.toBeInstanceOf(native.PlatformError);
  await expect(native.ui.confirm({})).rejects.toBeInstanceOf(native.PlatformError);
  await expect(native.ui.actionSheet({ options: ["A"] })).rejects.toBeInstanceOf(native.PlatformError);
  expect(() => native.ui.toast("message")).toThrow(native.PlatformError);
  const { calls } = installKernel(["ui"], ({ method }) => method === "confirm" ? "true" : method === "actionSheet" ? "0" : "");
  await native.ui.alert({ title: "Hello" });
  expect(await native.ui.confirm({ message: "Sure?" })).toBe(true);
  expect(await native.ui.actionSheet({ options: ["A"] })).toBe(0);
  native.ui.toast("Done", { duration: "long" });
  expect(calls.map(({ module, method, args }) => [module, method, JSON.parse(new TextDecoder().decode(args))])).toEqual([
    ["ui", "alert", { title: "Hello" }],
    ["ui", "confirm", { message: "Sure?" }],
    ["ui", "actionSheet", { options: ["A"] }],
    ["ui", "toast", { message: "Done", duration: "long" }],
  ]);
});

test("platform reports the OS version of the shell, run mounts through the kernel", () => {
  const { kernel } = installKernel([], () => "");
  expect(native.platform).toMatchObject({ os: "ios", version: "17.4" });
  const app = { mount: vi.fn(), unmount: vi.fn() };
  native.run(app);
  const sink = app.mount.mock.calls[0]![0] as { open(session: object): void };
  const dispatch = vi.fn(() => false);
  const window = vi.fn();
  sink.open({ hash: "abc", dispatch, window, detach() {} });
  expect(kernel.open).toHaveBeenCalledWith("abc", expect.any(Function), 3, expect.any(Function));
  const [, dispatchCallback, , windowCallback] = vi.mocked(kernel.open).mock.calls[0]!;
  expect(dispatchCallback(1, 2, "value")).toBe(false);
  expect(dispatch).toHaveBeenCalledWith(1, 2, "value");
  windowCallback(3, 4, 5, 6);
  expect(window).toHaveBeenCalledWith(3, 4, 5, 6);
});
