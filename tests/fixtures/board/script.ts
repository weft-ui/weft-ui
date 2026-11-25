import type { Script } from "../../conformance/harness.ts";
import { Board } from "./Board.weft";

/**
 * Components across files, slot content, nested loops, `if / else if /
 * else`, lifecycle events, and controlled checkboxes.
 */
export const script: Script<Board> = {
  dir: import.meta.dirname,
  entry: "Board.weft",
  component: "Board",
  App: Board,
  model: () => ({
    owner: null,
    note: { text: "note" },
    mode: 0,
    groups: [
      {
        id: 1,
        title: "first",
        items: [
          { id: 10, label: "a", done: false, tags: ["x"] },
          { id: 11, label: "b", done: true, tags: [] },
        ],
      },
      { id: 2, title: "second", items: [{ id: 20, label: "c", done: false, tags: [] }] },
    ],
  }),
  setup(app, log) {
    app.onLoaded(() => log("Loaded"));
    app.onShown((_, { id }) => log(`Shown ${id}`));
    app.onHidden((_, { id }) => log(`Hidden ${id}`));
    app.onToggle((model, { id, value }) => {
      log(`Toggle ${id} ${value}`);
      // Item 11 is locked: its toggles are rejected.
      if (id === 11) return;
      for (const group of model.groups) {
        for (const item of group.items) if (item.id === id) item.done = value;
      }
    });
  },
  steps: [
    { name: "type into the state input", run: (ui) => ui.edit("Input", 0, "z") },
    { name: "click the counter", run: (ui) => ui.click("Button", 0) },
    { name: "toggle an item", run: (ui) => ui.edit("Checkbox", 0, true) },
    { name: "toggle the locked item", run: (ui) => ui.edit("Checkbox", 1, false) },
    {
      name: "set the optional owner",
      run: (_, model) => {
        model.owner = { name: "ann" };
      },
    },
    {
      name: "rename the owner",
      run: (_, model) => {
        model.owner!.name = "bob";
      },
    },
    {
      name: "switch to the else-if branch",
      run: (_, model) => {
        model.mode = 1;
      },
    },
    {
      name: "switch to the else branch",
      run: (_, model) => {
        model.mode = 5;
      },
    },
    {
      name: "rename an item inside slot content",
      run: (_, model) => {
        model.groups[1]!.items[0]!.label = "C";
      },
    },
    {
      name: "add a group in front",
      run: (_, model) => {
        model.groups = [
          { id: 3, title: "third", items: [{ id: 30, label: "d", done: true, tags: ["y", "w"] }] },
          ...model.groups,
        ];
      },
    },
    {
      name: "remove the first group",
      run: (_, model) => {
        model.groups = model.groups.filter((g) => g.id !== 1);
      },
    },
  ],
};
