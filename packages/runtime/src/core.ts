/**
 * Backend-independent half of the runtime: reactive model storage, watches
 * that map model changes to dirty bits, the flush scheduler, expression
 * helpers, and event handler registration. `index.ts` (Web DOM) and
 * `remote.ts` (view protocol scopes) build their blocks on top of it.
 */

/* ------------------------------------------------------------------------ */
/* Assets                                                                    */
/* ------------------------------------------------------------------------ */

/** Browser URLs for a logical image or icon. An empty srcset uses src alone. */
export interface Asset {
  readonly src: string;
  readonly srcset: string;
}

const missingAsset: Asset = { src: "", srcset: "" };
let assets: Readonly<Record<string, Asset>> = {};
let fonts = "";

/** Installs the manifest and styles from the Vite asset module. */
export function registerAssets(manifest: Readonly<Record<string, Asset>>, fontStyles: string): void {
  assets = manifest;
  fonts = fontStyles;
}

/** Looks up a bundled image or icon by name, without its `asset:` prefix. */
export function asset(name: string): Asset {
  if (Object.prototype.hasOwnProperty.call(assets, name)) return assets[name]!;
  warnMissingAsset(name);
  return missingAsset;
}

/** Warns about a missing logical asset in debug builds. */
export function warnMissingAsset(name: string): void {
  if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) {
    console.warn(`weft: missing asset ${JSON.stringify(name)}`);
  }
}

/** CSS for the bundled fonts, installed the first time a document mounts. */
export function assetFonts(): string {
  return fonts;
}

/* ------------------------------------------------------------------------ */
/* Models                                                                    */
/* ------------------------------------------------------------------------ */

type Listener = (field: number) => void;

/** Base class of generated model classes; fields are stored by index. */
export class Model {
  /** Field values in declaration order. */
  $v: unknown[];
  /** Watches notified with the index of every changed field. */
  $subs: Set<Listener> = new Set();
  /** Indices of fields holding a model instance (`M` or `M?`). */
  static $m: readonly number[] = [];

  constructor(values: unknown[]) {
    this.$v = values;
  }

  /** Stores a field and notifies watchers when the value changed. */
  $set(field: number, value: unknown): void {
    if (this.$v[field] === value) return;
    this.$v[field] = value;
    for (const listener of this.$subs) listener(field);
  }
}

/** Converts a host-supplied value into its runtime representation. */
export type Conv = (value: unknown) => unknown;

export const id: Conv = (value) => value;

/**
 * Converter for `T[]`: converts every element and freezes the result, so
 * in-place mutation (`push`, index assignment) fails loudly instead of being
 * silently missed by change tracking. Already converted frozen arrays are
 * returned unchanged.
 */
export function arrayOf(conv: Conv): Conv {
  return (input) => {
    // Generated code only passes arrays here (checked by the host's types).
    const value = input as readonly unknown[];
    let out: unknown[] | null = null;
    for (let i = 0; i < value.length; i++) {
      const item = conv(value[i]);
      if (out) {
        out.push(item);
      } else if (item !== value[i]) {
        out = value.slice(0, i);
        out.push(item);
      }
    }
    if (!out) {
      if (Object.isFrozen(value)) return value;
      out = value.slice();
    }
    return Object.freeze(out);
  };
}

/** Converter for `T?`: `undefined` becomes `null`. */
export function optional(conv: Conv): Conv {
  return (value) => (value == null ? null : conv(value));
}

/* ------------------------------------------------------------------------ */
/* Watches: map model changes to dirty bits                                  */
/* ------------------------------------------------------------------------ */

/**
 * Dirty-bit layout of one root value, generated from the IR slot table:
 * a number is a leaf bit (changes detected by identity), `{ d }` is a leaf
 * bit for an optional model whose nested fields are watched deeply, and an
 * array lists the shapes of a non-optional model's fields.
 */
export type Shape = number | { d: number } | Shape[];

export interface Marker {
  mark(bit: number): void;
}

export interface Watch {
  set(value: unknown): void;
  dispose(): void;
}

/** Creates a watch for `value`; the initial value marks nothing. */
export function watch(shape: Shape, scope: Marker, value: unknown): Watch {
  if (typeof shape === "number") return new LeafWatch(shape, scope, value);
  if (Array.isArray(shape)) return new FieldsWatch(shape, scope, value as Model);
  return new DeepWatch(shape.d, scope, value);
}

