import { expect, test, vi } from "vitest";
import { Lazy } from "../../packages/runtime/src/lazy.ts";
import { render } from "../../packages/runtime/src/testing.ts";
import { App, Instance, LazyList, Row } from "../../packages/runtime/src/remote.ts";
import { flushSync } from "../../packages/runtime/src/core.ts";

function setup() {
  const splice = vi.fn();
  const bind = vi.fn();
  const destroy = vi.fn();
  const lazy = new Lazy((item: { id: number; text: string }) => item.id, {
    splice, bind, destroy,
    create: item => ({ value: item }),
    change: (row, item) => { row.value = item; },
  });
  const values = (ids: number[]) => ids.map(id => ({ id, text: String(id) }));
  return { lazy, splice, bind, destroy, values };
}

test("lazy reconciliation emits one minimal splice and retains IDs on reorder", () => {
  const { lazy, splice, values } = setup();
  lazy.set(values([1, 2, 3]));
  expect(splice).toHaveBeenLastCalledWith(0, 0, [{ id: 1, template: 0 }, { id: 2, template: 0 }, { id: 3, template: 0 }]);
  lazy.set(values([1, 4, 3]));
  expect(splice).toHaveBeenLastCalledWith(1, 1, [{ id: 4, template: 0 }]);
  lazy.set(values([3, 4, 1]));
  expect(splice).toHaveBeenLastCalledWith(0, 3, [{ id: 3, template: 0 }, { id: 4, template: 0 }, { id: 1, template: 0 }]);
  expect(() => lazy.set(values([1, 1]))).toThrow("duplicate key");
});

test("first frame and subsequent windows materialize and release only needed rows", () => {
  const { lazy, bind, destroy, values } = setup();
  lazy.set(values(Array.from({ length: 30 }, (_, i) => i)));
  expect(bind).toHaveBeenCalledTimes(20);
  lazy.window(10, 25);
  expect(bind).toHaveBeenCalledTimes(35);
  expect(destroy).toHaveBeenCalledTimes(10);
  bind.mockClear();
  lazy.window(10, 25);
  expect(bind).not.toHaveBeenCalled();
  lazy.destroy();
  expect(destroy).toHaveBeenCalledTimes(25);
});

test("splices reconcile the last requested window while retaining matching rows", () => {
  const { lazy, bind, values } = setup();
  lazy.set(values([0, 1, 2, 3, 4]));
  lazy.window(1, 3);
  bind.mockClear();
  lazy.set(values([4, 2, 1, 3, 0]));
  expect(bind).not.toHaveBeenCalled();
  lazy.set(values([1, 4, 2, 3, 0]));
  expect(bind).toHaveBeenCalledTimes(2);
  expect(bind).toHaveBeenCalledWith(2, null);
  expect(bind).toHaveBeenCalledWith(5, expect.any(Object));
});

test("remote window requests synchronously replace materialized scopes", () => {
  const renderer = render({ hash: "x", templates: [
    { label: "root", kind: "component", roots: [0], nodes: [{ element: "List", props: {}, children: [1] }, { point: 0 }], values: [], events: [], points: [{ node: 1, kind: "lazy", templates: [1] }] },
    { label: "row", kind: "row", roots: [0], nodes: [{ element: "Text", props: {}, children: [] }], values: [], events: [], points: [] },
  ] });
  const app = new App((owner, args, children, depth) => {
    const root = new Instance(owner, 0, 0, depth, args, children);
    const list = new LazyList(root, 0, item => new Row(owner, 1, 0, depth + 1, 0, item), item => item);
    list.set(Array.from({ length: 30 }, (_, i) => i));
    root.x = () => list.destroy();
    return root;
  }, [], "x");
  app.mount(renderer);
  flushSync();
  expect(renderer.all("Text")).toHaveLength(20);
  renderer.window(renderer.all("List")[0], 20, 30);
  expect(renderer.all("Text")).toHaveLength(10);
  app.unmount();
});

test("headless validates lazy IDs and templates and applies bindings", () => {
  const renderer = render({ hash: "x", templates: [
    { label: "root", kind: "component", roots: [0], nodes: [{ element: "List", props: {}, children: [1] }, { point: 0 }], values: [], events: [], points: [{ node: 1, kind: "lazy", templates: [1] }] },
    { label: "row", kind: "row", roots: [0], nodes: [{ element: "Text", props: { text: "row" }, children: [] }], values: [], events: [], points: [] },
    { label: "wrong", kind: "row", roots: [], nodes: [], values: [], events: [], points: [] },
  ] });
  renderer.create(1, 0); renderer.attach(0, 0, 1);
  renderer.splice(1, 0, 0, 0, [{ item: 1, template: 0 }]);
  renderer.create(2, 1); renderer.bind(1, 0, 1, 2); renderer.commit();
  expect(renderer.all("Text")).toHaveLength(1);
  renderer.splice(1, 0, 0, 1, [{ item: 1, template: 0 }]); renderer.commit();
  expect(renderer.all("Text")).toHaveLength(1);
  renderer.bind(1, 0, 1, 0); renderer.commit();
  expect(renderer.all("Text")).toHaveLength(0);
  renderer.create(3, 2); renderer.bind(1, 0, 1, 3);
  expect(() => renderer.commit()).toThrow("cannot be mounted here");
});
