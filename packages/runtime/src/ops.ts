/**
 * Binary encoding of view protocol ops (protocol/SPEC.md),
 * its decoder, and the one-line text form of an op used by dumps and golden
 * files.
 */

import { VERSION, Opcode, ValueTag, ModalStyle, type OpErrorKind } from "./protocol.ts";
import type { Ops, Value } from "./remote.ts";

/**
 * A batch that failed to decode; `kind` is one of the error kinds of
 * protocol/SPEC.md ("Decoding errors").
 */
export class OpsError extends Error {
  readonly kind: OpErrorKind;

  constructor(kind: OpErrorKind, message: string) {
    super(message);
    this.name = "OpsError";
    this.kind = kind;
  }
}

/** A decoded op. */
export type Op =
  | { op: "create"; scope: number; template: number }
  | { op: "set"; scope: number; slot: number; value: Value }
  | { op: "branch"; scope: number; point: number; child: number }
  | { op: "rows"; scope: number; point: number; children: number[] }
  | { op: "attach"; scope: number; point: number; child: number }
  | { op: "splice"; scope: number; point: number; index: number; remove: number; items: { item: number; template: number }[] }
  | { op: "bind"; scope: number; point: number; item: number; child: number }
  | { op: "nav"; tab: number; tabs: number[]; stack: number[]; modal: number; style: "sheet" | "fullScreen" };

/** Writes ops into one reusable buffer; `take` hands out each batch. */
export class OpWriter implements Ops {
  #bytes = new Uint8Array(256);
  #view = new DataView(this.#bytes.buffer);
  #length = 0;
  #encoder = new TextEncoder();

  /** Whether no op was written since the last `take`. */
  get empty(): boolean {
    return this.#length === 0;
  }

  /**
   * Returns the batch written since the last call and starts a new one, or
   * `null` if it is empty. The bytes are only valid until the next write.
   */
  take(): Uint8Array | null {
    if (this.#length === 0) return null;
    const batch = this.#bytes.subarray(0, this.#length);
    this.#length = 0;
    return batch;
  }

  create(scope: number, template: number): void {
    this.#op(Opcode.Create, 8);
    this.#u32(scope);
    this.#u32(template);
  }

  set(scope: number, slot: number, value: Value): void {
    this.#op(Opcode.Set, 9);
    this.#u32(scope);
    this.#u32(slot);
    if (typeof value === "string") {
      this.#bytes[this.#length++] = ValueTag.String;
      this.#string(value);
    } else if (typeof value === "number") {
      this.#bytes[this.#length++] = ValueTag.Number;
      this.#reserve(8);
      this.#view.setFloat64(this.#length, value, true);
      this.#length += 8;
    } else if (typeof value === "boolean") {
      this.#bytes[this.#length++] = value ? ValueTag.True : ValueTag.False;
    } else {
      this.#bytes[this.#length++] = ValueTag.Strings;
      this.#reserve(4);
      this.#u32(value.length);
      for (const text of value) this.#string(text);
    }
  }

  branch(scope: number, point: number, child: number): void {
    this.#op(Opcode.Branch, 12);
    this.#u32(scope);
    this.#u32(point);
    this.#u32(child);
  }

  rows(scope: number, point: number, children: readonly number[]): void {
    this.#op(Opcode.Rows, 12 + children.length * 4);
    this.#u32(scope);
    this.#u32(point);
    this.#u32(children.length);
    for (const child of children) this.#u32(child);
  }

  attach(scope: number, point: number, child: number): void {
    this.#op(Opcode.Attach, 12);
    this.#u32(scope);
    this.#u32(point);
    this.#u32(child);
  }

  splice(scope: number, point: number, index: number, remove: number, items: readonly { item: number; template: number }[]): void {
    this.#op(Opcode.Splice, 20 + items.length * 8);
    this.#u32(scope);
    this.#u32(point);
    this.#u32(index);
    this.#u32(remove);
    this.#u32(items.length);
    for (const { item, template } of items) {
      this.#u32(item);
      this.#u32(template);
    }
  }

  bind(scope: number, point: number, item: number, child: number): void {
    this.#op(Opcode.Bind, 16);
    this.#u32(scope);
    this.#u32(point);
    this.#u32(item);
    this.#u32(child);
  }

  nav(tab: number, tabs: readonly number[], stack: readonly number[], modal: number, style: "sheet" | "fullScreen"): void {
    this.#op(Opcode.Nav, 20 + (tabs.length + stack.length) * 4);
    this.#u32(tab);
    this.#u32(tabs.length);
    for (const scope of tabs) this.#u32(scope);
    this.#u32(stack.length);
    for (const scope of stack) this.#u32(scope);
    this.#u32(modal);
    this.#u32(modal !== 0 && style === "fullScreen" ? ModalStyle.FullScreen : ModalStyle.Sheet);
  }

  /** Writes the batch header if needed and the opcode, reserving `size` more bytes. */
  #op(code: number, size: number): void {
    this.#reserve(size + 2);
    if (this.#length === 0) this.#bytes[this.#length++] = VERSION;
    this.#bytes[this.#length++] = code;
  }

  #reserve(size: number): void {
    const needed = this.#length + size;
    if (needed <= this.#bytes.length) return;
    let capacity = this.#bytes.length * 2;
    while (capacity < needed) capacity *= 2;
    const bytes = new Uint8Array(capacity);
    bytes.set(this.#bytes.subarray(0, this.#length));
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer);
  }

  #string(value: string): void {
    // UTF-8 needs at most three bytes per UTF-16 code unit.
    this.#reserve(4 + value.length * 3);
    const { written } = this.#encoder.encodeInto(value, this.#bytes.subarray(this.#length + 4));
    this.#u32(written);
    this.#length += written;
  }

