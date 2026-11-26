/**
 * Runtime for weft-generated Web DOM modules.
 *
 * Generated code owns the view structure and computes which bindings to
 * re-run from dirty bits; this module only provides the dynamic DOM blocks
 * (`if` branches, keyed `for` lists, component slots) on top of the reactive
 * model storage and flush scheduler in `core.ts`.
 */

import {
  AppBase,
  type Job,
  type Marker,
  type Shape,
  type Watch,
  asset,
  assetFonts,
  currentEpoch,
  enqueue,
  restoreAfterFlush,
  watch,
} from "./core.ts";
import { declarations } from "./css.ts";
import { CSS, CSS_PROPS, type InputType } from "./elements.ts";
import type { Value } from "./remote.ts";

export * from "./core.ts";
export type { PageClass } from "./navigation.ts";
import { NavigationController, activate, componentMounted, type ApplicationConfig, type NavigationPage, type PageFactories } from "./navigation.ts";
import { matchRoute, routeURL, type RouteInfo } from "./route.ts";
import { WebNavigationHost, decorate } from "./web-navigation.ts";

/* ------------------------------------------------------------------------ */
/* Blocks                                                                    */
/* ------------------------------------------------------------------------ */

const noop = (): void => {};

function layoutContext(parent: Node | null): string {
  if (parent?.nodeType !== 1) return "";
  const classes = (parent as Element).classList;
  if (classes.contains("w-stack")) return "w-in-stack";
  if (classes.contains("w-scroll-v") || classes.contains("w-scroll-h")) return "w-in-scroll";
  return "";
}

/**
 * A range of sibling DOM nodes created from one template. `first` is always a
 * static element or a marker comment, and `last` a static element or the
 * anchor of a dynamic child, so the range stays valid while nested content
 * changes.
 */
export class Block {
  first!: Node;
  last!: Node;
  /** Holds the nodes until the first mount. */
  frag: DocumentFragment | null = null;
  born = currentEpoch();
  /** Set when the block was created through a component slot. */
  slot: Slot | null = null;
  /** Re-runs dirty bindings and walks nested blocks. */
  u: () => void = noop;
  /** Releases nested blocks, components, and watches; leaves the DOM alone. */
  x: () => void = noop;

  init(frag: DocumentFragment): void {
    this.frag = frag;
    this.first = frag.firstChild!;
    this.last = frag.lastChild!;
  }

  mount(parent: Node, anchor: Node | null): void {
    if (this.frag) {
      const context = layoutContext(parent);
      if (context) {
        // Nested blocks can already be mounted in this fragment. Its entire
        // top-level range acquires the same context when inserted.
        for (let child = this.frag.firstElementChild; child; child = child.nextElementSibling) {
          child.classList.add(context);
        }
      }
      parent.insertBefore(this.frag, anchor);
      this.frag = null;
      return;
    }
    const previous = this.first.parentNode;
    const oldContext = previous === parent ? "" : layoutContext(previous);
    const context = previous === parent ? "" : layoutContext(parent);
    let node = this.first;
    for (;;) {
      const next = node.nextSibling;
      if (oldContext !== context && node.nodeType === 1) {
        const classes = (node as Element).classList;
        if (oldContext) classes.remove(oldContext);
        if (context) classes.add(context);
      }
      parent.insertBefore(node, anchor);
      if (node === this.last) break;
      node = next!;
    }
  }

  update(): void {
    this.u();
  }

  /** `detach` removes the nodes; nested blocks go away with their parent. */
  destroy(detach: boolean): void {
    this.x();
    this.slot?.live.delete(this);
    if (!detach || this.frag) return;
    let node = this.first;
    for (;;) {
      const next = node.nextSibling;
      (node as ChildNode).remove();
      if (node === this.last) break;
      node = next!;
    }
  }
}

/** A block with its own dirty bits: a component instance or a `for` row. */
class ScopeBlock extends Block implements Job, Marker {
  d: number[];
  depth: number;
  queued = false;
  dead = false;

  constructor(words: number, depth: number) {
    super();
    this.d = new Array<number>(words).fill(0);
    this.depth = depth;
  }

