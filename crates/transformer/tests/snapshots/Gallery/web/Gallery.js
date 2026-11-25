import * as $ from "@weft-ui/runtime";

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
const $t0 = $.template("<div class=\"w-column\"><!----><button type=\"button\" class=\"w-button\"><span class=\"w-text\"></span></button></div>");
const $t1 = $.template("<div class=\"w-column\" style=\"width:320px;height:280px;padding-top:12px;padding-right:12px;padding-bottom:12px;padding-left:12px;background-color:#eeeeff;gap:8px\"><span class=\"w-text\" style=\"color:#224466;font-size:20px;font-weight:700\">Gallery</span><div class=\"w-row\"><input type=\"checkbox\" class=\"w-checkbox\"><img class=\"w-image\" style=\"width:32px;height:32px\"><span class=\"w-text\">Preview</span></div><input placeholder=\"Caption\" class=\"w-input\"><!----></div>");
const $t2 = $.template("<span class=\"w-text\"></span><!---->");
const $t3 = $.template("<!----><!---->");
const $t4 = $.template("<span class=\"w-text\"></span>");

export function Panel$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  c.s[0] = 0;
  c.sw[0] = $.watch($s0, c, c.s[0]);
  const f = $t0();
  const n3 = f.firstChild;
  const n0 = n3.firstChild;
  const n2 = n0.nextSibling;
  const n1 = n2.firstChild;
  const y0 = c.children[0]?.create() ?? null;
  if (y0) y0.mount(n0.parentNode, n0);
  n2.addEventListener("click", ($event) => { $event.stopPropagation(); c.state(0, c.s[0] + 1); });
  n1.textContent = ("Panel clicks: " + $.str(c.s[0]));
  c.init(f);
  c.u = () => {
    if (c.d[0] & 1) n1.textContent = ("Panel clicks: " + $.str(c.s[0]));
  };
  c.x = () => {
    if (y0) y0.destroy(false);
  };
  return c;
}

export class Panel extends $.App {
  constructor() { super(Panel$c, [undefined]); }
}

export function Gallery$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  c.pw[0] = $.watch($s1, c, args[0]);
  c.s[0] = "Weft";
  c.sw[0] = $.watch($s2, c, c.s[0]);
  const f = $t1();
  const n11 = f.firstChild;
  const n0 = n11.firstChild;
  const n4 = n0.nextSibling;
  const n1 = n4.firstChild;
  const n2 = n1.nextSibling;
  const n3 = n2.nextSibling;
  const n5 = n4.nextSibling;
  const n10 = n5.nextSibling;
  $.style(n4, 0, c.p[0].$v[0].$v[2]);
  $.style(n4, 1, c.p[0].$v[0].$v[3]);
  $.style(n4, 18, c.p[0].$v[0].$v[0]);
  $.style(n4, 25, c.p[0].$v[0].$v[4]);
  $.style(n4, 31, c.p[0].$v[0].$v[1]);
  $.checked(n1, c.p[0].$v[1]);
  $.checkbox(n1, ($a) => { c.app.$emit("Checked", { value: $a }); });
  $.image(n2, c.p[0].$v[2]);
  $.style(n3, 34, c.p[0].$v[0].$v[5]);
  $.style(n3, 35, c.p[0].$v[0].$v[6]);
  $.style(n3, 36, c.p[0].$v[0].$v[7]);
  $.value(n5, c.s[0]);
  $.input(n5, ($a) => { c.state(0, $a); });
  const s10 = new $.Slot(() => {
    const b = new $.Block();
    const f = $t2();
    const n6 = f.firstChild;
    const n9 = n6.nextSibling;
    n6.textContent = ("Caption: " + $.str(c.s[0]));
    const i9 = new $.Branches(n9, (i) => {
      switch (i) {
        case 0: {
          const b = new $.Block();
          const f = $t3();
          const n8 = f.firstChild.nextSibling;
          const l8 = new $.List(n8, (item) => {
            const r0 = new $.Row(1, c.depth + 1, $s0, item);
            const f = $t4();
            const n7 = f.firstChild;
            n7.textContent = r0.item;
            r0.init(f);
            r0.u = () => {
              if (r0.d[0] & 1) n7.textContent = r0.item;
            };
            return r0;
          }, ($it) => $it);
          l8.set(c.p[0].$v[3]);
          b.init(f);
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
    b.init(f);
    b.u = () => {
      if (c.d[0] & 2048) n6.textContent = ("Caption: " + $.str(c.s[0]));
      if (c.d[0] & 256) i9.set(c.p[0].$v[1] ? 0 : -1);
      if (c.d[0] & 1024) i9.update();
    };
    b.x = () => {
      i9.destroy();
    };
    return b;
  });
  const k10 = Panel$c(c.app, [undefined], [s10], c.depth + 1);
  k10.mount(n10.parentNode, n10);
  c.init(f);
  c.u = () => {
    if (c.d[0] & 4) $.style(n4, 0, c.p[0].$v[0].$v[2]);
    if (c.d[0] & 8) $.style(n4, 1, c.p[0].$v[0].$v[3]);
    if (c.d[0] & 1) $.style(n4, 18, c.p[0].$v[0].$v[0]);
    if (c.d[0] & 16) $.style(n4, 25, c.p[0].$v[0].$v[4]);
    if (c.d[0] & 2) $.style(n4, 31, c.p[0].$v[0].$v[1]);
    if (c.d[0] & 256) $.checked(n1, c.p[0].$v[1]);
    if (c.d[0] & 512) $.image(n2, c.p[0].$v[2]);
    if (c.d[0] & 32) $.style(n3, 34, c.p[0].$v[0].$v[5]);
    if (c.d[0] & 64) $.style(n3, 35, c.p[0].$v[0].$v[6]);
    if (c.d[0] & 128) $.style(n3, 36, c.p[0].$v[0].$v[7]);
    if (c.d[0] & 2048) $.value(n5, c.s[0]);
    if (c.d[0] & 3328) s10.update();
  };
  c.x = () => {
    k10.destroy(false);
  };
  return c;
}

export class Gallery extends $.App {
  constructor($p0) { super(Gallery$c, [GalleryModel.from($p0)]); }
  onChecked(h) { return this.$on("Checked", h); }
}
