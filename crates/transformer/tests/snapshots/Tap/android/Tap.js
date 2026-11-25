import * as $ from "@weft-ui/runtime/remote";

export class TapModel extends $.Model {
  static from($v) { return $v instanceof TapModel ? $v : new TapModel($v); }
  constructor($v) { super([$v.image, $v.opacity]); }
  get image() { return this.$v[0]; }
  set image($v) { this.$set(0, $v); }
  get opacity() { return this.$v[1]; }
  set opacity($v) { this.$set(1, $v); }
  toJSON() { return { image: this.$v[0], opacity: this.$v[1] }; }
}

const $s0 = [0, 1];

export function Tap$c(app, args, children, depth) {
  const c = new $.Instance(app, 0, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  c.set(0, c.p[0].$v[1]);
  c.on(0, () => { c.app.$emit("Activated", { target: "column" }); }, -1);
  c.on(1, () => { c.app.$emit("Activated", { target: "row" }); }, -1);
  c.on(2, () => { c.app.$emit("Activated", { target: "button" }); }, -1);
  c.on(3, () => { c.app.$emit("Activated", { target: "text" }); }, -1);
  c.on(4, () => { c.app.$emit("Activated", { target: "stack" }); }, -1);
  c.set(1, c.p[0].$v[0]);
  c.on(5, () => { c.app.$emit("Activated", { target: "image" }); }, -1);
  c.u = () => {
    if (c.d[0] & 2) c.set(0, c.p[0].$v[1]);
    if (c.d[0] & 1) c.set(1, c.p[0].$v[0]);
  };
  return c;
}

export class Tap extends $.App {
  constructor($p0) { super(Tap$c, [TapModel.from($p0)], "e3346ca1afcb3b60"); }
  onActivated(h) { return this.$on("Activated", h); }
}
