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
