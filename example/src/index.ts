import { platform, run, ui } from "@weft-ui/platform";
import manifest from "../pages.json" with { type: "json" };
import { Showcase } from "./App.weft";

// The catalog generator validates these keys and declares the matching model fields.
type Model = ConstructorParameters<typeof Showcase>[0];
const props = Object.fromEntries(manifest.flatMap(({ props }) => Object.entries(props ?? {}))) as Record<Exclude<keyof Model, "safeArea">, string[]>;
const app = new Showcase({ ...props, safeArea: platform.safeArea });
platform.onChange(() => Object.assign(app.model.safeArea, platform.safeArea));

// The native catalogs omit this pending page, so register by event name rather
// than depending on methods generated only for the web and WeChat catalogs.
const showResult = (result: string) => {
  (app.model as Model & { overlayResult: readonly string[] }).overlayResult = [result];
};
app.$on("OverlayAlert", async () => {
  await ui.alert({ title: "Alert", message: "This is an alert." });
  showResult("Alert dismissed.");
});
app.$on("OverlayConfirm", async () => {
  const confirmed = await ui.confirm({ title: "Confirm", message: "Continue?" });
  showResult(confirmed ? "Confirmed." : "Cancelled.");
});
app.$on("OverlayActionSheet", async () => {
  const selected = await ui.actionSheet({ title: "Choose an option", options: ["First", "Second", "Third"] });
  showResult(selected === null ? "Action sheet cancelled." : `Selected option ${selected + 1}.`);
});
app.$on("OverlayToast", () => {
  ui.toast("This is a toast.");
  showResult("Toast shown.");
});
run(app);
