/**
 * Block runtime of the view protocol (protocol/SPEC.md),
 * shared by every platform whose view layer is separate from the logic
 * layer: the WeChat mini program and the native platforms.
 *
 * Every block (component instance, `if` branch, `for` row, slot content) is
 * a scope of a layout template. Generated create code writes the scope's
 * value slots and mounts child scopes; update functions write the values
 * that changed. Each write becomes an op for the app's sink: the WeChat sink
 * turns ops into `setData` paths, the native sink encodes them for the
 * native kernel, and the headless renderer (`./testing`) applies them to a
 * tree in memory. Event handlers stay in the logic layer: the view reports
 * `(scope, event slot)` and `dispatch` runs the handler.
 */

import {
  AppBase,
  type Job,
  type Marker,
  type Shape,
  type Watch,
  currentEpoch,
  enqueue,
  flushSync,
  onCommit,
  schedule,
  watch,
} from "./core.ts";

export * from "./core.ts";
export type { PageClass } from "./navigation.ts";
import { NavigationController, activate, componentMounted, type ApplicationConfig, type NavigationEntry, type NavigationOperation, type PageFactories } from "./navigation.ts";
import { routeURL, type RouteInfo } from "./route.ts";
import { onSignal } from "./native.ts";
import { Lazy, Sections, type LazyOptions, type SectionItem } from "./lazy.ts";

/* ------------------------------------------------------------------------ */
/* Protocol                                                                  */
/* ------------------------------------------------------------------------ */

/** Value of a value slot; the slot's layout type says how to read a number. */
export type Value = number | boolean | string | readonly string[];

/** Compares slot values, including separately evaluated lists with equal contents. */
export function sameValue(a: unknown, b: unknown): boolean {
  return a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && a.every((item, i) => item === b[i]));
}

/** The view protocol ops, in the order the logic layer emits them. */
export interface Ops {
  /** Creates scope `scope` of `template`, not yet mounted. */
  create(scope: number, template: number): void;
  /** Writes value slot `slot` of `scope`. */
  set(scope: number, slot: number, value: Value): void;
  /** Mounts `child` (`0` for none) at the `if` point; the previous child and its descendants are destroyed. */
  branch(scope: number, point: number, child: number): void;
  /** Sets the complete row order of the `for` point; rows not in `children` are destroyed. */
  rows(scope: number, point: number, children: readonly number[]): void;
  /** Mounts a component instance or slot content once; scope `0` point `0` is the root. */
  attach(scope: number, point: number, child: number): void;
  splice?(scope: number, point: number, index: number, remove: number, items: readonly { item: number; template: number }[]): void;
  bind?(scope: number, point: number, item: number, child: number): void;
  nav?(tab: number, tabs: readonly number[], stack: readonly number[], modal: number, style: "sheet" | "fullScreen"): void;
  routes?(routes: readonly { page: string; url: string }[], mode: "push" | "replace" | "pop" | "root" | "tab" | "host"): void;
  beforePush?(depth: number): void;
  badge?(index: number, text: string | null): void;
}

/** What a sink receives from the app it renders. */
export interface Session {
  /** Hash of the layout the app was compiled with. */
  readonly hash: string;
  /**
   * Runs the handler of event slot `slot` of `scope` with the element's
   * value and flushes. Returns `false` when the view must restore the
   * controlled value slot of the event to the last value it received.
   */
  dispatch(scope: number, slot: number, payload: unknown): boolean;
  /** Requests materialization of the lazy point's half-open item range. */
  window(scope: number, point: number, start: number, end: number): void;
  /** Delivers a host signal to the application. */
  signal(name: string, json: string): void;
  /** Releases the app without calling the sink again, e.g. when the view went away. */
  detach(): void;
}

/** Renders the ops of one mounted app. */
export interface Sink extends Ops {
  /** Called by `mount` before any op; throws to refuse the app, e.g. on a layout mismatch. */
  open(session: Session): void;
  /** Ends a batch: called after every flush, also when no op was written. */
  commit(): void;
  /** The app was unmounted; its scopes are gone. */
  close(): void;
}

/* ------------------------------------------------------------------------ */
/* Scopes and handlers                                                       */
/* ------------------------------------------------------------------------ */

interface Handler {
  /** Receives the element's value; `null` for controlled elements without handler. */
  f: ((value: unknown) => void) | null;
  /** Controlled value slot, or `-1`. */
  k: number;
}

/** Mounted apps; their sinks end a batch after every flush. */
const mounted = new Set<App>();

onCommit(() => {
  for (const app of mounted) app.$commit();
});

