// Event handlers of the showcase pages, keyed by pages.json id. The generated
// src/catalog.ts calls the matching function from each page's factory.
import { lifecycle, platform, ui } from "@weft-ui/platform";
import type { LifecyclePage, ListExamplePage, OverlaysPage, SafeareaPage } from "./App.weft";

// Lifecycle events are counted for the whole run and shown on the open Lifecycle page.
const lifecycleCounts = [0, 0, 0];
let lifecyclePage: LifecyclePage | undefined;
const showLifecycleCounts = () => {
  if (!lifecyclePage) return;
  lifecyclePage.model.lifecycleCounts = ["Foreground", "Background", "Memory warnings"].map((label, i) => `${label}: ${lifecycleCounts[i]}`);
};
const countLifecycle = (index: number) => () => {
  lifecycleCounts[index]!++;
  showLifecycleCounts();
};
lifecycle.onForeground(countLifecycle(0));
lifecycle.onBackground(countLifecycle(1));
lifecycle.onMemoryWarning(countLifecycle(2));

export const setup = {
  lifecycle(page: LifecyclePage) {
    lifecyclePage = page;
    showLifecycleCounts();
  },
  list(page: ListExamplePage) {
    const rows = (start: number, count: number) => Array.from({ length: count }, (_, index) => (start + index) % 3 === 0 ? `Row ${start + index + 1} — a longer note from the trail` : `Row ${start + index + 1}`);
    page.model.listRows = rows(0, 1000);
    page.onListEndReached(() => { page.model.listRows = [...page.model.listRows, ...rows(page.model.listRows.length, 10)]; });
    page.onListRefresh(() => { page.model.listRefreshing = true; setTimeout(() => { page.model.listRows = rows(0, 1000); page.model.listRefreshing = false; }, 500); });
  },
  safearea(page: SafeareaPage) {
    let unsubscribe = () => {};
    page.onShow(() => {
      Object.assign(page.model.safeArea, platform.safeArea);
      unsubscribe = platform.onChange(() => Object.assign(page.model.safeArea, platform.safeArea));
    });
    page.onHide(() => unsubscribe());
  },
  overlays(page: OverlaysPage) {
    const showResult = (result: string) => {
      page.model.overlayResult = [result];
    };
    page.onOverlayAlert(async () => {
      await ui.alert({ title: "Alert", message: "This is an alert." });
      showResult("Alert dismissed.");
    });
    page.onOverlayConfirm(async () => {
      const confirmed = await ui.confirm({ title: "Confirm", message: "Continue?" });
      showResult(confirmed ? "Confirmed." : "Cancelled.");
    });
    page.onOverlayActionSheet(async () => {
      const selected = await ui.actionSheet({ title: "Choose an option", options: ["First", "Second", "Third"] });
      showResult(selected === null ? "Action sheet cancelled." : `Selected option ${selected + 1}.`);
    });
    page.onOverlayToast(() => {
      ui.toast("This is a toast.");
      showResult("Toast shown.");
    });
  },
};
