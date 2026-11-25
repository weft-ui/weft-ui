import * as $ from "@weft-ui/runtime/remote";

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

export function Overlay$c(app, args, children, depth) {
  const c = new $.Instance(app, 0, 1, depth, args, children);
  const y0 = c.children[0]?.create() ?? null;
  if (y0) c.attach(0, y0);
  c.x = () => {
    if (y0) y0.destroy();
  };
  return c;
}

export class Overlay extends $.App {
  constructor() { super(Overlay$c, [undefined], "79e99fac5e135437"); }
}

export function Layout$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  c.set(0, c.p[0].$v[0]);
  c.set(1, c.p[0].$v[1]);
  c.set(2, c.p[0].$v[1]);
  c.set(3, c.p[0].$v[2]);
  c.set(4, c.p[0].$v[6]);
  c.set(5, c.p[0].$v[7]);
  c.set(6, c.p[0].$v[3]);
  c.set(7, c.p[0].$v[5]);
  c.set(8, c.p[0].$v[4]);
  c.set(9, c.p[0].$v[10]);
  c.set(10, c.p[0].$v[1]);
  const i7 = new $.Branches(c, 0, (i) => {
    switch (i) {
      case 0: {
        const b = new $.Block(c.app, 2);
        return b;
      }
      default:
        return null;
    }
  });
  i7.set(c.p[0].$v[5] ? 0 : -1);
  c.set(11, c.p[0].$v[8]);
  const s10 = new $.Slot(() => {
    const b = new $.Block(c.app, 3);
    return b;
  });
  const k10 = Overlay$c(c.app, [undefined], [s10], c.depth + 1);
  c.attach(1, k10);
  c.set(12, c.p[0].$v[9]);
  const l15 = new $.List(c, 2, (item) => {
    const r0 = new $.Row(c.app, 4, 1, c.depth + 1, $s1, item);
    r0.set(0, r0.item);
    r0.u = () => {
      if (r0.d[0] & 1) r0.set(0, r0.item);
    };
    return r0;
  }, ($it) => $it);
  l15.set(c.p[0].$v[11]);
  c.set(13, c.p[0].$v[2]);
  c.set(14, c.p[0].$v[6]);
  c.set(15, c.p[0].$v[0]);
  c.set(16, "");
  c.on(0, null, 16);
  c.set(17, c.p[0].$v[5]);
  c.set(18, false);
  c.on(1, null, 18);
  c.u = () => {
    if (c.d[0] & 1) c.set(0, c.p[0].$v[0]);
    if (c.d[0] & 2) c.set(1, c.p[0].$v[1]);
    if (c.d[0] & 2) c.set(2, c.p[0].$v[1]);
    if (c.d[0] & 4) c.set(3, c.p[0].$v[2]);
    if (c.d[0] & 64) c.set(4, c.p[0].$v[6]);
    if (c.d[0] & 128) c.set(5, c.p[0].$v[7]);
    if (c.d[0] & 8) c.set(6, c.p[0].$v[3]);
    if (c.d[0] & 32) c.set(7, c.p[0].$v[5]);
    if (c.d[0] & 16) c.set(8, c.p[0].$v[4]);
    if (c.d[0] & 1024) c.set(9, c.p[0].$v[10]);
    if (c.d[0] & 2) c.set(10, c.p[0].$v[1]);
    if (c.d[0] & 32) i7.set(c.p[0].$v[5] ? 0 : -1);
    if (c.d[0] & 256) c.set(11, c.p[0].$v[8]);
    if (c.d[0] & 512) c.set(12, c.p[0].$v[9]);
    if (c.d[0] & 2048) l15.set(c.p[0].$v[11]);
    if (c.d[0] & 4) c.set(13, c.p[0].$v[2]);
    if (c.d[0] & 64) c.set(14, c.p[0].$v[6]);
    if (c.d[0] & 1) c.set(15, c.p[0].$v[0]);
    if (c.d[0] & 32) c.set(17, c.p[0].$v[5]);
  };
  c.x = () => {
    i7.destroy();
    k10.destroy();
    l15.destroy();
  };
  return c;
}

export class Layout extends $.App {
  constructor($p0) { super(Layout$c, [LayoutModel.from($p0)], "79e99fac5e135437"); }
}
