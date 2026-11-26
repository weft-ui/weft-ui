import { expect, test, vi } from "vitest";
import { NavigationController, type NavigationEntry, type NavigationPage } from "../../packages/runtime/src/navigation.ts";
import { matchRoute, routeURL, type RouteValue } from "../../packages/runtime/src/route.ts";

class Home { static $route = { name: "Home", path: ["home"], params: [] }; readonly params = {}; }
class Detail { static $route = { name: "Detail", path: ["notes", "{id}"], params: [{ name: "id", type: "Int", optional: false }, { name: "source", type: "String", optional: true }] }; readonly params = { id: 0, source: "" }; }

test("routes round-trip escaped path and typed query parameters", () => {
  const params = { id: 42, source: "search & more" };
  const url = routeURL(Detail, params);
  expect(url).toBe("/notes/42?source=search%20%26%20more");
  expect(matchRoute([Home, Detail], url)).toEqual({ page: Detail, params });
  expect(matchRoute([Detail], "/notes/not-a-number")).toBeNull();
});

test("stack changes notify lifecycle in order and accept only host back states", () => {
  const events: string[] = [];
  const updates: string[] = [];
  let nextId = 0;
  const createPage = (name: string, params: Record<string, RouteValue>): NavigationPage => ({ params, $emit(event) { events.push(`${name}:${event}`); } });
  const controller = new NavigationController({ Home: params => createPage("Home", params), Detail: params => createPage("Detail", params) }, { start: Home, pages: [Home, Detail] }, {
    create: () => ++nextId,
    destroy: page => events.push(`destroy:${page.params.id ?? "home"}`),
    update: (_entries: readonly NavigationEntry[], operation) => updates.push(operation),
  });
  controller.start();
  controller.push(Detail, { id: 1 });
  controller.push(Detail, { id: 2 });
  expect(events).toEqual(["Home:Show", "Home:Hide", "Detail:Show", "Detail:Hide", "Detail:Show"]);
  controller.signal(JSON.stringify({ tab: 0, stack: [2], modal: 0 }));
  expect(controller.entries.map(entry => entry.id)).toEqual([1, 2]);
  expect(events.slice(-3)).toEqual(["Detail:Hide", "Detail:Show", "destroy:2"]);
  expect(updates.at(-1)).toBe("host");
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  controller.signal(JSON.stringify({ tab: 0, stack: [99], modal: 0 }));
  expect(error).toHaveBeenCalled();
  expect(updates.at(-1)).toBe("correct");
  error.mockRestore();
  expect(() => controller.pop(0)).toThrow(RangeError);
  controller.popToRoot();
  expect(controller.entries).toHaveLength(1);
  controller.setForeground(false);
  controller.push(Detail, { id: 3 });
  expect(events.at(-1)).toBe("Home:Hide");
  controller.setForeground(true);
  expect(events.at(-1)).toBe("Detail:Show");
  controller.dispose();
});
