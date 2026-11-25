import * as $ from "@weft-ui/runtime";

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
const $t0 = $.template("<div class=\"w-column\" style=\"width:260px;opacity:0.9;padding-top:12px;padding-right:12px;padding-bottom:12px;padding-left:12px;background-color:#f7f8f9;border-radius:16px;border-style:solid;border-width:1px;box-shadow:0 1px 3px #0000001f;overflow:visible;gap:8px\"><div class=\"w-row\"><span class=\"w-text\" style=\"padding-top:6px;padding-right:6px;padding-bottom:6px;padding-left:6px;background-color:#f4c989;border-radius:4px\">Label</span></div><div class=\"w-stack\" style=\"width:160px;height:80px;background-color:#daf1ef;border-radius:12px;border-style:solid;border-width:2px;border-color:#4c888a;box-shadow:0 4px 12px #00000026;overflow:hidden\"><img src=\"wide.png\" class=\"w-image w-in-stack\" style=\"width:240px;height:96px;opacity:0.8;border-radius:6px\"></div><div class=\"w-scroll-v w-fill w-grow\" style=\"height:64px;border-radius:8px;border-style:solid;border-width:1px;box-shadow:0 12px 32px #0000002e\"><span class=\"w-text w-in-scroll\" style=\"height:96px\">Scroll</span></div><button type=\"button\" class=\"w-button\"><span class=\"w-text\">Action</span></button><input class=\"w-input\"><input type=\"checkbox\" class=\"w-checkbox\" style=\"display:none\"></div>");

export function Appearance$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  const f = $t0();
  const n10 = f.firstChild;
  const n1 = n10.firstChild;
  const n0 = n1.firstChild;
  const n3 = n1.nextSibling;
  const n2 = n3.firstChild;
  const n5 = n3.nextSibling;
  const n4 = n5.firstChild;
  const n7 = n5.nextSibling;
  const n6 = n7.firstChild;
  const n8 = n7.nextSibling;
  const n9 = n8.nextSibling;
  $.style(n1, 16, c.p[0].$v[0]);
  $.style(n1, 17, c.p[0].$v[1]);
  $.style(n1, 25, c.p[0].$v[2]);
  $.style(n1, 26, c.p[0].$v[3]);
  $.style(n1, 27, c.p[0].$v[4]);
  $.style(n1, 28, c.p[0].$v[5]);
  $.style(n1, 29, c.p[0].$v[6]);
  $.style(n1, 30, c.p[0].$v[7]);
  $.style(n5, 30, c.p[0].$v[7]);
  $.style(n7, 17, c.p[0].$v[1]);
  $.style(n8, 16, c.p[0].$v[0]);
  $.value(n8, "");
  $.input(n8, null);
  $.checked(n9, false);
  $.checkbox(n9, null);
  c.init(f);
  c.u = () => {
    if (c.d[0] & 1) $.style(n1, 16, c.p[0].$v[0]);
    if (c.d[0] & 2) $.style(n1, 17, c.p[0].$v[1]);
    if (c.d[0] & 4) $.style(n1, 25, c.p[0].$v[2]);
    if (c.d[0] & 8) $.style(n1, 26, c.p[0].$v[3]);
    if (c.d[0] & 16) $.style(n1, 27, c.p[0].$v[4]);
    if (c.d[0] & 32) $.style(n1, 28, c.p[0].$v[5]);
    if (c.d[0] & 64) $.style(n1, 29, c.p[0].$v[6]);
    if (c.d[0] & 128) $.style(n1, 30, c.p[0].$v[7]);
    if (c.d[0] & 128) $.style(n5, 30, c.p[0].$v[7]);
    if (c.d[0] & 2) $.style(n7, 17, c.p[0].$v[1]);
    if (c.d[0] & 1) $.style(n8, 16, c.p[0].$v[0]);
  };
  return c;
}

export class Appearance extends $.App {
  constructor($p0) { super(Appearance$c, [AppearanceModel.from($p0)]); }
}
