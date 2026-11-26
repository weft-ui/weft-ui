import type { Kernel } from "@weft-ui/runtime/native";
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

test("platform reports the OS version of the shell, run mounts through the kernel", () => {
  const { kernel } = installKernel([], () => "");
  expect(native.platform).toMatchObject({ os: "ios", version: "17.4" });
  const app = { mount: vi.fn(), unmount: vi.fn() };
  native.run(app);
  const sink = app.mount.mock.calls[0]![0] as { open(session: object): void };
  sink.open({ hash: "abc", dispatch: () => true, detach() {} });
  expect(kernel.open).toHaveBeenCalledWith("abc", expect.any(Function), 3);
});