  mark(bit: number): void {
    this.d[bit >> 5] |= 1 << (bit & 31);
    enqueue(this);
  }

  flush(): void {
    for (const word of this.d) {
      if (word !== 0) {
        this.update();
        return;
      }
    }
  }

  override update(): void {
    this.u();
    this.d.fill(0);
  }

  override destroy(detach: boolean): void {
    this.dead = true;
    super.destroy(detach);
  }
}

/** One item of a keyed `for` list. */
export class Row extends ScopeBlock {
  item: unknown;
  w: Watch;

  constructor(words: number, depth: number, shape: Shape, item: unknown) {
    super(words, depth);
    this.item = item;
    this.w = watch(shape, this, item);
  }

  setItem(item: unknown): void {
    this.item = item;
    this.w.set(item);
  }

  override destroy(detach: boolean): void {
    this.w.dispose();
    super.destroy(detach);
  }
}

/** A component instance: parameter and state values plus their watches. */
export class Instance extends ScopeBlock {
  app: App;
  p: unknown[];
  s: unknown[] = [];
  pw: (Watch | undefined)[] = [];
  sw: Watch[] = [];
  /** Caller-supplied blocks in `Children` parameter order. */
  children: readonly (Slot | null)[];

  constructor(app: App, words: number, depth: number, args: unknown[], children: readonly (Slot | null)[]) {
    super(words, depth);
    this.app = app;
    this.p = args;
    this.children = children;
  }

  arg(index: number, value: unknown): void {
    this.p[index] = value;
    this.pw[index]?.set(value);
  }

  state(index: number, value: unknown): void {
    this.s[index] = value;
    this.sw[index].set(value);
  }

  override destroy(detach: boolean): void {
    for (const w of this.pw) w?.dispose();
    for (const w of this.sw) w.dispose();
    super.destroy(detach);
  }
}

/** Runtime of an `if / else if / else` chain; branch `-1` renders nothing. */
export class Branches {
  anchor: Node;
  make: (index: number) => Block | null;
  index = -1;
  block: Block | null = null;

  constructor(anchor: Node, make: (index: number) => Block | null) {
    this.anchor = anchor;
    this.make = make;
  }

  set(index: number): void {
    if (index === this.index) return;
    this.index = index;
    this.block?.destroy(true);
    this.block = this.make(index);
    this.block?.mount(this.anchor.parentNode!, this.anchor);
  }

  update(): void {
    const block = this.block;
    if (block && block.born !== currentEpoch()) block.update();
  }

  destroy(): void {
    this.block?.destroy(false);
    this.block = null;
  }
}

/** Runtime of a keyed `for` loop. */
export class List {
  anchor: Node;
  make: (item: unknown) => Row;
  key: (item: unknown) => unknown;
  rows: Row[] = [];

  constructor(anchor: Node, make: (item: unknown) => Row, key: (item: unknown) => unknown) {
    this.anchor = anchor;
    this.make = make;
    this.key = key;
  }

  /**
   * Reconciles rows with `items` by key: reused rows receive the new item
   * (marking only the fields that changed), unmatched rows are destroyed, new
   * rows are created, and only rows outside the longest increasing run of old
   * positions are moved.
   */
  set(items: readonly unknown[]): void {
    const seen = new Set<unknown>();
    const keys = new Array<unknown>(items.length);
    for (let i = 0; i < items.length; i++) {
      const key = this.key(items[i]);
      if (seen.has(key)) throw new Error(`weft: duplicate key \`${String(key)}\` in for loop`);
      seen.add(key);
      keys[i] = key;
    }

    const old = this.rows;
    const byKey = new Map<unknown, number>();
    for (let i = 0; i < old.length; i++) byKey.set(this.key(old[i].item), i);

    const rows = new Array<Row>(items.length);
    const sources = new Array<number>(items.length);
    const reused = new Uint8Array(old.length);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const j = byKey.get(keys[i]);
      if (j !== undefined && !reused[j]) {
        reused[j] = 1;
        const row = old[j];
        if (row.item !== item) row.setItem(item);
        rows[i] = row;
        sources[i] = j;
      } else {
        rows[i] = this.make(item);
        sources[i] = -1;
      }
    }
    for (let j = 0; j < old.length; j++) {
      if (!reused[j]) old[j].destroy(true);
    }

