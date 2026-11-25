import * as $ from "@weft-ui/runtime";

const $c0 = $.arrayOf($.id);
const $s0 = 0;
const $s1 = 1;
const $s2 = 2;
const $s3 = 3;
const $s4 = 4;
const $s5 = 5;
const $s6 = 6;
const $s7 = 7;
const $t0 = $.template("<div class=\"w-column w-fill\" style=\"align-self:stretch;justify-self:stretch;gap:8px\"><input type=\"checkbox\" role=\"switch\" class=\"w-switch\"><input type=\"checkbox\" role=\"switch\" disabled class=\"w-switch\"><input type=\"checkbox\" class=\"w-checkbox\"><textarea rows=\"3\" placeholder=\"Write a note\" class=\"w-textarea\"></textarea><div class=\"w-spinner\"></div><div class=\"w-progress\" style=\"height:6px\"><div class=\"w-progress-bar\"></div></div><div class=\"w-progress\" style=\"width:120px\"><div class=\"w-progress-bar\" style=\"width:80%;background-color:#218670\"></div></div><div class=\"w-divider\"></div><div class=\"w-row\" style=\"height:24px\"><div class=\"w-divider-v\"></div></div><input type=\"range\" min=\"10\" step=\"5\" class=\"w-slider\"><select class=\"w-picker\"><option value=\"-1\" disabled hidden></option></select><select disabled class=\"w-picker\"><option value=\"-1\" disabled hidden></option></select></div>");

export function Controls$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  c.pw[1] = $.watch($s1, c, args[1]);
  c.pw[2] = $.watch($s2, c, args[2]);
  c.pw[3] = $.watch($s3, c, args[3]);
  c.s[0] = true;
  c.sw[0] = $.watch($s4, c, c.s[0]);
  c.s[1] = "";
  c.sw[1] = $.watch($s5, c, c.s[1]);
  c.s[2] = 30;
  c.sw[2] = $.watch($s6, c, c.s[2]);
  c.s[3] = (-1);
  c.sw[3] = $.watch($s7, c, c.s[3]);
  const f = $t0();
  const n13 = f.firstChild;
  const n0 = n13.firstChild;
  const n1 = n0.nextSibling;
  const n2 = n1.nextSibling;
  const n3 = n2.nextSibling;
  const n4 = n3.nextSibling;
  const n5 = n4.nextSibling;
  const n6 = n5.nextSibling;
  const n7 = n6.nextSibling;
  const n9 = n7.nextSibling;
  const n8 = n9.firstChild;
  const n10 = n9.nextSibling;
  const n11 = n10.nextSibling;
  const n12 = n11.nextSibling;
  $.checked(n0, c.s[0]);
  $.checkbox(n0, ($a) => { c.state(0, $a); });
  $.checked(n1, false);
  $.checkbox(n1, null);
  $.checked(n2, true);
  $.checkbox(n2, null);
  $.value(n3, c.s[1]);
  $.input(n3, ($a) => { c.state(1, $a); });
  $.style(n4, 34, c.p[1]);
  $.style(n5, 48, c.p[2]);
  $.style(n5, 49, c.p[1]);
  $.style(n8, 25, c.p[1]);
  $.rangeValue(n10, c.s[2]);
  $.rangeAttr(n10, "max", c.p[3]);
  $.slider(n10, ($a) => { c.state(2, $a); });
  $.selected(n11, c.s[3]);
  $.options(n11, c.p[0]);
  $.placeholder(n11, "Choose an option");
  $.picker(n11, ($a) => { c.state(3, $a); });
  $.selected(n12, 0);
  $.options(n12, c.p[0]);
  $.picker(n12, null);
  c.init(f);
  c.u = () => {
    if (c.d[0] & 16) $.checked(n0, c.s[0]);
    if (c.d[0] & 32) $.value(n3, c.s[1]);
    if (c.d[0] & 2) $.style(n4, 34, c.p[1]);
    if (c.d[0] & 4) $.style(n5, 48, c.p[2]);
    if (c.d[0] & 2) $.style(n5, 49, c.p[1]);
    if (c.d[0] & 2) $.style(n8, 25, c.p[1]);
    if (c.d[0] & 64) $.rangeValue(n10, c.s[2]);
    if (c.d[0] & 8) $.rangeAttr(n10, "max", c.p[3]);
    if (c.d[0] & 128) $.selected(n11, c.s[3]);
    if (c.d[0] & 1) $.options(n11, c.p[0]);
    if (c.d[0] & 1) $.options(n12, c.p[0]);
  };
  return c;
}

export class Controls extends $.App {
  constructor($p0, $p1, $p2, $p3) { super(Controls$c, [$c0($p0), $p1, $p2, $p3]); }
}
