/**
 * Runs one scripted fixture on every platform that can run in Node: the
 * headless renderer (the view protocol's reference implementation), the
 * mini program (WXML interpreter) and the Web (happy-dom). Every platform's
 * view is reduced to the same neutral tree so they can be compared.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tick as webTick } from "@weft-ui/runtime";
import { ELEMENTS } from "@weft-ui/runtime/elements";
import { type Value, tick as remoteTick } from "@weft-ui/runtime/remote";
import { type Renderer, type ViewElement, render } from "@weft-ui/runtime/testing";
import { Window } from "happy-dom";
import { limitInput } from "../src/input.ts";
import { type Element as WxElement, compile, loadNavigationView, loadView } from "../src/miniprogram.ts";

const window = new Window({ url: "http://localhost/" });
// The DOM runtime parses its templates with the global `document`.
globalThis.document = window.document as unknown as Document;

/**
 * A generated root component. Scripts are typed with the Web class; the
 * mini program class has the same shape apart from `mount`'s target.
 */
export interface AppLike {
  readonly model: unknown;
  mount(target: never): void;
  unmount(): void;
}

export type AppClass<A extends AppLike> = new (model: A["model"]) => A;

/** User actions, addressing elements by type and document order. */
export interface Actions {
  /** Simulates the platform back action. */
  back(): void;
  /** Simulates a host dismissal of the presented modal. */
  dismiss(): void;
  /** Simulates selecting a tab by index. */
  tab(index: number): void;
  /** Fires the named event, or the element's first event, without a payload. */
  click(type: string, index: number, event?: string): void;
  /** Gives or takes away user focus. */
  focus(type: string, index: number, value: boolean): void;
  /** Edits a controlled element with its UI event payload. */
  edit(type: string, index: number, value: string | boolean | number): void;
}

export interface Step<M> {
  name: string;
  run(actions: Actions, model: M): void;
}

export interface Script<A extends AppLike> {
  /** Directory holding the fixture's `.weft` files. */
  dir: string;
  /** Entry file, relative to `dir`. */
  entry: string;
  /** Root component name. */
  component: string;
  /** The root component as the importing build compiles it: for the Web in Vitest, in remote mode in native bundles. */
  App: AppClass<A>;
  /** Optional factory for application roots, whose page classes differ by backend. */
  create?(exports: Record<string, unknown>, log: (entry: string) => void): A;
  exports?: Record<string, unknown>;
  model(): A["model"];
  /** Registers host handlers; `log` records what they see, compared across platforms. */
  setup(app: A, log: (entry: string) => void): void;
  steps: Step<A["model"]>[];
}

/** A platform-neutral element: its type, main values, and children. */
export interface Neutral {
  type: string;
  props: Record<string, Value>;
  children: Neutral[];
}

export interface Driver<A extends AppLike> extends Actions {
  name: string;
  app: A;
  /** What the host handlers logged. */
  log: string[];
  tree(): Neutral[];
  /** Waits for the flush scheduled by the last action. */
  settle(): Promise<void>;
  dispose?(): void;
}

/** Props compared across platforms; styling differs by design. */
const MAIN = Object.fromEntries(Object.entries(ELEMENTS).map(([name, { main }]) => [name, main]));

/** A raw platform element's neutral type and main props, with its raw children. */
interface Classified<R> {
  type: string;
  props: Record<string, Value>;
  children: readonly R[];
}

/** Reduces a platform tree; `classify` returns `null` for raw nodes to skip. */
function reduce<R>(
  roots: readonly R[],
  classify: (raw: R) => Classified<R> | null,
  found: [R, string][] = [],
): Neutral[] {
  return roots.flatMap((raw) => {
    const node = classify(raw);
    if (!node) return [];
    found.push([raw, node.type]);
    return [{ type: node.type, props: node.props, children: reduce(node.children, classify, found) }];
  });
}

function nth<R>(found: [R, string][], type: string, index: number): R {
  const raw = found.filter(([, t]) => t === type)[index]?.[0];
  if (raw === undefined) throw new Error(`no ${type} #${index}`);
  return raw;
}

