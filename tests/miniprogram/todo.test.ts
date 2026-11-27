import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { tick } from "@weft-ui/runtime/remote";
import { compile, loadView } from "../src/miniprogram.ts";

const fixture = fileURLToPath(new URL("../fixtures/todo/TodoList.weft", import.meta.url));

interface TodoListModel {
  draft: string;
  todos: readonly { id: number; name: string }[];
}
interface TodoList {
  readonly model: TodoListModel;
  onTextChanged(handler: (model: TodoListModel, event: { value: string }) => void): () => void;
  onRemove(handler: (model: TodoListModel, event: { id: number }) => void): () => void;
  mount(view: object): void;
  unmount(): void;
}

let out: string;
let TodoList: new (model: TodoListModel) => TodoList;

beforeAll(async () => {
  out = await mkdtemp(join(tmpdir(), "weft-wx-todo-"));
  await compile({ entries: [fixture], outDir: out });
  // Generated modules exist only after the build.
  ({ TodoList } = await import(pathToFileURL(join(out, "TodoList.js")).href));
});

afterAll(async () => {
  await rm(out, { recursive: true, force: true });
});

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Mounts the fixture and waits for the first `setData`. */
async function mount(options: { handlers?: boolean } = {}) {
  const view = loadView(out);
  const app = new TodoList({
    draft: "",
    todos: [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
      { id: 3, name: "c" },
    ],
  });
  if (options.handlers !== false) {
    app.onTextChanged((model, e) => {
      model.draft = e.value;
    });
    app.onRemove((model, e) => {
      model.todos = model.todos.filter((t) => t.id !== e.id);
    });
  }
  app.mount(view);
  cleanups.push(() => app.unmount());
  await tick();
  const input = () => view.all("input")[0];
  const toggle = () => view.all("button")[0];
  const names = () => view.all("view").slice(2).map((row) => row.children.flatMap(textOf)[0]);
  /** `setData` payloads sent by `action` and the flush it triggers. */
  const sent = async (action: () => unknown) => {
    const before = view.calls.length;
    action();
    await tick();
    return view.calls.slice(before);
  };
  return { app, view, input, toggle, names, sent };
}

function textOf(node: { children: unknown[] } | string): string[] {
  return typeof node === "string" ? [node] : node.children.flatMap((child) => textOf(child as never));
}

test("keyboard height resizes the component root and targets the focused input", async () => {
  const { view, input } = await mount();
  const field = input();
  expect(field.attrs["adjust-position"]).toBe(false);
  expect(field.attrs["cursor-spacing"]).toBe("16");
  view.fire(field, "focus");
  expect(view.data.kf).toBe(field.attrs.id);
  view.fire(field, "keyboardheightchange", { height: 240 });
  expect(view.data.kh).toBe(240);
  expect(view.data.kf).toBe(field.attrs.id);
  expect(view.render()[0].attrs.style).toBe("padding-bottom:240px");
  view.fire(field, "keyboardheightchange", { height: 0 });
  expect(view.data.kh).toBe(0);
  expect(view.data.kf).toBe("");
});

test("the first setData sends the root template and its data", async () => {
  const { view, input, toggle, names } = await mount();
  expect(view.calls).toHaveLength(1);
  expect(Object.keys(view.calls[0]).sort()).toEqual(["r", "t"]);
  expect(view.calls[0].t).toBe("TodoList");
  expect(input().attrs.value).toBe("");
  expect(textOf(toggle())).toEqual(["expand"]);
  expect(names()).toEqual([]);
});

test("toggling state sends the branch, its index and the button label", async () => {
  const { view, toggle, names, sent } = await mount();
  const calls = await sent(() => view.tap(toggle()));
  expect(calls).toHaveLength(1);
  expect(Object.keys(calls[0]).sort()).toEqual(["r.b8", "r.i8", "r.n1_0"]);
  expect(calls[0]["r.n1_0"]).toBe("collapse");
  expect(names()).toEqual(["a", "b", "c"]);

  const collapse = await sent(() => view.tap(toggle()));
  expect(collapse).toEqual([{ "r.n1_0": "expand", "r.i8": -1, "r.b8": null }]);
  expect(names()).toEqual([]);
});

test("typing sends only the input value and keeps the typed text", async () => {
  const { view, input, sent } = await mount();
  let replaced: unknown;
  const calls = await sent(() => {
    replaced = view.input(input(), "milk");
  });
  expect(replaced).toBeUndefined();
  expect(calls).toEqual([{ "r.n0_0": "milk" }]);
  expect(input().attrs.value).toBe("milk");
});

test("an edit the host does not accept is replaced by the bound value", async () => {
  const { view, input, sent } = await mount({ handlers: false });
  let replaced: unknown;
  const calls = await sent(() => {
    replaced = view.input(input(), "milk");
  });
  expect(replaced).toBe("");
  expect(calls).toEqual([]);
});

test("a changed item field is sent by row index", async () => {
  const { app, view, toggle, names, sent } = await mount();
  view.tap(toggle());
  const calls = await sent(() => {
    app.model.todos[1].name = "B";
  });
  expect(calls).toEqual([{ "r.b8.l7[1].n3_0": "B" }]);
  expect(names()).toEqual(["a", "B", "c"]);
});

test("removing a row resends the list, appending sends only the new row", async () => {
  const { app, view, toggle, names, sent } = await mount();
  view.tap(toggle());
  const removeB = view.all("button")[2];
  const removed = await sent(() => view.tap(removeB));
  expect(removed).toHaveLength(1);
  expect(Object.keys(removed[0])).toEqual(["r.b8.l7"]);
  expect(names()).toEqual(["a", "c"]);

  const appended = await sent(() => {
    app.model.todos = [...app.model.todos, { id: 4, name: "d" }];
  });
  expect(appended).toHaveLength(1);
  expect(Object.keys(appended[0])).toEqual(["r.b8.l7[2]"]);
  expect(names()).toEqual(["a", "c", "d"]);
});

test("unchanged values send nothing", async () => {
  const { app, sent } = await mount();
  const calls = await sent(() => {
    app.model.draft = "";
    app.model.todos = [...app.model.todos];
  });
  expect(calls).toEqual([]);
});

test("unmount clears the view and releases handlers", async () => {
  const { app, view, toggle } = await mount();
  const button = toggle();
  app.unmount();
  expect(view.calls.at(-1)).toEqual({ t: "", r: null });
  expect(view.render()).toEqual([]);
  view.tap(button);
  await tick();
  expect(view.calls.at(-1)).toEqual({ t: "", r: null });
});