const noop = (): void => {};

/** A scope: one instance of a layout template. */
export class Block {
  id: number;
  app: App;
  /** Last value written to each slot. */
  v: unknown[] = [];
  /** Handlers by event slot. */
  h: Handler[] | null = null;
  lazy = new Map<number, LazyList>();
  born = currentEpoch();
  dead = false;
  /** Set when the block was created through a component slot. */
  slot: Slot | null = null;
  /** Re-runs dirty bindings and walks nested blocks. */
  u: () => void = noop;
  /** Releases nested blocks, components and watches. */
  x: () => void = noop;

  constructor(app: App, template: number) {
    this.app = app;
    this.id = app.$allocateScope();
    app.$scopes.set(this.id, this);
    app.$sink!.create(this.id, template);
  }

  /** Writes a value slot; only changes are sent. */
  set(slot: number, value: Value): void {
    if (sameValue(this.v[slot], value)) return;
    this.v[slot] = value;
    this.app.$sink!.set(this.id, slot, value);
  }

  /** Registers the handler of an event slot and the value slot it controls (`-1` for none). */
  on(slot: number, f: ((value: unknown) => void) | null, controls: number): void {
    (this.h ??= [])[slot] = { f, k: controls };
  }

  /** Mounts a component instance or slot content at `point`. */
  attach(point: number, child: Block): void {
    this.app.$sink!.attach(this.id, point, child.id);
  }

  update(): void {
    this.u();
  }

  destroy(): void {
    this.dead = true;
    this.x();
    this.app.$scopes.delete(this.id);
    this.slot?.live.delete(this);
  }
}

/** A block with its own dirty bits: a component instance or a `for` row. */
class ScopeBlock extends Block implements Job, Marker {
  d: number[];
  depth: number;
  queued = false;

  constructor(app: App, template: number, words: number, depth: number) {
    super(app, template);
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
}

/** One item of a keyed `for` list. */
export class Row extends ScopeBlock {
  item: unknown;
  w: Watch;

  constructor(app: App, template: number, words: number, depth: number, shape: Shape, item: unknown) {
    super(app, template, words, depth);
    this.item = item;
    this.w = watch(shape, this, item);
  }

  setItem(item: unknown): void {
    this.item = item;
    this.w.set(item);
  }

  override destroy(): void {
    this.w.dispose();
    super.destroy();
  }
}

/** A component instance: parameter and state values plus their watches. */
export class Instance extends ScopeBlock {
  p: unknown[];
  s: unknown[] = [];
  pw: (Watch | undefined)[] = [];
  sw: Watch[] = [];
  /** Caller-supplied blocks in `Children` parameter order. */
  children: readonly (Slot | null)[];

  constructor(app: App, template: number, words: number, depth: number, args: unknown[], children: readonly (Slot | null)[]) {
    super(app, template, words, depth);
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

  override destroy(): void {
    for (const w of this.pw) w?.dispose();
    for (const w of this.sw) w.dispose();
    super.destroy();
  }
}

/** Runtime of an `if / else if / else` chain at a branch point; `-1` renders nothing. */
export class Branches {
  up: Block;
  point: number;
  make: (index: number) => Block | null;
  index = -1;
  block: Block | null = null;

  constructor(up: Block, point: number, make: (index: number) => Block | null) {
    this.up = up;
    this.point = point;
    this.make = make;
  }

  set(index: number): void {
    if (index === this.index) return;
    this.index = index;
    this.block?.destroy();
    const block = this.make(index);
    this.block = block;
    const up = this.up;
    up.app.$sink!.branch(up.id, this.point, block ? block.id : 0);
  }

  update(): void {
    const block = this.block;
    if (block && block.born !== currentEpoch()) block.update();
  }

  destroy(): void {
    this.block?.destroy();
    this.block = null;
  }
}

/** Runtime of a keyed `for` loop at a list point. */
export class List {
  up: Block;
  point: number;
  make: (item: unknown) => Row;
  keyOf: (item: unknown) => unknown;
  rows: Row[] = [];

  constructor(up: Block, point: number, make: (item: unknown) => Row, keyOf: (item: unknown) => unknown) {
    this.up = up;
    this.point = point;
    this.make = make;
    this.keyOf = keyOf;
  }