function actionEvent(type: string, name?: string): { dom: string; wechat: string } {
  const first = ["Input", "TextArea", "Checkbox", "Switch", "Slider", "Picker"].includes(type) ? "onChange" : "onClick";
  switch (name ?? first) {
    case "onClick":
    case "onTap": return { dom: "click", wechat: "tap" };
    case "onSubmit": return { dom: "keydown", wechat: "confirm" };
    case "onChange": {
      if (type === "Slider") return { dom: "input", wechat: "changing" };
      const event = type === "Input" || type === "TextArea" ? "input" : "change";
      return { dom: event, wechat: event };
    }
    default: throw new Error(`no mapping for ${type}.${name}`);
  }
}

/** Output of the mini program build shared by the headless and WXML drivers. */
export interface Built<A extends AppLike> {
  out: string;
  layout: string;
  App: AppClass<A>;
  tick: () => Promise<void>;
  exports: Record<string, unknown>;
}

export async function buildFixture<A extends AppLike>(script: Script<A>): Promise<Built<A>> {
  const out = await mkdtemp(join(tmpdir(), "weft-conformance-"));
  const { layout } = await compile({ entries: [join(script.dir, script.entry)], outDir: out });
  const stem = script.entry.replace(/\.weft$/, "");
  // Generated modules exist only after the build.
  const module = await import(pathToFileURL(join(out, `${stem}.js`)).href);
  return { out, layout, App: module[script.component] as AppClass<A>, tick: remoteTick, exports: module };
}

function start<A extends AppLike>(script: Script<A>, App: AppClass<A>, target: unknown, exports: Record<string, unknown> = {}): { app: A; log: string[] } {
  const log: string[] = [];
  const app = script.create ? script.create(exports, (entry) => log.push(entry)) : new App(script.model());
  script.setup(app, (entry) => log.push(entry));
  const sink = (target as { $sink?: { configurePages?(pages: readonly unknown[]): void } }).$sink;
  const config = (app as A & { $config?: { pages: readonly unknown[] } }).$config;
  if (config) sink?.configurePages?.(config.pages);
  // Each platform's mount takes its own target type.
  app.mount(target as never);
  return { app, log };
}

/** The headless renderer; its batches are the golden ops. */
export function headless<A extends AppLike>(script: Script<A>, built: Built<A>): Driver<A> & { renderer: Renderer } {
  const renderer = render(built.layout);
  const { app, log } = start(script, built.App, renderer, built.exports);
  const find = (type: string, index: number) => {
    const found: [ViewElement, string][] = [];
    reduce(renderer.tree().flatMap((e) => e.type === "Page" ? e.children : [e]), classify, found);
    return nth(found, type, index);
  };
  const classify = (e: ViewElement) => {
    const main = MAIN[e.type];
    let props = main ? { [main]: e.props[main]! } : {};
    if (e.type === "Picker") {
      const options = e.props.options as readonly string[];
      const selected = pickerIndex(Number(e.props.selected), options.length);
      props = { selected, options, label: options[selected] ?? e.props.placeholder ?? "" };
    }
    return { type: e.type, props, children: e.children };
  };
  return {
    name: "headless",
    renderer,
    app,
    log,
    tree: () => reduce(renderer.tree().flatMap((e) => e.type === "Page" ? e.children : [e]), classify),
    back: () => renderer.back(),
    dismiss: () => renderer.dismiss(),
    tab: (index) => renderer.selectTab(index),
    click: (type, index, event) => renderer.click(find(type, index), event),
    focus: (type, index, value) => renderer.focus(find(type, index), value),
    edit: (type, index, value) => {
      const element = find(type, index);
      renderer.edit(element, typeof value === "string" ? limitInput(value, Number(element.props.maxLength ?? -1)) : value);
    },
    settle: built.tick,
  };
}

const CONTAINERS = {
  "w-column": "Column",
  "w-row": "Row",
  "w-stack": "Stack",
  "w-scroll-v": "Scroll",
  "w-scroll-h": "Scroll",
  "w-spacer": "Spacer",
  "w-spinner": "Spinner",
  "w-progress": "Progress",
  "w-divider": "Divider",
  "w-divider-v": "Divider",
};

function containerType(has: (name: string) => boolean): string {
  for (const [name, type] of Object.entries(CONTAINERS)) {
    if (has(name)) return type;
  }
  throw new Error("expected a Weft container class");
}

