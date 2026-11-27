/**
 * Headless stand-in for the mini program framework, shared by tests that
 * run without WeChat DevTools.
 *
 * - `launch` runs a whole project built with `WEFT_PLATFORM=wechat vite build`
 *   (in `apps/wechat/` by default): `app.js`, the first page of `app.json`
 *   and the view component it uses.
 * - `compile` writes the logic modules and the generated area of an app
 *   without bundling, so tests can construct root components themselves;
 *   `loadView` loads the view component of such an output directory.
 *
 * A view records every `setData` payload, applies the paths to its data
 * like the framework does, and renders the generated WXML against that
 * data. The renderer covers the WXML subset the compiler emits:
 * `<template name/is/data>`, `wx:if` / `wx:elif` / `wx:else`, `wx:for` with
 * `wx:for-item`, and `{{path}}`, `{{path === n}}`, `{{true}}` and
 * `{{...path}}` expressions.
 */

import { readFileSync, realpathSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileApp } from "@weft-ui/compiler";
import { view, type WechatSink } from "@weft-ui/runtime/wechat";
import { limitInput } from "./input.ts";

type Data = Record<string, unknown>;

/** A rendered element; text children are strings. */
export interface Element {
  tag: string;
  attrs: Data;
  children: (Element | string)[];
}

interface ViewOptions {
  data: Data;
  lifetimes: { created(this: unknown): void; detached(this: unknown): void };
  methods: { $e(this: unknown, event: object): unknown };
}

interface PageOptions {
  onLoad?(this: PageInstance, query: Data): void;
  onReady?(this: PageInstance): void;
  onShow?(this: PageInstance): void;
  onHide?(this: PageInstance): void;
  onUnload?(this: PageInstance): void;
}

interface PageInstance {
  selectComponent(selector: string): TestView | null;
}

/** A mounted-looking view component instance. */
export interface TestView {
  data: Data;
  /** Every `setData` payload in order, deep-copied when it was sent. */
  calls: Data[];
  setData(data: Data, callback?: () => void): void;
  /** The view as the WXML would render it now. */
  render(): Element[];
  /** Text content of the rendered view, in document order. */
  texts(): string[];
  /** Rendered elements with tag `tag`, in document order. */
  all(tag: string): Element[];
  /** Fires a bound event; taps propagate until a catch handler stops them. */
  fire(element: Element, type: string, value?: unknown): unknown;
  /** Taps the element. */
  tap(element: Element): void;
  /** Fires `bindinput`; returns what the handler returned (the replacement text, if any). */
  input(element: Element, value: string): unknown;
  /** Fires `bindchange` with `value`. */
  change(element: Element, value: unknown): unknown;
  /** Runs the component's `detached` lifetime. */
  detach(): void;
}

/* ---- Scripts ------------------------------------------------------------- */

/** Framework globals of mini program scripts. */
interface Globals {
  App(options: Data): void;
  Page(options: PageOptions): void;
  Component(options: ViewOptions): void;
  getApp(): Data | undefined;
  getCurrentPages(): PageInstance[];
  wx: object;
}

/**
 * Runs the CommonJS script at `path` with the framework globals, resolving
 * `require` relative to it like the mini program does.
 */
function run(path: string, globals: Globals, cache = new Map<string, { exports: unknown }>()): unknown {
  const cached = cache.get(path);
  if (cached) return cached.exports;
  const module = { exports: {} as unknown };
  cache.set(path, module);
  const require = (specifier: string) => {
    const target = resolve(dirname(path), specifier);
    return run(extname(target) ? target : `${target}.js`, globals, cache);
  };
  const names = Object.keys(globals) as (keyof Globals)[];
  // Script parameters shadow the test process's globals, as the framework's module wrapper does.
  new Function("require", "module", "exports", ...names, readFileSync(path, "utf8"))(
    require, module, module.exports, ...names.map((name) => globals[name]),
  );
  return module.exports;
}

/** Globals that record what the scripts register. */
function framework(wx: object) {
  const registered: { app?: Data; page?: PageOptions; component?: ViewOptions } = {};
  const globals: Globals = {
    App: (options) => {
      registered.app = options;
    },
    Page: (options) => {
      registered.page = options;
    },
    Component: (options) => {
      registered.component = options;
    },
    getApp: () => registered.app,
    getCurrentPages: () => [],
    wx,
  };
  return { registered, globals };
}

