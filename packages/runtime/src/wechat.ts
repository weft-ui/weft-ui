/**
 * WeChat mini program sink: translates view protocol ops into `setData`
 * paths, and the generated view component that hosts it.
 *
 * The sink keeps one plain data object per scope, nested like the view: a
 * component's WXML template renders exactly that tree. The generated table
 * (`weft-layout.js`) maps every slot, event and mount point of a layout
 * template to a data key. At the end of every batch the changed keys become
 * `setData` paths such as `r.b8.l7[2].n3_0`, and paths below another changed
 * path are dropped. Event handlers stay in the logic layer: the view only
 * carries handler ids (`data-e<type>`) that the sink maps back to
 * `(scope, event slot)`.
 */

import { warnMissingAsset } from "./core.ts";
import { declarations } from "./css.ts";
import { CSS_PROPS } from "./elements.ts";
import { sameValue, type Session, type Sink, type Value } from "./remote.ts";
import { matchRoute, type PageClass } from "./route.ts";

type Data = Record<string, unknown>;

type AssetVariants = Readonly<Record<string, readonly [scale: number, src: string][]>>;

declare const wx: {
  getWindowInfo?(): { pixelRatio: number };
  setNavigationBarTitle(options: { title: string }): void;
  navigateTo(options: { url: string }): void;
  redirectTo(options: { url: string }): void;
  navigateBack(options: { delta: number }): void;
  switchTab(options: { url: string }): void;
  setTabBarBadge(options: { index: number; text: string }): void;
  removeTabBarBadge(options: { index: number }): void;
  showTabBarRedDot(options: { index: number }): void;
  hideTabBarRedDot(options: { index: number }): void;
};

/** Data keys of one layout template (see `crates/transformer/src/wechat/table.rs`). */
export interface TemplateKeys {
  /** WXML template rendering a component body as the root. */
  n?: string;
  /** Static title or data key of the page's dynamic navigation title. */
  bar?: { title?: string; key?: string };
  /** WXML template of slot content, stored in its data as `t`. */
  t?: string;
  /** Branch index of an `if` branch template. */
  i?: number;
  /** Value key with optional CSS, picker or image-source mapping. */
  v?: ([key: string, cssIndex?: number | null, picker?: number]
    | [key: string, kind: "src", metrics?: string]
    | [key: string, kind: "fit"])[];
  /** Constant local sources to resolve when the scope is created. */
  a?: Readonly<Record<string, string>>;
  /** Whether to expose the scope id to image load events. */
  m?: true;
  /** Handler key, controlled value slot or -1, and optional event behavior. */
  e?: [key: string, controls: number, kind?: "number" | "textarea"][];
  /** Label, selected index, options and optional placeholder data keys per picker. */
  q?: [label: string, selected: string, options: string, placeholder?: string][];
  /** Key per mount point; `[indexKey, dataKey]` for branches. */
  p?: (string | [string, string])[];
  /** Constants that cannot be inlined into WXML. */
  d?: Data;
}

/** The generated table of an app. */
export interface Layout {
  hash: string;
  /** Names of tokens defined in the view stylesheet. */
  theme?: readonly string[];
  templates: TemplateKeys[];
}

/** The generated view component instance (`Component(view(layout))`). */
export interface View {
  setData(data: Data): void;
  $sink?: WechatSink;
}

/** The event object of WXML `bind` and `catch` handlers. */
interface ViewEvent {
  type: string;
  currentTarget: { dataset: Data };
  detail?: { value?: unknown; width?: number; height?: number };
}

interface Scope {
  id: number;
  keys: TemplateKeys;
  o: Data;
  /** The scope holding this one's data under `seg` (`b3`, `c5`, `y6`, or `l7[2]` for rows). */
  up: Scope | null;
  seg: string;
  /** Created in the current batch, so its data has not been sent yet. */
  fresh: boolean;
  dead: boolean;
  /** Mounted children by point: one scope, or the rows of a list. */
  kids: (Scope | Scope[] | null)[];
  /** Handler ids of the scope's event slots. */
  hs: number[];
}

/** Renders one app into a view component through `setData`. */
export class WechatSink implements Sink {
  #view: View;
  #layout: Layout;
  #theme: ReadonlySet<string> | null;
  #assets: AssetVariants | undefined;
  #scales = new Map<string, number>();
  #session: Session | null = null;
  #scopes = new Map<number, Scope>();
  #root: Scope | null = null;
  #rootFresh = false;
  #created: Scope[] = [];
  /** Changed data since the last commit: a scope and one of its keys, or `null` for the whole scope. */
  #pending: [Scope, string | null][] = [];
  /** Handler id → scope and event slot. */
  #handlers = new Map<number, [Scope, number]>();
  #lastHandler = 0;
  #pages: number[] = [];
  #views = new Map<number, View>();
  #routeCount = 0;
  #hostNavigating = 0;
  #pageTypes: readonly PageClass[] = [];
  #tabNames: readonly string[] = [];
  #tabs: readonly number[] = [];
  #tab = 0;
  #rootPage: string | undefined;
  #nextNavigation = 0;

