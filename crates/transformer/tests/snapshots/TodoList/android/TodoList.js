import * as $ from "@weft-ui/runtime/remote";

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

export function TodoList$c(app, args, children, depth) {
  const c = new $.Instance(app, 0, 1, depth, args, children);
  c.pw[0] = $.watch($s0, c, args[0]);
  c.s[0] = false;
  c.sw[0] = $.watch($s1, c, c.s[0]);
  c.set(0, c.p[0].$v[1]);
  c.on(0, ($a) => { c.app.$emit("TextChanged", { value: $a }); }, 0);
  c.on(1, () => { c.state(0, (!c.s[0])); }, -1);
  c.set(1, (c.s[0] ? "collapse" : "expand"));
  const i8 = new $.Branches(c, 0, (i) => {
    switch (i) {
      case 0: {
        const b = new $.Block(c.app, 1);
        const l7 = new $.List(b, 0, (item) => {
          const r0 = new $.Row(c.app, 2, 1, c.depth + 1, $s0, item);
          r0.set(0, r0.item.$v[1]);
          r0.on(0, () => { c.app.$emit("Remove", { id: r0.item.$v[0] }); }, -1);
          r0.u = () => {
            if (r0.d[0] & 2) r0.set(0, r0.item.$v[1]);
          };
          return r0;
        }, ($it) => $it.$v[0]);
        l7.set(c.p[0].$v[0]);
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
  c.u = () => {
    if (c.d[0] & 2) c.set(0, c.p[0].$v[1]);
    if (c.d[0] & 4) c.set(1, (c.s[0] ? "collapse" : "expand"));
    if (c.d[0] & 4) i8.set(c.s[0] ? 0 : -1);
    if (c.d[0] & 1) i8.update();
  };
  c.x = () => {
    i8.destroy();
  };
  return c;
}

export class TodoList extends $.App {
  constructor($p0) { super(TodoList$c, [TodoListModel.from($p0)], "6cf685a4e57f05dd"); }
  onTextChanged(h) { return this.$on("TextChanged", h); }
  onRemove(h) { return this.$on("Remove", h); }
}