    const stay = increasingRun(sources);
    const parent = this.anchor.parentNode!;
    let next = this.anchor;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (!stay[i]) rows[i].mount(parent, next);
      next = rows[i].first;
    }
    this.rows = rows;
  }

  update(): void {
    const epoch = currentEpoch();
    for (const row of this.rows) {
      if (row.born !== epoch) row.update();
    }
  }

  destroy(): void {
    for (const row of this.rows) row.destroy(false);
    this.rows = [];
  }
}

/**
 * Marks the positions of a longest strictly increasing subsequence of
 * `sources`, ignoring `-1` entries (new rows).
 */
function increasingRun(sources: readonly number[]): boolean[] {
  const n = sources.length;
  const prev = new Array<number>(n).fill(-1);
  /** `tails[k]`: index of the smallest tail of an increasing run of length k + 1. */
  const tails: number[] = [];
  for (let i = 0; i < n; i++) {
    const value = sources[i];
    if (value < 0) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sources[tails[mid]] < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const stay = new Array<boolean>(n).fill(false);
  let i = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (i >= 0) {
    stay[i] = true;
    i = prev[i];
  }
  return stay;
}

/**
 * The caller's block for a component's `Children` parameter. The callee
 * creates instances where it renders the slot; the caller updates them.
 */
export class Slot {
  make: () => Block;
  live: Set<Block> = new Set();

  constructor(make: () => Block) {
    this.make = make;
  }

  create(): Block {
    const block = this.make();
    block.slot = this;
    this.live.add(block);
    return block;
  }

  update(): void {
    const epoch = currentEpoch();
    for (const block of this.live) {
      if (block.born !== epoch) block.update();
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Host-facing component                                                     */
/* ------------------------------------------------------------------------ */

type Create = (app: App, args: unknown[], children: readonly (Slot | null)[], depth: number) => Instance;

/** Base class of the generated root component classes. */
export class App extends AppBase {
  /** Set by generated classes when the app opts out of safe-area padding. */
  declare static readonly safeArea?: boolean;

  #create: Create;
  #root: Instance | null = null;

  constructor(create: Create, args: unknown[]) {
    super(args);
    this.#create = create;
  }

  mount(target: Node): void {
    if (!(this instanceof Page)) componentMounted();
    if (this.#root) throw new Error("weft: component is already mounted");
    const doc = target.ownerDocument ?? (target as Document);
    if (!doc.querySelector("style[data-weft]")) {
      const base = doc.createElement("style");
      base.dataset.weft = "";
      // WXSS cannot compile :has(); WeChat stops ancestor hover via WXML instead.
      base.textContent = `${CSS}\n.w-safe{padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}\n:root{color-scheme:light dark}\n.w-tap:active:not(:has(.w-tap:active,.w-button:active)){filter:opacity(.6)}\nimg.w-image{object-fit:cover}\n.w-image-placeholder:not(.w-image-loaded){background-color:var(--w-image-placeholder)!important;content:linear-gradient(transparent,transparent)}\n${assetFonts()}`;
      doc.head.append(base);
    }
    if (target.nodeType === 1) {
      const { classList } = target as Element;
      classList.add("w-root");
      classList.toggle("w-safe", (this.constructor as typeof App).safeArea ?? true);
    }
    const root = this.#create(this, this.$args, [], 0);
    try {
      root.mount(target, null);
    } catch (error) {
      root.destroy(true);
      throw error;
    }
    this.#root = root;
  }

  unmount(): void {
    const root = this.#root;
    if (!root) return;
    this.#root = null;
    root.destroy(true);
  }
}

/** Base class of generated pages. */
export class Page<P> extends App {
  declare static readonly $route: RouteInfo;
  readonly params: Readonly<P>;
  $navigation: NavigationController | null = null;
  override $emit(name: string, payload: object): void {
    if (this.$navigation) activate(this.$navigation);
    super.$emit(name, payload);
  }

  constructor(create: Create, args: unknown[], params: P) {
    super(create, args);
    this.params = Object.freeze(params);
    if (!Object.prototype.hasOwnProperty.call(Page.prototype, "onShow")) {
      Object.defineProperties(Page.prototype, {
        onShow: { value(this: Page<unknown>, handler: (model: unknown) => void) { return this.$on("Show", handler); } },
        onHide: { value(this: Page<unknown>, handler: (model: unknown) => void) { return this.$on("Hide", handler); } },
      });
    }
  }
  override mount(_target: Node): void { throw new Error("weft: pages are mounted by their app"); }
  $mountPage(target: Node): void { super.mount(target); }
}

/** An application retains each page's DOM while it remains on the stack. */
export class Application {
  readonly $application = true;
  readonly $config: ApplicationConfig;
  private readonly controller: NavigationController;
  private host: WebNavigationHost | null = null;
  private mountedPages = new Set<NavigationPage>();
  private document: Document | null = null;
  private readonly visibility = () => this.controller.setForeground(!this.document?.hidden);

  constructor(factories: PageFactories, config: ApplicationConfig, _hash = "") {
    this.$config = config;
    this.controller = new NavigationController(factories, config, {
      create: value => { (value as Page<Record<string, never>>).$navigation = this.controller; return 0; },
      destroy: (value) => { const page = value as Page<Record<string, never>>; page.unmount(); page.$navigation = null; this.mountedPages.delete(value); },
      update: (entries, operation) => {
        const sections = this.host!.sync(entries.map(({ page, type }) => ({ key: page, url: routeURL(type, page.params) })), operation === "correct" ? "host" : operation);
        entries.forEach(({ page }, i) => {
          if (!this.mountedPages.has(page)) { (page as Page<Record<string, never>>).$mountPage(sections[i]!); this.mountedPages.add(page); }
          decorate(sections[i]!, i > 0, () => this.controller.pop());
        });
      },
    });
  }
  $activate(): void { activate(this.controller); }
  mount(target: Node): void {
    if (this.host) throw new Error("weft: application is already mounted");
    const doc = target.ownerDocument ?? target as Document;
    const window = doc.defaultView;
    if (!window) throw new Error("weft: application target requires a window");
    this.document = doc;
    this.host = new WebNavigationHost(target as HTMLElement, urls => this.controller.restore(urls));
    activate(this.controller);
    doc.addEventListener("visibilitychange", this.visibility);
    this.visibility();
    const url = window.location.pathname + window.location.search;
    const route = matchRoute(this.$config.pages, url);
    try {
      this.controller.start(route ? (route.page === this.$config.start ? [url] : [routeURL(this.$config.start, {}), url]) : []);
    } catch (error) { this.unmount(); throw error; }
  }
  unmount(): void { if (!this.host) return; this.document?.removeEventListener("visibilitychange", this.visibility); this.document = null; this.controller.dispose(); this.host.dispose(); this.host = null; }
}

/* ------------------------------------------------------------------------ */
/* DOM helpers used by generated code                                        */
/* ------------------------------------------------------------------------ */

/** Sets a navigation bar button's icon without disturbing its accessible text. */
export function barIcon(button: HTMLElement, value: string): void {
  const src = value.startsWith("asset:") ? asset(value.slice(6)).src : value;
  button.classList.toggle("w-bar-button-icon", !!src);
  button.style.backgroundImage = src ? `url(${JSON.stringify(src)})` : "";
}

/** Tracks loading state for an image that has a placeholder. */
export function imagePlaceholder(node: HTMLImageElement): void {
  node.addEventListener("load", () => node.classList.add("w-image-loaded"));
  node.addEventListener("error", () => node.classList.remove("w-image-loaded"));
}

/** Applies an image source, resolving and clearing density variants as needed. */
export function image(node: HTMLImageElement, value: string): void {
  let src = value;
  let srcset = "";
  if (value.startsWith("asset:")) {
    ({ src, srcset } = asset(value.slice(6)));
    // src would count as an extra 1x candidate if the manifest starts at 2x or 3x.
    if (srcset && !srcset.startsWith(`${src} 1x`)) src = "";
  }
  if ((node.getAttribute("src") ?? "") === src && (node.getAttribute("srcset") ?? "") === srcset) return;
  node.classList.remove("w-image-loaded");
  if (srcset) node.setAttribute("srcset", srcset);
  else node.removeAttribute("srcset");
  if (src) node.setAttribute("src", src);
  else node.removeAttribute("src");
}

let webThemeColors: ReadonlySet<string> | null = null;

/** Applies a generated CSS mapping, optionally restricted to winning declarations. */
export function style(node: HTMLElement, index: number, value: Value, mask = -1): void {
  const css = CSS_PROPS[index]!;
  const output = declarations(css, value, webThemeColors);
  const inline = (css.target === "inner" ? node.firstElementChild as HTMLElement : node).style;
  if (css.unit === "custom") {
    switch (css.custom) {
      case "fill":
        node.classList.toggle("w-fill", value === true);
        break;
      case "grow": {
        const grows = typeof value === "number" && Number.isFinite(value) && value > 0;
        node.classList.toggle("w-grow", grows);
        if (!grows) {
          // Positive grow adds minimums unless explicit constraints own them.
          if ((mask & 0b010) !== 0) inline.removeProperty("min-width");
          if ((mask & 0b100) !== 0) inline.removeProperty("min-height");
        }
        break;
      }
      case "hidden":
        if (!output) inline.removeProperty("display");
        break;
      case "maxLines":
        if (!output) {
          inline.removeProperty("display");
          inline.removeProperty("-webkit-box-orient");
          inline.removeProperty("-webkit-line-clamp");
          inline.removeProperty("overflow");
        }
        break;
    }
  } else if ((css.unit === "keyword" || css.unit === "font") && !output) {
    if (css.properties) {
      for (const property of css.properties) inline.removeProperty(property);
    } else {
      inline.removeProperty(css.property);
    }
  }

  let start = 0;
  let bit = 1;
  while (start < output.length) {
    const separator = output.indexOf(";", start);
    const end = separator < 0 ? output.length : separator;
    const colon = output.indexOf(":", start);
    if (colon > start && colon < end && (mask & bit) !== 0) {
      inline.setProperty(output.slice(start, colon), output.slice(colon + 1, end));
    }
    start = end + 1;
    bit <<= 1;
  }
}

/** Installs the generated theme once; CSS handles system appearance changes. */
export function theme(tokens: Record<string, readonly [string, string]>): void {
  const names = Object.keys(tokens);
  if (names.length === 0) return;
  webThemeColors = new Set(names);
  if (typeof document === "undefined") return;
  if (document.querySelector("style[data-weft-theme]")) return;
  const style = document.createElement("style");
  style.dataset.weftTheme = "";
  let light = "";
  let dark = "";
  for (const name of names) {
    const [lightColor, darkColor] = tokens[name]!;
    light += `--weft-${name}:${lightColor};`;
    dark += `--weft-${name}:${darkColor};`;
  }
  style.textContent = `:root{${light}}@media (prefers-color-scheme: dark){:root{${dark}}}`;
  document.head.append(style);
}

/** Lazily parsed `<template>`; returns a fresh clone per call. */
export function template(html: string): () => DocumentFragment {
  let tpl: HTMLTemplateElement | null = null;
  return () => {
    if (!tpl) {
      tpl = document.createElement("template");
      tpl.innerHTML = html;
    }
    return tpl.content.cloneNode(true) as DocumentFragment;
  };
}

/** An input whose displayed value follows the last bound value. */
type Controlled<N, V> = N & { $v?: V };
type TextControl = Controlled<HTMLInputElement | HTMLTextAreaElement, string> & { $focused?: boolean };
type CheckControl = Controlled<HTMLInputElement, boolean>;
type RangeControl = Controlled<HTMLInputElement, number>;
type PickerControl = Controlled<HTMLSelectElement, number> & { $options?: readonly string[] };

export function value(node: TextControl, value: string): void {
  node.$v = value;
  if (node.value !== value) node.value = value;
}

export function inputType(node: HTMLInputElement, type: InputType): void {
  node.type = type === "phone" ? "tel" : type === "number" ? "text" : type;
  if (type === "number") node.setAttribute("inputmode", "numeric");
  else node.removeAttribute("inputmode");
}

export function focused(node: TextControl, value: boolean): void {
  if ((node.$focused ?? false) === value) return;
  node.$focused = value;
  if (!value) node.blur();
  else if (node.isConnected) node.focus();
  else {
    // Initial bindings run on a detached template; mount inserts it in this turn.
    queueMicrotask(() => {
      if (node.$focused && node.isConnected) node.focus();
    });
  }
}

/** Gives a non-button DOM element button keyboard behavior. */
export function onTap(node: HTMLElement, handler: () => void): void {
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    handler();
  });
  let pressedKey: string | undefined;
  node.addEventListener("keydown", (event) => {
    if (event.target !== node || (event.key !== "Enter" && event.key !== " ") || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || pressedKey !== undefined) return;
    pressedKey = event.key;
    node.classList.add("w-pressed");
    if (pressedKey === "Enter") node.click();
  });
  node.addEventListener("keyup", (event) => {
    if (event.target !== node || event.key !== pressedKey) return;
    event.preventDefault();
    event.stopPropagation();
    pressedKey = undefined;
    node.classList.remove("w-pressed");
    if (event.key === " ") node.click();
  });
  node.addEventListener("blur", () => {
    pressedKey = undefined;
    node.classList.remove("w-pressed");
  });
}

export function onSubmit(node: HTMLInputElement, handler: () => void): void {
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) handler();
  });
}

