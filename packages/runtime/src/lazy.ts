import { watch, type Shape, type Watch } from "./core.ts";

/** Keyed, windowed item reconciliation shared by the DOM and remote renderers. */
export interface LazyOptions<R> {
  endThreshold?: number;
  onEndReached?: () => void;
  onRefresh?: () => void;
  stickyHeaders?: boolean;
  sections?: {
    watchShape?: Shape;
    rows(section: unknown): readonly unknown[];
    rowKey(section: unknown, item: unknown): unknown;
    createRow(section: unknown, item: unknown): R;
  };
}

export interface SectionItem { key: object; template: number; value: unknown }

/** Intern keys by section and row, without conflating headers with rows. */
export class Sections<R> {
  private keys = new Map<unknown, { header: object; rows: Map<unknown, object>; watcher?: Watch; value: unknown }>();
  constructor(private readonly keyOf: (section: unknown) => unknown, private readonly options: NonNullable<LazyOptions<R>["sections"]>, private readonly changed: () => void) {}

  flatten(sections: readonly unknown[]): SectionItem[] {
    const next = new Map<unknown, { header: object; rows: Map<unknown, object>; watcher?: Watch; value: unknown }>();
    const result: SectionItem[] = [];
    for (const section of sections) {
      const key = this.keyOf(section);
      if (next.has(key)) throw new Error(`weft: duplicate key \`${String(key)}\` in for loop`);
      const previous = this.keys.get(key);
      if (previous && previous.value !== section) previous.watcher?.dispose();
      const watcher = previous && previous.value === section ? previous.watcher :
        this.options.watchShape === undefined ? undefined : watch(this.options.watchShape, { mark: this.changed }, section);
      const entry = { header: previous?.header ?? {}, rows: new Map<unknown, object>(), watcher, value: section };
      next.set(key, entry);
      result.push({ key: entry.header, template: 0, value: section });
      for (const item of this.options.rows(section)) {
        const rowKey = this.options.rowKey(section, item);
        if (entry.rows.has(rowKey)) throw new Error(`weft: duplicate key \`${String(rowKey)}\` in for loop`);
        const token = previous?.rows.get(rowKey) ?? {};
        entry.rows.set(rowKey, token);
        result.push({ key: token, template: 1, value: [section, item] });
      }
    }
    for (const [key, entry] of this.keys) if (!next.has(key)) entry.watcher?.dispose();
    this.keys = next;
    return result;
  }

  destroy(): void {
    for (const entry of this.keys.values()) entry.watcher?.dispose();
    this.keys.clear();
  }
}

export interface LazyHooks<T, R> {
  splice(index: number, remove: number, items: readonly { id: number; template: number }[]): void;
  bind(id: number, row: R | null): void;
  create(item: T): R;
  change(row: R, item: T): void;
  destroy(row: R): void;
}

interface Item<T, R> { key: unknown; id: number; value: T; row: R | null }

export class Lazy<T, R> {
  private items: Item<T, R>[] = [];
  // Sorted indices of materialized items in the current items array.
  private active: number[] = [];
  private nextId = 0;
  private started = false;
  private start = 0;
  private end = 0;
  private retained = -1;
  private notifiedCount: number | null = null;

  constructor(
    private readonly keyOf: (item: T) => unknown,
    private readonly hooks: LazyHooks<T, R>,
    private readonly templateOf: (item: T) => number = () => 0,
    private readonly endThreshold = 5,
    private readonly onEndReached?: () => void,
  ) {}

  private checkEnd(): void {
    const count = this.items.length;
    if (count !== this.notifiedCount && count > 0 && this.end >= count - this.endThreshold) {
      this.notifiedCount = count;
      this.onEndReached?.();
    }
  }

  set(values: readonly T[]): void {
    const keys = values.map(this.keyOf);
    const seen = new Set<unknown>();
    for (const key of keys) {
      if (seen.has(key)) throw new Error(`weft: duplicate key \`${String(key)}\` in for loop`);
      seen.add(key);
    }
    const old = this.items;
    if (values.length !== old.length) this.notifiedCount = null;
    const byKey = new Map(old.map(item => [item.key, item]));
    const items = values.map((value, i) => {
      const existing = byKey.get(keys[i]);
      if (!existing) return { key: keys[i], id: ++this.nextId, value, row: null };
      if (existing.value !== value) {
        existing.value = value;
        if (existing.row !== null) this.hooks.change(existing.row, value);
      }
      return existing;
    });
    let prefix = 0;
    while (prefix < old.length && prefix < items.length && old[prefix] === items[prefix]) prefix++;
    let suffix = 0;
    while (suffix < old.length - prefix && suffix < items.length - prefix && old[old.length - 1 - suffix] === items[items.length - 1 - suffix]) suffix++;
    for (const item of old) if (!seen.has(item.key) && item.row !== null) this.hooks.destroy(item.row);
    this.items = items;
    this.active = [];
    for (let i = 0; i < items.length; i++) if (items[i].row !== null) this.active.push(i);
    const changed = prefix !== old.length || prefix !== items.length;
    if (changed) {
      this.hooks.splice(prefix, old.length - prefix - suffix, items.slice(prefix, items.length - suffix).map(item => ({ id: item.id, template: this.templateOf(item.value) })));
    }
    if (!this.started && items.length) {
      this.started = true;
      this.window(0, Math.min(items.length, 20));
    } else if (changed && this.started) {
      this.window(this.start, this.end, this.retained);
    } else if (changed) {
      this.checkEnd();
    }
  }

  window(start: number, end: number, retained = -1): void {
    this.retained = retained;
    this.start = Math.max(0, Math.floor(start));
    this.end = Math.max(this.start, Math.floor(end));
    start = Math.min(this.items.length, this.start);
    end = Math.min(this.items.length, this.end);
    const next: number[] = [];
    let retain = Number.isInteger(retained) && retained >= 0 && retained < this.items.length;
    for (let i = start; i < end; i++) {
      if (retain && retained < i) { next.push(retained); retain = false; }
      next.push(i);
      if (i === retained) retain = false;
    }
    if (retain) next.push(retained);

    // Merge the old and new materialized indices to preserve index-order hooks.
    const previous = this.active;
    this.active = next;
    let oldIndex = 0, newIndex = 0;
    while (oldIndex < previous.length || newIndex < next.length) {
      const old = previous[oldIndex] ?? Infinity;
      const current = next[newIndex] ?? Infinity;
      if (old === current) { oldIndex++; newIndex++; continue; }
      if (old < current) {
        const item = this.items[old];
        if (item.row !== null) {
          this.hooks.bind(item.id, null);
          this.hooks.destroy(item.row);
          item.row = null;
        }
        oldIndex++;
      } else {
        const item = this.items[current];
        if (item.row === null) {
          item.row = this.hooks.create(item.value);
          this.hooks.bind(item.id, item.row);
        }
        newIndex++;
      }
    }
    this.checkEnd();
  }

  update(visitor: (row: R) => void): void {
    for (const item of this.items) if (item.row !== null) visitor(item.row);
  }

  destroy(): void {
    for (const item of this.items) if (item.row !== null) this.hooks.destroy(item.row);
    this.items = [];
    this.active = [];
  }
}
