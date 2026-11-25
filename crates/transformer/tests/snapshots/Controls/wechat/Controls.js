import * as $ from "@weft-ui/runtime/remote";

const $c0 = $.arrayOf($.id);
const $s0 = 0;
const $s1 = 1;
const $s2 = 2;
const $s3 = 3;
const $s4 = 4;
const $s5 = 5;
const $s6 = 6;
const $s7 = 7;

export function Controls$c(app, args, children, depth) {
  const c = new $.Instance(app, 0, 1, depth, args, children);
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
  c.set(0, c.s[0]);
  c.on(0, ($a) => { c.state(0, $a); }, 0);
  c.set(1, false);
  c.on(1, null, 1);
  c.set(2, true);
  c.on(2, null, 2);
  c.set(3, c.s[1]);
  c.on(3, ($a) => { c.state(1, $a); }, 3);
  c.set(4, c.p[1]);
  c.set(5, c.p[2]);
  c.set(6, c.p[1]);
  c.set(7, c.p[1]);
  c.set(8, c.s[2]);
  c.set(9, c.p[3]);
  c.on(4, ($a) => { c.state(2, $a); }, 8);
  c.set(10, c.s[3]);
  c.set(11, c.p[0]);
  c.on(5, ($a) => { c.state(3, $a); }, 10);
  c.set(12, 0);
  c.set(13, c.p[0]);
  c.on(6, null, 12);
  c.u = () => {
    if (c.d[0] & 16) c.set(0, c.s[0]);
    if (c.d[0] & 32) c.set(3, c.s[1]);
    if (c.d[0] & 2) c.set(4, c.p[1]);
    if (c.d[0] & 4) c.set(5, c.p[2]);
    if (c.d[0] & 2) c.set(6, c.p[1]);
    if (c.d[0] & 2) c.set(7, c.p[1]);
    if (c.d[0] & 64) c.set(8, c.s[2]);
    if (c.d[0] & 8) c.set(9, c.p[3]);
    if (c.d[0] & 128) c.set(10, c.s[3]);
    if (c.d[0] & 1) c.set(11, c.p[0]);
    if (c.d[0] & 1) c.set(13, c.p[0]);
  };
  return c;
}

export class Controls extends $.App {
  constructor($p0, $p1, $p2, $p3) { super(Controls$c, [$c0($p0), $p1, $p2, $p3], "b32031c178730da0"); }
}
