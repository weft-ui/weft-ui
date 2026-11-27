import * as $ from "@weft-ui/runtime";

export class Item extends $.Model {
  static from($v) { return $v instanceof Item ? $v : new Item($v); }
  constructor($v) { super([$v.id, $v.title]); }
  get id() { return this.$v[0]; }
  set id($v) { this.$set(0, $v); }
  get title() { return this.$v[1]; }
  set title($v) { this.$set(1, $v); }
  toJSON() { return { id: this.$v[0], title: this.$v[1] }; }
}

export class ListsModel extends $.Model {
  static from($v) { return $v instanceof ListsModel ? $v : new ListsModel($v); }
  constructor($v) { super([$c0($v.items)]); }
  get items() { return this.$v[0]; }
  set items($v) { if ($v !== this.$v[0]) this.$set(0, $c0($v)); }
  toJSON() { return { items: this.$v[0] }; }
}

const $c0 = $.arrayOf(Item.from);
const $s0 = [0];
const $s1 = [0, 1];
const $t0 = $.template("<div class=\"w-column\"><div class=\"w-list w-scroll-v w-fill w-grow\" style=\"gap:8px\"><span class=\"w-text w-in-scroll\">Header</span><!----><span class=\"w-text w-in-scroll\">Footer</span></div><div class=\"w-grid w-scroll-v w-fill w-grow\" style=\"gap:4px\"><!----></div></div>");
const $t1 = $.template("<span class=\"w-text\"></span>");

export function Lists$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  const f = $t0();
  const n8 = f.firstChild;
  const n4 = n8.firstChild;
  const n0 = n4.firstChild;
  const n2 = n0.nextSibling;
  const n3 = n2.nextSibling;
  const n7 = n4.nextSibling;
  const n6 = n7.firstChild;
  const l2 = new $.LazyList(n2, (item) => {
    const r0 = new $.Row(1, c.depth + 1, $s1, item);
    const f = $t1();
    const n1 = f.firstChild;
    n1.textContent = r0.item.$v[1];
    r0.init(f);
    r0.u = () => {
      if (r0.d[0] & 2) n1.textContent = r0.item.$v[1];
    };
    return r0;
  }, ($it) => $it.$v[0]);
  l2.set(c.p[0].$v[0]);
  const l6 = new $.LazyList(n6, (item) => {
    const r1 = new $.Row(1, c.depth + 1, $s1, item);
    const f = $t1();
    const n5 = f.firstChild;
    n5.textContent = r1.item.$v[1];
    r1.init(f);
    r1.u = () => {
      if (r1.d[0] & 2) n5.textContent = r1.item.$v[1];
    };
    return r1;
  }, ($it) => $it.$v[0], 3);
  l6.set(c.p[0].$v[0]);
  c.init(f);
  c.u = () => {
    if (c.d[0] & 1) l2.set(c.p[0].$v[0]);
    if (c.d[0] & 1) l6.set(c.p[0].$v[0]);
  };
  c.x = () => {
    l2.destroy();
    l6.destroy();
  };
  return c;
}

export class Lists extends $.App {
  constructor($p0) { super(Lists$c, [ListsModel.from($p0)]); }
}