export function onFocusChange(node: TextControl, handler: (focused: boolean) => void): void {
  node.addEventListener("focus", () => handler(true));
  node.addEventListener("blur", () => handler(false));
}

export function checked(node: CheckControl, value: boolean): void {
  node.$v = value;
  if (node.checked !== value) node.checked = value;
}

/**
 * Text input events. After the flush triggered by the handler, the input is
 * reset to the bound value, so only the host decides what it shows.
 */
export function input(node: TextControl, handler: ((value: string) => void) | null): void {
  node.addEventListener("input", () => {
    handler?.(node.value);
    restoreAfterFlush(() => {
      if (node.$v !== undefined) value(node, node.$v);
    });
  });
}

export function checkbox(node: CheckControl, handler: ((value: boolean) => void) | null): void {
  node.addEventListener("change", () => {
    handler?.(node.checked);
    restoreAfterFlush(() => {
      if (node.$v !== undefined) checked(node, node.$v);
    });
  });
}

export function rangeValue(node: RangeControl, value: number): void {
  node.$v = value;
  const text = String(value);
  if (node.value !== text) node.value = text;
}

export function rangeAttr(node: RangeControl, name: string, value: number): void {
  node.setAttribute(name, String(value));
  // The browser can sanitize the current value as a bound or step changes.
  if (node.$v !== undefined) rangeValue(node, node.$v);
}

