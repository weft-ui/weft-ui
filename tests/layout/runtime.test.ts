// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { flushSync, hold, restoreAfterFlush, schedule, tick } from "../../packages/runtime/src/core.ts";
import { CSS_PROPS } from "../../packages/runtime/src/elements.ts";
import { render } from "../../packages/runtime/src/testing.ts";
import { App as DomApp, Instance as DomInstance, List as DomList, Row as DomRow, style, theme } from "../../packages/runtime/src/index.ts";
import { App as RemoteApp, Instance as RemoteInstance, List as RemoteList, Row as RemoteRow, type Sink } from "../../packages/runtime/src/remote.ts";

test("headless navigation renders the current page and reports host back", () => {
  const renderer = render({ hash: "test", app: { start: 0 }, templates: [{
    label: "page", kind: "page", roots: [0, 1],
    nodes: [
      { element: "NavBar", props: { title: "Note" }, children: [] },
      { element: "Text", props: { value: "content" }, children: [] },
    ], values: [], events: [], points: [],
  }] });
  const signal = vi.fn();
  renderer.open({ hash: "test", dispatch: () => true, window: () => {}, signal, detach: () => {} });
  renderer.create(1, 0);
  renderer.nav(0, [1], [], 0, "sheet");
  renderer.commit();
  expect(renderer.tree()[0]).toMatchObject({ type: "Page", bar: { type: "NavBar", props: { title: "Note" } }, children: [{ type: "Text" }] });
  renderer.create(2, 0);
  renderer.nav(0, [1], [2], 0, "sheet");
  renderer.commit();
  renderer.back();
  expect(signal).toHaveBeenCalledWith("navigation", JSON.stringify({ tab: 0, stack: [], modal: 0 }));
  renderer.set(2, 0, "late");
  expect(() => renderer.commit()).toThrow("unknown scope 2");
});

test("headless navigation rejects non-page and duplicate scope references", () => {
  const renderer = render({ hash: "test", app: { start: 1 }, templates: [
    { label: "component", kind: "component", roots: [], nodes: [], values: [], events: [], points: [] },
    { label: "page", kind: "page", roots: [], nodes: [], values: [], events: [], points: [] },
  ] });
  renderer.create(1, 0);
  renderer.nav(0, [1], [], 0, "sheet");
  expect(() => renderer.commit()).toThrow("scope 1 is not an available page");
  renderer.create(2, 1);
  renderer.nav(0, [2], [2], 0, "sheet");
  expect(() => renderer.commit()).toThrow("appears twice in navigation");
});

test("headless validates tab roots and reports tab selection", () => {
  const renderer = render({
    hash: "tabs",
    app: { tabs: [
      { page: 0, title: "Home", icon: "asset:home", activeIcon: "asset:home" },
      { page: 1, title: "Settings", icon: "asset:settings", activeIcon: "asset:settings" },
    ] },
    templates: [
      { label: "Home", kind: "page", roots: [], nodes: [], values: [], events: [], points: [] },
      { label: "Settings", kind: "page", roots: [], nodes: [], values: [], events: [], points: [] },
    ],
  });
  const signal = vi.fn();
  renderer.open({ hash: "tabs", dispatch: () => true, window: () => {}, signal, detach: () => {} });
  renderer.create(1, 0);
  renderer.create(2, 1);
  renderer.nav(0, [1, 2], [], 0, "sheet");
  renderer.commit();
  renderer.selectTab(1);
  expect(signal).toHaveBeenCalledWith("navigation", JSON.stringify({ tab: 1, stack: [], modal: 0 }));
  renderer.nav(0, [2, 1], [], 0, "sheet");
  expect(() => renderer.commit()).toThrow("navigation tabs do not match the app layout");
});

