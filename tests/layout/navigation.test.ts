import { expect, test, vi } from "vitest";
import { NavigationController, activate, navigation, setAppForeground, type NavigationEntry, type NavigationPage } from "../../packages/runtime/src/navigation.ts";
import { matchRoute, routeURL, type RouteValue } from "../../packages/runtime/src/route.ts";

class Home { static $route = { name: "Home", path: ["home"], params: [] }; readonly params = {}; }
class Detail { static $route = { name: "Detail", path: ["notes", "{id}"], params: [{ name: "id", type: "Int", optional: false }, { name: "source", type: "String", optional: true }] }; readonly params: { id: number; source?: string } = { id: 0 }; }

test("routes round-trip escaped path and typed query parameters", () => {
  const params = { id: 42, source: "search & more" };
  const url = routeURL(Detail, params);
  expect(url).toBe("/notes/42?source=search%20%26%20more");
  expect(matchRoute([Home, Detail], url)).toEqual({ page: Detail, params });
  expect(matchRoute([Detail], "/notes/not-a-number")).toBeNull();
});

test("tabs are created lazily, retained, and clear the stack on selection", () => {
  class Settings { static $route = { name: "Settings", path: ["settings"], params: [] }; readonly params = {}; }
  const events: string[] = [];
  const badges: (string | null)[] = [];
  let id = 0;
  const page = (name: string) => ({ params: {}, $emit: (event: string) => events.push(`${name}:${event}`) });
  const controller = new NavigationController({ Home: () => page("Home"), Settings: () => page("Settings"), Detail: () => page("Detail") }, {
    tabs: [
      { page: Home, title: "Home", icon: "asset:home", activeIcon: "asset:home" },
      { page: Settings, title: "Settings", icon: "asset:settings", activeIcon: "asset:settings" },
    ], pages: [Home, Settings, Detail],
  }, { create: () => ++id, destroy: () => events.push("destroy"), update: () => {}, badge: (_index, text) => badges.push(text) });
  controller.start();
  expect(id).toBe(1);
  controller.push(Detail, { id: 1 });
  controller.switchTab(Settings);
  expect(controller.entries.map(entry => entry.type)).toEqual([Settings]);
  expect(id).toBe(3);
  controller.switchTab(Home);
  controller.signal(JSON.stringify({ tab: 1, stack: [], modal: 0 }));
  expect(id).toBe(3);
  controller.setBadge(Settings, "2");
  controller.setBadge(Settings, "");
  controller.setBadge(Settings, null);
  expect(badges).toEqual(["2", "", null]);
  expect(events).toContain("destroy");
  expect(() => controller.switchTab(Detail)).toThrow("Detail is not a tab");
  controller.dispose();
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

test("application visibility is retained before mounting and reaches the current page", () => {
  const events: string[] = [];
  const controller = new NavigationController({ Home: () => ({ params: {}, $emit: event => events.push(event) }) }, { start: Home, pages: [Home] }, {
    create: () => 1, destroy: () => {}, update: () => {},
  });
  setAppForeground(false);
  activate(controller);
  controller.start();
  expect(events).toEqual([]);
  setAppForeground(true);
  setAppForeground(true);
  setAppForeground(false);
  expect(events).toEqual(["Show", "Hide"]);
  controller.dispose();
  setAppForeground(true);
});

test("modal navigation observes lifecycle, errors, back counts, and host dismissal", () => {
  const events: string[] = [];
  const updates: string[] = [];
  let id = 0;
  const page = (name: string, params: Record<string, RouteValue>): NavigationPage => ({ params, $emit: event => events.push(`${name}:${event}`) });
  const controller = new NavigationController({ Home: params => page("Home", params), Detail: params => page("Detail", params) }, { start: Home, pages: [Home, Detail] }, {
    create: () => ++id,
    destroy: value => events.push(`destroy:${value.params.id ?? "home"}`),
    update: (_entries, operation) => updates.push(operation),
  });
  controller.start();
  activate(controller);
  navigation.push(Detail, { id: 1 });
  navigation.present(Detail, { id: 2 }, { style: "fullScreen" });
  expect(navigation.modal).toEqual({ page: "Detail", params: { id: 2 } });
  expect(controller.modal?.style).toBe("fullScreen");
  expect(navigation.stack).toHaveLength(2);
  expect(() => navigation.push(Detail, { id: 3 })).toThrow("cannot push while a modal page is presented");
  expect(() => navigation.replace(Detail, { id: 3 })).toThrow("cannot push while a modal page is presented");
  expect(() => navigation.present(Detail, { id: 3 })).toThrow("a modal page is already presented");
  expect(events.slice(-2)).toEqual(["Detail:Hide", "Detail:Show"]);
  controller.setForeground(false);
  controller.setForeground(true);
  expect(events.slice(-2)).toEqual(["Detail:Hide", "Detail:Show"]);
  controller.signal(JSON.stringify({ tab: 0, stack: [2], modal: 0 }));
  expect(updates.at(-1)).toBe("host");
  expect(events.slice(-3)).toEqual(["Detail:Hide", "Detail:Show", "destroy:2"]);
  expect(navigation.modal).toBeNull();
  navigation.present(Detail, { id: 3 });
  expect(controller.modal?.style).toBe("sheet");
  navigation.pop(2);
  expect(navigation.stack).toHaveLength(1);
  expect(navigation.modal).toBeNull();
  navigation.present(Detail, { id: 4 });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  controller.signal(JSON.stringify({ tab: 0, stack: [], modal: 999 }));
  expect(error).toHaveBeenCalled();
  expect(updates.at(-1)).toBe("correct");
  expect(navigation.modal?.params.id).toBe(4);
  error.mockRestore();
  navigation.popToRoot();
  expect(navigation.modal).toBeNull();
  const count = updates.length;
  navigation.dismiss();
  expect(updates).toHaveLength(count);
  controller.dispose();
});

test("switching tabs dismisses a modal even on the selected tab", () => {
  let id = 0;
  const make = (): NavigationPage => ({ params: {}, $emit: () => {} });
  const controller = new NavigationController({ Home: make, Detail: make }, {
    tabs: [{ page: Home, title: "Home", icon: "", activeIcon: "" }, { page: Detail, title: "Detail", icon: "", activeIcon: "" }], pages: [Home, Detail],
  }, { create: () => ++id, destroy: () => {}, update: () => {} });
  controller.start();
  controller.present(Detail);
  controller.switchTab(Home);
  expect(controller.modal).toBeNull();
  controller.present(Detail);
  controller.signal(JSON.stringify({ tab: 1, stack: [], modal: 0 }));
  expect(controller.modal).toBeNull();
  expect(controller.tab).toBe(1);
  controller.dispose();
});

test("open intercepts matched links, switches tabs, and dismisses a modal before pushing", () => {
  class Settings { static $route = { name: "Settings", path: ["settings"], params: [] }; readonly params = {}; }
  let id = 0;
  const make = (params: Record<string, RouteValue>): NavigationPage => ({ params, $emit: () => {} });
  const controller = new NavigationController({ Home: make, Settings: make, Detail: make }, {
    tabs: [{ page: Home, title: "Home", icon: "", activeIcon: "" }, { page: Settings, title: "Settings", icon: "", activeIcon: "" }], pages: [Home, Settings, Detail],
  }, { create: () => ++id, destroy: () => {}, update: () => {} });
  controller.start();
  const handler = vi.fn(() => true);
  const unsubscribe = controller.onOpen(handler);
  expect(controller.open("/notes/3")).toBe(true);
  expect(handler).toHaveBeenCalledWith({ page: "Detail", params: { id: 3, source: null } }, "/notes/3");
  expect(controller.entries).toHaveLength(1);
  unsubscribe();
  controller.present(Detail, { id: 1 });
  expect(controller.open("/notes/3")).toBe(true);
  expect(controller.modal).toBeNull();
  expect(controller.entries.map(entry => entry.type)).toEqual([Home, Detail]);
  expect(controller.open("/settings")).toBe(true);
  expect(controller.entries.map(entry => entry.type)).toEqual([Settings]);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(controller.open("/missing")).toBe(false);
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
  controller.dispose();
});

test("cold start constructs root and target with one show and hide on the root", () => {
  const events: string[] = [];
  let id = 0;
  const make = (name: string) => (params: Record<string, RouteValue>): NavigationPage => ({ params, $emit: event => events.push(`${name}:${event}`) });
  const controller = new NavigationController({ Home: make("Home"), Detail: make("Detail") }, { start: Home, pages: [Home, Detail] }, {
    create: () => ++id, destroy: () => {}, update: (_entries, operation) => events.push(`update:${operation}`),
  });
  controller.start(["/home", "/notes/3"]);
  expect(controller.entries.map(entry => entry.type)).toEqual([Home, Detail]);
  expect(events).toEqual(["Home:Show", "update:host", "Home:Hide", "Detail:Show"]);
  controller.dispose();
});