export function slider(node: RangeControl, handler: ((value: number) => void) | null): void {
  node.addEventListener("input", () => {
    handler?.(Number(node.value));
    restoreAfterFlush(() => {
      if (node.$v !== undefined) rangeValue(node, node.$v);
    });
  });
}

export function selected(node: PickerControl, value: number): void {
  node.$v = value;
  const index = value >= 0 && value < node.options.length - 1 ? value + 1 : 0;
  if (node.selectedIndex !== index) node.selectedIndex = index;
}

export function options(node: PickerControl, labels: readonly string[]): void {
  const old = node.$options;
  if (old === labels || (old?.length === labels.length && labels.every((label, i) => label === old[i]))) return;
  node.$options = labels;
  const fragment = node.ownerDocument.createDocumentFragment();
  for (const [index, label] of labels.entries()) {
    const option = node.ownerDocument.createElement("option");
    option.value = String(index);
    option.textContent = label;
    fragment.append(option);
  }
  node.replaceChildren(node.options[0]!, fragment);
  if (node.$v !== undefined) selected(node, node.$v);
}

export function placeholder(node: PickerControl, text: string): void {
  node.options[0]!.textContent = text;
}

export function picker(node: PickerControl, handler: ((value: number) => void) | null): void {
  node.addEventListener("change", () => {
    handler?.(Number(node.value));
    restoreAfterFlush(() => {
      if (node.$v !== undefined) selected(node, node.$v);
    });
  });
}
