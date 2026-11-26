/**
 * Headless renderer: the reference implementation of the view protocol
 * (protocol/SPEC.md), for tests that run without a platform view.
 *
 * The renderer is a sink built on the binary writer: every batch is encoded,
 * decoded again, checked against the layout, and applied to a tree in
 * memory; the decoded ops are kept as annotated text for golden files.
 * Events are dispatched like a platform view does, including the rollback
 * of rejected controlled edits.
 */

import { OpWriter, decode, formatOp, type Op } from "./ops.ts";
import type { Session, Sink, Value } from "./remote.ts";

/** The view protocol layout, as `compileApp` returns it (JSON). */
export interface Layout {
  hash: string;
  templates: TemplateLayout[];
  app?: { start: number } | { tabs: { page: number; title: string; icon: string; activeIcon: string }[] };
}

export interface TemplateLayout {
  label: string;
  kind: "component" | "page" | "branch" | "row" | "slot";
  roots: number[];
  nodes: NodeLayout[];
  values: { node: number; prop: string; type: "Int" | "Float" | "Bool" | "String" | "Color" | "Strings" }[];
  events: { node: number; event: string; payload: string | null; controls: number | null }[];
  points: PointLayout[];
}

export type NodeLayout =
  | { element: string; props: Record<string, Value>; children: number[] }
  | { point: number };

export type PointLayout =
  | { node: number; kind: "branch"; templates: number[] }
  | { node: number; kind: "list" | "instance"; template: number }
  | { node: number; kind: "slot" };

/** A rendered element. */
export interface ViewElement {
  /** Element name, e.g. `Text`. */
  type: string;
  props: Record<string, Value>;
  children: ViewElement[];
  /** Navigation bar of a page, separate from its content. */
  bar?: ViewElement | null;
}

interface Scope {
  id: number;
  template: TemplateLayout;
  /** Properties of each element node, by local index. */
  props: Record<string, Value>[];
  /** Last value received per slot. */
  values: (Value | undefined)[];
  /** Mounted children by point. */
  kids: (Scope | Scope[] | null)[];
  mounted: boolean;
}

/** Renders one app in memory. */
export class Renderer extends OpWriter implements Sink {
  readonly layout: Layout;
  /** The ops of every committed batch, one annotated line per op. */
  readonly batches: string[][] = [];
  #session: Session | null = null;
  #scopes = new Map<number, Scope>();
  #root: Scope | null = null;
  #nav: { tab: number; tabs: number[]; stack: number[]; modal: number } | null = null;
  #elements = new WeakMap<ViewElement, [Scope, number]>();

  constructor(layout: Layout) {
    super();
    this.layout = layout;
  }