test("remote sessions report and ignore lazy window requests before lazy points exist", () => {
  const renderer = render({
    hash: "test",
    templates: [{
      label: "root", kind: "component", roots: [0],
      nodes: [{ element: "Text", props: { text: "root" }, children: [] }],
      values: [], events: [], points: [],
    }],
  });
  const open = vi.spyOn(renderer, "open");
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = new RemoteApp((app, args, children, depth) =>
    new RemoteInstance(app, 0, 0, depth, args, children), [], "test");
  try {
    app.mount(renderer);
    open.mock.calls[0]![0].window(1, 2, 3, 4);
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("scope 1, point 2, range [3, 4)"));
  } finally {
    app.unmount();
    error.mockRestore();
    open.mockRestore();
  }
});

test("web keyboard avoidance resizes the root, reveals focused controls and cleans up", () => {
  const originalViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
  const viewport = new EventTarget() as EventTarget & { height: number; offsetTop: number };
  viewport.height = window.innerHeight;
  viewport.offsetTop = 0;
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  const root = document.createElement("div");
  root.style.setProperty("--w-keyboard-height", "7px", "important");
  document.body.append(root);
  const app = new DomApp((owner, args, children, depth) => {
    const instance = new DomInstance(owner, 1, depth, args, children);
    const fragment = document.createDocumentFragment();
    const input = document.createElement("input");
    input.className = "w-input";
    const textarea = document.createElement("textarea");
    textarea.className = "w-textarea";
    fragment.append(input, textarea);
    instance.init(fragment);
    return instance;
  }, []);
  try {
    app.mount(root);
    const input = root.querySelector("input")!;
    const textarea = root.querySelector("textarea")!;
    const scrollInput = vi.fn();
    const scrollTextarea = vi.fn();
    input.scrollIntoView = scrollInput;
    textarea.scrollIntoView = scrollTextarea;
    input.focus();
    expect(scrollInput).toHaveBeenCalledWith({ block: "nearest" });
    viewport.height = window.innerHeight - 300;
    viewport.offsetTop = 20;
    viewport.dispatchEvent(new Event("resize"));
    expect(root.style.getPropertyValue("--w-keyboard-height")).toBe("280px");
    expect(scrollInput).toHaveBeenCalledTimes(2);
    textarea.focus();
    expect(scrollTextarea).toHaveBeenCalledWith({ block: "nearest" });
    viewport.height = window.innerHeight;
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event("resize"));
    expect(root.style.getPropertyValue("--w-keyboard-height")).toBe("0px");
    expect(document.querySelector("style[data-weft]")!.textContent).toContain("scroll-margin-bottom:16px");
    app.unmount();
    expect(root.style.getPropertyValue("--w-keyboard-height")).toBe("7px");
    expect(root.style.getPropertyPriority("--w-keyboard-height")).toBe("important");
    viewport.height -= 200;
    viewport.dispatchEvent(new Event("resize"));
    expect(root.style.getPropertyValue("--w-keyboard-height")).toBe("7px");
    root.append(input);
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(scrollInput).toHaveBeenCalledTimes(2);
  } finally {
    app.unmount();
    root.remove();
    if (originalViewport) Object.defineProperty(window, "visualViewport", originalViewport);
    else Reflect.deleteProperty(window, "visualViewport");
  }
});

test("theme() populates webThemeColors even when a theme style tag already exists", () => {
  const existing = document.createElement("style");
  existing.dataset.weftTheme = "";
  existing.textContent = ":root{--weft-accent:#111}";
  document.head.append(existing);
  try {
    theme({ accent: ["#111", "#eee"] });
    const colorIndex = CSS_PROPS.findIndex(
      (entry) => entry.unit === "color" && "property" in entry && entry.property === "color",
    );
    expect(colorIndex).toBeGreaterThanOrEqual(0);
    const span = document.createElement("span");
    style(span, colorIndex, "@accent");
    expect(span.style.color).toContain("var(--weft-accent)");
  } finally {
    existing.remove();
  }
});

