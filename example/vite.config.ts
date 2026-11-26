import { defineConfig } from "vite";
import weft from "@weft-ui/vite";

export default defineConfig({
  plugins: [weft({
    app: { id: "net.mioyi.weftui.showcase", name: "Weft Showcase" },
    include: "src/App.weft",
  })],
});