  open(session: Session): void {
    if (session.hash !== this.layout.hash) {
      throw new Error(`weft: layout mismatch (renderer ${this.layout.hash}, app ${session.hash})`);
    }
    if (this.#session) throw new Error("weft: the renderer already renders an app");
    this.#session = session;
  }

  commit(): void {
    const batch = this.take();
    if (!batch) return;
    const ops = decode(batch);
    for (const op of ops) {
      if (op.op === "splice" || op.op === "bind") {
        throw new Error(`weft protocol: unsupported ${op.op} for this layout`);
      }
    }
    const lines: string[] = [];
    for (const op of ops) {
      lines.push(this.#annotate(op));
      this.#apply(op);
    }
    this.batches.push(lines);
  }

  close(): void {
    this.take();
    this.#session = null;
    this.#scopes.clear();
    this.#root = null;
    this.#nav = null;
  }

  /** The rendered tree. A page's bar is separate from its content. */
  tree(): ViewElement[] {
    if (!this.#nav) return this.#root ? this.#expandScope(this.#root) : [];
    const id = this.#nav.modal || this.#nav.stack.at(-1) || this.#nav.tabs[this.#nav.tab];
    if (!id) return [];
    const content = this.#expandScope(this.#scope(id));
    const bar = content.find((element) => element.type === "NavBar") ?? null;
    return [{ type: "Page", props: {}, bar, children: content.filter((element) => element !== bar) }];
  }

  /** Simulates a host back action, updating host state before reporting it. */
  back(): void {
    const nav = this.#nav;
    if (!nav || (!nav.modal && nav.stack.length === 0)) return;
    const next = { ...nav, stack: [...nav.stack] };
    if (next.modal) next.modal = 0;
    else next.stack.pop();
    this.#setNav(next);
    this.#session!.signal("navigation", JSON.stringify({ tab: next.tab, stack: next.stack, modal: next.modal }));
  }

  /** Simulates selecting a tab in the host. */
  selectTab(index: number): void {
    const nav = this.#nav;
    if (!nav || !Number.isInteger(index) || index < 0 || index >= nav.tabs.length) {
      throw new RangeError(`weft: invalid tab index ${index}`);
    }
    if (nav.tabs[index]) this.#setNav({ ...nav, tab: index, stack: [], modal: 0 });
    this.#session!.signal("navigation", JSON.stringify({ tab: index, stack: [], modal: 0 }));
  }

  /** Rendered elements of `type`, in document order. */
  all(type: string): ViewElement[] {
    const out: ViewElement[] = [];
    const visit = (element: ViewElement) => {
      if (element.type === type) out.push(element);
      if (element.bar) visit(element.bar);
      element.children.forEach(visit);
    };
    this.tree().forEach(visit);
    return out;
  }

  /** Fires the named event (or the element's first event) without a payload. */
  click(element: ViewElement, event?: string): void {
    this.#emit(element, event, undefined);
  }

  /** Reports a user focus change without modifying the input's requested focus. */
  focus(element: ViewElement, value: boolean): void {
    this.#emit(element, "onFocusChange", value);
  }

  #emit(element: ViewElement, event: string | undefined, payload: boolean | undefined): void {
    const [scope, node] = this.#node(element);
    const slot = scope.template.events.findIndex((e) => e.node === node && (event === undefined || e.event === event));
    if (slot < 0) throw new Error(`<${element.type}> has no event${event === undefined ? "" : ` ${event}`}`);
    this.#session!.dispatch(scope.id, slot, payload);
  }

  /**
   * Edits a controlled element (`Input` text, `Checkbox` state) like a user
   * would; a rejected edit is rolled back to the last value received.
   * Returns whether the edit was accepted.
   */
  edit(element: ViewElement, value: Value): boolean {
    const [scope, local] = this.#node(element);
    const slot = scope.template.events.findIndex((e) => e.node === local && e.controls !== null);
    if (slot < 0) throw new Error(`<${element.type}> is not controlled`);
    const controls = scope.template.events[slot].controls!;
    const { node, prop } = scope.template.values[controls];
    scope.props[node][prop] = value;
    const accepted = this.#session!.dispatch(scope.id, slot, value);
    if (!accepted && this.#scopes.get(scope.id) === scope) {
      scope.props[node][prop] = scope.values[controls]!;
    }
    return accepted;
  }

  #node(element: ViewElement): [Scope, number] {
    const found = this.#elements.get(element);
    if (!found) throw new Error("weft: the element is not part of the current tree");
    return found;
  }

  #expandScope(scope: Scope): ViewElement[] {
    return scope.template.roots.flatMap((node) => this.#expand(scope, node));
  }

  #expand(scope: Scope, local: number): ViewElement[] {
    const node = scope.template.nodes[local];
    if ("point" in node) {
      const kid = scope.kids[node.point];
      if (!kid) return [];
      return Array.isArray(kid) ? kid.flatMap((row) => this.#expandScope(row)) : this.#expandScope(kid);
    }
    const element: ViewElement = {
      type: node.element,
      props: { ...scope.props[local] },
      children: node.children.flatMap((child) => this.#expand(scope, child)),
    };
    this.#elements.set(element, [scope, local]);
    return [element];
  }

  #annotate(op: Op): string {
    const text = formatOp(op);
    if (op.op === "create") return `${text}  # ${this.layout.templates[op.template]?.label}`;
    if (op.op === "set") {
      const slot = this.#scopes.get(op.scope)?.template.values[op.slot];
      const node = slot && this.#scopes.get(op.scope)!.template.nodes[slot.node];
      if (slot && node && "element" in node) return `${text}  # ${node.element}.${slot.prop}`;
    }
    return text;
  }

  #scope(id: number): Scope {
    const scope = this.#scopes.get(id);
    if (!scope) throw new Error(`weft protocol: unknown scope ${id}`);
    return scope;
  }

