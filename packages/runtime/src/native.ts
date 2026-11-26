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
  open(hash: string, dispatch: (scope: number, slot: number, payload: Value | undefined) => boolean, protocol: number): void;
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

/** Renders one app through the native kernel. */
export class NativeSink extends OpWriter implements Sink {
  #kernel: Kernel;

  constructor(target: Kernel = kernel()) {
    super();
    this.#kernel = target;
  }

  open(session: Session): void {
    this.#kernel.open(session.hash, (scope, slot, payload) => session.dispatch(scope, slot, payload), VERSION);
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
