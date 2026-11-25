import * as $ from "@weft-ui/runtime/remote";

const $s0 = 0;
const $s1 = 1;
const $s2 = 2;
const $s3 = 3;

export function Assets$c(app, args, children, depth) {
  const c = new $.Instance(app, 0, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  c.pw[1] = $.watch($s1, c, args[1]);
  c.pw[2] = $.watch($s2, c, args[2]);
  c.pw[3] = $.watch($s3, c, args[3]);
  c.set(0, c.p[0]);
  c.set(1, c.p[1]);
  c.set(2, c.p[3]);
  c.set(3, c.p[2]);
  c.u = () => {
    if (c.d[0] & 1) c.set(0, c.p[0]);
    if (c.d[0] & 2) c.set(1, c.p[1]);
    if (c.d[0] & 8) c.set(2, c.p[3]);
    if (c.d[0] & 4) c.set(3, c.p[2]);
  };
  return c;
}

export class Assets extends $.App {
  constructor($p0, $p1, $p2, $p3) { super(Assets$c, [$p0, $p1, $p2, $p3], "bb3bd24184629ff7"); }
}
