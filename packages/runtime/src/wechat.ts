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
import { matchRoute, routeURL, type PageClass } from "./route.ts";

declare const __WEFT_WECHAT_SUBPACKAGES__: Record<string, string> | undefined;

type Data = Record<string, unknown>;

/** Maps a generated mini program page and its query to the application's route URL. */
export function wechatRouteURL(pages: readonly PageClass[], path: string, query: Readonly<Record<string, string>>): string | null {
  const normalized = path.replace(/^\//, "");
  const packages: Record<string, string> = typeof __WEFT_WECHAT_SUBPACKAGES__ === "undefined" ? {} : __WEFT_WECHAT_SUBPACKAGES__;
  const page = pages.find(({ $route }) => {
    const slug = $route.name.replace(/([A-Z])/g, (letter, _match, offset: number) => `${offset ? "-" : ""}${letter.toLowerCase()}`);
    const prefix = packages[$route.name] ? `${packages[$route.name]}/` : "";
    return normalized === `${prefix}weft/pages/${slug}/index`;
  });
  if (!page) return null;
  const route = page.$route;
  const segments = route.path.map(segment => segment.startsWith("{") && segment.endsWith("}")
    ? encodeURIComponent(query[segment.slice(1, -1)] ?? "") : segment);
  const args = Object.entries(query).filter(([key]) => key !== "__w")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  const match = matchRoute([page], `/${segments.join("/")}${args ? `?${args}` : ""}`);
  return match ? routeURL(match.page, match.params) : null;
}

type AssetVariants = Readonly<Record<string, readonly [scale: number, src: string][]>>;

declare const wx: {
  getWindowInfo?(): { pixelRatio: number; windowHeight?: number };
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
  /** Static or dynamic visibility of the modal navigation bar. */
  barHidden?: boolean;
  barHiddenKey?: string;
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
  /** Grid column count by lazy point. */
  g?: Readonly<Record<number, number>>;
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
  setData(data: Data, callback?: () => void): void;
  createIntersectionObserver?(options: { observeAll: boolean }): IntersectionObserver;
  createSelectorQuery?(): SelectorQuery;
  $sink?: WechatSink;
  $keyboardRevision?: number;
}

/** The event object of WXML `bind` and `catch` handlers. */
interface ViewEvent {
  type: string;
  currentTarget: { id?: string; dataset: Data };
  detail?: { value?: unknown; width?: number; height?: number; scrollTop?: number };
}

interface IntersectionObserver {
  relativeTo(selector: string, margins: { top: number; bottom: number }): IntersectionObserver;
  observe(selector: string, callback: (entry: { intersectionRatio: number; dataset: Data }) => void): void;
  disconnect(): void;
}

interface Rect { dataset: Data; top: number; bottom: number; height: number }
interface SelectorQuery {
  select(selector: string): { boundingClientRect(callback: (rect: Rect | null) => void): SelectorQuery };
  selectAll(selector: string): { boundingClientRect(callback: (rects: Rect[]) => void): SelectorQuery };
  exec(): void;
}

interface LazyItem { item: number; template: number; child: Scope | null }
interface LazyPoint {
  scope: Scope;
  point: number;
  key: string;
  columns: number;
  size: number;
  items: LazyItem[];
  heights: Map<number, number>;
  positions: Map<number, number>;
  scrollTop: number;
  measuring: boolean;
  measureAgain: boolean;
  requestedStart: number;
  requestedEnd: number;
  dirty: boolean;
  observer?: IntersectionObserver;
  view?: View;
}

const SEGMENT_SIZE = 20;
const ESTIMATED_HEIGHT = 44;

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
  /** Root scope currently rendered by each platform view. */
  #rendered = new Map<View, number>();
  #routeCount = 0;
  #hostNavigating = 0;
  #pageTypes: readonly PageClass[] = [];
  #tabNames: readonly string[] = [];
  #tabs: readonly number[] = [];
  #tab = 0;
  #rootPage: string | undefined;
  #nextNavigation = 0;
  #modal = 0;
  #modalStyle: "sheet" | "fullScreen" = "sheet";
  #modalViews = new Map<number, { view: View; page: View }>();
  #lazy = new Map<string, LazyPoint>();

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

  splice(id: number, point: number, index: number, remove: number, items: readonly { item: number; template: number }[]): void {
    const scope = this.#scope(id);
    const token = `${id}:${point}`;
    let lazy = this.#lazy.get(token);
    if (!lazy) {
      const columns = scope.keys.g?.[point] ?? 1;
      const size = Math.max(columns, Math.floor(SEGMENT_SIZE / columns) * columns);
      lazy = { scope, point, key: scope.keys.p![point] as string, columns, size, items: [], heights: new Map(), positions: new Map(), scrollTop: 0, measuring: false, measureAgain: false, requestedStart: -1, requestedEnd: -1, dirty: false };
      scope.o[`z${lazy.key.slice(1)}`] = 0;
      this.#lazy.set(token, lazy);
    }
    const kept = new Map(lazy.items.map((item) => [item.item, item]));
    const inserted = items.map(({ item, template }) => kept.get(item) ?? { item, template, child: null });
    const removed = lazy.items.splice(index, remove, ...inserted);
    const remaining = new Set(lazy.items);
    for (const item of removed) if (!remaining.has(item) && item.child) this.#destroy(item.child);
    // Keep measurements before the changed segment. In particular, appending
    // a page must not collapse every spacer back to the initial estimate.
    const firstChanged = Math.floor(index / lazy.size);
    for (const segment of lazy.heights.keys()) if (segment >= firstChanged) lazy.heights.delete(segment);
    for (const segment of lazy.positions.keys()) if (segment >= firstChanged) lazy.positions.delete(segment);
    lazy.requestedStart = -1;
    lazy.requestedEnd = -1;
    lazy.observer?.disconnect();
    lazy.observer = undefined;
    lazy.dirty = true;
  }

  bind(id: number, point: number, item: number, child: number): void {
    const lazy = this.#lazy.get(`${id}:${point}`);
    const entry = lazy?.items.find((row) => row.item === item);
    if (!lazy || !entry) throw new Error(`weft: unknown lazy item ${item}`);
    if (entry.child && entry.child.id !== child) this.#destroy(entry.child);
    entry.child = child ? this.#scope(child) : null;
    lazy.dirty = true;
  }

  /** Records user scrolling independently of programmatic scroll-top corrections. */
  scroll(event: ViewEvent): void {
    const { scope, point } = event.currentTarget.dataset;
    const lazy = this.#lazy.get(`${Number(scope)}:${Number(point)}`);
    if (lazy && typeof event.detail?.scrollTop === "number") {
      lazy.scrollTop = event.detail.scrollTop;
      this.#measure(lazy);
    }
  }

  /** Requests a half-open range, as an IntersectionObserver or a test host does. */
  window(scope: number, point: number, start: number, end: number): void {
    this.#session?.window(scope, point, start, end);
  }

  #segments(lazy: LazyPoint): void {
    const { scope, key, items } = lazy;
    const segments: Data[] = [];
    let measuredHeight = 0;
    let measuredRows = 0;
    for (const [index, height] of lazy.heights) {
      const count = Math.min(lazy.size, Math.max(0, items.length - index * lazy.size));
      measuredHeight += height;
      measuredRows += Math.ceil(count / lazy.columns);
    }
    const estimate = measuredRows ? measuredHeight / measuredRows : ESTIMATED_HEIGHT;
    for (let start = 0; start < items.length; start += lazy.size) {
      const index = segments.length;
      const slice = items.slice(start, start + lazy.size);
      const materialized = slice.some((item) => item.child !== null);
      const rows = materialized ? slice.map((item, offset) => {
        if (!item.child) return { k: item.item, t: item.template };
        item.child.up = scope;
        item.child.seg = `${key}[${index}].r[${offset}]`;
        item.child.o.k = item.item;
        item.child.o.t = item.template;
        item.child.o.w = true;
        return item.child.o;
      }) : null;
      const height = lazy.heights.get(index) ?? Math.ceil(slice.length / lazy.columns) * estimate;
      segments.push({ k: index, h: height, s: `height:${height}px`, r: rows });
    }
    scope.o[key] = segments;
    if (!scope.fresh) this.#pend(scope, key);
  }

  #observeView(view: View): void {
    for (const lazy of this.#lazy.values()) if (this.#viewFor(lazy.scope) === view) {
      this.#observe(lazy);
      this.#measure(lazy);
    }
  }

  #observe(lazy: LazyPoint): void {
    if (lazy.scope.dead || !this.#locate(lazy.scope, lazy.key)) return;
    const view = this.#viewFor(lazy.scope);
    if (lazy.view === view && lazy.observer) return;
    lazy.observer?.disconnect();
    lazy.view = view;
    const observer = view.createIntersectionObserver?.({ observeAll: true });
    if (!observer) return;
    lazy.observer = observer;
    const selector = `#wl-${lazy.scope.id}-${lazy.point}`;
    const margin = typeof wx === "undefined" ? 0 : wx.getWindowInfo?.().windowHeight ?? 0;
    observer.relativeTo(selector, { top: margin, bottom: margin }).observe(`.wl-segment-${lazy.scope.id}-${lazy.point}`, () => {
      if (!lazy.scope.dead) this.#measure(lazy);
    });
  }

  #measure(lazy: LazyPoint): void {
    if (lazy.measuring) {
      lazy.measureAgain = true;
      return;
    }
    const query = lazy.view?.createSelectorQuery?.();
    if (!query) return;
    lazy.measuring = true;
    const selector = `#wl-${lazy.scope.id}-${lazy.point}`;
    const bounds: { viewport: Rect | null } = { viewport: null };
    query.select(selector).boundingClientRect((rect) => { bounds.viewport = rect; });
    query.selectAll(`.wl-segment-${lazy.scope.id}-${lazy.point}`).boundingClientRect((rects) => {
      lazy.measuring = false;
      const viewport = bounds.viewport;
      if (lazy.scope.dead || !viewport) return;
      const next = new Map<number, number>();
      let correction: number | undefined;
      let first = Infinity;
      let last = -1;
      for (const rect of rects) {
        const index = Number(rect.dataset.segment);
        const position = rect.top - viewport.top + lazy.scrollTop;
        next.set(index, position);
        if (rect.bottom > viewport.top - viewport.height && rect.top < viewport.bottom + viewport.height) {
          first = Math.min(first, index);
          last = Math.max(last, index);
        }
        const old = lazy.positions.get(index);
        if (correction === undefined && rect.bottom > viewport.top && old !== undefined) correction = position - old;
        if (lazy.items.slice(index * lazy.size, (index + 1) * lazy.size).every((item) => item.child) && rect.height > 0) lazy.heights.set(index, rect.height);
      }
      lazy.positions = next;
      if (correction !== undefined && Math.abs(correction) > 0.5) {
        lazy.scrollTop = Math.max(0, lazy.scrollTop + correction);
        const key = `z${lazy.key.slice(1)}`;
        lazy.scope.o[key] = lazy.scrollTop;
        const path = this.#locate(lazy.scope, key);
        if (path !== null) lazy.view?.setData({ [path]: lazy.scrollTop });
      }
      if (last >= 0) {
        const start = first * lazy.size;
        const end = Math.min(lazy.items.length, (last + 1) * lazy.size);
        if (start !== lazy.requestedStart || end !== lazy.requestedEnd) {
          lazy.requestedStart = start;
          lazy.requestedEnd = end;
          this.window(lazy.scope.id, lazy.point, start, end);
        }
      }
      if (lazy.measureAgain) {
        lazy.measureAgain = false;
        this.#measure(lazy);
      }
    }).exec();
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
    if (this.#modal) {
      const modal = this.#scopes.get(this.#modal);
      this.#modal = 0;
      if (modal) this.#destroy(modal);
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
    if (scope) {
      this.#rendered.set(view, scope.id);
      view.setData({ t: scope.keys.n, r: scope.o }, () => this.#observeView(view));
    }
  }

  /** Associates the modal component and its page-container owner with a stack position. */
  bindModal(view: View, page?: View, index = this.#pages.length - 1): void {
    view.$sink = this;
    this.#modalViews.set(index, { view, page: page ?? view });
    this.#renderModal(index);
  }

  /** Adopts a swipe, mask tap, or close button dismissal from the host. */
  dismissed(): void {
    if (!this.#modal) return;
    const id = this.#modal;
    this.#modal = 0;
    this.#renderModal(this.#pages.length - 1);
    this.#session?.signal("navigation", JSON.stringify({ tab: this.#tab, stack: this.#pages.slice(1), modal: 0 }));
    const scope = this.#scopes.get(id);
    if (scope) this.#destroy(scope);
  }

  unloadPage(index: number, view?: View): void {
    const modal = this.#modalViews.get(index);
    if (modal) this.#rendered.delete(modal.view);
    this.#modalViews.delete(index);
    if (!view || this.#views.get(index) === view) {
      const old = this.#views.get(index);
      if (old) this.#rendered.delete(old);
      this.#views.delete(index);
    }
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
      const packages: Record<string, string> = typeof __WEFT_WECHAT_SUBPACKAGES__ === "undefined" ? {} : __WEFT_WECHAT_SUBPACKAGES__;
      const prefix = packages[route.page] ? `/${packages[route.page]}` : "";
      const url = `${prefix}/weft/pages/${slug}/index?${query.join("&")}`;
      if (operation === "push") wx.navigateTo({ url });
      else { this.#hostNavigating++; wx.redirectTo({ url }); }
    } else {
      const delta = previous - routes.length;
      if (delta > 0) { this.#hostNavigating += delta; wx.navigateBack({ delta }); }
    }
  }

  nav(tab: number, tabs: readonly number[], stack: readonly number[], modal: number, style: "sheet" | "fullScreen"): void {
    const next = [tabs[tab], ...stack].filter((id) => id !== 0);
    const kept = new Set([...tabs, ...stack]);
    this.#tab = tab;
    this.#tabs = tabs;
    for (const id of this.#pages) if (!kept.has(id)) {
      const scope = this.#scopes.get(id);
      if (scope) this.#destroy(scope);
    }
    if (this.#modal && this.#modal !== modal) {
      const old = this.#scopes.get(this.#modal);
      if (old) this.#destroy(old);
    }
    this.#modal = modal;
    this.#modalStyle = style;
    this.#pages = next;
    if (modal) this.#scope(modal).seg = "r";
    for (const id of next) this.#scope(id).seg = "r";
    if (!this.#views.size) this.#views.set(0, this.#view);
    // A host reLaunch can replace the page at an already-bound stack index.
    // Its new navigation state arrives after onReady, so refresh the title once
    // the new scope exists. Do not update an outgoing page during a push: the
    // new top index is not bound until the host creates its view.
    if (next.length && this.#views.has(next.length - 1)) this.showPage(next.length - 1);
  }

  /** Sends the batch with one `setData`. */
  commit(): void {
    for (const lazy of this.#lazy.values()) {
      if (lazy.dirty && !lazy.scope.dead) {
        lazy.dirty = false;
        this.#segments(lazy);
      }
    }
    const changes = new Map<number, Map<string, unknown>>();
    for (const [scope, key] of this.#pending) {
      if (scope.dead) continue;
      const path = this.#locate(scope, key);
      if (path === null) continue;
      let root = scope;
      while (root.up) root = root.up;
      let data = changes.get(root.id);
      if (!data) changes.set(root.id, data = new Map());
      data.set(path, key === null ? scope.o : scope.o[key]);
    }
    if (this.#rootFresh && this.#root) {
      changes.set(this.#root.id, new Map<string, unknown>([["t", this.#root.keys.n], ["r", this.#root.o]]));
    }
    this.#pending = [];
    this.#rootFresh = false;
    for (const scope of this.#created) scope.fresh = false;
    this.#created = [];
    if (this.#pages.length) {
      for (const [index, view] of this.#views) {
        const scope = this.#scopes.get(this.#pages[index]);
        if (scope) this.#updateView(view, scope, changes.get(scope.id));
      }
      this.#renderModal(this.#pages.length - 1, changes);
    } else if (this.#root) {
      const data = changes.get(this.#root.id);
      if (data?.size) this.#view.setData(uncovered(data), () => this.#observeView(this.#view));
    }
  }

  /** Send a complete root only on a page change; subsequent updates stay granular. */
  #updateView(view: View, scope: Scope, data?: Map<string, unknown>): void {
    if (this.#rendered.get(view) !== scope.id) {
      this.#rendered.set(view, scope.id);
      view.setData({ t: scope.keys.n, r: scope.o }, () => this.#observeView(view));
    } else if (data?.size) {
      view.setData(uncovered(data), () => this.#observeView(view));
    }
  }

  #renderModal(index: number, changes?: Map<number, Map<string, unknown>>): void {
    const binding = this.#modalViews.get(index);
    if (!binding) return;
    const scope = this.#scopes.get(this.#modal);
    const bar = scope?.keys.bar;
    const title = bar?.key === undefined ? bar?.title : scope?.o[bar.key];
    if (scope) this.#updateView(binding.view, scope, changes?.get(scope.id));
    else if (this.#rendered.has(binding.view)) {
      this.#rendered.delete(binding.view);
      binding.view.setData({ t: "", r: null });
    }
    const hidden = scope?.keys.barHiddenKey ? scope.o[scope.keys.barHiddenKey] : scope?.keys.barHidden;
    binding.page.setData({ m: !!scope, ms: this.#modalStyle === "sheet" ? 0 : 1, mc: this.#modalStyle === "sheet" ? "max-height:90vh" : "height:100vh", mt: typeof title === "string" ? title : "", mh: !!hidden });
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
    const accepted = session.dispatch(scope.id, slot, value);
    if (event.type === "refresherrefresh" && !scope.dead) {
      const { refreshKey, refreshAlways } = event.currentTarget.dataset;
      if (!refreshAlways && typeof refreshKey === "string" && !scope.o[refreshKey]) {
        const path = this.#locate(scope, refreshKey);
        if (path !== null) {
          const view = this.#viewFor(scope);
          view.setData({ [path]: true }, () => {
            if (!scope.dead && !scope.o[refreshKey]) view.setData({ [path]: false });
          });
        }
      }
    }
    if (accepted || scope.dead || controls < 0) return undefined;
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
    return top === this.#root || this.#pages.includes(top.id) || top.id === this.#modal ? path : null;
  }

  #viewFor(scope: Scope): View {
    let top = scope;
    while (top.up) top = top.up;
    if (top.id === this.#modal) return this.#modalViews.get(this.#pages.length - 1)?.view ?? this.#view;
    const index = this.#pages.indexOf(top.id);
    return this.#views.get(index) ?? this.#view;
  }

  /** Destroys a scope and its descendants. */
  #destroy(scope: Scope): void {
    if (scope.dead) return;
    scope.dead = true;
    for (const [key, lazy] of this.#lazy) {
      if (lazy.scope !== scope) continue;
      lazy.observer?.disconnect();
      this.#lazy.delete(key);
      for (const item of lazy.items) if (item.child) this.#destroy(item.child);
    }
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
    this.#rendered.clear();
    this.#modalViews.clear();
    this.#modal = 0;
    this.#modalStyle = "sheet";
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
    data: { t: "", r: null, kh: 0, kf: "" },
    lifetimes: {
      created(this: View) {
        this.$sink = new WechatSink(this, layout, assets);
      },
      detached(this: View) {
        this.$sink?.detach();
      },
    },
    methods: {
      $focus(this: View, event: ViewEvent): void {
        this.$sink?.event(event);
        this.$keyboardRevision = (this.$keyboardRevision ?? 0) + 1;
        this.setData({ kf: event.currentTarget.id ?? "" });
      },
      $keyboard(this: View, event: ViewEvent): void {
        const revision = this.$keyboardRevision = (this.$keyboardRevision ?? 0) + 1;
        const height = event.detail?.height ?? 0;
        const target = height > 0 ? event.currentTarget.id ?? "" : "";
        this.setData({ kh: height, kf: "" }, () => {
          if (target && this.$keyboardRevision === revision) this.setData({ kf: target });
        });
      },
      $scroll(this: View, event: ViewEvent): void {
        this.$sink?.scroll(event);
      },
      $image(this: View, event: ViewEvent): void {
        this.$sink?.imageLoaded(event);
      },
      $e(this: View, event: ViewEvent): string | undefined {
        return this.$sink?.event(event);
      },
    },
  };
}
