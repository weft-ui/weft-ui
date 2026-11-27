import * as $ from "@weft-ui/runtime/remote";

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

export function Lists$c(app, args, children, depth) {
  const c = new $.Instance(app, 0, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  const l2 = new $.LazyList(c, 0, (item) => {
    const r0 = new $.Row(c.app, 1, 1, c.depth + 1, $s1, item);
    r0.set(0, r0.item.$v[1]);
    r0.u = () => {
      if (r0.d[0] & 2) r0.set(0, r0.item.$v[1]);
    };
    return r0;
  }, ($it) => $it.$v[0]);
  l2.set(c.p[0].$v[0]);
  const l6 = new $.LazyList(c, 1, (item) => {
    const r1 = new $.Row(c.app, 2, 1, c.depth + 1, $s1, item);
    r1.set(0, r1.item.$v[1]);
    r1.u = () => {
      if (r1.d[0] & 2) r1.set(0, r1.item.$v[1]);
    };
    return r1;
  }, ($it) => $it.$v[0]);
  l6.set(c.p[0].$v[0]);
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
  constructor($p0) { super(Lists$c, [ListsModel.from($p0)], "c3693e913dbb329f"); }
}
