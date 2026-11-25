import * as $ from "@weft-ui/runtime/remote";

const $s0 = 0;
const $s1 = 1;
const $s2 = 2;
const $s3 = 3;
const $s4 = 4;
const $s5 = 5;
const $s6 = 6;

export function Inputs$c(app, args, children, depth) {
  const c = new $.Instance(app, 0, 1, depth, args, children);
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
  c.set(0, c.s[0]);
  c.set(1, c.p[0]);
  c.set(2, c.p[2]);
  c.set(3, c.s[2]);
  c.on(0, ($a) => { c.state(0, $a); }, 0);
  c.on(1, () => { c.state(0, ""); }, -1);
  c.on(2, ($a) => { c.state(3, $a); }, -1);
  c.set(4, "");
  c.on(3, null, 4);
  c.set(5, c.s[1]);
  c.on(4, ($a) => { c.state(1, $a); }, 5);
  c.on(5, ($a) => { c.state(3, $a); }, -1);
  c.set(6, (c.s[3] ? "Focused" : "Not focused"));
  c.on(6, () => { c.state(2, (!c.s[2])); }, -1);
  c.u = () => {
    if (c.d[0] & 8) c.set(0, c.s[0]);
    if (c.d[0] & 1) c.set(1, c.p[0]);
    if (c.d[0] & 4) c.set(2, c.p[2]);
    if (c.d[0] & 32) c.set(3, c.s[2]);
    if (c.d[0] & 16) c.set(5, c.s[1]);
    if (c.d[0] & 64) c.set(6, (c.s[3] ? "Focused" : "Not focused"));
  };
  return c;
}

export class Inputs extends $.App {
  constructor($p0, $p1, $p2) { super(Inputs$c, [$p0, $p1, $p2], "7830210590bc0977"); }
}
