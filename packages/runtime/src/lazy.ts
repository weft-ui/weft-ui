/** Keyed, windowed item reconciliation shared by the DOM and remote renderers. */
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
  private nextId = 0;
  private started = false;
  private start = 0;
  private end = 0;

  constructor(private readonly keyOf: (item: T) => unknown, private readonly hooks: LazyHooks<T, R>) {}

  set(values: readonly T[]): void {
    const keys = values.map(this.keyOf);
    const seen = new Set<unknown>();
    for (const key of keys) {
      if (seen.has(key)) throw new Error(`weft: duplicate key \`${String(key)}\` in for loop`);
      seen.add(key);
    }
    const old = this.items;
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
    const changed = prefix !== old.length || prefix !== items.length;
    if (changed) {
      this.hooks.splice(prefix, old.length - prefix - suffix, items.slice(prefix, items.length - suffix).map(item => ({ id: item.id, template: 0 })));
    }
    if (!this.started && items.length) {
      this.started = true;
      this.window(0, Math.min(items.length, 20));
    } else if (changed && this.started) {
      this.window(this.start, this.end);
    }
  }

  window(start: number, end: number): void {
    this.start = Math.max(0, Math.floor(start));
    this.end = Math.max(this.start, Math.floor(end));
    start = Math.min(this.items.length, this.start);
    end = Math.min(this.items.length, this.end);
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (i >= start && i < end) {
        if (item.row === null) {
          item.row = this.hooks.create(item.value);
          this.hooks.bind(item.id, item.row);
        }
      } else if (item.row !== null) {
        this.hooks.bind(item.id, null);
        this.hooks.destroy(item.row);
        item.row = null;
      }
    }
  }

  update(visitor: (row: R) => void): void {
    for (const item of this.items) if (item.row !== null) visitor(item.row);
  }

  destroy(): void {
    for (const item of this.items) if (item.row !== null) this.hooks.destroy(item.row);
    this.items = [];
  }
}
