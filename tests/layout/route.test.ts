import { describe, expect, test } from "vitest";
import { matchRoute, routeURL } from "../../packages/runtime/src/route.ts";

class Note {
  static $route = {
    name: "Note", path: ["notes", "{id}"], params: [
      { name: "id", type: "String", optional: false },
      { name: "from", type: "Union", optional: false, values: ["feed", "search"], default: "feed" },
      { name: "count", type: "Int", optional: true },
      { name: "ratio", type: "Float", optional: true },
      { name: "pinned", type: "Bool", optional: true },
      { name: "text", type: "String", optional: true },
    ],
  };
  readonly params = {};
}
class Settings {
  static $route = { name: "Settings", path: ["settings"], params: [] };
  readonly params = {};
}
class Numbered {
  static $route = { name: "Numbered", path: ["number", "{id}"], params: [
    { name: "id", type: "Int", optional: false },
    { name: "enabled", type: "Bool", optional: false },
  ] };
  readonly params = {};
}

const defaults = { from: "feed", count: null, ratio: null, pinned: null, text: null };

describe("route URL encoding", () => {
  test("escapes Unicode and reserved characters and writes query parameters in declaration order", () => {
    const params = { id: "中文/😀 ?", text: "a+b & =", pinned: false, ratio: 1.25, count: -2, from: "search" };
    const url = routeURL(Note, params);
    expect(url).toBe("/notes/%E4%B8%AD%E6%96%87%2F%F0%9F%98%80%20%3F?from=search&count=-2&ratio=1.25&pinned=false&text=a%2Bb%20%26%20%3D");
    expect(matchRoute([Note], url)).toEqual({ page: Note, params });
  });

  test("omits defaults and nulls and restores them on decode", () => {
    expect(routeURL(Note, { id: "1", from: "feed", count: null, pinned: null })).toBe("/notes/1");
    expect(matchRoute([Note], "/notes/1")).toEqual({ page: Note, params: { id: "1", ...defaults } });
  });
});

describe("route matching", () => {
  test("decodes typed values and ignores extra query keys", () => {
    expect(matchRoute([Note], "/notes/a%2Fb?from=search&count=-9007199254740991&ratio=1.5e-2&pinned=true&text=hello+world&extra=x"))
      .toEqual({ page: Note, params: { id: "a/b", from: "search", count: -9007199254740991, ratio: 0.015, pinned: true, text: "hello world" } });
  });

  test.each([
    "/notes/1?count=9007199254740992", "/notes/1?count=-9007199254740992",
    "/notes/1?count=1.0", "/notes/1?count=1e2", "/notes/1?count=",
    "/notes/1?ratio=NaN", "/notes/1?ratio=Infinity", "/notes/1?ratio=%201",
    "/notes/1?pinned=1", "/notes/1?pinned=True", "/notes/1?from=other",
    "/notes/%ZZ", "/notes/1?text=%ZZ", "/notes", "/notes/1/extra",
  ])("rejects invalid route %s", url => {
    expect(matchRoute([Note], url)).toBeNull();
  });

  test("validates required query parameters and integer path parameters", () => {
    expect(matchRoute([Numbered], "/number/9007199254740991?enabled=false"))
      .toEqual({ page: Numbered, params: { id: 9007199254740991, enabled: false } });
    expect(matchRoute([Numbered], "/number/1")).toBeNull();
    expect(matchRoute([Numbered], "/number/9007199254740992?enabled=true")).toBeNull();
    expect(matchRoute([Numbered], "/number/1.5?enabled=true")).toBeNull();
  });

  test("matches later routes when earlier paths do not match", () => {
    expect(matchRoute([Settings, Note], "/notes/3")).toEqual({ page: Note, params: { id: "3", ...defaults } });
    expect(matchRoute([Note, Settings], "/settings")).toEqual({ page: Settings, params: {} });
    expect(matchRoute([Note, Settings], "/missing")).toBeNull();
  });

  test("literal paths take priority over parameter paths", () => {
    class Featured { static $route = { name: "Featured", path: ["notes", "featured"], params: [] }; readonly params = {}; }
    expect(matchRoute([Note, Featured], "/notes/featured")).toEqual({ page: Featured, params: {} });
  });

  test("query keys cannot override path parameters", () => {
    expect(matchRoute([Note], "/notes/path?id=query")).toEqual({ page: Note, params: { id: "path", ...defaults } });
  });
});
