import * as $ from "@weft-ui/runtime";

export class NoteModel extends $.Model {
  static from($v) { return $v instanceof NoteModel ? $v : new NoteModel($v); }
  constructor($v) { super([$v.title]); }
  get title() { return this.$v[0]; }
  set title($v) { this.$set(0, $v); }
  toJSON() { return { title: this.$v[0] }; }
}

const $s0 = 0;
const $s1 = [0];
const $s2 = 1;
const $s3 = 2;
const $s4 = 3;
const $t0 = $.template("<span class=\"w-text\"></span>");
const $t1 = $.template("<div class=\"w-column\"><!----><span class=\"w-text\"></span></div>");
const $t2 = $.template("<!----><!---->");

export function Heading$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  const f = $t0();
  const n0 = f.firstChild;
  n0.textContent = c.p[0];
  c.init(f);
  c.u = () => {
    if (c.d[0] & 1) n0.textContent = c.p[0];
  };
  return c;
}

export class Heading extends $.App {
  constructor($p0) { super(Heading$c, [$p0]); }
}

export function Detail$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  c.pw[0] = $.watch($s1, c, args[0]);
  c.pw[1] = $.watch($s2, c, args[1]);
  c.pw[2] = $.watch($s3, c, args[2]);
  c.pw[3] = $.watch($s4, c, args[3]);
  const f = $t1();
  const n2 = f.firstChild;
  const n0 = n2.firstChild;
  const n1 = n0.nextSibling;
  const k0 = Heading$c(c.app, [c.p[0].$v[0]], [], c.depth + 1);
  k0.mount(n0.parentNode, n0);
  n1.textContent = c.p[1];
  c.init(f);
  c.u = () => {
    if (c.d[0] & 1) k0.arg(0, c.p[0].$v[0]);
    if (c.d[0] & 2) n1.textContent = c.p[1];
  };
  c.x = () => {
    k0.destroy(false);
  };
  return c;
}

export class Detail extends $.Page {
  static $route = { name: "Detail", path: ["notes", "{id}"], params: [{ name: "id", type: "String", optional: false }, { name: "from", type: "Union", optional: true, values: ["feed", "search"], default: "feed" }, { name: "draft", type: "Bool", optional: true }] };
  constructor($model, $params = {}) {
    const $p0 = $params["id"];
    const $p1 = $params["from"] === undefined ? "feed" : $params["from"];
    const $p2 = $params["draft"] === undefined ? null : $params["draft"];
    super(Detail$c, [NoteModel.from($model), $p0, $p1, $p2], { ["id"]: $p0, ["from"]: $p1, ["draft"]: $p2 });
  }
}

export function About$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  const f = $t2();
  const n0 = f.firstChild.nextSibling;
  const k0 = Heading$c(c.app, ["About"], [], c.depth + 1);
  k0.mount(n0.parentNode, n0);
  c.init(f);
  c.x = () => {
    k0.destroy(false);
  };
  return c;
}

export class About extends $.Page {
  static $route = { name: "About", path: ["about"], params: [] };
  constructor($params = {}) {
    super(About$c, [], {  });
  }
  get model() { return undefined; }
}
