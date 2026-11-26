import { matchRoute, routeURL, type PageClass, type Route, type RouteValue } from "./route.js";
export type { PageClass, Route } from "./route.js";

type ParamsArg<P> = {} extends P ? [params?: P] : [params: P];
export interface NavigationPage { readonly params: Readonly<Record<string, RouteValue>>; $emit(name: string, payload: object): void }
export interface NavigationEntry { page: NavigationPage; type: PageClass; id: number }
export type ModalStyle = "sheet" | "fullScreen";
export interface NavigationModal { entry: NavigationEntry; style: ModalStyle }
export type NavigationOperation = "push" | "replace" | "pop" | "root" | "tab" | "present" | "dismiss" | "host" | "correct";
export interface NavigationHost {
  beforePush?(depth: number): void;
  create(page: NavigationPage): number;
  destroy(page: NavigationPage): void;
  update(entries: readonly NavigationEntry[], operation: NavigationOperation): void;
  badge?(index: number, text: string | null): void;
}
export interface TabConfig { page: PageClass; title: string; icon: string; activeIcon: string }
export interface ApplicationConfig { start?: PageClass; tabs?: readonly TabConfig[]; pages: readonly PageClass[] }
export type PageFactories = Record<string, (params: Record<string, RouteValue>) => NavigationPage>;

let active: NavigationController | null = null;
let noApp = false;
export function componentMounted(): void { noApp = true; }
export function activate(controller: NavigationController): void { active = controller; noApp = false; }
export function deactivate(controller: NavigationController): void { if (active === controller) active = null; }
function current(): NavigationController {
  if (!active) throw new Error(noApp ? "weft: this program has no app declaration" : "weft: navigation is available after the app is mounted");
  return active;
}

