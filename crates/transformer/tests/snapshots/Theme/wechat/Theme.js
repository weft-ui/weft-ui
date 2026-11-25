import * as $ from "@weft-ui/runtime/remote";

export class Model extends $.Model {
  static from($v) { return $v instanceof Model ? $v : new Model($v); }
  constructor($v) { super([$v.flag]); }
  get flag() { return this.$v[0]; }
  set flag($v) { this.$set(0, $v); }
  toJSON() { return { flag: this.$v[0] }; }
}

const $s0 = 0;
const $s1 = [0];

export function Badge$c(app, args, children, depth) {
  const c = new $.Instance(app, 0, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  c.set(0, c.p[0]);
  c.u = () => {
    if (c.d[0] & 1) c.set(0, c.p[0]);
  };
  return c;
}

export class Badge extends $.App {
  constructor($p0) { super(Badge$c, [$p0], "7cc75271705805fa"); }
}

export function Theme$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, 1, depth, args, children);
  c.pw[0] = $.watch($s1, c, args[0]);
  c.set(0, (c.p[0].$v[0] ? "@accent" : "#000000"));
  c.set(1, $.str((-1.25)));
  const k4 = Badge$c(c.app, ["@accent"], [], c.depth + 1);
  c.attach(0, k4);
  c.u = () => {
    if (c.d[0] & 1) c.set(0, (c.p[0].$v[0] ? "@accent" : "#000000"));
  };
  c.x = () => {
    k4.destroy();
  };
  return c;
}

export class Theme extends $.App {
  constructor($p0) { super(Theme$c, [Model.from($p0)], "7cc75271705805fa"); }
}
