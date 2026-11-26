import * as $ from "@weft-ui/runtime";

const $s0 = 0;
const $t0 = $.template("<header data-title=\"Home\" class=\"w-navbar\"></header><span class=\"w-text\">Home</span>");
const $t1 = $.template("<header class=\"w-navbar\"><button type=\"button\" role=\"button\" tabindex=\"0\" class=\"w-bar-button w-tap\">Action</button></header><span class=\"w-text\"></span>");

export function Home$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  const f = $t0();
  const n0 = f.firstChild;
  const n1 = n0.nextSibling;
  c.init(f);
  return c;
}

export class Home extends $.Page {
  static $route = { name: "Home", path: ["home"], params: [] };
  constructor($params = {}) {
    super(Home$c, [], {  });
  }
  get model() { return undefined; }
}

export function Detail$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  const f = $t1();
  const n1 = f.firstChild;
  const n0 = n1.firstChild;
  const n2 = n1.nextSibling;
  n1.setAttribute("data-title", ("Note " + $.str(c.p[0])));
  $.onTap(n0, () => { c.app.$emit("Action", {}); });
  n2.textContent = c.p[0];
  c.init(f);
  c.u = () => {
    if (c.d[0] & 1) n1.setAttribute("data-title", ("Note " + $.str(c.p[0])));
    if (c.d[0] & 1) n2.textContent = c.p[0];
  };
  return c;
}

export class Detail extends $.Page {
  static $route = { name: "Detail", path: ["detail"], params: [{ name: "id", type: "String", optional: false }] };
  constructor($params = {}) {
    const $p0 = $params["id"];
    super(Detail$c, [$p0], { ["id"]: $p0 });
  }
  get model() { return undefined; }
  onAction(h) { return this.$on("Action", (_, event) => h(undefined, event)); }
}
export class Notes extends $.Application { constructor(pages) { super(pages, { start: Home, pages: [Home, Detail] }, undefined); } }
