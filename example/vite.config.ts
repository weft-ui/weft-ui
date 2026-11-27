import { defineConfig } from "vite";
import weft from "@weft-ui/vite";
import { componentName, pages } from "./scripts/pages.ts";

export default defineConfig({
  plugins: [weft({
    app: { id: "net.mioyi.weftui.showcase", name: "Weft Showcase" },
    include: "src/App.weft",
    // The showcase pages and the Inter fonts they use stay out of the main package.
    wechat: { subPackages: { showcase: pages("wechat").map((page) => `${componentName(page)}Page`) } },
  })],
});
