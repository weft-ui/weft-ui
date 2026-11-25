import * as $ from "@weft-ui/runtime";

export class LanguageItem extends $.Model {
  static from($v) { return $v instanceof LanguageItem ? $v : new LanguageItem($v); }
  constructor($v) { super([$v.id, $v.kind, $v.name]); }
  get id() { return this.$v[0]; }
  set id($v) { this.$set(0, $v); }
  get kind() { return this.$v[1]; }
  set kind($v) { this.$set(1, $v); }
  get name() { return this.$v[2]; }
  set name($v) { this.$set(2, $v); }
  toJSON() { return { id: this.$v[0], kind: this.$v[1], name: this.$v[2] }; }
}

export class LanguageModel extends $.Model {
  static from($v) { return $v instanceof LanguageModel ? $v : new LanguageModel($v); }
  constructor($v) { super([$v.name, $c0($v.items), $v.mode, $v.rating, $v.title, $v.body, $v.footer]); }
  get name() { return this.$v[0]; }
  set name($v) { this.$set(0, $v); }
  get items() { return this.$v[1]; }
  set items($v) { if ($v !== this.$v[1]) this.$set(1, $c0($v)); }
  get mode() { return this.$v[2]; }
  set mode($v) { this.$set(2, $v); }
  get rating() { return this.$v[3]; }
  set rating($v) { this.$set(3, $v); }
  get title() { return this.$v[4]; }
  set title($v) { this.$set(4, $v); }
  get body() { return this.$v[5]; }
  set body($v) { this.$set(5, $v); }
  get footer() { return this.$v[6]; }
  set footer($v) { this.$set(6, $v); }
  toJSON() { return { name: this.$v[0], items: this.$v[1], mode: this.$v[2], rating: this.$v[3], title: this.$v[4], body: this.$v[5], footer: this.$v[6] }; }
}

const $c0 = $.arrayOf(LanguageItem.from);
const $s0 = 0;
const $s1 = [0, 1, 2, 3, 4, 5, 6];
const $s2 = 7;
const $s3 = [0, 1, 2];
const $t0 = $.template("<span class=\"w-text\"></span>");
const $t1 = $.template("<div class=\"w-row\"><span class=\"w-text\"></span><button type=\"button\" class=\"w-button\"><span class=\"w-text\">1</span></button><button type=\"button\" class=\"w-button\"><span class=\"w-text\">2</span></button><button type=\"button\" class=\"w-button\"><span class=\"w-text\">Repeat</span></button></div>");
const $t2 = $.template("<!----><!---->");
const $t3 = $.template("<div class=\"w-column\"><!----><!----><!----></div>");
const $t4 = $.template("<div class=\"w-column\"><span class=\"w-text\"></span><!----><!----><!----><!----><!----><!----><!----><!----><span class=\"w-text\" style=\"color:#6b7280;font-size:14px\">note</span></div>");
const $t5 = $.template("<!---->");
const $t6 = $.template("<span class=\"w-text\">Footer only</span>");
const $t7 = $.template("<span class=\"w-text\"></span><!---->");
const $t8 = $.template("<span class=\"w-text\">image</span>");
const $t9 = $.template("<span class=\"w-text\">text</span>");

export function ModeLabel$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  const f = $t0();
  const n0 = f.firstChild;
  n0.textContent = ((c.p[0] === "compact") ? "C" : "F");
  c.init(f);
  c.u = () => {
    if (c.d[0] & 1) n0.textContent = ((c.p[0] === "compact") ? "C" : "F");
  };
  return c;
}

export class ModeLabel extends $.App {
  constructor($p0 = "full") { super(ModeLabel$c, [$p0]); }
}