  /**
   * Reconciles rows with `items` by key: reused rows receive the new item
   * (marking only the fields that changed), unmatched rows are destroyed and
   * new rows are created. The new order is sent only when it changed.
   */
  set(items: readonly unknown[]): void {
    const seen = new Set<unknown>();
    const keys = new Array<unknown>(items.length);
    for (let i = 0; i < items.length; i++) {
      const key = this.keyOf(items[i]);
      if (seen.has(key)) throw new Error(`weft: duplicate key \`${String(key)}\` in for loop`);
      seen.add(key);
      keys[i] = key;
    }

    const old = this.rows;
    const byKey = new Map<unknown, number>();
    for (let i = 0; i < old.length; i++) byKey.set(this.keyOf(old[i].item), i);

    const rows = new Array<Row>(items.length);
    const reused = new Uint8Array(old.length);
    let changed = items.length !== old.length;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const j = byKey.get(keys[i]);
      if (j !== undefined && !reused[j]) {
        reused[j] = 1;
        const row = old[j];
        if (row.item !== item) row.setItem(item);
        rows[i] = row;
        if (j !== i) changed = true;
      } else {
        rows[i] = this.make(item);
        changed = true;
      }
    }
    for (let j = 0; j < old.length; j++) {
      if (!reused[j]) old[j].destroy();
    }
    this.rows = rows;
    if (changed) {
      const up = this.up;
      up.app.$sink!.rows(
        up.id,
        this.point,
        rows.map((row) => row.id),
      );
    }
  }

  update(): void {
    const epoch = currentEpoch();
    for (const row of this.rows) {
      if (row.born !== epoch) row.update();
    }
  }

  destroy(): void {
    for (const row of this.rows) row.destroy();
    this.rows = [];
  }
}

/** A keyed lazy point. The host controls which rows have scopes. */
export class LazyList {
  private readonly lazy: Lazy<unknown, Row>;
  private readonly sections: Sections<Row> | null;
  private values: readonly unknown[] = [];

  constructor(private readonly up: Block, private readonly point: number, make: (item: unknown) => Row, keyOf: (item: unknown) => unknown, options: LazyOptions<Row> = {}) {
    up.lazy.set(point, this);
    this.sections = options.sections ? new Sections(keyOf, options.sections, () => this.set(this.values)) : null;
    const section = (item: unknown) => item as SectionItem;
    this.lazy = new Lazy(this.sections ? item => section(item).key : keyOf, {
      splice: (index, remove, items) => {
        const sink = up.app.$sink!;
        if (!sink.splice) throw new Error("weft: sink does not support lazy lists");
        sink.splice(up.id, point, index, remove, items.map(({ id, template }) => ({ item: id, template })));
      },
      bind: (id, row) => {
        const sink = up.app.$sink!;
        if (!sink.bind) throw new Error("weft: sink does not support lazy lists");
        sink.bind(up.id, point, id, row?.id ?? 0);
      },
      create: item => this.sections ? (section(item).template ? options.sections!.createRow(...section(item).value as [unknown, unknown]) : make(section(item).value)) : make(item),
      change: (row, item) => {
        if (this.sections && section(item).template) (row as Row & { setSection(section: unknown, item: unknown): void }).setSection(...section(item).value as [unknown, unknown]);
        else row.setItem(this.sections ? section(item).value : item);
      },
      destroy: row => row.destroy(),
    }, this.sections ? item => section(item).template : undefined, options.endThreshold, options.onEndReached);
  }