  constructor(view: View, layout: Layout, assets?: AssetVariants) {
    this.#view = view;
    this.#layout = layout;
    this.#theme = layout.theme ? new Set(layout.theme) : null;
    this.#assets = assets;
    if (assets) {
      for (const variants of Object.values(assets)) {
        for (const [scale, src] of variants) this.#scales.set(src, scale);
      }
    }
  }

  open(session: Session): void {
    if (session.hash !== this.#layout.hash) {
      throw new Error(
        `weft: this view component was generated for another build of the app (layout ${this.#layout.hash}, app ${session.hash})`,
      );
    }
    this.#session?.detach();
    this.#reset();
    this.#session = session;
  }

  create(id: number, template: number): void {
    const keys = this.#layout.templates[template];
    const scope: Scope = { id, keys, o: {}, up: null, seg: "", fresh: true, dead: false, kids: [], hs: [] };
    const o = scope.o;
    if (keys.t !== undefined) o.t = keys.t;
    if (keys.d) Object.assign(o, keys.d);
    if (keys.m) o.ws = id;
    if (keys.a) for (const [key, src] of Object.entries(keys.a)) o[key] = this.#imageSource(src);
    if (keys.e) {
      for (let slot = 0; slot < keys.e.length; slot++) {
        const handler = ++this.#lastHandler;
        this.#handlers.set(handler, [scope, slot]);
        scope.hs.push(handler);
        o[keys.e[slot][0]] = handler;
      }
    }
    if (keys.p) {
      for (const point of keys.p) {
        if (typeof point === "string") {
          if (point[0] === "l") o[point] = [];
        } else {
          o[point[0]] = -1;
          o[point[1]] = null;
        }
      }
    }
    this.#scopes.set(id, scope);
    this.#created.push(scope);
  }