export function Rating$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  const f = $t1();
  const n7 = f.firstChild;
  const n0 = n7.firstChild;
  const n2 = n0.nextSibling;
  const n1 = n2.firstChild;
  const n4 = n2.nextSibling;
  const n3 = n4.firstChild;
  const n6 = n4.nextSibling;
  const n5 = n6.firstChild;
  n0.textContent = ("Rating: " + $.str(c.p[0]));
  const $h2_onClick = 1;
  n2.addEventListener("click", ($event) => { $event.stopPropagation(); c.p[1]?.($h2_onClick); });
  n4.addEventListener("click", ($event) => { $event.stopPropagation(); c.p[1]?.(2); });
  let $h6_onClick = c.p[0];
  n6.addEventListener("click", ($event) => { $event.stopPropagation(); c.p[1]?.($h6_onClick); });
  c.init(f);
  c.u = () => {
    if (c.d[0] & 1) n0.textContent = ("Rating: " + $.str(c.p[0]));
    if (c.d[0] & 1) $h6_onClick = c.p[0];
  };
  return c;
}

export class Rating extends $.App {
  constructor($p0) { super(Rating$c, [$p0, null]); }
}

export function ForwardRating$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  const f = $t2();
  const n0 = f.firstChild.nextSibling;
  const k0 = Rating$c(c.app, [0, ($a) => { c.p[0]?.($a); }], [], c.depth + 1);
  k0.mount(n0.parentNode, n0);
  c.init(f);
  c.x = () => {
    k0.destroy(false);
  };
  return c;
}

export class ForwardRating extends $.App {
  constructor() { super(ForwardRating$c, [null]); }
  get model() { return undefined; }
}

export function Card$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  const f = $t3();
  const n3 = f.firstChild;
  const n0 = n3.firstChild;
  const n1 = n0.nextSibling;
  const n2 = n1.nextSibling;
  const y0 = c.children[1]?.create() ?? null;
  if (y0) y0.mount(n0.parentNode, n0);
  const y1 = c.children[0]?.create() ?? null;
  if (y1) y1.mount(n1.parentNode, n1);
  const y2 = c.children[2]?.create() ?? null;
  if (y2) y2.mount(n2.parentNode, n2);
  c.init(f);
  c.x = () => {
    if (y0) y0.destroy(false);
    if (y1) y1.destroy(false);
    if (y2) y2.destroy(false);
  };
  return c;
}

export class Card extends $.App {
  constructor() { super(Card$c, [undefined, undefined, undefined]); }
}

