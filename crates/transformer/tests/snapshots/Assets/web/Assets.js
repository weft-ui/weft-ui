import * as $ from "@weft-ui/runtime";

const $s0 = 0;
const $s1 = 1;
const $s2 = 2;
const $s3 = 3;
const $t0 = $.template("<div class=\"w-column\" style=\"gap:8px\"><img alt=\"\" class=\"w-image w-image-placeholder\" style=\"width:96px;height:56px;object-fit:contain;--w-image-placeholder:#334455\"><img alt=\"\" class=\"w-image w-image-placeholder\" style=\"width:48px;height:48px\"><img class=\"w-image\" style=\"width:24px\"><span class=\"w-text\" style=\"font-weight:700;font-family:'Inter'\"><span class=\"w-span\">Bundled fonts</span><span class=\"w-span\" style=\"font-style:italic\">Family</span></span></div>");

export function Assets$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  c.pw[1] = $.watch($s1, c, args[1]);
  c.pw[2] = $.watch($s2, c, args[2]);
  c.pw[3] = $.watch($s3, c, args[3]);
  const f = $t0();
  const n6 = f.firstChild;
  const n0 = n6.firstChild;
  const n1 = n0.nextSibling;
  const n2 = n1.nextSibling;
  const n5 = n2.nextSibling;
  const n3 = n5.firstChild;
  const n4 = n3.nextSibling;
  $.imagePlaceholder(n0);
  $.image(n0, "asset:logo");
  $.imagePlaceholder(n1);
  $.image(n1, c.p[0]);
  $.style(n1, 43, c.p[1]);
  $.style(n1, 44, c.p[3]);
  $.image(n2, "asset:star");
  $.style(n4, 39, c.p[2]);
  c.init(f);
  c.u = () => {
    if (c.d[0] & 1) $.image(n1, c.p[0]);
    if (c.d[0] & 2) $.style(n1, 43, c.p[1]);
    if (c.d[0] & 8) $.style(n1, 44, c.p[3]);
    if (c.d[0] & 4) $.style(n4, 39, c.p[2]);
  };
  return c;
}

export class Assets extends $.App {
  constructor($p0, $p1, $p2, $p3) { super(Assets$c, [$p0, $p1, $p2, $p3]); }
}
