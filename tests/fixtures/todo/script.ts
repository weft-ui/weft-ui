import type { Script } from "../../conformance/harness.ts";
import { TodoList } from "./TodoList.weft";

/** `if` / `for` with keyed moves, a controlled input that the host transforms or rejects. */
export const script: Script<TodoList> = {
  dir: import.meta.dirname,
  entry: "TodoList.weft",
  component: "TodoList",
  App: TodoList,
  model: () => ({
    draft: "",
    todos: [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
      { id: 3, name: "c" },
    ],
  }),
  setup(app, log) {
    app.onTextChanged((model, { value }) => {
      log(`TextChanged ${value}`);
      // Text with `!` is rejected; anything else is stored upper-cased.
      if (!value.includes("!")) model.draft = value.toUpperCase();
    });
    app.onRemove((model, { id }) => {
      log(`Remove ${id}`);
      model.todos = model.todos.filter((t) => t.id !== id);
    });
  },
  steps: [
    { name: "expand", run: (ui) => ui.click("Button", 0) },
    { name: "type a transformed value", run: (ui) => ui.edit("Input", 0, "milk") },
    { name: "type a rejected value", run: (ui) => ui.edit("Input", 0, "no!") },
    {
      name: "rename an item",
      run: (_, model) => {
        model.todos[1]!.name = "B";
      },
    },
    {
      name: "reverse the list",
      run: (_, model) => {
        model.todos = [...model.todos].reverse();
      },
    },
    { name: "remove the first row", run: (ui) => ui.click("Button", 1) },
    {
      name: "append a row",
      run: (_, model) => {
        model.todos = [...model.todos, { id: 4, name: "d" }];
      },
    },
    {
      name: "assign equal values",
      run: (_, model) => {
        const { draft } = model;
        model.draft = draft;
        model.todos = [...model.todos];
      },
    },
    { name: "collapse", run: (ui) => ui.click("Button", 0) },
  ],
};