  set(items: readonly unknown[]): void { this.values = items; this.lazy.set(this.sections ? this.sections.flatten(items) : items); }
  window(start: number, end: number): void { this.lazy.window(start, end); }
  update(): void {
    const epoch = currentEpoch();
    this.lazy.update(row => { if (row.born !== epoch) row.update(); });
  }
  destroy(): void { this.up.lazy.delete(this.point); this.sections?.destroy(); this.lazy.destroy(); }
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

/** Something an app can be mounted into: a sink, or a view that owns one (the mini program view component). */
export type Target = Sink | { readonly $sink: Sink };

type Create = (app: App, args: unknown[], children: readonly (Slot | null)[], depth: number) => Instance;

function sinkOf(target: Target): Sink {
  const sink = target && "$sink" in target ? target.$sink : target;
  if (typeof (sink as Partial<Sink> | undefined)?.create !== "function") {
    throw new Error(
      "weft: mount expects a view sink or a generated view component instance, e.g. `this.selectComponent(\"#view\")`",
    );
  }
  return sink as Sink;
}

/** Base class of the generated root component classes. */
export class App extends AppBase {
  #create: Create;
  /** Hash of the layout the app was compiled with. */
  readonly $hash: string;
  $root: Instance | null = null;
  $sink: Sink | null = null;
  /** Live scopes by id; ids are allocated per app, starting at 1. */
  $scopes = new Map<number, Block>();
  $lastScope = 0;
  $owner: App | null = null;
  $allocateScope(): number { return this.$owner ? this.$owner.$allocateScope() : ++this.$lastScope; }
  $createRoot(): Instance { return this.#create(this, this.$args, [], 0); }
  $commit(): void { this.$sink!.commit(); }

  constructor(create: Create, args: unknown[], hash: string) {
    super(args);
    this.#create = create;
    this.$hash = hash;
  }

  /** Renders into `target`; the first batch follows in a microtask. */
  mount(target: Target): void {
    if (this.$root) throw new Error("weft: component is already mounted");
    const sink = sinkOf(target);
    sink.open({
      hash: this.$hash,
      dispatch: (scope, slot, payload) => this.#dispatch(scope, slot, payload),
      window: (scope, point, start, end) => this.$window(scope, point, start, end),
      signal: () => {},
      detach: () => this.$detach(),
    });
    componentMounted();
    this.$sink = sink;
    mounted.add(this);
    try {
      const root = this.#create(this, this.$args, [], 0);
      this.$root = root;
      sink.attach(0, 0, root.id);
      schedule();
    } catch (error) {
      // A partial root leaves registered blocks, live watches and buffered ops behind.
      for (const block of [...this.$scopes.values()].reverse()) if (!block.dead) block.destroy();
      this.$scopes.clear();
      mounted.delete(this);
      this.$root = null;
      this.$sink = null;
      try { sink.close(); } catch (closeError) { console.error(closeError); }
      throw error;
    }
  }

  $window(scope: number, point: number, start: number, end: number): void {
    const lazy = this.$scopes.get(scope)?.lazy.get(point);
    if (!lazy) {
      console.error(`weft: lazy window requested for scope ${scope}, point ${point}, range [${start}, ${end}), but no lazy point exists`);
      return;
    }
    lazy.window(start, end);
    schedule();
    flushSync();
  }

  unmount(): void {
    const sink = this.$sink;
    if (this.$detach()) sink!.close();
  }

  /**
   * Runs an event handler and flushes synchronously, so the view learns
   * right away whether a controlled value was accepted: the edit stands if
   * the bound value now equals it (a different new value arrives as a `set`
   * op). Events of destroyed scopes are ignored.
   */
  #dispatch(scope: number, slot: number, payload: unknown): boolean {
    const block = this.$scopes.get(scope);
    const handler = block?.h?.[slot];
    if (!block || !handler) return true;
    handler.f?.(payload);
    flushSync();
    return handler.k < 0 || block.dead || block.v[handler.k] === payload;
  }

  /** Releases the root without calling the sink; `false` if not mounted. */
  $detach(): boolean {
    const root = this.$root;
    if (!root) return false;
    this.$root = null;
    mounted.delete(this);
    root.destroy();
    this.$sink = null;
    return true;
  }
}

/** Base class of generated pages. */
export class Page<P> extends App {
  declare static readonly $route: RouteInfo;
  readonly params: Readonly<P>;

  constructor(create: Create, args: unknown[], hash: string, params: P) {
    super(create, args, hash);
    this.params = Object.freeze(params);
    if (!Object.prototype.hasOwnProperty.call(Page.prototype, "onShow")) {
      Object.defineProperties(Page.prototype, {
        onShow: { value(this: Page<unknown>, handler: (model: unknown) => void) { return this.$on("Show", handler); } },
        onHide: { value(this: Page<unknown>, handler: (model: unknown) => void) { return this.$on("Hide", handler); } },
      });
    }
  }

  override mount(_target: Target): void { throw new Error("weft: pages are mounted by their app"); }
}

/** An application owns all page scopes and emits complete navigation states. */
export class Application extends App {
  readonly $application = true;
  readonly $config: ApplicationConfig;
  private readonly controller: NavigationController;
  private unsubscribe: (() => void) | null = null;
  private initialURL: string | null = null;
  private pendingNavigation: { entries: readonly NavigationEntry[]; mode: NavigationOperation; tab: number; tabs: readonly number[]; modal: number; style: "sheet" | "fullScreen" } | null = null;
  private initialized = false;

