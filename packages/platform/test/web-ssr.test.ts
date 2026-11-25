// @vitest-environment node
import { expect, test, vi } from "vitest";

test("web platform module loads safely when navigator is absent and reads navigator.userAgent lazily", async () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  vi.resetModules();
  Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true, writable: true });
  try {
    const { platform } = await import("../src/web.ts");
    expect(platform.version).toBe("");
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "CustomAgent/2.0" },
      configurable: true,
      writable: true,
    });
    expect(platform.version).toBe("CustomAgent/2.0");
  } finally {
    if (desc) Object.defineProperty(globalThis, "navigator", desc);
    else delete (globalThis as Record<string, unknown>).navigator;
    vi.resetModules();
  }
});
