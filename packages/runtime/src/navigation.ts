import { matchRoute, routeURL, type PageClass, type Route, type RouteValue } from "./route.js";
export type { PageClass, Route } from "./route.js";

type ParamsArg<P> = {} extends P ? [params?: P] : [params: P];
export interface NavigationPage { readonly params: Readonly<Record<string, RouteValue>>; $emit(name: string, payload: object): void }
export interface NavigationEntry { page: NavigationPage; type: PageClass; id: number }
export type NavigationOperation = "push" | "replace" | "pop" | "root" | "host" | "correct";
export interface NavigationHost {
  beforePush?(depth: number): void;
  create(page: NavigationPage): number;
  destroy(page: NavigationPage): void;
  update(entries: readonly NavigationEntry[], operation: NavigationOperation): void;
}
export interface ApplicationConfig { start: PageClass; pages: readonly PageClass[] }
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
  entries: NavigationEntry[] = [];
  private listeners = new Set<() => void>();
  private foreground = true;
  setForeground(foreground: boolean): void {
    if (this.foreground === foreground) return;
    this.foreground = foreground;
    this.entries.at(-1)?.page.$emit(foreground ? "Show" : "Hide", {});
  }
  constructor(readonly factories: PageFactories, readonly config: ApplicationConfig, readonly host: NavigationHost) {
    for (const page of config.pages) if (typeof factories[page.$route.name] !== "function") throw new Error(`weft: missing factory for page ${page.$route.name}`);
  }
  make(type: PageClass, params: Record<string, RouteValue> = {}): NavigationEntry {
    if (!this.config.pages.includes(type)) throw new Error(`weft: ${type.$route.name} is not a page in this app`);
    const page = this.factories[type.$route.name]!(params);
    return { page, type, id: this.host.create(page) };
  }
  start(urls: readonly string[] = []): void {
    const matches = urls.map(url => matchRoute(this.config.pages, url));
    this.entries = matches.length && matches.every(match => match !== null)
      ? matches.map(match => this.make(match!.page, match!.params))
      : [this.make(this.config.start)];
    this.host.update(this.entries, "host"); if (this.foreground) this.entries[this.entries.length - 1]!.page.$emit("Show", {});
  }
  private change(entries: NavigationEntry[], operation: NavigationOperation): void {
    const old = this.entries; const previous = old[old.length - 1]; const next = entries[entries.length - 1];
    this.entries = entries;
    this.host.update(entries, operation);
    if (this.foreground && previous !== next) { previous?.page.$emit("Hide", {}); next?.page.$emit("Show", {}); }
    for (const entry of old) if (!entries.includes(entry)) this.host.destroy(entry.page);
    for (const listener of this.listeners) listener();
  }
  push(type: PageClass, params: Record<string, RouteValue> = {}): void { this.host.beforePush?.(this.entries.length); this.change([...this.entries, this.make(type, params)], "push"); }
  replace(type: PageClass, params: Record<string, RouteValue> = {}): void {
    if (this.entries.length <= 1) throw new Error("weft: cannot replace the root page");
    this.change([...this.entries.slice(0, -1), this.make(type, params)], "replace");
  }
  pop(count = 1): void { if (count < 1 || !Number.isInteger(count)) throw new RangeError("weft: pop count must be a positive integer"); const length = Math.max(1, this.entries.length - count); if (length !== this.entries.length) this.change(this.entries.slice(0, length), "pop"); }
  popToRoot(): void { if (this.entries.length > 1) this.change(this.entries.slice(0, 1), "root"); }
  signal(json: string): void {
    try {
      const state = JSON.parse(json) as { tab?: unknown; stack?: unknown; modal?: unknown };
      if (state.tab === 0 && state.modal === 0 && Array.isArray(state.stack) && state.stack.length <= this.entries.length - 1 && state.stack.every((id, i) => id === this.entries[i + 1]?.id)) {
        const length = state.stack.length + 1; if (length !== this.entries.length) this.change(this.entries.slice(0, length), "host"); return;
      }
    } catch { /* invalid host payload */ }
    console.error("weft: invalid navigation signal"); this.host.update(this.entries, "correct");
  }
  restore(urls: readonly string[], operation: "host" | "correct" = "host"): void {
    if (!urls.length) return;
    const matches = urls.map(url => matchRoute(this.config.pages, url));
    if (matches.some(match => match === null)) return;
    const entries = matches.map((match, i) => {
      const existing = this.entries[i];
      return existing && routeURL(existing.type, existing.page.params) === urls[i] ? existing : this.make(match!.page, match!.params);
    });
    this.change(entries, operation);
  }
  onChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispose(): void { const entries = this.entries; this.entries = []; if (this.foreground) entries.at(-1)?.page.$emit("Hide", {}); for (const entry of entries) this.host.destroy(entry.page); deactivate(this); }
}

export const navigation = {
  get stack(): readonly Route[] { return current().entries.map(({ page, type }) => ({ page: type.$route.name, params: page.params })); },
  push<P>(page: PageClass<P>, ...params: ParamsArg<P>): void { current().push(page, (params[0] ?? {}) as Record<string, RouteValue>); },
  replace<P>(page: PageClass<P>, ...params: ParamsArg<P>): void { current().replace(page, (params[0] ?? {}) as Record<string, RouteValue>); },
  pop(count?: number): void { current().pop(count); },
  popToRoot(): void { current().popToRoot(); },
  onChange(listener: () => void): () => void { return current().onChange(listener); },
};