  set(id: number, slot: number, value: Value): void {
    const scope = this.#scope(id);
    const [key, mapping, extra] = scope.keys.v![slot]!;
    const next = mapping === "src" ? this.#imageSource(String(value))
      : mapping === "fit" ? value === "contain" ? "aspectFit" : value === "fill" ? "scaleToFill" : "aspectFill"
      : mapping == null ? value : declarations(CSS_PROPS[mapping]!, value, this.#theme);
    if (sameValue(scope.o[key], next)) return;
    scope.o[key] = next;
    if (!scope.fresh) this.#pend(scope, key);
    if (scope.keys.bar?.key === key && this.#pages.at(-1) === id) this.showPage(this.#pages.length - 1);
    if (mapping === "src") {
      if (typeof extra === "string" && scope.o[extra]) {
        scope.o[extra] = "";
        if (!scope.fresh) this.#pend(scope, extra);
      }
    } else if (typeof extra === "number") {
      const picker = extra;
      const [label, selected, options, placeholder] = scope.keys.q![picker]!;
      const index = scope.o[selected] as number;
      const labels = scope.o[options] as readonly string[] | undefined;
      const text = labels?.[index] ?? (placeholder === undefined ? "" : scope.o[placeholder] ?? "");
      if (scope.o[label] !== text) {
        scope.o[label] = text;
        if (!scope.fresh) this.#pend(scope, label);
      }
    }
  }

  branch(id: number, point: number, child: number): void {
    const scope = this.#scope(id);
    const [indexKey, dataKey] = scope.keys.p![point] as [string, string];
    const old = scope.kids[point] as Scope | null | undefined;
    if (old) this.#destroy(old);
    const next = child === 0 ? null : this.#scope(child);
    scope.kids[point] = next;
    if (next) {
      next.up = scope;
      next.seg = dataKey;
    }
    scope.o[indexKey] = next ? next.keys.i! : -1;
    scope.o[dataKey] = next ? next.o : null;
    if (!scope.fresh) {
      this.#pend(scope, indexKey);
      this.#pend(scope, dataKey);
    }
  }

  /**
   * Rows appended behind unchanged ones are sent by index; any other change
   * of the row order sends the whole array. A row's `k` (`wx:key`) is its
   * scope id.
   */
  rows(id: number, point: number, children: readonly number[]): void {
    const scope = this.#scope(id);
    const key = scope.keys.p![point] as string;
    const old = (scope.kids[point] as Scope[] | undefined) ?? [];
    const rows = children.map((child) => this.#scope(child));
    const kept = new Set(rows);
    for (const row of old) if (!kept.has(row)) this.#destroy(row);
    let appended = rows.length >= old.length;
    for (let i = 0; appended && i < old.length; i++) appended = rows[i] === old[i];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      row.up = scope;
      row.seg = `${key}[${i}]`;
      row.o.k = row.id;
    }
    scope.kids[point] = rows;
    if (appended) {
      const data = scope.o[key] as Data[];
      for (let i = old.length; i < rows.length; i++) {
        data.push(rows[i].o);
        if (!scope.fresh) this.#pend(rows[i], null);
      }
    } else {
      scope.o[key] = rows.map((row) => row.o);
      if (!scope.fresh) this.#pend(scope, key);
    }
  }

  attach(id: number, point: number, child: number): void {
    const next = this.#scope(child);
    if (id === 0) {
      next.seg = "r";
      this.#root = next;
      this.#rootFresh = true;
      return;
    }
    const scope = this.#scope(id);
    const key = scope.keys.p![point] as string;
    scope.kids[point] = next;
    next.up = scope;
    next.seg = key;
    scope.o[key] = next.o;
    if (!scope.fresh) this.#pend(scope, key);
  }

  /** Enforces the platform page-stack limit before creating another page. */
  beforePush(depth: number): void {
    if (depth >= 10) throw new Error("weft: the mini program page stack is limited to 10 pages");
  }

  /** Supplies route metadata for encoding mini program page queries. */
  configurePages(pages: readonly PageClass[]): void {
    this.#pageTypes = pages;
  }

  /** Records the tab page names in tab-bar order. */
  configureTabs(names: readonly string[]): void {
    this.#tabNames = names;
  }

  /** Adopts a user-selected tab before its view is bound. */
  selectTab(name: string): void {
    const index = this.#tabNames.indexOf(name);
    if (index < 0 || (index === this.#tab && this.#rootPage === name && this.#pages.length <= 1)) return;
    for (const id of this.#pages.slice(1)) {
      const scope = this.#scopes.get(id);
      if (scope) this.#destroy(scope);
    }
    const wasTab = this.#rootPage === this.#tabNames[this.#tab];
    if (!wasTab) {
      const root = this.#scopes.get(this.#pages[0]);
      if (root) this.#destroy(root);
    }
    this.#tab = index;
    this.#rootPage = name;
    this.#pages = wasTab && this.#tabs[index] ? [this.#tabs[index]!] : [];
    this.#routeCount = 1;
    this.#session?.signal("navigation", JSON.stringify({ tab: index, stack: [], modal: 0 }));
  }

  badge(index: number, text: string | null): void {
    if (text === null) {
      wx.removeTabBarBadge({ index });
      wx.hideTabBarRedDot({ index });
    } else if (text === "") {
      wx.removeTabBarBadge({ index });
      wx.showTabBarRedDot({ index });
    } else {
      wx.hideTabBarRedDot({ index });
      wx.setTabBarBadge({ index, text });
    }
  }

  /** Refreshes the native title when the platform shows a page. */
  showPage(index: number): void {
    const scope = this.#scopes.get(this.#pages[index]);
    const bar = scope?.keys.bar;
    if (!bar) return;
    const title = bar.key === undefined ? bar.title : scope?.o[bar.key];
    wx.setNavigationBarTitle({ title: typeof title === "string" ? title : "" });
  }

  /** Associates a platform page with the corresponding navigation stack position. */
  bindPage(index: number, view: View): void {
    this.#views.set(index, view);
    view.$sink = this;
    const scope = this.#scopes.get(this.#pages[index]);
    if (scope) view.setData({ t: scope.keys.n, r: scope.o });
  }

  unloadPage(index: number, view?: View): void {
    if (!view || this.#views.get(index) === view) this.#views.delete(index);
    if (this.#hostNavigating > 0) {
      this.#hostNavigating--;
      return;
    }
    if (index > 0 && index < this.#pages.length) {
      const removed = this.#pages.slice(index);
      this.#pages = this.#pages.slice(0, index);
      this.#routeCount = this.#pages.length;
      this.#session?.signal("navigation", JSON.stringify({ tab: this.#tab, stack: this.#pages.slice(1), modal: 0 }));
      for (const id of removed) {
        const scope = this.#scopes.get(id);
        if (scope) this.#destroy(scope);
      }
    }
  }

  routes(routes: readonly { page: string; url: string }[], operation: "push" | "replace" | "pop" | "root" | "host" | "tab"): void {
    const previous = this.#routeCount;
    this.#routeCount = routes.length;
    this.#rootPage = routes[0]?.page;
    if (!previous || operation === "host") return;
    if (operation === "tab") {
      const slug = routes[0]!.page.replace(/([A-Z])/g, (letter, _match, offset: number) => `${offset ? "-" : ""}${letter.toLowerCase()}`);
      this.#hostNavigating += Math.max(0, previous - 1);
      wx.switchTab({ url: `/weft/pages/${slug}/index` });
    } else if (operation === "push" || operation === "replace") {
      const route = routes[routes.length - 1];
      const slug = route.page.replace(/([A-Z])/g, (letter, _match, offset: number) => `${offset ? "-" : ""}${letter.toLowerCase()}`);
      const match = matchRoute(this.#pageTypes, route.url);
      if (!match) throw new Error(`weft: cannot encode route ${route.url}`);
      const query = Object.entries(match.params).filter(([, value]) => value != null)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
      query.push(`__w=${++this.#nextNavigation}`);
      const url = `/weft/pages/${slug}/index?${query.join("&")}`;
      if (operation === "push") wx.navigateTo({ url });
      else { this.#hostNavigating++; wx.redirectTo({ url }); }
    } else {
      const delta = previous - routes.length;
      if (delta > 0) { this.#hostNavigating += delta; wx.navigateBack({ delta }); }
    }
  }

  nav(tab: number, tabs: readonly number[], stack: readonly number[], _modal: number, _style: "sheet" | "fullScreen"): void {
    const initial = this.#pages.length === 0;
    const next = [tabs[tab], ...stack].filter((id) => id !== 0);
    const kept = new Set([...tabs, ...stack]);
    this.#tab = tab;
    this.#tabs = tabs;
    for (const id of this.#pages) if (!kept.has(id)) {
      const scope = this.#scopes.get(id);
      if (scope) this.#destroy(scope);
    }
    this.#pages = next;
    for (const id of next) this.#scope(id).seg = "r";
    if (!this.#views.size) this.#views.set(0, this.#view);
    if (initial && next.length) this.showPage(0);
  }

  /** Sends the batch with one `setData`. */
  commit(): void {
    const data = new Map<string, unknown>();
    for (const [scope, key] of this.#pending) {
      if (scope.dead) continue;
      const path = this.#locate(scope, key);
      if (path !== null) data.set(path, key === null ? scope.o : scope.o[key]);
    }
    if (this.#rootFresh && this.#root) {
      data.set("t", this.#root.keys.n);
      data.set("r", this.#root.o);
    }
    this.#pending = [];
    this.#rootFresh = false;
    for (const scope of this.#created) scope.fresh = false;
    this.#created = [];
    if (this.#pages.length) {
      for (const [index, view] of this.#views) {
        const scope = this.#scopes.get(this.#pages[index]);
        if (scope) view.setData({ t: scope.keys.n, r: scope.o });
      }
    } else if (data.size > 0) this.#view.setData(uncovered(data));
  }

  close(): void {
    this.#session = null;
    this.#reset();
    this.#view.setData({ t: "", r: null });
  }

  /** The view went away: releases the app without touching the view. */
  detach(): void {
    if (this.#pages.length) return;
    const session = this.#session;
    this.#session = null;
    session?.detach();
    this.#reset();
  }

  /**
   * Dispatches a view event. Input can return replacement text from bindinput;
   * textarea and the other controls instead need two setData calls because
   * the view's data still holds the bound value.
   */
  event(event: ViewEvent): string | undefined {
    const found = this.#handlers.get(Number(event.currentTarget.dataset[`e${event.type}`]));
    const session = this.#session;
    if (!found || !session) return undefined;
    const [scope, slot] = found;
    const [, controls, kind] = scope.keys.e![slot]!;
    let detail: unknown;
    switch (event.type) {
      case "focus": detail = true; break;
      case "blur": detail = false; break;
      case "input":
      case "change":
      case "changing": detail = event.detail?.value; break;
    }
    // The selector's change event sends a string, even though its index is an Int.
    const value = kind === "number" ? Number(detail) : detail;
    if (session.dispatch(scope.id, slot, value) || scope.dead || controls < 0) return undefined;
    const key = scope.keys.v![controls][0];
    const bound = scope.o[key];
    if (typeof bound === "string" && kind !== "textarea") return bound;
    const path = this.#locate(scope, key);
    if (path !== null) {
      const view = this.#viewFor(scope);
      view.setData({ [path]: value });
      view.setData({ [path]: bound });
    }
    return undefined;
  }

  /** Applies logical image dimensions and clears the placeholder when loading succeeds. */
  imageLoaded(event: ViewEvent): void {
    const { scope: id, image: key, src, size } = event.currentTarget.dataset;
    const scope = this.#scopes.get(Number(id));
    const width = event.detail?.width ?? 0;
    const height = event.detail?.height ?? 0;
    if (!scope || typeof key !== "string" || width <= 0 || height <= 0) return;
    let metrics = ";"; // Truthy even when both dimensions are fixed and only the placeholder changes.
    switch (size) {
      case "auto": {
        const scale = typeof src === "string" ? this.#scales.get(src) ?? 1 : 1;
        metrics = `--w-image-width:${width / scale}px;--w-image-ratio:${width}/${height}`;
        break;
      }
      case "ratio": metrics = `--w-image-ratio:${width}/${height}`; break;
    }
    if (scope.o[key] === metrics) return;
    scope.o[key] = metrics;
    const path = this.#locate(scope, key);
    if (path !== null) this.#viewFor(scope).setData({ [path]: metrics });
  }

  #imageSource(src: string): string {
    if (!src.startsWith("asset:")) return src;
    const name = src.slice(6);
    const variants = this.#assets && Object.prototype.hasOwnProperty.call(this.#assets, name) ? this.#assets[name] : undefined;
    if (!variants?.length) {
      warnMissingAsset(name);
      return "";
    }
    const scale = typeof wx === "undefined" ? 1 : wx.getWindowInfo?.().pixelRatio ?? 1;
    return (variants.find(([density]) => density >= scale) ?? variants.at(-1)!)[1];
  }

  #scope(id: number): Scope {
    const scope = this.#scopes.get(id);
    if (!scope) throw new Error(`weft: unknown scope ${id}`);
    return scope;
  }

  #pend(scope: Scope, key: string | null): void {
    this.#pending.push([scope, key]);
  }

  /** The `setData` path of `key` in `scope` (the scope itself for `null`), or `null` when not mounted at the root. */
  #locate(scope: Scope, key: string | null): string | null {
    let path = key === null ? scope.seg : `${scope.seg}.${key}`;
    let top = scope;
    while (top.up) {
      top = top.up;
      path = `${top.seg}.${path}`;
    }
    return top === this.#root || this.#pages.includes(top.id) ? path : null;
  }

  #viewFor(scope: Scope): View {
    let top = scope;
    while (top.up) top = top.up;
    const index = this.#pages.indexOf(top.id);
    return this.#views.get(index) ?? this.#view;
  }

  /** Destroys a scope and its descendants. */
  #destroy(scope: Scope): void {
    scope.dead = true;
    this.#scopes.delete(scope.id);
    for (const handler of scope.hs) this.#handlers.delete(handler);
    for (const kid of scope.kids) {
      if (Array.isArray(kid)) for (const row of kid) this.#destroy(row);
      else if (kid) this.#destroy(kid);
    }
  }

  #reset(): void {
    if (this.#root) this.#destroy(this.#root);
    for (const scope of this.#scopes.values()) this.#destroy(scope);
    this.#root = null;
    this.#rootFresh = false;
    this.#created = [];
    this.#pending = [];
    this.#pages = [];
    this.#tabs = [];
    this.#tab = 0;
    this.#rootPage = undefined;
    this.#views.clear();
    this.#routeCount = 0;
    this.#hostNavigating = 0;
  }
}

/** Drops paths that lie inside another changed path. */
function uncovered(data: Map<string, unknown>): Data {
  const out: Data = {};
  outer: for (const [path, value] of data) {
    for (let i = 0; i < path.length; i++) {
      const c = path[i];
      if ((c === "." || c === "[") && data.has(path.slice(0, i))) continue outer;
    }
    out[path] = value;
  }
  return out;
}

/**
 * Options of the generated view component. The view releases its app when
 * it is detached from the page.
 */
export function view(layout: Layout, assets?: AssetVariants) {
  return {
    data: { t: "", r: null },
    lifetimes: {
      created(this: View) {
        this.$sink = new WechatSink(this, layout, assets);
      },
      detached(this: View) {
        this.$sink?.detach();
      },
    },
    methods: {
      $image(this: View, event: ViewEvent): void {
        this.$sink?.imageLoaded(event);
      },
      $e(this: View, event: ViewEvent): string | undefined {
        return this.$sink?.event(event);
      },
    },
  };
}
