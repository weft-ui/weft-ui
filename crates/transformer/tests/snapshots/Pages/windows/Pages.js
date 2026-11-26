import * as $ from "@weft-ui/runtime/remote";

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

export function Heading$c(app, args, children, depth) {
  const c = new $.Instance(app, 0, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  c.set(0, c.p[0]);
  c.u = () => {
    if (c.d[0] & 1) c.set(0, c.p[0]);
  };
  return c;
}

export class Heading extends $.App {
  constructor($p0) { super(Heading$c, [$p0], "215dc99bf436019e"); }
}

export function Detail$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, 1, depth, args, children);
  c.pw[0] = $.watch($s1, c, args[0]);
  c.pw[1] = $.watch($s2, c, args[1]);
  c.pw[2] = $.watch($s3, c, args[2]);
  c.pw[3] = $.watch($s4, c, args[3]);
  const k0 = Heading$c(c.app, [c.p[0].$v[0]], [], c.depth + 1);
  c.attach(0, k0);
  c.set(0, c.p[1]);
  c.u = () => {
    if (c.d[0] & 1) k0.arg(0, c.p[0].$v[0]);
    if (c.d[0] & 2) c.set(0, c.p[1]);
  };
  c.x = () => {
    k0.destroy();
  };
  return c;
}

export class Detail extends $.Page {
  static $route = { name: "Detail", path: ["notes", "{id}"], params: [{ name: "id", type: "String", optional: false }, { name: "from", type: "Union", optional: true, values: ["feed", "search"], default: "feed" }, { name: "draft", type: "Bool", optional: true }] };
  constructor($model, $params = {}) {
    const $p0 = $params["id"];
    const $p1 = $params["from"] === undefined ? "feed" : $params["from"];
    const $p2 = $params["draft"] === undefined ? null : $params["draft"];
    super(Detail$c, [NoteModel.from($model), $p0, $p1, $p2], "215dc99bf436019e", { ["id"]: $p0, ["from"]: $p1, ["draft"]: $p2 });
  }
}

export function About$c(app, args, children, depth) {
  const c = new $.Instance(app, 2, 1, depth, args, children);
  const k0 = Heading$c(c.app, ["About"], [], c.depth + 1);
  c.attach(0, k0);
  c.x = () => {
    k0.destroy();
  };
  return c;
}

export class About extends $.Page {
  static $route = { name: "About", path: ["about"], params: [] };
  constructor($params = {}) {
    super(About$c, [], "215dc99bf436019e", {  });
  }
  get model() { return undefined; }
}
