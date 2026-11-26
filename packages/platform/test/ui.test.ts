// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { createUI } from "../src/ui.ts";
import { ui } from "../src/web.ts";
import { ui as wechatUI } from "../src/wechat.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.head.querySelector("style[data-weft-ui]")?.remove();
});

test("dialogs run FIFO, recover after rejection, and invalid sheets do not enter the queue", async () => {
  const first = Promise.withResolvers<void>();
  const alert = vi.fn().mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error("failed"));
  const confirm = vi.fn().mockResolvedValue(true);
  const actionSheet = vi.fn().mockResolvedValue(0);
  const api = createUI({ alert, confirm, actionSheet, toast: vi.fn() });
  const a = api.alert({});
  const b = api.confirm({});
  await expect(api.actionSheet({ options: [] })).rejects.toBeInstanceOf(RangeError);
  await expect(api.actionSheet({ options: Array(7).fill("x") })).rejects.toBeInstanceOf(RangeError);
  await Promise.resolve();
  expect(alert).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
  first.resolve();
  await a;
  expect(await b).toBe(true);
  await expect(api.alert({})).rejects.toThrow("failed");
  expect(await api.actionSheet({ options: ["one"] })).toBe(0);
});

test("web renders modal dialogs, handles dismissal and replaces toast", async () => {
  const confirm = ui.confirm({ title: "Question", message: "Proceed?", destructive: true });
  await Promise.resolve();
  let dialog = document.querySelector("dialog")!;
  expect(dialog.open).toBe(true);
  expect(dialog.querySelector("h2")?.textContent).toBe("Question");
  expect(dialog.querySelector("p")?.textContent).toBe("Proceed?");
  expect(dialog.querySelector(".weft-destructive")?.textContent).toBe("OK");
  // A browser closes a dialog after an uncancelled Escape cancel event.
  dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
  dialog.close();
  expect(await confirm).toBe(false);
  const sheet = ui.actionSheet({ title: "Choose", options: ["One", "Two"], destructiveIndex: 1 });
  await Promise.resolve();
  await Promise.resolve();
  dialog = document.querySelector("dialog")!;
  expect(dialog.classList.contains("weft-sheet")).toBe(true);
  expect(dialog.querySelector(".weft-destructive")?.textContent).toBe("Two");
  (dialog.querySelectorAll("button")[1] as HTMLButtonElement).click();
  expect(await sheet).toBe(1);
  vi.useFakeTimers();
  ui.toast("first");
  ui.toast("second", { icon: "success", duration: "long" });
  expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(document.querySelector('[role="status"]')?.textContent).toContain("second");
  expect(document.querySelectorAll("style[data-weft-ui]")).toHaveLength(1);
  vi.advanceTimersByTime(3000);
  expect(document.querySelector('[role="status"]')).toBeNull();
});

test("WeChat maps modal, sheet, cancellation and toast options", async () => {
  const showModal = vi.fn((options: { success(result: { confirm: boolean }): void }) => options.success({ confirm: true }));
  const showActionSheet = vi.fn((options: { fail(error: { errMsg: string }): void }) => options.fail({ errMsg: "showActionSheet:fail cancel" }));
  const showToast = vi.fn();
  vi.stubGlobal("wx", { showModal, showActionSheet, showToast });
  await wechatUI.alert({ message: "Hello" });
  expect(showModal).toHaveBeenLastCalledWith(expect.objectContaining({ content: "Hello", showCancel: false, confirmText: "OK" }));
  expect(await wechatUI.confirm({ destructive: true })).toBe(true);
  expect(showModal).toHaveBeenLastCalledWith(expect.objectContaining({ showCancel: true, cancelText: "Cancel", confirmColor: "#d22" }));
  expect(await wechatUI.actionSheet({ title: "Choose", options: ["A"] })).toBeNull();
  expect(showActionSheet).toHaveBeenCalledWith(expect.objectContaining({ alertText: "Choose", itemList: ["A"] }));
  wechatUI.toast("Done", { icon: "success", duration: "long" });
  expect(showToast).toHaveBeenCalledWith({ title: "Done", icon: "success", duration: 3000 });
});