function pickerIndex(index: number, count: number): number {
  return index >= 0 && index < count ? index : -1;
}

function progressValue(style: string): number {
  return Number.parseFloat(/(?:^|;)\s*width:\s*([^;]+)%/.exec(style)?.[1] ?? "") / 100;
}

function wxClassify(e: WxElement | string): Classified<WxElement | string> | null {
  if (typeof e === "string") return null;
  const text = (node: WxElement | string): string =>
    typeof node === "string" ? node : node.children.map(text).join("");
  switch (e.tag) {
    case "view": {
      const classes = String(e.attrs.class).split(/\s+/);
      // Navigation bars are represented by the native page chrome, not content.
      if (classes.includes("w-navbar")) return null;
      if (classes.includes("w-wx-tap-image")) {
        const image = e.children[0];
        if (!image || typeof image === "string") throw new Error("expected a tappable image");
        return { type: "Image", props: { src: String(image.attrs.src ?? "") }, children: [] };
      }
      if (classes.includes("w-text")) return { type: "Text", props: { value: text(e) }, children: [] };
      const type = containerType((name) => classes.includes(name));
      if (type === "Progress") {
        const bar = e.children[0];
        if (!bar || typeof bar === "string") throw new Error("expected a Progress bar");
        return { type, props: { value: progressValue(String(bar.attrs.style)) }, children: [] };
      }
      return { type, props: {}, children: e.children };
    }
    case "scroll-view": {
      const content = e.children[0];
      if (!content || typeof content === "string" || !String(content.attrs.class).startsWith("w-scroll-content-")) {
        throw new Error("expected a Weft scroll content view");
      }
      return { type: "Scroll", props: {}, children: content.children };
    }
    case "text":
      return { type: "Text", props: { value: text(e) }, children: [] };
    case "button":
      return { type: "Button", props: {}, children: e.children };
    case "input":
      return { type: "Input", props: { value: String(e.attrs.value ?? "") }, children: [] };
    case "textarea":
      return { type: "TextArea", props: { value: String(e.attrs.value ?? "") }, children: [] };
    case "switch":
      return { type: e.attrs.type === "checkbox" ? "Checkbox" : "Switch", props: { checked: e.attrs.checked === true }, children: [] };
    case "slider":
      return { type: "Slider", props: { value: Number(e.attrs.value) }, children: [] };
    case "picker": {
      const options = e.attrs.range as readonly string[];
      const selected = pickerIndex(Number(e.attrs.value), options.length);
      return { type: "Picker", props: { selected, options, label: text(e) }, children: [] };
    }
    case "image":
      return { type: "Image", props: { src: String(e.attrs.src ?? "") }, children: [] };
    default:
      throw new Error(`unexpected WXML <${e.tag}>`);
  }
}

/** The mini program view component, rendered by the WXML interpreter. */
export async function wechat<A extends AppLike>(script: Script<A>, built: Built<A>): Promise<Driver<A>> {
  const layout = JSON.parse(built.layout) as { app?: { tabs?: { page: number }[] }; templates: { label: string }[] };
  const tabs = layout.app?.tabs?.map((tab) => layout.templates[tab.page]!.label) ?? [];
  const navigation = script.create ? loadNavigationView(built.out, tabs) : null;
  const root = navigation?.root ?? loadView(built.out);
  const view = () => navigation?.current() ?? root;
  const { app, log } = start(script, built.App, root, built.exports);
  navigation?.bindRootModal();
  const find = (type: string, index: number) => {
    const found: [WxElement | string, string][] = [];
    reduce(view().render().flatMap((root) => root.children), wxClassify, found);
    return nth(found, type, index) as WxElement;
  };
  return {
    name: "wechat",
    app,
    log,
    back: () => navigation?.back(),
    dismiss: () => navigation?.dismiss(),
    tab: (index) => navigation?.tab(index),
    dispose: () => navigation?.dispose(),
    tree: () => reduce(view().render().flatMap((root) => root.children), wxClassify),
    click: (type, index, event) => {
      view().fire(find(type, index), actionEvent(type, event).wechat);
    },
    focus: (type, index, value) => void view().fire(find(type, index), value ? "focus" : "blur"),
    edit: (type, index, value) => {
      const element = find(type, index);
      const { wechat } = actionEvent(type);
      view().fire(element, wechat, type === "Picker" ? String(value) : value);
    },
    settle: built.tick,
  };
}

