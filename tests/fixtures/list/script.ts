import type { Script } from "../../conformance/harness.ts";
import { ListFixture } from "./ListFixture.weft";

export const script: Script<ListFixture> = {
  dir: import.meta.dirname,
  entry: "ListFixture.weft",
  component: "ListFixture",
  App: ListFixture,
  model: () => ({
    items: Array.from({ length: 50 }, (_, id) => ({ id, label: `row ${id}` })),
    cells: Array.from({ length: 10 }, (_, id) => ({ id, label: `cell ${id}` })),
  }),
  setup() {},
  steps: [
    { name: "window 10 to 30", run: (ui) => ui.window("List", 0, 10, 30) },
    { name: "insert at head", run: (_, model) => { model.items = [{ id: 50, label: "row 50" }, { id: 51, label: "row 51" }, ...model.items]; } },
    { name: "append at tail", run: (_, model) => { model.items = [...model.items, ...Array.from({ length: 5 }, (_, i) => ({ id: 52 + i, label: `row ${52 + i}` }))]; } },
    { name: "remove an item", run: (_, model) => { model.items = model.items.filter((item) => item.id !== 15); } },
    { name: "reverse", run: (_, model) => { model.items = [...model.items].reverse(); } },
    { name: "update visible item", run: (_, model) => { model.items[15]!.label = "visible updated"; } },
    { name: "update hidden item", run: (_, model) => { model.items[45]!.label = "hidden updated"; } },
  ],
};