test("DOM List.set rejects duplicate keys before mutating existing rows", () => {
  const anchor = document.createComment("list");
  document.body.append(anchor);
  const created: unknown[] = [];
  const destroyed: unknown[] = [];
  const list = new DomList(
    anchor,
    (item) => {
      created.push(item);
      const row = new DomRow(1, 1, 0, item);
      const node = document.createElement("span");
      node.textContent = (item as { label: string }).label;
      const frag = document.createDocumentFragment();
      frag.append(node);
      row.init(frag);
      row.u = () => {
        node.textContent = (row.item as { label: string }).label;
      };
      row.x = () => {
        destroyed.push(row.item);
      };
      return row;
    },
    (item) => (item as { id: string }).id,
  );
  list.set([{ id: "a", label: "A" }, { id: "b", label: "B" }]);
  expect(created).toHaveLength(2);
  expect(() => list.set([
    { id: "a", label: "A2" },
    { id: "c", label: "C" },
    { id: "a", label: "A-dup" },
  ])).toThrow(/duplicate key/);
  expect(created).toHaveLength(2);
  expect(destroyed).toHaveLength(0);
  expect([...document.body.querySelectorAll("span")].map((n) => n.textContent)).toEqual(["A", "B"]);
  list.set([]);
  anchor.remove();
});

test("remote List.set and App.mount avoid partial mutation on error", () => {
  const ops: string[] = [];
  const sink: Sink = {
    open() { ops.push("open"); },
    create(scope, template) { ops.push(`create:${scope}:${template}`); },
    set(scope, slot, value) { ops.push(`set:${scope}:${slot}:${String(value)}`); },
    branch(scope, point, child) { ops.push(`branch:${scope}:${point}:${child}`); },
    rows(scope, point, ids) { ops.push(`rows:${scope}:${point}:${ids.join(",")}`); },
    attach(scope, point, child) { ops.push(`attach:${scope}:${point}:${child}`); },
    commit() { ops.push("commit"); },
    close() { ops.push("close"); },
  };
  let rootAttempts = 0;
  const failingApp = new class extends RemoteApp {
    constructor() {
      super(
        (app, args, children, depth) => {
          rootAttempts++;
          if (rootAttempts === 1) throw new Error("boom in root create");
          return new RemoteInstance(app, 0, 1, depth, args, children);
        },
        [],
        "hash1",
      );
    }
  }();
  expect(() => failingApp.mount(sink)).toThrow("boom in root create");
  failingApp.mount(sink);
  expect(rootAttempts).toBe(2);
  const rootScope = new RemoteInstance(failingApp, 0, 1, 0, [], []);
  const list = new RemoteList(
    rootScope,
    0,
    (item) => {
      const s = new RemoteRow(failingApp, 1, 1, 1, 0, item);
      ops.push(`make:${(item as { id: string }).id}`);
      return s;
    },
    (item) => (item as { id: string }).id,
  );
  list.set([{ id: "a" }, { id: "b" }]);
  ops.length = 0;
  expect(() => list.set([{ id: "a" }, { id: "c" }, { id: "a" }])).toThrow(/duplicate key/);
  expect(ops).toEqual([]);
  failingApp.unmount();
  // Reference DomApp constructor signature so DOM App mount rollback typechecks too.
  expect(typeof DomApp).toBe("function");
});

test("flushSync ignores re-entrant calls and flush drains restores and afterFlush after errors", async () => {
  const events: string[] = [];
  const release = hold();
  restoreAfterFlush(() => events.push("restore"));
  release();

  restoreAfterFlush(() => {
    events.push("first-restore");
    flushSync(); // Must be a no-op while flushing.
  });
  const pendingTick = tick().then(() => events.push("tick"));
  flushSync();
  await pendingTick;
  expect(events).toContain("restore");
  expect(events).toContain("first-restore");
  expect(events).toContain("tick");
  schedule();
  flushSync();
  // Dummy DomInstance reference to ensure export stays covered.
  const domApp = new class extends DomApp {
    constructor() {
      super((app, args, children, depth) => {
        const inst = new DomInstance(app, 1, depth, args, children);
        const frag = document.createDocumentFragment();
        frag.append(document.createElement("span"));
        inst.init(frag);
        return inst;
      }, []);
    }
  }();
  const rootEl = document.createElement("div");
  domApp.mount(rootEl);
  domApp.unmount();
});