function domClassify(e: Element): Classified<Element> {
  const children = [...e.children];
  switch (e.tagName) {
    case "DIV": {
      const type = containerType((name) => e.classList.contains(name));
      if (type === "Progress") {
        const value = Number.parseFloat((children[0] as HTMLElement).style.width) / 100;
        return { type, props: { value }, children: [] };
      }
      return { type, props: {}, children };
    }
    case "SPAN":
      return { type: "Text", props: { value: e.textContent ?? "" }, children: [] };
    case "BUTTON":
      return { type: "Button", props: {}, children };
    case "INPUT": {
      const input = e as HTMLInputElement;
      if (input.type === "checkbox") {
        const type = input.getAttribute("role") === "switch" ? "Switch" : "Checkbox";
        return { type, props: { checked: input.checked }, children: [] };
      }
      if (input.type === "range") return { type: "Slider", props: { value: Number(input.value) }, children: [] };
      return { type: "Input", props: { value: input.value }, children: [] };
    }
    case "TEXTAREA":
      return { type: "TextArea", props: { value: (e as HTMLTextAreaElement).value }, children: [] };
    case "SELECT": {
      const select = e as HTMLSelectElement;
      const options = [...select.options].slice(1).map((option) => option.textContent ?? "");
      const selected = Number(select.value);
      const label = select.options[select.selectedIndex]?.textContent ?? "";
      return { type: "Picker", props: { selected, options, label }, children: [] };
    }
    case "IMG":
      return { type: "Image", props: { src: e.getAttribute("src") ?? "" }, children: [] };
    default:
      throw new Error(`unexpected <${e.tagName}>`);
  }
}

/** The Web DOM backend in happy-dom. */
export function web<A extends AppLike>(script: Script<A>): Driver<A> {
  const target = document.createElement("div");
  document.body.append(target);
  const { app, log } = start(script, script.App, target, script.exports);
  let back: Promise<void> | undefined;
  const roots = () => {
    const page = target.querySelector(".w-modal > .w-page") ??
      [...target.children].find((element) => element.classList.contains("w-page") && !(element as HTMLElement).hidden);
    return page ? [...page.children].filter((element) => !element.classList.contains("w-navbar")) : [...target.children];
  };
  const find = (type: string, index: number) => {
    const found: [Element, string][] = [];
    reduce(roots(), domClassify, found);
    return nth(found, type, index);
  };
  return {
    name: "web",
    app,
    log,
    back: () => {
      const pending = Promise.withResolvers<void>();
      back = pending.promise;
      window.addEventListener("popstate", () => pending.resolve(), { once: true });
      window.history.back();
    },
    dismiss: () => {
      const overlay = target.querySelector<HTMLElement>(".w-modal");
      if (overlay) overlay.click();
    },
    tab: (index) => {
      const button = target.querySelectorAll<HTMLElement>('.w-tabbar [role="tab"]')[index];
      if (!button) throw new RangeError(`weft: invalid tab index ${index}`);
      button.click();
    },
    tree: () => reduce(roots(), domClassify),
    click: (type, index, name) => {
      const element = find(type, index) as HTMLElement;
      const { dom } = actionEvent(type, name);
      if (dom === "click") element.click();
      else if (dom === "keydown") element.dispatchEvent(new window.KeyboardEvent(dom, { key: "Enter" }) as unknown as Event);
      else element.dispatchEvent(new window.Event(dom) as unknown as Event);
    },
    focus: (type, index, value) => {
      const element = find(type, index) as HTMLElement;
      if (value) element.focus();
      else element.blur();
    },
    edit: (type, index, value) => {
      const input = find(type, index) as HTMLInputElement;
      if (typeof value === "boolean") input.checked = value;
      else input.value = limitInput(String(value), Number(input.getAttribute("maxlength") ?? -1));
      // Use the event class of the happy-dom window that owns the element.
      const event = new window.Event(actionEvent(type).dom) as unknown as Event;
      input.dispatchEvent(event);
    },
    settle: async () => {
      if (back) { await back; back = undefined; }
      await webTick();
    },
  };
}
