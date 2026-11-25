import * as $ from "@weft-ui/runtime";

export class Todo extends $.Model {
  static from($v) { return $v instanceof Todo ? $v : new Todo($v); }
  constructor($v) { super([$v.id, $v.name]); }
  get id() { return this.$v[0]; }
  set id($v) { this.$set(0, $v); }
  get name() { return this.$v[1]; }
  set name($v) { this.$set(1, $v); }
  toJSON() { return { id: this.$v[0], name: this.$v[1] }; }
}

export class TodoListModel extends $.Model {
  static from($v) { return $v instanceof TodoListModel ? $v : new TodoListModel($v); }
  constructor($v) { super([$c0($v.todos), $v.draft]); }
  get todos() { return this.$v[0]; }
  set todos($v) { if ($v !== this.$v[0]) this.$set(0, $c0($v)); }
  get draft() { return this.$v[1]; }
  set draft($v) { this.$set(1, $v); }
  toJSON() { return { todos: this.$v[0], draft: this.$v[1] }; }
}

const $c0 = $.arrayOf(Todo.from);
const $s0 = [0, 1];
const $s1 = 2;
const $t0 = $.template("<div class=\"w-column\"><input class=\"w-input\"><button type=\"button\" class=\"w-button\"><span class=\"w-text\"></span></button><!----></div>");
const $t1 = $.template("<!----><!---->");
const $t2 = $.template("<div class=\"w-row\"><span class=\"w-text\"></span><button type=\"button\" class=\"w-button\"><span class=\"w-text\">x</span></button></div>");

export function TodoList$c(app, args, children, depth) {
  const c = new $.Instance(app, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  c.s[0] = false;
  c.sw[0] = $.watch($s1, c, c.s[0]);
  const f = $t0();
  const n9 = f.firstChild;
  const n0 = n9.firstChild;
  const n2 = n0.nextSibling;
  const n1 = n2.firstChild;
  const n8 = n2.nextSibling;
  $.value(n0, c.p[0].$v[1]);
  $.input(n0, ($a) => { c.app.$emit("TextChanged", { value: $a }); });
  n2.addEventListener("click", ($event) => { $event.stopPropagation(); c.state(0, (!c.s[0])); });
  n1.textContent = (c.s[0] ? "collapse" : "expand");
  const i8 = new $.Branches(n8, (i) => {
    switch (i) {
      case 0: {
        const b = new $.Block();
        const f = $t1();
        const n7 = f.firstChild.nextSibling;
        const l7 = new $.List(n7, (item) => {
          const r0 = new $.Row(1, c.depth + 1, $s0, item);
          const f = $t2();
          const n6 = f.firstChild;
          const n3 = n6.firstChild;
          const n5 = n3.nextSibling;
          const n4 = n5.firstChild;
          n3.textContent = r0.item.$v[1];
          n5.addEventListener("click", ($event) => { $event.stopPropagation(); c.app.$emit("Remove", { id: r0.item.$v[0] }); });
          r0.init(f);
          r0.u = () => {
            if (r0.d[0] & 2) n3.textContent = r0.item.$v[1];
          };
          return r0;
        }, ($it) => $it.$v[0]);
        l7.set(c.p[0].$v[0]);
        b.init(f);
        b.u = () => {
          if (c.d[0] & 1) l7.set(c.p[0].$v[0]);
        };
        b.x = () => {
          l7.destroy();
        };
        return b;
      }
      default:
        return null;
    }
  });
  i8.set(c.s[0] ? 0 : -1);
  c.init(f);
  c.u = () => {
    if (c.d[0] & 2) $.value(n0, c.p[0].$v[1]);
    if (c.d[0] & 4) n1.textContent = (c.s[0] ? "collapse" : "expand");
    if (c.d[0] & 4) i8.set(c.s[0] ? 0 : -1);
    if (c.d[0] & 1) i8.update();
  };
  c.x = () => {
    i8.destroy();
  };
  return c;
}

export class TodoList extends $.App {
  constructor($p0) { super(TodoList$c, [TodoListModel.from($p0)]); }
  onTextChanged(h) { return this.$on("TextChanged", h); }
  onRemove(h) { return this.$on("Remove", h); }
}