export function Language$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  c.pw[0] = $.watch($s1, c, args[0]);
  c.s[0] = 0;
  c.sw[0] = $.watch($s2, c, c.s[0]);
  const f = $t4();
  const n18 = f.firstChild;
  const n0 = n18.firstChild;
  const n1 = n0.nextSibling;
  const n2 = n1.nextSibling;
  const n3 = n2.nextSibling;
  const n4 = n3.nextSibling;
  const n5 = n4.nextSibling;
  const n9 = n5.nextSibling;
  const n11 = n9.nextSibling;
  const n16 = n11.nextSibling;
  const n17 = n16.nextSibling;
  n0.textContent = ($.str(c.p[0].$v[0]) + " (" + $.str(c.p[0].$v[1].length) + ")");
  const k1 = ModeLabel$c(c.app, [c.p[0].$v[2]], [], c.depth + 1);
  k1.mount(n1.parentNode, n1);
  const k2 = Rating$c(c.app, [c.p[0].$v[3], ($a) => { c.app.$emit("Rated", { value: $a }); }], [], c.depth + 1);
  k2.mount(n2.parentNode, n2);
  const k3 = Rating$c(c.app, [c.s[0], ($a) => { c.state(0, $a); c.app.$emit("Rated", { value: c.s[0] }); }], [], c.depth + 1);
  k3.mount(n3.parentNode, n3);
  const k4 = ForwardRating$c(c.app, [(($b0) => { c.app.$emit("Rated", { value: $b0 }); }).bind(null, c.p[0].$v[3])], [], c.depth + 1);
  k4.mount(n4.parentNode, n4);
  const k5 = Rating$c(c.app, [0, null], [], c.depth + 1);
  k5.mount(n5.parentNode, n5);
  const s9 = new $.Slot(() => {
    const b = new $.Block();
    const f = $t0();
    const n6 = f.firstChild;
    n6.textContent = c.p[0].$v[5];
    b.init(f);
    b.u = () => {
      if (c.d[0] & 32) n6.textContent = c.p[0].$v[5];
    };
    return b;
  });
  const s9_1 = new $.Slot(() => {
    const b = new $.Block();
    const f = $t0();
    const n7 = f.firstChild;
    n7.textContent = c.p[0].$v[4];
    b.init(f);
    b.u = () => {
      if (c.d[0] & 16) n7.textContent = c.p[0].$v[4];
    };
    return b;
  });
  const s9_2 = new $.Slot(() => {
    const b = new $.Block();
    const f = $t0();
    const n8 = f.firstChild;
    n8.textContent = c.p[0].$v[6];
    b.init(f);
    b.u = () => {
      if (c.d[0] & 64) n8.textContent = c.p[0].$v[6];
    };
    return b;
  });
  const k9 = Card$c(c.app, [undefined, undefined, undefined], [s9, s9_1, s9_2], c.depth + 1);
  k9.mount(n9.parentNode, n9);
  const s11_1 = new $.Slot(() => {
    const b = new $.Block();
    const f = $t5();
    b.init(f);
    return b;
  });
  const s11_2 = new $.Slot(() => {
    const b = new $.Block();
    const f = $t6();
    const n10 = f.firstChild;
    b.init(f);
    return b;
  });
  const k11 = Card$c(c.app, [undefined, undefined, undefined], [null, s11_1, s11_2], c.depth + 1);
  k11.mount(n11.parentNode, n11);
  const l16 = new $.List(n16, (item) => {
    const r0 = new $.Row(1, c.depth + 1, $s3, item);
    const f = $t7();
    const n12 = f.firstChild;
    const n15 = n12.nextSibling;
    n12.textContent = r0.item.$v[2].toUpperCase();
    const i15 = new $.Branches(n15, (i) => {
      switch (i) {
        case 0: {
          const b = new $.Block();
          const f = $t8();
          const n13 = f.firstChild;
          b.init(f);
          return b;
        }
        case 1: {
          const b = new $.Block();
          const f = $t9();
          const n14 = f.firstChild;
          b.init(f);
          return b;
        }
        default:
          return null;
      }
    });
    i15.set((r0.item.$v[1] === "image") ? 0 : 1);
    r0.init(f);
    r0.u = () => {
      if (r0.d[0] & 4) n12.textContent = r0.item.$v[2].toUpperCase();
      if (r0.d[0] & 2) i15.set((r0.item.$v[1] === "image") ? 0 : 1);
    };
    r0.x = () => {
      i15.destroy();
    };
    return r0;
  }, ($it) => $it.$v[0]);
  l16.set(c.p[0].$v[1]);
  c.init(f);
  c.u = () => {
    if (c.d[0] & 3) n0.textContent = ($.str(c.p[0].$v[0]) + " (" + $.str(c.p[0].$v[1].length) + ")");
    if (c.d[0] & 4) k1.arg(0, c.p[0].$v[2]);
    if (c.d[0] & 8) k2.arg(0, c.p[0].$v[3]);
    if (c.d[0] & 128) k3.arg(0, c.s[0]);
    if (c.d[0] & 8) k4.arg(0, (($b0) => { c.app.$emit("Rated", { value: $b0 }); }).bind(null, c.p[0].$v[3]));
    if (c.d[0] & 32) s9.update();
    if (c.d[0] & 16) s9_1.update();
    if (c.d[0] & 64) s9_2.update();
    if (c.d[0] & 2) l16.set(c.p[0].$v[1]);
  };
  c.x = () => {
    k1.destroy(false);
    k2.destroy(false);
    k3.destroy(false);
    k4.destroy(false);
    k5.destroy(false);
    k9.destroy(false);
    k11.destroy(false);
    l16.destroy();
  };
  return c;
}

export class Language extends $.App {
  constructor($p0) { super(Language$c, [LanguageModel.from($p0)]); }
  onRated(h) { return this.$on("Rated", h); }
}
