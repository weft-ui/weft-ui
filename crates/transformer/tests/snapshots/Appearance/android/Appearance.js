import * as $ from "@weft-ui/runtime/remote";

export class AppearanceModel extends $.Model {
  static from($v) { return $v instanceof AppearanceModel ? $v : new AppearanceModel($v); }
  constructor($v) { super([$v.opacity, $v.hidden, $v.background, $v.radius, $v.border, $v.borderColor, $v.shadow, $v.clip]); }
  get opacity() { return this.$v[0]; }
  set opacity($v) { this.$set(0, $v); }
  get hidden() { return this.$v[1]; }
  set hidden($v) { this.$set(1, $v); }
  get background() { return this.$v[2]; }
  set background($v) { this.$set(2, $v); }
  get radius() { return this.$v[3]; }
  set radius($v) { this.$set(3, $v); }
  get border() { return this.$v[4]; }
  set border($v) { this.$set(4, $v); }
  get borderColor() { return this.$v[5]; }
  set borderColor($v) { this.$set(5, $v); }
  get shadow() { return this.$v[6]; }
  set shadow($v) { this.$set(6, $v); }
  get clip() { return this.$v[7]; }
  set clip($v) { this.$set(7, $v); }
  toJSON() { return { opacity: this.$v[0], hidden: this.$v[1], background: this.$v[2], radius: this.$v[3], border: this.$v[4], borderColor: this.$v[5], shadow: this.$v[6], clip: this.$v[7] }; }
}

const $s0 = [0, 1, 2, 3, 4, 5, 6, 7];

export function Appearance$c(app, args, children, depth) {
  const c = new $.Instance(app, 0, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  c.set(0, c.p[0].$v[0]);
  c.set(1, c.p[0].$v[1]);
  c.set(2, c.p[0].$v[2]);
  c.set(3, c.p[0].$v[3]);
  c.set(4, c.p[0].$v[4]);
  c.set(5, c.p[0].$v[5]);
  c.set(6, c.p[0].$v[6]);
  c.set(7, c.p[0].$v[7]);
  c.set(8, c.p[0].$v[7]);
  c.set(9, c.p[0].$v[1]);
  c.set(10, c.p[0].$v[0]);
  c.set(11, "");
  c.on(0, null, 11);
  c.set(12, false);
  c.on(1, null, 12);
  c.u = () => {
    if (c.d[0] & 1) c.set(0, c.p[0].$v[0]);
    if (c.d[0] & 2) c.set(1, c.p[0].$v[1]);
    if (c.d[0] & 4) c.set(2, c.p[0].$v[2]);
    if (c.d[0] & 8) c.set(3, c.p[0].$v[3]);
    if (c.d[0] & 16) c.set(4, c.p[0].$v[4]);
    if (c.d[0] & 32) c.set(5, c.p[0].$v[5]);
    if (c.d[0] & 64) c.set(6, c.p[0].$v[6]);
    if (c.d[0] & 128) c.set(7, c.p[0].$v[7]);
    if (c.d[0] & 128) c.set(8, c.p[0].$v[7]);
    if (c.d[0] & 2) c.set(9, c.p[0].$v[1]);
    if (c.d[0] & 1) c.set(10, c.p[0].$v[0]);
  };
  return c;
}

export class Appearance extends $.App {
  constructor($p0) { super(Appearance$c, [AppearanceModel.from($p0)], "70627c3a51016ed9"); }
}
