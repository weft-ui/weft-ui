import * as $ from "@weft-ui/runtime";

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
const $t0 = $.template("<div class=\"w-column\" style=\"gap:8px\"><span class=\"w-text\" style=\"width:240px;color:#123456;font-size:18px;text-align:end;line-height:24px\"></span><span class=\"w-text\" style=\"color:#334455;font-size:16px;text-align:center\"><span class=\"w-span\" style=\"font-weight:600\">One </span><span class=\"w-span\" style=\"color:#228866;text-decoration-line:underline\"></span><span class=\"w-span\" style=\"font-size:14px;font-style:italic;text-decoration-line:line-through\"> two</span></span></div>");

export function Typography$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  const f = $t0();
  const n5 = f.firstChild;
  const n0 = n5.firstChild;
  const n4 = n0.nextSibling;
  const n1 = n4.firstChild;
  const n2 = n1.nextSibling;
  const n3 = n2.nextSibling;
  n0.classList.toggle("w-text-hidden", c.p[0].$v[4]);
  n0.classList.toggle("w-text-clip", c.p[0].$v[5]);
  $.style(n0, 36, c.p[0].$v[1]);
  $.style(n0, 37, c.p[0].$v[6]);
  $.style(n0, 38, c.p[0].$v[2]);
  n0.textContent = c.p[0].$v[0];
  $.style(n0, 41, c.p[0].$v[3]);
  n2.textContent = c.p[0].$v[0];
  c.init(f);
  c.u = () => {
    if (c.d[0] & 16) n0.classList.toggle("w-text-hidden", c.p[0].$v[4]);
    if (c.d[0] & 32) n0.classList.toggle("w-text-clip", c.p[0].$v[5]);
    if (c.d[0] & 2) $.style(n0, 36, c.p[0].$v[1]);
    if (c.d[0] & 64) $.style(n0, 37, c.p[0].$v[6]);
    if (c.d[0] & 4) $.style(n0, 38, c.p[0].$v[2]);
    if (c.d[0] & 1) n0.textContent = c.p[0].$v[0];
    if (c.d[0] & 8) $.style(n0, 41, c.p[0].$v[3]);
    if (c.d[0] & 1) n2.textContent = c.p[0].$v[0];
  };
  return c;
}

export class Typography extends $.App {
  constructor($p0) { super(Typography$c, [TypographyModel.from($p0)]); }
}
