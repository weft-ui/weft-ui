import * as $ from "@weft-ui/runtime/remote";

const $s0 = 0;

export function Home$c(app, args, children, depth) {
  const c = new $.Instance(app, 0, 1, depth, args, children);
  return c;
}

export class Home extends $.Page {
  static $route = { name: "Home", path: ["home"], params: [] };
  constructor($params = {}) {
    super(Home$c, [], "0cb287c33f80ecd6", {  });
  }
  get model() { return undefined; }
}

export function Detail$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  c.set(0, ("Note " + $.str(c.p[0])));
  c.on(0, () => { c.app.$emit("Action", {}); }, -1);
  c.set(1, c.p[0]);
  c.u = () => {
    if (c.d[0] & 1) c.set(0, ("Note " + $.str(c.p[0])));
    if (c.d[0] & 1) c.set(1, c.p[0]);
  };
  return c;
}

export class Detail extends $.Page {
  static $route = { name: "Detail", path: ["detail"], params: [{ name: "id", type: "String", optional: false }] };
  constructor($params = {}) {
    const $p0 = $params["id"];
    super(Detail$c, [$p0], "0cb287c33f80ecd6", { ["id"]: $p0 });
  }
  get model() { return undefined; }
  onAction(h) { return this.$on("Action", (_, event) => h(undefined, event)); }
}
export class Notes extends $.Application { constructor(pages) { super(pages, { start: Home, pages: [Home, Detail] }, "0cb287c33f80ecd6"); } }
