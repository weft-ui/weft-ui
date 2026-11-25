import * as $ from "@weft-ui/runtime/remote";

export class TypographyModel extends $.Model {
  static from($v) { return $v instanceof TypographyModel ? $v : new TypographyModel($v); }
  constructor($v) { super([$v.value, $v.weight, $v.decoration, $v.lines, $v.hidden, $v.clip, $v.italic]); }
  get value() { return this.$v[0]; }
  set value($v) { this.$set(0, $v); }
  get weight() { return this.$v[1]; }
  set weight($v) { this.$set(1, $v); }
  get decoration() { return this.$v[2]; }
  set decoration($v) { this.$set(2, $v); }
  get lines() { return this.$v[3]; }
  set lines($v) { this.$set(3, $v); }
  get hidden() { return this.$v[4]; }
  set hidden($v) { this.$set(4, $v); }
  get clip() { return this.$v[5]; }
  set clip($v) { this.$set(5, $v); }
  get italic() { return this.$v[6]; }
  set italic($v) { this.$set(6, $v); }
  toJSON() { return { value: this.$v[0], weight: this.$v[1], decoration: this.$v[2], lines: this.$v[3], hidden: this.$v[4], clip: this.$v[5], italic: this.$v[6] }; }
}

const $s0 = [0, 1, 2, 3, 4, 5, 6];

export function Typography$c(app, args, children, depth) {
  const c = new $.Instance(app, 0, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  c.set(0, c.p[0].$v[4]);
  c.set(1, c.p[0].$v[5]);
  c.set(2, c.p[0].$v[1]);
  c.set(3, c.p[0].$v[6]);
  c.set(4, c.p[0].$v[2]);
  c.set(5, c.p[0].$v[0]);
  c.set(6, c.p[0].$v[3]);
  c.set(7, c.p[0].$v[0]);
  c.u = () => {
    if (c.d[0] & 16) c.set(0, c.p[0].$v[4]);
    if (c.d[0] & 32) c.set(1, c.p[0].$v[5]);
    if (c.d[0] & 2) c.set(2, c.p[0].$v[1]);
    if (c.d[0] & 64) c.set(3, c.p[0].$v[6]);
    if (c.d[0] & 4) c.set(4, c.p[0].$v[2]);
    if (c.d[0] & 1) c.set(5, c.p[0].$v[0]);
    if (c.d[0] & 8) c.set(6, c.p[0].$v[3]);
    if (c.d[0] & 1) c.set(7, c.p[0].$v[0]);
  };
  return c;
}

export class Typography extends $.App {
  constructor($p0) { super(Typography$c, [TypographyModel.from($p0)], "d2a4d4e0ff976a2e"); }
}
