import * as $ from "@weft-ui/runtime";

export class LayoutModel extends $.Model {
  static from($v) { return $v instanceof LayoutModel ? $v : new LayoutModel($v); }
  constructor($v) { super([$v.width, $v.inset, $v.gap, $v.grow, $v.ratio, $v.fill, $v.align, $v.justify, $v.alignment, $v.indicators, $v.spacer, $c0($v.labels)]); }
  get width() { return this.$v[0]; }
  set width($v) { this.$set(0, $v); }
  get inset() { return this.$v[1]; }
  set inset($v) { this.$set(1, $v); }
  get gap() { return this.$v[2]; }
  set gap($v) { this.$set(2, $v); }
  get grow() { return this.$v[3]; }
  set grow($v) { this.$set(3, $v); }
  get ratio() { return this.$v[4]; }
  set ratio($v) { this.$set(4, $v); }
  get fill() { return this.$v[5]; }
  set fill($v) { this.$set(5, $v); }
  get align() { return this.$v[6]; }
  set align($v) { this.$set(6, $v); }
  get justify() { return this.$v[7]; }
  set justify($v) { this.$set(7, $v); }
  get alignment() { return this.$v[8]; }
  set alignment($v) { this.$set(8, $v); }
  get indicators() { return this.$v[9]; }
  set indicators($v) { this.$set(9, $v); }
  get spacer() { return this.$v[10]; }
  set spacer($v) { this.$set(10, $v); }
  get labels() { return this.$v[11]; }
  set labels($v) { if ($v !== this.$v[11]) this.$set(11, $c0($v)); }
  toJSON() { return { width: this.$v[0], inset: this.$v[1], gap: this.$v[2], grow: this.$v[3], ratio: this.$v[4], fill: this.$v[5], align: this.$v[6], justify: this.$v[7], alignment: this.$v[8], indicators: this.$v[9], spacer: this.$v[10], labels: this.$v[11] }; }
}

const $c0 = $.arrayOf($.id);
const $s0 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const $s1 = 0;
const $t0 = $.template("<div class=\"w-stack\" style=\"place-items:center center\"><!----></div>");
const $t1 = $.template("<div class=\"w-column\" style=\"width:320px;height:540px;min-width:160px;max-width:480px;min-height:240px;max-height:640px;margin-top:12px;margin-bottom:12px;margin-left:10px;margin-right:10px;padding-top:16px;padding-bottom:16px;padding-left:14px;padding-right:14px;gap:8px;align-items:stretch;justify-content:space-between\"><div class=\"w-row\" style=\"margin-top:6px;margin-bottom:4px;padding-right:6px;padding-left:6px;padding-top:5px\"><div class=\"w-row\" style=\"min-width:12px\"><span class=\"w-text\" style=\"margin-top:1px;margin-bottom:2px;margin-left:3px;margin-right:4px;padding-top:2px;padding-bottom:3px;padding-left:4px;padding-right:5px\">fluid</span></div><div class=\"w-spacer\"></div><span class=\"w-text w-fill w-grow\" style=\"flex:2 1 0px;min-width:0;min-height:0;align-self:stretch;justify-self:stretch;aspect-ratio:1.5;padding-top:8px;padding-bottom:8px\">fixed</span></div><div class=\"w-stack\" style=\"width:128px;height:64px;place-items:end end\"><img src=\"square.png\" class=\"w-image w-in-stack\" style=\"width:32px;height:32px\"><!----></div><div class=\"w-stack\"><!----></div><div class=\"w-scroll-v w-fill w-grow\" style=\"gap:4px;align-items:center\"><span class=\"w-text w-in-scroll\">vertical</span><div class=\"w-spacer w-in-scroll\"></div><!----></div><div class=\"w-scroll-h w-fill w-grow\" style=\"scrollbar-width:none\"><div class=\"w-spacer w-in-scroll\" style=\"flex:0 0 16px\"></div><button type=\"button\" class=\"w-button w-in-scroll\" style=\"width:80px\"><span class=\"w-text\">horizontal</span></button><input class=\"w-input w-in-scroll\"><input type=\"checkbox\" class=\"w-checkbox w-in-scroll\"></div></div>");
const $t2 = $.template("<span class=\"w-text w-fill\" style=\"align-self:stretch;justify-self:stretch\">overlay</span>");
const $t3 = $.template("<span class=\"w-text\">projected</span>");
const $t4 = $.template("<span class=\"w-text\"></span>");

export function Overlay$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  const f = $t0();
  const n1 = f.firstChild;
  const n0 = n1.firstChild;
  const y0 = c.children[0]?.create() ?? null;
  if (y0) y0.mount(n0.parentNode, n0);
  c.init(f);
  c.x = () => {
    if (y0) y0.destroy(false);
  };
  return c;
}

export class Overlay extends $.App {
  constructor() { super(Overlay$c, [undefined]); }
}