class LeafWatch implements Watch {
  bit: number;
  scope: Marker;
  cur: unknown;

  constructor(bit: number, scope: Marker, value: unknown) {
    this.bit = bit;
    this.scope = scope;
    this.cur = value;
  }

  set(value: unknown): void {
    if (value === this.cur) return;
    this.cur = value;
    this.scope.mark(this.bit);
  }

  dispose(): void {}
}

/** A non-optional model flattened into one watch per field. */
class FieldsWatch implements Watch {
  cur: Model;
  fields: Watch[];
  listener: Listener;

  constructor(shapes: Shape[], scope: Marker, value: Model) {
    this.cur = value;
    this.fields = shapes.map((shape, i) => watch(shape, scope, value.$v[i]));
    this.listener = (field) => this.fields[field].set(this.cur.$v[field]);
    value.$subs.add(this.listener);
  }

  set(value: unknown): void {
    if (value === this.cur) return;
    const next = value as Model;
    this.cur.$subs.delete(this.listener);
    this.cur = next;
    next.$subs.add(this.listener);
    for (let i = 0; i < this.fields.length; i++) this.fields[i].set(next.$v[i]);
  }

  dispose(): void {
    this.cur.$subs.delete(this.listener);
    for (const field of this.fields) field.dispose();
  }
}

/**
 * One bit covering an optional model and every model reachable from it
 * without passing through an array (array elements are only readable through
 * `for` items, which watch themselves).
 */
class DeepWatch implements Watch {
  bit: number;
  scope: Marker;
  cur: unknown;
  subs: Map<Model, Listener> = new Map();

  constructor(bit: number, scope: Marker, value: unknown) {
    this.bit = bit;
    this.scope = scope;
    this.cur = value;
    this.track();
  }

  set(value: unknown): void {
    if (value === this.cur) return;
    this.cur = value;
    this.track();
    this.scope.mark(this.bit);
  }

  /** Re-subscribes to the reachable models, keeping existing listeners. */
  track(): void {
    const next = new Map<Model, Listener>();
    const visit = (value: unknown): void => {
      if (!(value instanceof Model) || next.has(value)) return;
      const nested = (value.constructor as typeof Model).$m;
      let listener = this.subs.get(value);
      if (!listener) {
        listener = (field) => {
          if (nested.includes(field)) this.track();
          this.scope.mark(this.bit);
        };
        value.$subs.add(listener);
      }
      next.set(value, listener);
      for (const field of nested) visit(value.$v[field]);
    };
    visit(this.cur);
    for (const [model, listener] of this.subs) {
      if (!next.has(model)) model.$subs.delete(listener);
    }
    this.subs = next;
  }

  dispose(): void {
    for (const [model, listener] of this.subs) model.$subs.delete(listener);
    this.subs.clear();
  }
}

/* ------------------------------------------------------------------------ */
/* Scheduler                                                                 */
/* ------------------------------------------------------------------------ */

/** A scope with dirty bits that the scheduler updates during a flush. */
export interface Job {
  depth: number;
  queued: boolean;
  dead: boolean;
  flush(): void;
}

let queue: Job[] = [];
let scheduled = false;
let flushing = false;
/** Incremented by every flush; blocks created during a flush skip its updates. */
let epoch = 0;
let pendingEvents: [AppBase, string, object][] = [];
let afterFlush: (() => void)[] = [];
let deferredRestores: (() => void)[] = [];
let holds = 0;
const commits: (() => void)[] = [];

const defer = microtask();

/** Mini program logic layers may lack `queueMicrotask`; promises always work. */
function microtask(): (task: () => void) => void {
  const scope: object = globalThis;
  if ("queueMicrotask" in scope && typeof scope.queueMicrotask === "function") {
    const queue = scope.queueMicrotask;
    return (task) => queue.call(scope, task);
  }
  return (task) => {
    void Promise.resolve().then(task);
  };
}

/** The current flush counter; blocks remember the flush they were born in. */
export function currentEpoch(): number {
  return epoch;
}

/** Defers controlled-input restores until every hold is released. */
export function hold(): () => void {
  holds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    schedule();
  };
}

