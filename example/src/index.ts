import { platform, run, ui } from "@weft-ui/platform";
import manifest from "../pages.json" with { type: "json" };
import { Showcase } from "./App.weft";

// The catalog generator validates these keys and declares the matching model fields.
type Model = ConstructorParameters<typeof Showcase>[0];
const props = Object.fromEntries(manifest.flatMap(({ props }) => Object.entries(props ?? {}))) as Record<Exclude<keyof Model, "safeArea">, string[]>;
const app = new Showcase({ ...props, safeArea: platform.safeArea });
platform.onChange(() => Object.assign(app.model.safeArea, platform.safeArea));

const showResult = (result: string) => {
  app.model.overlayResult = [result];
};
app.onOverlayAlert(async () => {
  await ui.alert({ title: "Alert", message: "This is an alert." });
  showResult("Alert dismissed.");
});
app.onOverlayConfirm(async () => {
  const confirmed = await ui.confirm({ title: "Confirm", message: "Continue?" });
  showResult(confirmed ? "Confirmed." : "Cancelled.");
});
app.onOverlayActionSheet(async () => {
  const selected = await ui.actionSheet({ title: "Choose an option", options: ["First", "Second", "Third"] });
  showResult(selected === null ? "Action sheet cancelled." : `Selected option ${selected + 1}.`);
});
app.onOverlayToast(() => {
  ui.toast("This is a toast.");
  showResult("Toast shown.");
});
run(app);
