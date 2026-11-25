import * as $ from "@weft-ui/runtime";

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
const $t0 = $.template("<div role=\"button\" tabindex=\"0\" class=\"w-column w-tap\"><div role=\"button\" tabindex=\"0\" class=\"w-row w-tap\" style=\"opacity:0.8;gap:8px\"><button type=\"button\" class=\"w-button\"><span class=\"w-text\">Button</span></button><span role=\"button\" tabindex=\"0\" class=\"w-text w-tap\" style=\"display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden\"><span class=\"w-span\" style=\"font-weight:600\">Tap me</span></span></div><div role=\"button\" tabindex=\"0\" class=\"w-stack w-tap\"><img role=\"button\" tabindex=\"0\" class=\"w-image w-in-stack w-tap\" style=\"width:48px;height:48px\"></div></div>");

export function Tap$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  const f = $t0();
  const n7 = f.firstChild;
  const n4 = n7.firstChild;
  const n1 = n4.firstChild;
  const n0 = n1.firstChild;
  const n3 = n1.nextSibling;
  const n2 = n3.firstChild;
  const n6 = n4.nextSibling;
  const n5 = n6.firstChild;
  $.style(n7, 16, c.p[0].$v[1]);
  $.onTap(n7, () => { c.app.$emit("Activated", { target: "column" }); });
  $.onTap(n4, () => { c.app.$emit("Activated", { target: "row" }); });
  n1.addEventListener("click", ($event) => { $event.stopPropagation(); c.app.$emit("Activated", { target: "button" }); });
  $.onTap(n3, () => { c.app.$emit("Activated", { target: "text" }); });
  $.onTap(n6, () => { c.app.$emit("Activated", { target: "stack" }); });
  $.onTap(n5, () => { c.app.$emit("Activated", { target: "image" }); });
  $.image(n5, c.p[0].$v[0]);
  c.init(f);
  c.u = () => {
    if (c.d[0] & 2) $.style(n7, 16, c.p[0].$v[1]);
    if (c.d[0] & 1) $.image(n5, c.p[0].$v[0]);
  };
  return c;
}

export class Tap extends $.App {
  constructor($p0) { super(Tap$c, [TapModel.from($p0)]); }
  onActivated(h) { return this.$on("Activated", h); }
}
