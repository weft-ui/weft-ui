import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { tick } from "@weft-ui/runtime/remote";
import { WechatSink, type View } from "@weft-ui/runtime/wechat";
import { compile, loadView, type TestView } from "../src/miniprogram.ts";

const fixture = fileURLToPath(new URL("../fixtures/list/ListFixture.weft", import.meta.url));
type Item = { id: number; label: string };
type Model = { items: Item[]; cells: Item[]; sections: { id: number; title: string; items: Item[] }[] };
type App = { model: Model; mount(view: object): void; unmount(): void };
type Rect = { dataset: Record<string, unknown>; top: number; bottom: number; height: number };
type Query = {
  select(selector: string): { boundingClientRect(callback: (rect: Rect | null) => void): Query };
  selectAll(selector: string): { boundingClientRect(callback: (rects: Rect[]) => void): Query };
  exec(): void;
};
type Observer = {
  options: { observeAll: boolean };
  relative: [string, { top: number; bottom: number }] | undefined;
  observed: string | undefined;
  callback: ((entry: { intersectionRatio: number; dataset: Record<string, unknown> }) => void) | undefined;
  disconnected: boolean;
};
let out: string;
let ListFixture: new (model: Model) => App;
const cleanups: (() => void)[] = [];
beforeAll(async () => {
  out = await mkdtemp(join(tmpdir(), "weft-wx-lazy-"));
  await compile({ entries: [fixture], outDir: out });
  // This generated module exists only after the fixture is compiled.
  ({ ListFixture } = await import(pathToFileURL(join(out, "ListFixture.js")).href));
});
afterAll(async () => { await rm(out, { recursive: true, force: true }); });
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

async function settle() {
  await tick();
  await tick();
}

async function mount(count: number, cellCount = 0) {
  const view = loadView(out) as TestView & View;
  const observers: Observer[] = [];
  let scrollTop = 0;
  const app = new ListFixture({
    items: Array.from({ length: count }, (_, id) => ({ id, label: `row ${id}` })),
    cells: Array.from({ length: cellCount }, (_, id) => ({ id, label: `cell ${id}` })),
    sections: [],
  });
  view.createIntersectionObserver = (options) => {
    const record: Observer = { options, relative: undefined, observed: undefined, callback: undefined, disconnected: false };
    observers.push(record);
    const observer = {
      relativeTo(selector: string, margins: { top: number; bottom: number }) { record.relative = [selector, margins]; return observer; },
      observe(selector: string, callback: NonNullable<Observer["callback"]>) { record.observed = selector; record.callback = callback; },
      disconnect() { record.disconnected = true; },
    };
    return observer;
  };
  view.createSelectorQuery = (): Query => {
    let viewport: ((rect: Rect | null) => void) | undefined;
    let segments: ((rects: Rect[]) => void) | undefined;
    let selected = "";
    const query: Query = {
      select() { return { boundingClientRect(callback) { viewport = callback; return query; } }; },
      selectAll(selector) { selected = selector; return { boundingClientRect(callback) { segments = callback; return query; } }; },
      exec() {
        // SelectorQuery.exec delivers its callbacks asynchronously in WeChat.
        queueMicrotask(() => {
          viewport?.({ dataset: {}, top: 0, bottom: 600, height: 600 });
          const id = view.all("scroll-view")[0]?.attrs.id;
          const selector = typeof id === "string" ? `.wl-segment-${id.slice(3)}` : "";
          segments?.(selected === selector ? Array.from({ length: Math.ceil(app.model.items.length / 20) }, (_, i) => ({
            dataset: { segment: i }, top: i * 880 - scrollTop, bottom: (i + 1) * 880 - scrollTop, height: 880,
          })) : []);
        });
      },
    };
    return query;
  };
  app.mount(view);
  const sink = view.$sink;
  if (!(sink instanceof WechatSink)) throw new Error("expected WechatSink");
  const window = vi.spyOn(sink, "window");
  cleanups.push(() => app.unmount());
  await settle();
  return { app, view, sink, window, observers, setScrollTop(value: number) { scrollTop = value; } };
}

function identity(view: TestView, index = 0) {
  const attrs = view.all("scroll-view")[index]!.attrs;
  return { id: String(attrs.id), scope: Number(attrs["data-scope"]), point: Number(attrs["data-point"]) };
}

function observerFor(observers: Observer[], id: string) {
  const observer = observers.find((entry) => entry.relative?.[0] === `#${id}`);
  if (!observer) throw new Error(`missing observer for ${id}`);
  return observer;
}

