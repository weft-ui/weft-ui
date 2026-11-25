import * as $ from "@weft-ui/runtime/remote";

export class GalleryStyle extends $.Model {
  static from($v) { return $v instanceof GalleryStyle ? $v : new GalleryStyle($v); }
  constructor($v) { super([$v.padding, $v.gap, $v.width, $v.height, $v.background, $v.color, $v.size, $v.weight]); }
  get padding() { return this.$v[0]; }
  set padding($v) { this.$set(0, $v); }
  get gap() { return this.$v[1]; }
  set gap($v) { this.$set(1, $v); }
  get width() { return this.$v[2]; }
  set width($v) { this.$set(2, $v); }
  get height() { return this.$v[3]; }
  set height($v) { this.$set(3, $v); }
  get background() { return this.$v[4]; }
  set background($v) { this.$set(4, $v); }
  get color() { return this.$v[5]; }
  set color($v) { this.$set(5, $v); }
  get size() { return this.$v[6]; }
  set size($v) { this.$set(6, $v); }
  get weight() { return this.$v[7]; }
  set weight($v) { this.$set(7, $v); }
  toJSON() { return { padding: this.$v[0], gap: this.$v[1], width: this.$v[2], height: this.$v[3], background: this.$v[4], color: this.$v[5], size: this.$v[6], weight: this.$v[7] }; }
}

export class GalleryModel extends $.Model {
  static $m = [0];
  static from($v) { return $v instanceof GalleryModel ? $v : new GalleryModel($v); }
  constructor($v) { super([GalleryStyle.from($v.style), $v.checked, $v.imageUrl, $c0($v.labels)]); }
  get style() { return this.$v[0]; }
  set style($v) { if ($v !== this.$v[0]) this.$set(0, GalleryStyle.from($v)); }
  get checked() { return this.$v[1]; }
  set checked($v) { this.$set(1, $v); }
  get imageUrl() { return this.$v[2]; }
  set imageUrl($v) { this.$set(2, $v); }
  get labels() { return this.$v[3]; }
  set labels($v) { if ($v !== this.$v[3]) this.$set(3, $c0($v)); }
  toJSON() { return { style: this.$v[0], checked: this.$v[1], imageUrl: this.$v[2], labels: this.$v[3] }; }
}

const $c0 = $.arrayOf($.id);
const $s0 = 0;
const $s1 = [[0, 1, 2, 3, 4, 5, 6, 7], 8, 9, 10];
const $s2 = 11;

export function Panel$c(app, args, children, depth) {
  const c = new $.Instance(app, 0, 1, depth, args, children);
  c.s[0] = 0;
  c.sw[0] = $.watch($s0, c, c.s[0]);
  const y0 = c.children[0]?.create() ?? null;
  if (y0) c.attach(0, y0);
  c.on(0, () => { c.state(0, c.s[0] + 1); }, -1);
  c.set(0, ("Panel clicks: " + $.str(c.s[0])));
  c.u = () => {
    if (c.d[0] & 1) c.set(0, ("Panel clicks: " + $.str(c.s[0])));
  };
  c.x = () => {
    if (y0) y0.destroy();
  };
  return c;
}

export class Panel extends $.App {
  constructor() { super(Panel$c, [undefined], "fbf37220d9389a7d"); }
}

export function Gallery$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, 1, depth, args, children);
  c.pw[0] = $.watch($s1, c, args[0]);
  c.s[0] = "Weft";
  c.sw[0] = $.watch($s2, c, c.s[0]);
  c.set(0, c.p[0].$v[0].$v[2]);
  c.set(1, c.p[0].$v[0].$v[3]);
  c.set(2, c.p[0].$v[0].$v[0]);
  c.set(3, c.p[0].$v[0].$v[4]);
  c.set(4, c.p[0].$v[0].$v[1]);
  c.set(5, c.p[0].$v[1]);
  c.on(0, ($a) => { c.app.$emit("Checked", { value: $a }); }, 5);
  c.set(6, c.p[0].$v[2]);
  c.set(7, c.p[0].$v[0].$v[5]);
  c.set(8, c.p[0].$v[0].$v[6]);
  c.set(9, c.p[0].$v[0].$v[7]);
  c.set(10, c.s[0]);
  c.on(1, ($a) => { c.state(0, $a); }, 10);
  const s10 = new $.Slot(() => {
    const b = new $.Block(c.app, 2);
    b.set(0, ("Caption: " + $.str(c.s[0])));
    const i9 = new $.Branches(b, 0, (i) => {
      switch (i) {
        case 0: {
          const b = new $.Block(c.app, 3);
          const l8 = new $.List(b, 0, (item) => {
            const r0 = new $.Row(c.app, 4, 1, c.depth + 1, $s0, item);
            r0.set(0, r0.item);
            r0.u = () => {
              if (r0.d[0] & 1) r0.set(0, r0.item);
            };
            return r0;
          }, ($it) => $it);
          l8.set(c.p[0].$v[3]);
          b.u = () => {
            if (c.d[0] & 1024) l8.set(c.p[0].$v[3]);
          };
          b.x = () => {
            l8.destroy();
          };
          return b;
        }
        default:
          return null;
      }
    });
    i9.set(c.p[0].$v[1] ? 0 : -1);
    b.u = () => {
      if (c.d[0] & 2048) b.set(0, ("Caption: " + $.str(c.s[0])));
      if (c.d[0] & 256) i9.set(c.p[0].$v[1] ? 0 : -1);
      if (c.d[0] & 1024) i9.update();
    };
    b.x = () => {
      i9.destroy();
    };
    return b;
  });
  const k10 = Panel$c(c.app, [undefined], [s10], c.depth + 1);
  c.attach(0, k10);
  c.u = () => {
    if (c.d[0] & 4) c.set(0, c.p[0].$v[0].$v[2]);
    if (c.d[0] & 8) c.set(1, c.p[0].$v[0].$v[3]);
    if (c.d[0] & 1) c.set(2, c.p[0].$v[0].$v[0]);
    if (c.d[0] & 16) c.set(3, c.p[0].$v[0].$v[4]);
    if (c.d[0] & 2) c.set(4, c.p[0].$v[0].$v[1]);
    if (c.d[0] & 256) c.set(5, c.p[0].$v[1]);
    if (c.d[0] & 512) c.set(6, c.p[0].$v[2]);
    if (c.d[0] & 32) c.set(7, c.p[0].$v[0].$v[5]);
    if (c.d[0] & 64) c.set(8, c.p[0].$v[0].$v[6]);
    if (c.d[0] & 128) c.set(9, c.p[0].$v[0].$v[7]);
    if (c.d[0] & 2048) c.set(10, c.s[0]);
    if (c.d[0] & 3328) s10.update();
  };
  c.x = () => {
    k10.destroy();
  };
  return c;
}

export class Gallery extends $.App {
  constructor($p0) { super(Gallery$c, [GalleryModel.from($p0)], "fbf37220d9389a7d"); }
  onChecked(h) { return this.$on("Checked", h); }
}
