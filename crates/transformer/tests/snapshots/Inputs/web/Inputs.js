import * as $ from "@weft-ui/runtime";

const $s0 = 0;
const $s1 = 1;
const $s2 = 2;
const $s3 = 3;
const $s4 = 4;
const $s5 = 5;
const $s6 = 6;
const $t0 = $.template("<div class=\"w-column\"><input class=\"w-input\"><input class=\"w-input\"><textarea rows=\"3\" maxlength=\"10\" class=\"w-textarea\"></textarea><span class=\"w-text\"></span><button type=\"button\" class=\"w-button\"><span class=\"w-text\">Toggle focus</span></button></div>");

export function Inputs$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  c.pw[1] = $.watch($s1, c, args[1]);
  c.pw[2] = $.watch($s2, c, args[2]);
  c.s[0] = "";
  c.sw[0] = $.watch($s3, c, c.s[0]);
  c.s[1] = "";
  c.sw[1] = $.watch($s4, c, c.s[1]);
  c.s[2] = false;
  c.sw[2] = $.watch($s5, c, c.s[2]);
  c.s[3] = false;
  c.sw[3] = $.watch($s6, c, c.s[3]);
  const f = $t0();
  const n6 = f.firstChild;
  const n0 = n6.firstChild;
  const n1 = n0.nextSibling;
  const n2 = n1.nextSibling;
  const n3 = n2.nextSibling;
  const n5 = n3.nextSibling;
  const n4 = n5.firstChild;
  $.value(n0, c.s[0]);
  $.input(n0, ($a) => { c.state(0, $a); });
  $.inputType(n0, c.p[0]);
  n0.setAttribute("enterkeyhint", c.p[1]);
  n0.setAttribute("maxlength", c.p[2]);
  $.focused(n0, c.s[2]);
  $.onSubmit(n0, () => { c.state(0, ""); });
  $.onFocusChange(n0, ($a) => { c.state(3, $a); });
  $.value(n1, "");
  $.inputType(n1, "password");
  $.input(n1, null);
  $.value(n2, c.s[1]);
  $.input(n2, ($a) => { c.state(1, $a); });
  $.focused(n2, false);
  $.onFocusChange(n2, ($a) => { c.state(3, $a); });
  n3.textContent = (c.s[3] ? "Focused" : "Not focused");
  n5.addEventListener("click", ($event) => { $event.stopPropagation(); c.state(2, (!c.s[2])); });
  c.init(f);
  c.u = () => {
    if (c.d[0] & 8) $.value(n0, c.s[0]);
    if (c.d[0] & 1) $.inputType(n0, c.p[0]);
    if (c.d[0] & 2) n0.setAttribute("enterkeyhint", c.p[1]);
    if (c.d[0] & 4) n0.setAttribute("maxlength", c.p[2]);
    if (c.d[0] & 32) $.focused(n0, c.s[2]);
    if (c.d[0] & 16) $.value(n2, c.s[1]);
    if (c.d[0] & 64) n3.textContent = (c.s[3] ? "Focused" : "Not focused");
  };
  return c;
}

export class Inputs extends $.App {
  constructor($p0, $p1, $p2) { super(Inputs$c, [$p0, $p1, $p2]); }
}