  #u32(value: number): void {
    this.#view.setUint32(this.#length, value, true);
    this.#length += 4;
  }
}

/**
 * Decodes one batch; throws an `OpsError` on truncated input, an unknown
 * version, opcode or value tag, or a string that is not well-formed UTF-8.
 */
export function decode(batch: Uint8Array): Op[] {
  const view = new DataView(batch.buffer, batch.byteOffset, batch.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let at = 0;
  const need = (size: number) => {
    if (at + size > batch.length) throw new OpsError("truncated", `weft ops: truncated batch at byte ${at}`);
  };
  const u8 = () => {
    need(1);
    return batch[at++];
  };
  const u32 = () => {
    need(4);
    const value = view.getUint32(at, true);
    at += 4;
    return value;
  };
  const string = () => {
    const length = u32();
    need(length);
    try {
      const text = decoder.decode(batch.subarray(at, at + length));
      at += length;
      return text;
    } catch {
      throw new OpsError("utf8", `weft ops: invalid UTF-8 string at byte ${at}`);
    }
  };
  const version = u8();
  if (version !== VERSION) throw new OpsError("version", `weft ops: unsupported version ${version}`);
  const ops: Op[] = [];
  while (at < batch.length) {
    const code = u8();
    switch (code) {
      case Opcode.Create:
        ops.push({ op: "create", scope: u32(), template: u32() });
        break;
      case Opcode.Set: {
        const scope = u32();
        const slot = u32();
        const tag = u8();
        let value: Value;
        if (tag === ValueTag.False || tag === ValueTag.True) {
          value = tag === ValueTag.True;
        } else if (tag === ValueTag.Number) {
          need(8);
          value = view.getFloat64(at, true);
          at += 8;
        } else if (tag === ValueTag.String) {
          value = string();
        } else if (tag === ValueTag.Strings) {
          const count = u32();
          need(count * 4); // Each string has at least its u32 length.
          const strings: string[] = [];
          for (let i = 0; i < count; i++) strings.push(string());
          value = strings;
        } else {
          throw new OpsError("tag", `weft ops: unknown value tag ${tag} at byte ${at - 1}`);
        }
        ops.push({ op: "set", scope, slot, value });
        break;
      }
      case Opcode.Branch:
        ops.push({ op: "branch", scope: u32(), point: u32(), child: u32() });
        break;
      case Opcode.Rows: {
        const scope = u32();
        const point = u32();
        const count = u32();
        const children: number[] = [];
        for (let i = 0; i < count; i++) children.push(u32());
        ops.push({ op: "rows", scope, point, children });
        break;
      }
      case Opcode.Attach:
        ops.push({ op: "attach", scope: u32(), point: u32(), child: u32() });
        break;
      case Opcode.Splice: {
        const scope = u32();
        const point = u32();
        const index = u32();
        const remove = u32();
        const count = u32();
        need(count * 8);
        const items: { item: number; template: number }[] = [];
        for (let i = 0; i < count; i++) items.push({ item: u32(), template: u32() });
        ops.push({ op: "splice", scope, point, index, remove, items });
        break;
      }
      case Opcode.Bind:
        ops.push({ op: "bind", scope: u32(), point: u32(), item: u32(), child: u32() });
        break;
      case Opcode.Nav: {
        const tab = u32();
        const n = u32();
        need(n * 4);
        const tabs: number[] = [];
        for (let i = 0; i < n; i++) tabs.push(u32());
        const m = u32();
        need(m * 4);
        const stack: number[] = [];
        for (let i = 0; i < m; i++) stack.push(u32());
        const modal = u32();
        const style = u32() === ModalStyle.FullScreen ? "fullScreen" : "sheet";
        ops.push({ op: "nav", tab, tabs, stack, modal, style });
        break;
      }
      default:
        throw new OpsError("opcode", `weft ops: unknown opcode ${code} at byte ${at - 1}`);
    }
  }
  return ops;
}

/** The text form of a value: a boolean, JS number, JSON string, or JSON string array. */
export function formatValue(value: Value): string {
  return typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
}

/** The text form of an op, e.g. `set 3 0 "milk"` or `rows 2 0 [4 5]`. */
export function formatOp(op: Op): string {
  switch (op.op) {
    case "create":
      return `create ${op.scope} ${op.template}`;
    case "set":
      return `set ${op.scope} ${op.slot} ${formatValue(op.value)}`;
    case "branch":
      return `branch ${op.scope} ${op.point} ${op.child}`;
    case "rows":
      return `rows ${op.scope} ${op.point} [${op.children.join(" ")}]`;
    case "attach":
      return `attach ${op.scope} ${op.point} ${op.child}`;
    case "splice":
      return `splice ${op.scope} ${op.point} ${op.index} ${op.remove} [${op.items.map(({ item, template }) => `${item}/${template}`).join(" ")}]`;
    case "bind":
      return `bind ${op.scope} ${op.point} ${op.item} ${op.child}`;
    case "nav":
      return `nav ${op.tab} [${op.tabs.join(" ")}] [${op.stack.join(" ")}] ${op.modal}${op.modal === 0 ? "" : ` ${op.style}`}`;
  }
}
