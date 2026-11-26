/**
 * Native sink: encodes view protocol ops for the native kernel
 * (`native/core`), which hands every batch to the platform shell without
 * copying, and routes the shell's events back to the app.
 *
 * The kernel installs `globalThis.__weft` before the bundle runs; see
 * protocol/SPEC.md ("Native kernel") for the contract.
 */

import { OpWriter } from "./ops.ts";
import { VERSION } from "./protocol.ts";
import type { Session, Sink, Value } from "./remote.ts";

/** The kernel's global, installed by `native/core/src/runtime.cpp`. */
export interface Kernel {
  /**
   * Starts rendering. Throws if `hash` is not the layout hash of the native
   * views or another app is open. `dispatch` receives the shell's events.
   */
  open(hash: string, dispatch: (scope: number, slot: number, payload: Value | undefined) => boolean, protocol: number, window: (scope: number, point: number, start: number, end: number) => void): void;
  /** Hands `length` bytes at `offset` to the shell; they are read during the call only. */
  commit(buffer: ArrayBuffer, offset: number, length: number): void;
  /** The app was unmounted; later events are ignored. */
  close(): void;
  /** Whether the shell implements platform module `module`. */
  supports(module: string): boolean;
  /**
   * Calls a platform module of the shell. Strings are sent as UTF-8; the
   * promise resolves with the shell's result bytes, or rejects with its
   * error message (immediately for unsupported modules).
   */
  call(module: string, method: string, args?: string | ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer>;
  /** Registers the callback for a host signal, replacing any previous callback for that name. */
  on(name: string, callback: (json: string) => void): void;
  /** Launch options supplied by the shell as a JSON string. */
  readonly launch: string;
  /** Protocol version implemented by the kernel. */
  readonly protocol: number;
  /** OS version reported by the shell. */
  readonly version: string;
  /** Current environment as a JSON string. */
  readonly environment: string;
  /** Installs the callback for environment changes, replacing any previous callback. */
  listen(callback: () => void): void;
}

declare global {
  var __weft: Kernel | undefined;
}

/** The kernel global; throws outside the native kernel. */
export function kernel(): Kernel {
  const found = globalThis.__weft;
  if (!found) throw new Error("weft: the native kernel is missing; native bundles run inside native/core");
  return found;
}

// The kernel keeps one callback per signal name; multiplex it for platform subscribers.
const signals = new WeakMap<Kernel, Map<string, Set<(json: string) => void>>>();

/** Subscribes to a native host signal; the payload is the kernel's JSON string. */
export function onSignal(name: string, callback: (json: string) => void): () => void {
  const target = kernel();
  let names = signals.get(target);
  if (!names) signals.set(target, names = new Map());
  let listeners = names.get(name);
  if (!listeners) {
    names.set(name, listeners = new Set());
    const current = listeners;
    target.on(name, (json) => {
      for (const listener of current) listener(json);
    });
  }
  const listener = (json: string) => callback(json);
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Renders one app through the native kernel. */
export class NativeSink extends OpWriter implements Sink {
  #kernel: Kernel;

  constructor(target: Kernel = kernel()) {
    super();
    this.#kernel = target;
  }

  open(session: Session): void {
    this.#kernel.open(
      session.hash,
      (scope, slot, payload) => session.dispatch(scope, slot, payload),
      VERSION,
      (scope, point, start, end) => session.window(scope, point, start, end),
    );
  }

  commit(): void {
    const batch = this.take();
    if (batch) this.#kernel.commit(batch.buffer as ArrayBuffer, batch.byteOffset, batch.byteLength);
  }

  close(): void {
    this.take();
    this.#kernel.close();
  }
}