/** Runs `restore` after the next flush, or once all holds are released. */
export function restoreAfterFlush(restore: () => void): void {
  afterFlush.push(() => {
    if (holds > 0) deferredRestores.push(restore);
    else restore();
  });
  schedule();
}

/** Registers a hook that runs in every flush after the dirty scopes are updated. */
export function onCommit(hook: () => void): void {
  commits.push(hook);
}

/** Schedules a flush in a microtask unless one is pending. */
export function schedule(): void {
  if (!scheduled) {
    scheduled = true;
    defer(() => {
      if (scheduled) flush();
    });
  }
}

/** Runs the pending flush now instead of in its microtask. */
export function flushSync(): void {
  if (scheduled && !flushing) flush();
}

export function enqueue(job: Job): void {
  if (job.queued) return;
  job.queued = true;
  queue.push(job);
  schedule();
}

/**
 * Updates every dirty scope, parents before children, runs the commit hooks,
 * then dispatches the lifecycle events collected during the flush. Handlers
 * that modify models schedule the next flush instead of re-entering this one.
 */
function flush(): void {
  if (flushing) return;
  flushing = true;
  epoch++;
  let batch: Job[] = [];
  let events: [AppBase, string, object][] = [];
  let callbacks: (() => void)[] = [];
  try {
    try {
      while (queue.length > 0) {
        batch = queue;
        queue = [];
        batch.sort((a, b) => a.depth - b.depth);
        for (const job of batch) {
          job.queued = false;
          if (!job.dead) job.flush();
        }
      }
      batch = [];
      for (const commit of commits) commit();
    } catch (error) {
      // After an exception, unprocessed jobs must be able to queue again.
      for (const job of batch) job.queued = false;
      for (const job of queue) job.queued = false;
      queue = [];
      pendingEvents = [];
      throw error;
    } finally {
      scheduled = false;
      events = pendingEvents;
      callbacks = afterFlush;
      pendingEvents = [];
      afterFlush = [];
    }
    for (const [app, name, payload] of events) app.$emit(name, payload);
  } finally {
    try {
      if (holds === 0 && deferredRestores.length > 0) {
        const restores = deferredRestores;
        deferredRestores = [];
        for (const restore of restores) restore();
      }
    } finally {
      try {
        for (const callback of callbacks) callback();
      } finally {
        flushing = false;
        if (queue.length > 0 || afterFlush.length > 0) schedule();
      }
    }
  }
}

/** Resolves after the next flush (one is scheduled if none is pending). */
export function tick(): Promise<void> {
  // Not `Promise.withResolvers`: mini program JS engines predate ES2024.
  return new Promise((resolve) => {
    afterFlush.push(resolve);
    schedule();
  });
}

/** Queues a lifecycle event for dispatch after the current flush. */
export function lifecycle(app: AppBase, name: string, payload: object): void {
  pendingEvents.push([app, name, payload]);
  schedule();
}

/* ------------------------------------------------------------------------ */
/* Host-facing component                                                     */
/* ------------------------------------------------------------------------ */

type Handler = (model: unknown, event: object) => unknown;

/** Event handler registration shared by the backends' root component classes. */
export class AppBase {
  /** Root component arguments; the first is the model handlers receive. */
  protected readonly $args: unknown[];
  #handlers = new Map<string, Set<Handler>>();

  constructor(args: unknown[]) {
    this.$args = args;
  }

  /** Value of the first parameter: the object event handlers receive. */
  get model(): unknown {
    return this.$args[0];
  }

  $on(name: string, handler: Handler): () => void {
    let handlers = this.#handlers.get(name);
    if (!handlers) {
      handlers = new Set();
      this.#handlers.set(name, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  $emit(name: string, payload: object): void {
    const handlers = this.#handlers.get(name);
    if (!handlers) return;
    for (const handler of handlers) handler(this.$args[0], payload);
  }
}

/* ------------------------------------------------------------------------ */
/* Expression helpers used by generated code                                 */
/* ------------------------------------------------------------------------ */

export function str(value: unknown): string {
  return String(value);
}

/** `Int / Int`: truncating division. */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** Applies `f` to a non-null receiver (`?.` on built-in members). */
export function safe<T, R>(value: T | null, f: (value: T) => R): R | null {
  return value == null ? null : f(value);
}
