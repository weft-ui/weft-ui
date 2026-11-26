import { platform, run } from "@weft-ui/platform";
import manifest from "../pages.json" with { type: "json" };
import { Showcase } from "./App.weft";

// The catalog generator validates these keys and declares the matching model fields.
type Model = ConstructorParameters<typeof Showcase>[0];
const props = Object.fromEntries(manifest.flatMap(({ props }) => Object.entries(props ?? {}))) as Record<Exclude<keyof Model, "safeArea">, string[]>;
const app = new Showcase({ ...props, safeArea: platform.safeArea });
platform.onChange(() => Object.assign(app.model.safeArea, platform.safeArea));
run(app);