  constructor(factories: PageFactories, config: ApplicationConfig, hash = "") {
    super(() => { throw new Error("weft: application has no component root"); }, [], hash);
    this.$config = config;
    this.controller = new NavigationController(factories, config, {
      beforePush: depth => this.$sink?.beforePush?.(depth),
      create: (value) => {
        const page = value as Page<Record<string, never>>;
        page.$owner = this; page.$sink = this.$sink; page.$scopes = this.$scopes;
        page.$root = page.$createRoot();
        return page.$root.id;
      },
      destroy: (value) => { const page = value as Page<Record<string, never>>; page.$root?.destroy(); page.$root = null; page.$sink = null; page.$owner = null; },
      update: (entries, mode) => {
        this.$root = (entries[0]!.page as Page<Record<string, never>>).$root;
        if (mode === "host" && this.initialized && !this.pendingNavigation) return;
        this.pendingNavigation = { entries, mode, tab: this.controller.tab, tabs: this.controller.tabs.map(entry => entry?.id ?? 0), modal: this.controller.modal?.entry.id ?? 0, style: this.controller.modal?.style ?? "sheet" };
        this.initialized = true;
        schedule();
      },
      badge: (index, text) => this.$sink?.badge?.(index, text),
    });
  }

  override $commit(): void {
    const pending = this.pendingNavigation;
    if (pending) {
      this.pendingNavigation = null;
      const sink = this.$sink!;
      if (!sink.nav) throw new Error("weft: sink does not support navigation");
      sink.routes?.(pending.entries.map(({ page, type }) => ({ page: type.$route.name, url: routeURL(type, page.params) })), pending.mode === "correct" || pending.mode === "present" || pending.mode === "dismiss" ? "host" : pending.mode);
      sink.nav(pending.tab, pending.tabs, pending.entries.slice(1).map(entry => entry.id), pending.modal, pending.style);
    }
    super.$commit();
  }
  $activate(): void { activate(this.controller); }
  $initialRoute(url: string): void { this.initialURL = url; }
  $restore(urls: readonly string[]): void { this.controller.restore(urls, "correct"); }
  $open(url: string, host = false): boolean { return this.controller.open(url, host); }
  $signal(name: string, json: string): void {
    if (name === "navigation") this.controller.signal(json);
    else if (name === "link") {
      try { const value = JSON.parse(json) as { url?: unknown }; if (typeof value.url === "string") this.controller.open(value.url); } catch { /* Ignore malformed links. */ }
    }
    else if (name === "lifecycle") {
      try {
        const value = JSON.parse(json) as { state?: unknown };
        if (value.state === "foreground" || value.state === "background") this.controller.setForeground(value.state === "foreground");
      } catch { /* Ignore malformed host lifecycle signals. */ }
    }
  }

  override mount(target: Target): void {
    if (this.$sink) throw new Error("weft: application is already mounted");
    const sink = sinkOf(target);
    sink.open({ hash: this.$hash, dispatch: (scope, slot, payload) => {
      activate(this.controller);
      const block = this.$scopes.get(scope); const handler = block?.h?.[slot];
      if (!block || !handler) return true;
      handler.f?.(payload); flushSync();
      return handler.k < 0 || block.dead || block.v[handler.k] === payload;
    }, window: (scope, point, start, end) => { activate(this.controller); this.$window(scope, point, start, end); },
    signal: (name, json) => this.$signal(name, json), detach: () => this.$detach() });
    this.$sink = sink; mounted.add(this); activate(this.controller);
    if (globalThis.__weft) {
      const navigation = onSignal("navigation", json => this.$signal("navigation", json));
      const lifecycle = onSignal("lifecycle", json => this.$signal("lifecycle", json));
      const link = onSignal("link", json => this.$signal("link", json));
      this.unsubscribe = () => { navigation(); lifecycle(); link(); };
    }
    try {
      if (this.initialURL) this.controller.start([this.initialURL]);
      else {
        let launch: string | null = null;
        if (globalThis.__weft) {
          try { const value = JSON.parse(globalThis.__weft.launch) as { url?: unknown }; if (typeof value.url === "string") launch = value.url; } catch { /* Ignore malformed launch data. */ }
        }
        const match = launch ? this.controller.match(launch) : null;
        const start = this.$config.start ?? this.$config.tabs![0]!.page;
        const isTab = this.$config.tabs?.some(tab => tab.page === match?.page);
        this.controller.start(match ? (match.page === start || isTab ? [routeURL(match.page, match.params)] : [routeURL(start, {}), routeURL(match.page, match.params)]) : []);
      }
    } catch (error) { this.$detach(); sink.close(); throw error; }
  }

  override $detach(): boolean {
    if (!this.$sink) return false;
    this.unsubscribe?.(); this.unsubscribe = null;
    this.controller.dispose(); this.pendingNavigation = null; this.initialized = false; this.$root = null; mounted.delete(this); this.$sink = null;
    return true;
  }
}
