import * as $ from "@weft-ui/runtime/remote";

const $s0 = 0;

export function Home$c(app, args, children, depth) {
  const c = new $.Instance(app, 0, 1, depth, args, children);
  return c;
}

export class Home extends $.Page {
  static $route = { name: "Home", path: ["home"], params: [] };
  constructor($params = {}) {
    super(Home$c, [], "12b91656a08a2389", {  });
  }
  get model() { return undefined; }
}

export function Settings$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, 1, depth, args, children);
  return c;
}

export class Settings extends $.Page {
  static $route = { name: "Settings", path: ["settings"], params: [] };
  constructor($params = {}) {
    super(Settings$c, [], "12b91656a08a2389", {  });
  }
  get model() { return undefined; }
}

export function Detail$c(app, args, children, depth) {
  const c = new $.Instance(app, 2, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  c.set(0, ("Note " + $.str(c.p[0])));
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
    super(Detail$c, [$p0], "12b91656a08a2389", { ["id"]: $p0 });
  }
  get model() { return undefined; }
  onAction(h) { return this.$on("Action", (_, event) => h(undefined, event)); }
}
export class Notes extends $.Application { constructor(pages) { super(pages, { tabs: [{ page: Home, title: "Home", icon: "asset:tab_home", activeIcon: "asset:tab_home" }, { page: Settings, title: "Settings", icon: "asset:tab_settings", activeIcon: "asset:tab_settings" }], pages: [Home, Settings, Detail] }, "12b91656a08a2389"); } }