test("creates the first list observer after commit", async () => {
  const { view, observers } = await mount(100);
  const { id } = identity(view);
  const observer = observerFor(observers, id);
  expect(observer.options).toEqual({ observeAll: true });
  expect(observer.relative).toEqual([`#${id}`, { top: 0, bottom: 0 }]);
  expect(observer.observed).toBe(`.wl-segment-${id.slice(3)}`);
});

test("observer measures and requests the scrolled window", async () => {
  const { view, observers, window, setScrollTop } = await mount(200);
  const { id, scope, point } = identity(view);
  setScrollTop(3000);
  observerFor(observers, id).callback!({ intersectionRatio: 1, dataset: {} });
  await settle();
  expect(window).toHaveBeenLastCalledWith(scope, point, 40, 100);
});

test("splicing disconnects and recreates the observer", async () => {
  const { app, view, observers } = await mount(100);
  const { id } = identity(view);
  const previous = observerFor(observers, id);
  app.model.items = [...app.model.items, ...Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, label: `row ${100 + i}` }))];
  await tick();
  expect(previous.disconnected).toBe(true);
  expect(observers.filter((entry) => entry.relative?.[0] === `#${id}`)).toHaveLength(2);
  expect(observers.at(-1)?.disconnected).toBe(false);
});

test("teardown disconnects observers and stale callbacks do nothing", async () => {
  const { app, view, observers, window, setScrollTop } = await mount(100);
  const observer = observerFor(observers, identity(view).id);
  app.unmount();
  expect(observers.length).toBeGreaterThan(0);
  expect(observers.every((entry) => entry.disconnected)).toBe(true);
  const count = window.mock.calls.length;
  setScrollTop(3000);
  observer.callback!({ intersectionRatio: 1, dataset: {} });
  expect(window.mock.calls).toHaveLength(count);
});

type Segment = { k: number; s: string; r: Record<string, unknown>[] | null };
function segments(view: TestView, index: number): Segment[] {
  const found: Segment[][] = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      if (value.length && value.every((entry) => entry && typeof entry === "object" && "k" in entry && "s" in entry && "r" in entry)) {
        found.push(value as Segment[]);
      } else {
        value.forEach(visit);
      }
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  }
  visit(view.data.r);
  if (!found[index]) throw new Error(`missing segment array ${index}`);
  return found[index];
}

test("initial measurement materializes two segments and leaves spacers", async () => {
  const { view, window } = await mount(100);
  const { scope, point } = identity(view);
  expect(window).toHaveBeenCalledWith(scope, point, 0, 40);
  const rows = segments(view, 0);
  expect(rows).toHaveLength(5);
  for (const segment of rows.slice(0, 2)) {
    expect(segment.r).toHaveLength(20);
    expect(segment.r!.every((row) => row.w === true)).toBe(true);
  }
  expect(rows.slice(2).map(({ k, r, s }) => ({ k, r, s }))).toEqual([
    { k: 2, r: null, s: "height:880px" },
    { k: 3, r: null, s: "height:880px" },
    { k: 4, r: null, s: "height:880px" },
  ]);
});

test("moving the window materializes new rows and releases old rows", async () => {
  const { view, sink } = await mount(100);
  const { scope, point } = identity(view);
  sink.window(scope, point, 40, 60);
  await tick();
  const rows = segments(view, 0);
  expect(rows[0]!.r).toBeNull();
  expect(rows[2]!.r).toHaveLength(20);
  expect(rows[2]!.r!.every((row) => row.w === true)).toBe(true);
  expect(view.texts()).toContain("row 45");
  expect(view.texts()).not.toContain("row 5");
});

test("updating a visible row changes the rendered label", async () => {
  const { app, view, sink } = await mount(100);
  const { scope, point } = identity(view);
  sink.window(scope, point, 40, 60);
  await tick();
  app.model.items[45]!.label = "changed";
  await tick();
  expect(view.texts()).toContain("changed");
  expect(view.texts()).not.toContain("row 45");
});

test("grid segments align to columns and preserve placeholders", async () => {
  const { view } = await mount(100, 30);
  const grid = segments(view, 1);
  expect(grid.map((segment) => segment.k)).toEqual([0, 1]);
  expect(grid[0]!.r).toHaveLength(18);
  expect(grid[0]!.r!.every((row) => row.w === true)).toBe(true);
  expect(grid[1]!.r).toHaveLength(12);
  expect(grid[1]!.r!.slice(0, 2).every((row) => row.w === true)).toBe(true);
  for (const row of grid[1]!.r!.slice(2)) {
    expect(Object.keys(row).sort()).toEqual(["k", "t"]);
    expect(row).not.toHaveProperty("w");
  }
});

test("renders the list fixture", async () => {
  const { view } = await mount(100);
  expect(view.texts()).toContain("header");
});
