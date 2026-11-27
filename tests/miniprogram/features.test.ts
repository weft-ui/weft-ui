import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { tick } from "@weft-ui/runtime/remote";
import { type Element, type TestView, compile, loadView } from "../src/miniprogram.ts";

// The shared feature fixture: nested components, slots, defaults,
// lifecycle events, optional models and `if / else if / else`.
const fixture = fileURLToPath(new URL("../fixtures/board/Board.weft", import.meta.url));

interface Item {
  id: number;
  label: string;
  done: boolean;
  tags: readonly string[];
}
interface BoardModel {
  owner: { name: string } | null;
  note: { text: string };
  mode: number;
  groups: readonly { id: number; title: string; items: readonly Item[] }[];
}
interface Board {
  readonly model: BoardModel;
  $on(name: string, handler: (model: BoardModel, event: Record<string, unknown>) => unknown): () => void;
  mount(view: object): void;
  unmount(): void;
}

let out: string;
let Board: new (model: BoardModel) => Board;

beforeAll(async () => {
  out = await mkdtemp(join(tmpdir(), "weft-wx-"));
  await compile({ entries: [fixture], outDir: out });
  // Generated modules exist only after the build.
  ({ Board } = await import(pathToFileURL(join(out, "Board.js")).href));
});

afterAll(async () => {
  await rm(out, { recursive: true, force: true });
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function mount(options: { acceptToggles?: boolean } = {}) {
  const view = loadView(out);
  const app = new Board({
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
  });
  const events: string[] = [];
  app.$on("Loaded", () => events.push("Loaded"));
  app.$on("Shown", (_, e) => events.push(`Shown ${e.id}`));
  app.$on("Hidden", (_, e) => events.push(`Hidden ${e.id}`));
  app.$on("Toggle", (model, e) => {
    events.push(`Toggle ${e.id} ${e.value}`);
    if (options.acceptToggles === false) return;
    for (const group of model.groups) {
      for (const item of group.items) if (item.id === e.id) item.done = e.value as boolean;
    }
  });
  app.mount(view);
  cleanups.push(() => app.unmount());
  await tick();
  const sent = async (action: () => unknown) => {
    const before = view.calls.length;
    action();
    await tick();
    return view.calls.slice(before);
  };
  return { app, view, events, sent };
}

function text(node: Element | string): string {
  return typeof node === "string" ? node : node.children.map(text).join("");
}

/** The item labels rendered by `ItemRow` (the second child of each row). */
function labels(view: TestView): string[] {
  return view
    .all("view")
    .filter((v) => v.children.some((c) => typeof c !== "string" && c.tag === "switch"))
    .map((row) => text(row.children[1]));
}

test("renders nested components, slots and defaults", async () => {
  const { view } = await mount();
  const texts = view.texts();
  expect(texts.slice(0, 5)).toEqual(["nobody", "note", "zero", "q: ", "clicks 0"]);
  expect(texts.filter((t) => t === "end")).toHaveLength(2);
  expect(labels(view)).toEqual(["a", "b", "c"]);
  const title = view.all("text").find((t) => text(t) === "first")!;
  expect(title.attrs.style).toBe("font-weight:700");
  const card = view.all("view").find((v) => v.attrs.class === "w-column" && String(v.attrs.style).includes("padding"))!;
  expect(card.attrs.class).toBe("w-column");
  expect(card.attrs.style).toBe("padding-top:4px;padding-right:4px;padding-bottom:4px;padding-left:4px");
  const tag = view.all("text").find((t) => text(t) === "x")!;
  expect(tag.attrs.style).toBe("color:#808080");
  expect(view.all("switch").map((s) => s.attrs.checked)).toEqual([false, true, false]);
});

test("lifecycle events fire after the first setData, children first", async () => {
  const { app, events, sent } = await mount();
  expect(events).toEqual(["Shown 10", "Shown 11", "Shown 20", "Loaded"]);
  events.length = 0;
  await sent(() => {
    app.model.groups = app.model.groups.filter((g) => g.id !== 1);
  });
  expect(events).toEqual(["Hidden 10", "Hidden 11"]);
});

test("state lambdas update the component and slot content through deep paths", async () => {
  const { view, sent } = await mount();
  const calls = await sent(() => view.input(view.all("input")[0], "z"));
  expect(calls).toHaveLength(1);
  const paths = Object.keys(calls[0]);
  // The input value, the `q:` text, and the three item labels inside the slots.
  expect(paths).toHaveLength(5);
  expect(paths.filter((p) => /^r\.l\d+\[\d\]\.c\d+\.y\d+\.l\d+\[\d\]\.c\d+\.n\d+_\d+$/.test(p))).toHaveLength(3);
  expect(view.texts()).toContain("q: z");
  expect(labels(view)).toEqual(["za", "zb", "zc"]);

  const clicks = await sent(() => view.tap(view.all("button")[0]));
  expect(clicks).toHaveLength(1);
  expect(Object.values(clicks[0])).toEqual(["clicks 1"]);
});

test("an accepted toggle sends the new checked value", async () => {
  const { view, events, sent } = await mount();
  const calls = await sent(() => view.change(view.all("switch")[0], true));
  expect(events.at(-1)).toBe("Toggle 10 true");
  expect(calls).toHaveLength(1);
  expect(Object.values(calls[0])).toEqual([true]);
  expect(view.all("switch")[0].attrs.checked).toBe(true);
});

test("a rejected toggle is switched back by the view", async () => {
  const { view, sent } = await mount({ acceptToggles: false });
  const calls = await sent(() => view.change(view.all("switch")[1], false));
  expect(calls).toHaveLength(2);
  const [path] = Object.keys(calls[0]);
  expect(calls).toEqual([{ [path]: false }, { [path]: true }]);
  expect(view.all("switch")[1].attrs.checked).toBe(true);
});

test("optional models are watched deeply, branches follow conditions", async () => {
  const { app, view, sent } = await mount();
  await sent(() => {
    app.model.owner = { name: "ann" };
  });
  expect(view.texts()[0]).toBe("ann");
  const rename = await sent(() => {
    app.model.owner!.name = "bob";
  });
  expect(rename).toHaveLength(1);
  expect(Object.values(rename[0])).toEqual(["bob"]);

  await sent(() => {
    app.model.mode = 1;
  });
  expect(view.texts()[2]).toBe("one");
  await sent(() => {
    app.model.mode = 5;
  });
  expect(view.texts()[2]).toBe("many");
});

test("a changed item inside slot content is sent alone", async () => {
  const { app, view, sent } = await mount();
  const calls = await sent(() => {
    app.model.groups[1].items[0].label = "C";
  });
  expect(calls).toHaveLength(1);
  expect(Object.keys(calls[0])).toHaveLength(1);
  expect(Object.keys(calls[0])[0]).toMatch(/^r\.l\d+\[1\]\.c\d+\.y\d+\.l\d+\[0\]\.c\d+\.n\d+_\d+$/);
  expect(labels(view)).toEqual(["a", "b", "C"]);
});