export function Layout$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  const f = $t1();
  const n23 = f.firstChild;
  const n4 = n23.firstChild;
  const n1 = n4.firstChild;
  const n0 = n1.firstChild;
  const n2 = n1.nextSibling;
  const n3 = n2.nextSibling;
  const n8 = n4.nextSibling;
  const n5 = n8.firstChild;
  const n7 = n5.nextSibling;
  const n11 = n8.nextSibling;
  const n10 = n11.firstChild;
  const n16 = n11.nextSibling;
  const n12 = n16.firstChild;
  const n13 = n12.nextSibling;
  const n15 = n13.nextSibling;
  const n22 = n16.nextSibling;
  const n17 = n22.firstChild;
  const n19 = n17.nextSibling;
  const n18 = n19.firstChild;
  const n20 = n19.nextSibling;
  const n21 = n20.nextSibling;
  $.style(n4, 0, c.p[0].$v[0]);
  $.style(n4, 9, c.p[0].$v[1], 10);
  $.style(n4, 20, c.p[0].$v[1], 2);
  $.style(n4, 31, c.p[0].$v[2]);
  $.style(n4, 32, c.p[0].$v[6]);
  $.style(n4, 33, c.p[0].$v[7]);
  $.style(n1, 2, c.p[0].$v[3], 5);
  $.style(n1, 7, c.p[0].$v[5]);
  $.style(n1, 8, c.p[0].$v[4]);
  $.style(n2, 47, c.p[0].$v[10]);
  $.style(n3, 14, c.p[0].$v[1]);
  const i7 = new $.Branches(n7, (i) => {
    switch (i) {
      case 0: {
        const b = new $.Block();
        const f = $t2();
        const n6 = f.firstChild;
        b.init(f);
        return b;
      }
      default:
        return null;
    }
  });
  i7.set(c.p[0].$v[5] ? 0 : -1);
  $.style(n11, 45, c.p[0].$v[8]);
  const s10 = new $.Slot(() => {
    const b = new $.Block();
    const f = $t3();
    const n9 = f.firstChild;
    b.init(f);
    return b;
  });
  const k10 = Overlay$c(c.app, [undefined], [s10], c.depth + 1);
  k10.mount(n10.parentNode, n10);
  $.style(n16, 46, c.p[0].$v[9]);
  const l15 = new $.List(n15, (item) => {
    const r0 = new $.Row(1, c.depth + 1, $s1, item);
    const f = $t4();
    const n14 = f.firstChild;
    n14.textContent = r0.item;
    r0.init(f);
    r0.u = () => {
      if (r0.d[0] & 1) n14.textContent = r0.item;
    };
    return r0;
  }, ($it) => $it);
  l15.set(c.p[0].$v[11]);
  $.style(n22, 31, c.p[0].$v[2]);
  $.style(n22, 32, c.p[0].$v[6]);
  $.style(n20, 3, c.p[0].$v[0]);
  $.value(n20, "");
  $.input(n20, null);
  $.style(n21, 7, c.p[0].$v[5]);
  $.checked(n21, false);
  $.checkbox(n21, null);
  c.init(f);
  c.u = () => {
    if (c.d[0] & 1) $.style(n4, 0, c.p[0].$v[0]);
    if (c.d[0] & 2) $.style(n4, 9, c.p[0].$v[1], 10);
    if (c.d[0] & 2) $.style(n4, 20, c.p[0].$v[1], 2);
    if (c.d[0] & 4) $.style(n4, 31, c.p[0].$v[2]);
    if (c.d[0] & 64) $.style(n4, 32, c.p[0].$v[6]);
    if (c.d[0] & 128) $.style(n4, 33, c.p[0].$v[7]);
    if (c.d[0] & 8) $.style(n1, 2, c.p[0].$v[3], 5);
    if (c.d[0] & 32) $.style(n1, 7, c.p[0].$v[5]);
    if (c.d[0] & 16) $.style(n1, 8, c.p[0].$v[4]);
    if (c.d[0] & 1024) $.style(n2, 47, c.p[0].$v[10]);
    if (c.d[0] & 2) $.style(n3, 14, c.p[0].$v[1]);
    if (c.d[0] & 32) i7.set(c.p[0].$v[5] ? 0 : -1);
    if (c.d[0] & 256) $.style(n11, 45, c.p[0].$v[8]);
    if (c.d[0] & 512) $.style(n16, 46, c.p[0].$v[9]);
    if (c.d[0] & 2048) l15.set(c.p[0].$v[11]);
    if (c.d[0] & 4) $.style(n22, 31, c.p[0].$v[2]);
    if (c.d[0] & 64) $.style(n22, 32, c.p[0].$v[6]);
    if (c.d[0] & 1) $.style(n20, 3, c.p[0].$v[0]);
    if (c.d[0] & 32) $.style(n21, 7, c.p[0].$v[5]);
  };
  c.x = () => {
    i7.destroy();
    k10.destroy(false);
    l15.destroy();
  };
  return c;
}

export class Layout extends $.App {
  constructor($p0) { super(Layout$c, [LayoutModel.from($p0)]); }
}