  /** A created scope that is not mounted yet, of one of `templates`. */
  #child(id: number, templates: readonly number[]): Scope {
    const child = this.#scope(id);
    const index = this.layout.templates.indexOf(child.template);
    if (!templates.includes(index)) {
      throw new Error(`weft protocol: scope ${id} of template ${index} cannot be mounted here`);
    }
    if (child.mounted) throw new Error(`weft protocol: scope ${id} is already mounted`);
    child.mounted = true;
    return child;
  }

  #point(scope: Scope, index: number, kind: PointLayout["kind"]): PointLayout {
    const point = scope.template.points[index];
    if (point?.kind !== kind) {
      throw new Error(`weft protocol: point ${index} of scope ${scope.id} is not a ${kind} point`);
    }
    return point;
  }

  #setNav(next: { tab: number; tabs: number[]; stack: number[]; modal: number }): void {
    if (this.#root || next.tab < 0 || next.tab >= next.tabs.length || !next.tabs[next.tab] || next.stack.includes(0)) {
      throw new Error("weft protocol: invalid navigation state");
    }
    const previous = new Set(this.#nav ? [...this.#nav.tabs, ...this.#nav.stack, this.#nav.modal].filter(Boolean) : []);
    const ids = [...next.tabs, ...next.stack, next.modal].filter(Boolean);
    const retained = new Set<number>();
    for (const id of ids) {
      if (retained.has(id)) throw new Error(`weft protocol: scope ${id} appears twice in navigation`);
      const scope = this.#scope(id);
      if (scope.template.kind !== "page" || (scope.mounted && !previous.has(id))) {
        throw new Error(`weft protocol: scope ${id} is not an available page`);
      }
      retained.add(id);
    }
    const app = this.layout.app;
    const expected = app && ("tabs" in app ? app.tabs.map((tab) => tab.page) : [app.start]);
    if (!expected || next.tabs.length !== expected.length || next.tabs.some((id, index) => id !== 0 && this.layout.templates[expected[index]!] !== this.#scope(id).template)) {
      throw new Error("weft protocol: navigation tabs do not match the app layout");
    }
    for (const id of previous) if (!retained.has(id)) this.#destroy(this.#scope(id));
    for (const id of retained) this.#scope(id).mounted = true;
    this.#nav = { ...next, tabs: [...next.tabs], stack: [...next.stack] };
  }

  #apply(op: Op): void {
    switch (op.op) {
      case "nav": {
        this.#setNav(op);
        return;
      }
      case "create": {
        const template = this.layout.templates[op.template];
        if (!template) throw new Error(`weft protocol: unknown template ${op.template}`);
        if (op.scope === 0 || this.#scopes.has(op.scope)) {
          throw new Error(`weft protocol: scope id ${op.scope} is in use`);
        }
        this.#scopes.set(op.scope, {
          id: op.scope,
          template,
          props: template.nodes.map((node) => ("element" in node ? { ...node.props } : {})),
          values: [],
          kids: template.points.map(() => null),
          mounted: false,
        });
        return;
      }
      case "set": {
        const scope = this.#scope(op.scope);
        const slot = scope.template.values[op.slot];
        if (!slot) throw new Error(`weft protocol: scope ${op.scope} has no value slot ${op.slot}`);
        const ok =
          slot.type === "Int" ? Number.isInteger(op.value)
          : slot.type === "Float" ? typeof op.value === "number"
          : slot.type === "Bool" ? typeof op.value === "boolean"
          : slot.type === "Strings" ? Array.isArray(op.value)
          : typeof op.value === "string";
        if (!ok) throw new Error(`weft protocol: ${formatOp(op)} does not fit a ${slot.type} slot`);
        scope.values[op.slot] = op.value;
        scope.props[slot.node][slot.prop] = op.value;
        return;
      }
      case "branch": {
        const scope = this.#scope(op.scope);
        const point = this.#point(scope, op.point, "branch") as { templates: number[] };
        const old = scope.kids[op.point] as Scope | null;
        if (old) this.#destroy(old);
        scope.kids[op.point] = op.child === 0 ? null : this.#child(op.child, point.templates);
        return;
      }
      case "rows": {
        const scope = this.#scope(op.scope);
        const point = this.#point(scope, op.point, "list") as { template: number };
        const old = (scope.kids[op.point] as Scope[] | null) ?? [];
        const kept = new Set<Scope>();
        const rows = op.children.map((id) => {
          const row = this.#scope(id);
          if (kept.has(row)) throw new Error(`weft protocol: scope ${id} appears twice in ${formatOp(op)}`);
          kept.add(row);
          return old.includes(row) ? row : this.#child(id, [point.template]);
        });
        for (const row of old) if (!kept.has(row)) this.#destroy(row);
        scope.kids[op.point] = rows;
        return;
      }
      case "attach": {
        if (op.scope === 0) {
          if (op.point !== 0 || this.#root) throw new Error(`weft protocol: invalid root ${formatOp(op)}`);
          const components = this.layout.templates.flatMap((t, i) => (t.kind === "component" ? [i] : []));
          this.#root = this.#child(op.child, components);
          return;
        }
        const scope = this.#scope(op.scope);
        const point = scope.template.points[op.point];
        if (scope.kids[op.point]) throw new Error(`weft protocol: point ${op.point} of scope ${op.scope} is attached twice`);
        if (point?.kind === "instance") {
          scope.kids[op.point] = this.#child(op.child, [point.template]);
        } else if (point?.kind === "slot") {
          const contents = this.layout.templates.flatMap((t, i) => (t.kind === "slot" ? [i] : []));
          scope.kids[op.point] = this.#child(op.child, contents);
        } else {
          throw new Error(`weft protocol: point ${op.point} of scope ${op.scope} does not take attach`);
        }
        return;
      }
    }
  }

  /** Implicit destruction of a scope and its descendants. */
  #destroy(scope: Scope): void {
    this.#scopes.delete(scope.id);
    for (const kid of scope.kids) {
      if (Array.isArray(kid)) kid.forEach((row) => this.#destroy(row));
      else if (kid) this.#destroy(kid);
    }
  }
}

/** Creates a renderer for the layout returned by `compileApp`. */
export function render(layout: string | Layout): Renderer {
  return new Renderer(typeof layout === "string" ? (JSON.parse(layout) as Layout) : layout);
}
