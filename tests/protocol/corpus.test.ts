// The shared protocol corpus (protocol/corpus) against the JS encoder and decoder.
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { App, Instance, flushSync, type Value } from "@weft-ui/runtime/remote";
import { WechatSink } from "@weft-ui/runtime/wechat";
import { type Op, OpWriter, OpsError, decode, formatOp } from "../../packages/runtime/src/ops.ts";

type CorpusValue = { bool: boolean } | { number: number } | { string: string } | { strings: string[] };
type CorpusOp = Exclude<Op, { op: "set" }> | { op: "set"; scope: number; slot: number; value: CorpusValue };
interface OpsCase {
  name: string;
  hex: string;
  ops?: CorpusOp[];
  error?: OpsError["kind"];
  text?: string;
}
interface ValueCase {
  name: string;
  value: CorpusValue;
  hex: string;
}

function corpus<T>(file: string): T {
  return JSON.parse(readFileSync(new URL(`../../protocol/corpus/${file}`, import.meta.url), "utf8")) as T;
}

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.replace(/\s+/g, "").match(/../g) ?? [], (byte) => parseInt(byte, 16));
}

function value(value: CorpusValue): Value {
  return "bool" in value ? value.bool : "number" in value ? value.number : "string" in value ? value.string : value.strings;
}

const { cases: opsCases } = corpus<{ cases: OpsCase[] }>("ops.json");
const { cases: valueCases } = corpus<{ cases: ValueCase[] }>("values.json");
const valid = opsCases.filter((c) => c.ops !== undefined);

describe("ops", () => {
  test.each(opsCases.map((c) => [c.name, c] as const))("decodes %s", (_, c) => {
    if (c.ops) {
      const ops = decode(bytes(c.hex));
      expect(ops).toEqual(c.ops.map((o) => (o.op === "set" ? { ...o, value: value(o.value) } : o)));
      if (c.text !== undefined) expect(ops.map(formatOp).join("\n")).toBe(c.text);
    } else {
      let error: unknown;
      try {
        decode(bytes(c.hex));
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(OpsError);
      expect((error as OpsError).kind).toBe(c.error);
    }
  });

  test.each(valid.map((c) => [c.name, c] as const))("encodes %s", (_, c) => {
    const writer = new OpWriter();
    for (const o of c.ops!) {
      switch (o.op) {
        case "create":
          writer.create(o.scope, o.template);
          break;
        case "set":
          writer.set(o.scope, o.slot, value(o.value));
          break;
        case "branch":
          writer.branch(o.scope, o.point, o.child);
          break;
        case "rows":
          writer.rows(o.scope, o.point, o.children);
          break;
        case "attach":
          writer.attach(o.scope, o.point, o.child);
          break;
        case "splice":
          writer.splice(o.scope, o.point, o.index, o.remove, o.items);
          break;
        case "bind":
          writer.bind(o.scope, o.point, o.item, o.child);
          break;
        case "nav":
          writer.nav(o.tab, o.tabs, o.stack, o.modal, o.style);
          break;
      }
    }
    expect(writer.take()).toEqual(bytes(c.hex));
  });
});

test.each(valueCases.map((c) => [c.name, c] as const))("encodes the value %s", (_, c) => {
  const writer = new OpWriter();
  writer.set(0, 0, value(c.value));
  // Version, opcode and the scope and slot u32s precede the value.
  const batch = writer.take()!;
  expect(batch.subarray(10)).toEqual(bytes(c.hex));
  expect(decode(batch)).toEqual([{ op: "set", scope: 0, slot: 0, value: value(c.value) }]);
});

test("keeps U+FEFF at the start of a string member", () => {
  const value = ["\ufeffa"];
  const writer = new OpWriter();
  writer.set(0, 0, value);
  expect(decode(writer.take()!)).toEqual([{ op: "set", scope: 0, slot: 0, value }]);
});

test("does not resend equal string lists to mini programs", () => {
  const updates: Record<string, unknown>[] = [];
  const sink = new WechatSink({ setData: (data) => updates.push(data) }, {
    hash: "list",
    templates: [{ n: "root", v: [["value"]] }],
  });
  const app = new App((app, args, children, depth) => new Instance(app, 0, 0, depth, args, children), [], "list");
  app.mount(sink);
  try {
    flushSync();
    updates.length = 0;
    const root = app.$scopes.get(1)!;
    const set = vi.spyOn(sink, "set");
    root.set(0, ["a", "b"]);
    root.set(0, ["a", "b"]);
    expect(set).toHaveBeenCalledTimes(1);
    sink.commit();
    expect(updates).toEqual([{ "r.value": ["a", "b"] }]);

    updates.length = 0;
    sink.set(root.id, 0, ["a", "b"]);
    sink.commit();
    expect(updates).toEqual([]);

    root.set(0, ["b", "a"]);
    sink.commit();
    expect(updates).toEqual([{ "r.value": ["b", "a"] }]);
  } finally {
    app.unmount();
  }
});