/** Runs the view component script at `path` and renders its WXML. */
function component(path: string, globals: Globals, registered: { component?: ViewOptions }): TestView {
  registered.component = undefined;
  run(`${path}.js`, globals);
  if (!registered.component) throw new Error(`${path}.js did not call Component()`);
  return createView(registered.component, parseTemplates(readFileSync(`${path}.wxml`, "utf8")));
}

/** A launched mini program. */
export interface MiniProgram {
  /** What `app.js` passed to `App()`. */
  app: Data;
  /** The view component instance on the current page. */
  readonly view: TestView;
  /** Most recent native navigation title. */
  readonly title: string;
  /** Simulates the system back action. */
  back(): void;
  /** Runs the page's `onUnload`. */
  unload(): void;
}

/**
 * Launches the mini program project in `project`: runs `app.js`, then loads
 * the first page of `app.json` with its view component and runs the page's
 * `onLoad` and `onReady`. `wx` is the API object the scripts see.
 */
export function launch(project: string, options: { wx?: object; route?: string } = {}): MiniProgram {
  const wx = { getLaunchOptionsSync: () => ({}), onMemoryWarning: () => {}, ...options.wx } as Record<string, unknown>;
  let title = "";
  const { registered, globals } = framework(wx);
  const stack: { options: PageOptions; instance: PageInstance; view: TestView }[] = [];
  globals.getCurrentPages = () => stack.map((page) => page.instance);
  const open = (url: string) => {
    const [route, query = ""] = url.replace(/^\//, "").split("?", 2);
    const page = join(project, route!);
    const usingComponents: Record<string, string> = JSON.parse(readFileSync(`${page}.json`, "utf8")).usingComponents ?? {};
    const components = new Map<string, TestView>();
    let view: TestView | undefined;
    for (const node of parse(readFileSync(`${page}.wxml`, "utf8"))) {
      if (typeof node === "string" || !(node.tag in usingComponents)) continue;
      view = component(resolve(dirname(page), usingComponents[node.tag]!), globals, registered);
      if (node.attrs.id) components.set(`#${node.attrs.id}`, view);
    }
    if (!view) throw new Error(`${page}.wxml uses no component`);
    registered.page = undefined;
    run(`${page}.js`, globals);
    // The script calls Page() through the framework callback, which TypeScript cannot track.
    const pageOptions = registered.page as PageOptions | undefined;
    if (!pageOptions) throw new Error(`${page}.js did not call Page()`);
    const instance: PageInstance = { selectComponent: (selector) => components.get(selector) ?? null };
    stack.push({ options: pageOptions, instance, view });
    pageOptions.onLoad?.call(instance, Object.fromEntries(new URLSearchParams(query)));
    pageOptions.onShow?.call(instance);
    pageOptions.onReady?.call(instance);
  };
  const hide = () => { const page = stack.at(-1); page?.options.onHide?.call(page.instance); };
  const remove = () => { const page = stack.pop(); if (page) { page.options.onUnload?.call(page.instance); page.view.detach(); } };
  const back = (delta = 1) => {
    if (stack.length < 2) return;
    hide();
    for (let i = 0; i < delta && stack.length > 1; i++) remove();
    const page = stack.at(-1)!;
    page.options.onShow?.call(page.instance);
  };
  wx.navigateTo = ({ url }: { url: string }) => { hide(); open(url); };
  wx.redirectTo = ({ url }: { url: string }) => { hide(); remove(); open(url); };
  wx.navigateBack = ({ delta = 1 }: { delta?: number } = {}) => back(delta);
  wx.setNavigationBarTitle = ({ title: next }: { title: string }) => { title = next; };
  run(join(project, "app.js"), globals);
  const app = registered.app;
  if (!app) throw new Error("app.js did not call App()");
  const config = JSON.parse(readFileSync(join(project, "app.json"), "utf8")) as { pages: string[] };
  open(options.route ?? config.pages[0]!);
  return { app, get view() { return stack.at(-1)!.view; }, get title() { return title; }, back, unload: () => { while (stack.length) remove(); } };
}

/* ---- Unbundled output ---------------------------------------------------- */

/** Sources share a root; generated paths preserve their layout beneath outDir. */
export interface CompileOptions {
  entries: string[];
  outDir: string;
  /** Defaults to the first entry's directory. */
  root?: string;
}

// Path arithmetic instead of `new URL`: DOM test environments replace the global `URL`.
const runtime = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "../node_modules/@weft-ui/runtime"));

/**
 * Compiles an app for the mini program into `outDir`: every logic module at
 * `X.js` (its `.weft` imports pointed at the `.js` files), the generated
 * area (`view.*`, `index.*`), and a `node_modules` link to
 * `@weft-ui/runtime`, so the modules resolve the same runtime instance as
 * the test. Throws rendered diagnostics on errors; returns the layout JSON.
 */