export class NavigationController {
  readonly tabs: (NavigationEntry | null)[];
  readonly badges: (string | null)[];
  tab = 0;
  private stack: NavigationEntry[] = [];
  modal: NavigationModal | null = null;
  private get currentEntry(): NavigationEntry | undefined { return this.modal?.entry ?? this.entries.at(-1); }
  private coldRoot = false;
  private listeners = new Set<() => void>();
  private foreground = true;
  get entries(): NavigationEntry[] { const root = this.tabs[this.tab]; return root ? [root, ...this.stack] : []; }
  setForeground(foreground: boolean): void {
    if (this.foreground === foreground) return;
    this.foreground = foreground;
    this.currentEntry?.page.$emit(foreground ? "Show" : "Hide", {});
  }
  constructor(readonly factories: PageFactories, readonly config: ApplicationConfig, readonly host: NavigationHost) {
    for (const page of config.pages) if (typeof factories[page.$route.name] !== "function") throw new Error(`weft: missing factory for page ${page.$route.name}`);
    this.tabs = Array(config.tabs?.length ?? 1).fill(null);
    this.badges = Array(this.tabs.length).fill(null);
  }
  make(type: PageClass, params: Record<string, RouteValue> = {}): NavigationEntry {
    if (!this.config.pages.includes(type)) throw new Error(`weft: ${type.$route.name} is not a page in this app`);
    const page = this.factories[type.$route.name]!(params);
    return { page, type, id: this.host.create(page) };
  }
  start(urls: readonly string[] = []): void {
    const matches = urls.map(url => matchRoute(this.config.pages, url));
    const valid = matches.length > 0 && matches.every(match => match !== null);
    const first = valid ? matches[0]! : null;
    const index = first ? this.config.tabs?.findIndex(tab => tab.page === first.page) ?? -1 : -1;
    this.tab = index < 0 ? 0 : index;
    const root = first;
    this.coldRoot = !!this.config.tabs && !!root && index < 0;
    const type = root?.page ?? this.config.tabs?.[this.tab]?.page ?? this.config.start!;
    this.tabs[this.tab] = this.make(type, root?.params);
    this.stack = valid ? matches.slice(root ? 1 : 0).map(match => this.make(match!.page, match!.params)) : [];
    this.host.update(this.entries, "host");
    if (this.foreground) this.entries.at(-1)?.page.$emit("Show", {});
  }
  private change(tab: number, stack: NavigationEntry[], operation: NavigationOperation, old = this.entries, modal: NavigationModal | null = this.modal): void {
    const oldModal = this.modal;
    const previous = oldModal?.entry ?? old.at(-1);
    this.tab = tab; this.stack = stack; this.modal = modal;
    const entries = this.entries; const next = this.currentEntry;
    this.host.update(entries, operation);
    if (this.foreground && previous !== next) { previous?.page.$emit("Hide", {}); next?.page.$emit("Show", {}); }
    for (const entry of old) if (!entries.includes(entry) && !this.tabs.includes(entry)) this.host.destroy(entry.page);
    if (oldModal && oldModal !== modal) this.host.destroy(oldModal.entry.page);
    for (const listener of this.listeners) listener();
  }
  push(type: PageClass, params: Record<string, RouteValue> = {}): void {
    if (this.modal) throw new Error("weft: cannot push while a modal page is presented");
    this.host.beforePush?.(this.entries.length); this.change(this.tab, [...this.stack, this.make(type, params)], "push");
  }
  replace(type: PageClass, params: Record<string, RouteValue> = {}): void {
    if (this.modal) throw new Error("weft: cannot push while a modal page is presented");
    if (!this.stack.length) throw new Error("weft: cannot replace the root page");
    this.change(this.tab, [...this.stack.slice(0, -1), this.make(type, params)], "replace");
  }
  present(type: PageClass, params: Record<string, RouteValue> = {}, style: ModalStyle = "sheet"): void {
    if (this.modal) throw new Error("weft: a modal page is already presented");
    this.change(this.tab, this.stack, "present", this.entries, { entry: this.make(type, params), style });
  }
  dismiss(host = false): void { if (this.modal) this.change(this.tab, this.stack, host ? "host" : "dismiss", this.entries, null); }
  pop(count = 1): void {
    if (count < 1 || !Number.isInteger(count)) throw new RangeError("weft: pop count must be a positive integer");
    const length = Math.max(0, this.stack.length - count + (this.modal ? 1 : 0));
    if (this.modal || length !== this.stack.length) this.change(this.tab, this.stack.slice(0, length), "pop", this.entries, null);
  }
  popToRoot(): void { if (this.modal || this.stack.length) this.change(this.tab, [], "root", this.entries, null); }
  private tabIndex(type: PageClass): number {
    const index = this.config.tabs?.findIndex(tab => tab.page === type) ?? -1;
    if (index < 0) throw new Error(`weft: ${type.$route.name} is not a tab`);
    return index;
  }
  switchTab(type: PageClass): void { this.selectTab(this.tabIndex(type)); }
  selectTab(index: number, host = false): void {
    const tab = this.config.tabs?.[index];
    if (!tab) return;
    if (index === this.tab && !this.stack.length && !this.coldRoot && !this.modal) return;
    const old = this.entries;
    if (this.coldRoot) { this.tabs[this.tab] = null; this.coldRoot = false; }
    const created = !this.tabs[index];
    if (created) this.tabs[index] = this.make(tab.page);
    this.change(index, [], host ? (created ? "correct" : "host") : "tab", old, null);
  }
  setBadge(type: PageClass, text: string | null): void {
    const index = this.tabIndex(type);
    this.badges[index] = text;
    this.host.badge?.(index, text);
  }
  signal(json: string): void {
    try {
      const state = JSON.parse(json) as { tab?: unknown; stack?: unknown; modal?: unknown };
      if (typeof state.tab === "number" && Number.isInteger(state.tab) && state.tab >= 0 && state.tab < this.tabs.length && Array.isArray(state.stack)) {
        if ((state.tab !== this.tab || this.coldRoot) && this.config.tabs && state.stack.length === 0 && state.modal === 0) { this.selectTab(state.tab, true); return; }
        if (state.tab === this.tab && state.stack.length <= this.stack.length && state.stack.every((id, i) => id === this.stack[i]?.id)) {
          const sameModal = state.modal === (this.modal?.entry.id ?? 0);
          const dismissed = !!this.modal && state.modal === 0;
          if ((sameModal && (!this.modal || state.stack.length === this.stack.length)) || dismissed) {
            if (dismissed || state.stack.length !== this.stack.length) this.change(this.tab, this.stack.slice(0, state.stack.length), "host", this.entries, dismissed ? null : this.modal);
            return;
          }
        }
      }
    } catch { /* invalid host payload */ }
    console.error("weft: invalid navigation signal"); this.host.update(this.entries, "correct");
  }
  restore(urls: readonly string[], operation: "host" | "correct" = "host"): void {
    if (!urls.length) return;
    const matches = urls.map(url => matchRoute(this.config.pages, url));
    if (matches.some(match => match === null)) return;
    const index = this.config.tabs?.findIndex(tab => tab.page === matches[0]!.page) ?? -1;
    const tab = index < 0 ? this.tab : index;
    const old = this.entries;
    const existingRoot = this.tabs[tab];
    const root = existingRoot && routeURL(existingRoot.type, existingRoot.page.params) === urls[0] ? existingRoot : this.make(matches[0]!.page, matches[0]!.params);
    if (existingRoot !== root) this.tabs[tab] = root;
    const stack = matches.slice(1).map((match, i) => {
      const existing = tab === this.tab ? this.stack[i] : undefined;
      return existing && routeURL(existing.type, existing.page.params) === urls[i + 1] ? existing : this.make(match!.page, match!.params);
    });
    this.change(tab, stack, operation, old, null);
    if (existingRoot && existingRoot !== root && !old.includes(existingRoot)) this.host.destroy(existingRoot.page);
  }
  onChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispose(): void { if (this.foreground) this.currentEntry?.page.$emit("Hide", {}); for (const entry of [...this.tabs, ...this.stack, this.modal?.entry]) if (entry) this.host.destroy(entry.page); this.tabs.fill(null); this.stack = []; this.modal = null; deactivate(this); }
}

export const navigation = {
  get stack(): readonly Route[] { return current().entries.map(({ page, type }) => ({ page: type.$route.name, params: page.params })); },
  get tab(): string | null { const controller = current(); return controller.config.tabs?.[controller.tab]?.page.$route.name ?? null; },
  get modal(): Route | null { const modal = current().modal; return modal ? { page: modal.entry.type.$route.name, params: modal.entry.page.params } : null; },
  present<P>(page: PageClass<P>, ...rest: [...ParamsArg<P>, options?: { style?: ModalStyle }]): void {
    const [params, options] = rest as unknown as [P?, { style?: ModalStyle }?];
    current().present(page, (params ?? {}) as Record<string, RouteValue>, options?.style);
  },
  dismiss(): void { current().dismiss(); },
  switchTab(page: PageClass<{}>): void { current().switchTab(page); },
  setBadge(page: PageClass<{}>, text: string | null): void { current().setBadge(page, text); },
  push<P>(page: PageClass<P>, ...params: ParamsArg<P>): void { current().push(page, (params[0] ?? {}) as Record<string, RouteValue>); },
  replace<P>(page: PageClass<P>, ...params: ParamsArg<P>): void { current().replace(page, (params[0] ?? {}) as Record<string, RouteValue>); },
  pop(count?: number): void { current().pop(count); },
  popToRoot(): void { current().popToRoot(); },
  onChange(listener: () => void): () => void { return current().onChange(listener); },
};