export async function compile(options: CompileOptions): Promise<{ layout: string }> {
  const root = resolve(options.root ?? dirname(resolve(options.entries[0]!)));
  const entries = options.entries.map((entry) => relative(root, resolve(entry)).replaceAll("\\", "/"));
  const output = await compileApp(entries, "wechat", (path) => readFileSync(join(root, path), "utf8"));
  if (output.hasErrors) throw new Error(output.diagnostics);
  const files = new Map<string, string>();
  for (const module of output.logic) {
    const code = module.code.replace(/(from\s*["'][^"']*)\.weft(["'])/g, "$1.js$2");
    files.set(module.source.replace(/\.weft$/, ".js"), code);
  }
  for (const file of output.views) files.set(file.path, file.contents);
  for (const [path, contents] of files) {
    const target = join(options.outDir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  const link = join(options.outDir, "node_modules/@weft-ui/runtime");
  await mkdir(dirname(link), { recursive: true });
  await symlink(runtime, link, "junction");
  return { layout: output.layout };
}

/**
 * Loads the view component written by `compile` into `dir`, backed by the
 * WeChat sink of `@weft-ui/runtime/wechat`. Mount root components into it.
 */
export function loadView(dir: string): TestView {
  const { registered, globals } = framework({});
  globals.getApp = () => ({ weft: { view } });
  return component(join(dir, "view"), globals, registered);
}

/** A multi-page stand-in for an unbundled navigation fixture. */
export function loadNavigationView(dir: string, tabs: readonly string[] = []): { root: TestView; bindRootModal(): void; current(): TestView; back(): void; dismiss(): void; tab(index: number): void; dispose(): void } {
  const stack = [loadView(dir)];
  const root = stack[0]!;
  const modals = [loadView(dir)];
  const modal = () => modals[modals.length - 1]!;
  const sink = () => (root as TestView & { $sink: WechatSink }).$sink;
  sink().configureTabs(tabs);
  const globals = globalThis as typeof globalThis & { wx?: object };
  const previous = globals.wx;
  const remove = () => {
    const index = stack.length - 1;
    sink().unloadPage(index);
    stack.pop()!.detach();
    modals.pop()!.detach();
  };
  const tab = (index: number) => {
    const name = tabs[index];
    if (!name) throw new RangeError(`weft: invalid tab index ${index}`);
    while (stack.length > 1) remove();
    sink().selectTab(name);
    sink().bindPage(0, root);
    sink().showPage(0);
  };
  const open = () => {
    const next = loadView(dir);
    stack.push(next);
    modals.push(loadView(dir));
    const index = stack.length - 1;
    sink().bindPage(index, next);
    sink().bindModal(modal(), undefined, index);
  };
  const wx = {
    navigateTo: open,
    redirectTo: () => { remove(); open(); },
    navigateBack: ({ delta }: { delta: number }) => { for (let i = 0; i < delta && stack.length > 1; i++) remove(); sink().showPage(stack.length - 1); },
    switchTab: ({ url }: { url: string }) => {
      const index = tabs.findIndex((name) => url.includes(`/${name.replace(/([A-Z])/g, (letter, _match, offset: number) => `${offset ? "-" : ""}${letter.toLowerCase()}`)}/`));
      if (index >= 0) queueMicrotask(() => tab(index));
    },
    setTabBarBadge: () => {}, removeTabBarBadge: () => {}, showTabBarRedDot: () => {}, hideTabBarRedDot: () => {},
    setNavigationBarTitle: () => {},
  };
  globals.wx = wx;
  return {
    root,
    bindRootModal: () => sink().bindModal(modals[0]!, undefined, 0),
    current: () => modal().data.r ? modal() : stack[stack.length - 1]!,
    back: () => { if (modal().data.r) sink().dismissed(); else if (stack.length > 1) remove(); },
    dismiss: () => { if (modal().data.r) sink().dismissed(); },
    tab,
    dispose: () => { for (const view of modals) view.detach(); if (previous === undefined) delete globals.wx; else globals.wx = previous; },
  };
}

/* ---- View component ------------------------------------------------------ */

function createView(options: ViewOptions, templates: Templates): TestView {
  const view: TestView & Data = {
    data: structuredClone(options.data),
    calls: [],
    setData(data, callback?: () => void) {
      const copy = structuredClone(data);
      view.calls.push(copy);
      for (const [path, value] of Object.entries(copy)) assign(view.data, path, value);
      callback?.();
    },
    render: () => renderNodes(templates.root, view.data, templates),
    texts: () => texts(view.render()),
    all: (tag) => all(view.render(), tag),
    fire: (element, type, value) => fire(view, element, type, value),
    tap: (element) => {
      view.fire(element, "tap");
    },
    input: (element, value) => view.fire(element, "input", value),
    change: (element, value) => view.fire(element, "change", value),
    detach: () => options.lifetimes.detached.call(view),
  };
  for (const [name, method] of Object.entries(options.methods)) view[name] = method;
  options.lifetimes.created.call(view);
  return view;
}

const parents = new WeakMap<Element, Element>();

function fire(view: TestView & Data, element: Element, type: string, value: unknown): unknown {
  const bindAttr = `bind${type}`;
  const catchAttr = `catch${type}`;
  let handled = false;
  let result: unknown;
  for (let node: Element | undefined = element; node; node = type === "tap" ? parents.get(node) : undefined) {
    const method = node.attrs[catchAttr] ?? node.attrs[bindAttr];
    if (typeof method !== "string") continue;
    const handler = view[method];
    if (typeof handler !== "function") throw new Error(`the view has no method ${method}`);
    if (type === "input" && typeof value === "string") {
      value = limitInput(value, Number(node.attrs.maxlength ?? 140));
    }
    const dataset = Object.fromEntries(Object.entries(node.attrs)
      .filter(([name]) => name.startsWith("data-")).map(([name, data]) => [name.slice(5), data]));
    result = handler.call(view, {
      type,
      currentTarget: { id: node.attrs.id, dataset },
      detail: type === "load" || type === "keyboardheightchange" || type === "scroll" ? value : { value },
    });
    handled = true;
    if (catchAttr in node.attrs) break;
  }
  if (!handled) throw new Error(`<${element.tag}> has no ${bindAttr} or ${catchAttr} handler`);
  return result;
}

/** Applies a `setData` path such as `r.b8.l7[2].n3_0`. */
function assign(data: Data, path: string, value: unknown): void {
  const keys = path.match(/[^.[\]]+/g) ?? [];
  let target: Data = data;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = target[keys[i]];
    if (next === null || typeof next !== "object") throw new Error(`setData path ${path} crosses a non-object`);
    target = next as Data;
  }
  target[keys[keys.length - 1]] = value;
}

/* ---- WXML ---------------------------------------------------------------- */

interface Source {
  tag: string;
  attrs: Record<string, string>;
  children: (Source | string)[];
}

interface Templates {
  named: Map<string, Source[]>;
  root: Source[];
}

function parseTemplates(wxml: string): Templates {
  const named = new Map<string, Source[]>();
  const root: Source[] = [];
  for (const node of parse(wxml)) {
    if (typeof node === "string") continue;
    if (node.tag === "template" && node.attrs.name !== undefined) named.set(node.attrs.name, node.children as Source[]);
    else root.push(node);
  }
  return { named, root };
}

function parse(wxml: string): (Source | string)[] {
  const top: Source = { tag: "", attrs: {}, children: [] };
  const stack = [top];
  const token = /<\/([\w-]+)>|<([\w-]+)((?:\s+[\w:.-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  for (const match of wxml.matchAll(token)) {
    const [, close, open, attrText, selfClosing, text] = match;
    const parent = stack[stack.length - 1];
    if (close) {
      if (parent.tag !== close) throw new Error(`unbalanced </${close}> in WXML`);
      stack.pop();
    } else if (open) {
      const attrs: Record<string, string> = {};
      for (const [, name, value] of attrText.matchAll(/([\w:.-]+)(?:="([^"]*)")?/g)) attrs[name] = value ?? "";
      const node: Source = { tag: open, attrs, children: [] };
      parent.children.push(node);
      if (!selfClosing) stack.push(node);
    } else if (text.trim() !== "") {
      parent.children.push(text);
    }
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1].tag}> in WXML`);
  return top.children;
}

/** Variables visible in a template: its data plus enclosing `wx:for` items. */
type Scope = Data;

function renderNodes(nodes: (Source | string)[], scope: Scope, templates: Templates): Element[] {
  const out: (Element | string)[] = [];
  renderInto(nodes, scope, templates, out);
  return out.filter((node): node is Element => typeof node !== "string");
}

function renderInto(nodes: (Source | string)[], scope: Scope, templates: Templates, out: (Element | string)[]): void {
  let chainTaken = false;
  for (const node of nodes) {
    if (typeof node === "string") {
      out.push(interpolate(node, scope));
      continue;
    }
    const { attrs } = node;
    if ("wx:if" in attrs) {
      chainTaken = Boolean(evaluate(attrs["wx:if"], scope));
      if (!chainTaken) continue;
    } else if ("wx:elif" in attrs) {
      if (chainTaken) continue;
      chainTaken = Boolean(evaluate(attrs["wx:elif"], scope));
      if (!chainTaken) continue;
    } else if ("wx:else" in attrs) {
      if (chainTaken) continue;
    }
    if ("wx:for" in attrs) {
      const items = evaluate(attrs["wx:for"], scope);
      const name = attrs["wx:for-item"] ?? "item";
      for (const item of Array.isArray(items) ? items : []) {
        renderElement(node, { ...scope, [name]: item }, templates, out);
      }
      continue;
    }
    renderElement(node, scope, templates, out);
  }
}

function renderElement(node: Source, scope: Scope, templates: Templates, out: (Element | string)[]): void {
  if (node.tag === "block") {
    renderInto(node.children, scope, templates, out);
    return;
  }
  if (node.tag === "template") {
    const name = evaluate(node.attrs.is, scope);
    const body = typeof name === "string" ? templates.named.get(name) : undefined;
    if (!body) throw new Error(`WXML template \`${String(name)}\` is not defined`);
    const data = node.attrs.data === undefined ? {} : evaluate(node.attrs.data, scope);
    renderInto(body, (data ?? {}) as Scope, templates, out);
    return;
  }
  const attrs: Data = {};
  for (const [name, value] of Object.entries(node.attrs)) {
    if (!name.startsWith("wx:")) attrs[name] = evaluate(value, scope);
  }
  const children: (Element | string)[] = [];
  renderInto(node.children, scope, templates, children);
  const element = { tag: node.tag, attrs, children };
  for (const child of children) {
    if (typeof child !== "string") parents.set(child, element);
  }
  out.push(element);
}

/** An attribute value: a lone `{{expr}}` keeps its type, anything else is a string. */
function evaluate(text: string, scope: Scope): unknown {
  const lone = /^\{\{(.*)\}\}$/.exec(text);
  if (lone && !lone[1].includes("}}")) return expression(lone[1].trim(), scope);
  return interpolate(text, scope);
}

function interpolate(text: string, scope: Scope): string {
  return text.replace(/\{\{(.*?)\}\}/g, (_, expr: string) => {
    const value = expression(expr.trim(), scope);
    return value === undefined || value === null ? "" : String(value);
  });
}

function expression(expr: string, scope: Scope): unknown {
  // Template data spreads the scope and can pass an extra layout class.
  const spread = /^\.\.\.([^,]+)(.*)$/.exec(expr);
  if (spread) {
    const data = { ...(path(spread[1].trim(), scope) as Data) };
    for (const field of spread[2].split(",").filter(Boolean)) {
      const colon = field.indexOf(":");
      data[field.slice(0, colon).trim()] = expression(field.slice(colon + 1).trim(), scope);
    }
    return data;
  }
  const conditional = /^(.+?)\s*\?\s*('[^']*'|[\w.[\]]+)\s*:\s*('[^']*'|[\w.[\]]+)$/.exec(expr);
  if (conditional) return expression(expression(conditional[1], scope) ? conditional[2] : conditional[3], scope);
  const disjunction = /^([\w.[\]]+\s*===\s*'[^']*')\s*\|\|\s*(.+)$/.exec(expr);
  if (disjunction) return expression(disjunction[1], scope) || expression(disjunction[2], scope);
  const comparison = /^(.+?)\s*===\s*(-?\d+|'[^']*')$/.exec(expr);
  if (comparison) return path(comparison[1], scope) === expression(comparison[2], scope);
  if (expr.startsWith("'") && expr.endsWith("'")) return expr.slice(1, -1);
  if (/^-?\d+$/.test(expr)) return Number(expr);
  if (expr === "true" || expr === "false") return expr === "true";
  return path(expr, scope);
}

function path(expr: string, scope: Scope): unknown {
  let value: unknown = scope;
  for (const key of expr.match(/[^.[\]]+/g) ?? []) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Data)[key];
  }
  return value;
}

function texts(nodes: (Element | string)[]): string[] {
  return nodes.flatMap((node) => (typeof node === "string" ? [node] : texts(node.children)));
}

function all(nodes: (Element | string)[], tag: string): Element[] {
  return nodes.flatMap((node) => {
    if (typeof node === "string") return [];
    const nested = all(node.children, tag);
    return node.tag === tag ? [node, ...nested] : nested;
  });
}
