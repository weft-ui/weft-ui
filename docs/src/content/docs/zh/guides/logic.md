---
title: 逻辑与事件
description: 在 JavaScript 或 TypeScript 中处理 Weft UI 事件、更新模型，并控制输入组件显示的值。
sidebar:
  order: 3
---

`.weft` 视图读取应用模型来渲染。视图里的内联事件处理函数只能修改局部 `state`，不能给模型字段赋值。需要修改模型时，由视图发出事件，在 JavaScript 或 TypeScript 中处理。Weft UI 随后更新视图中读取了这些字段的部分。什么时候该用局部状态，见[视图指南](/zh/guides/views/)。

## 创建应用

下面的待办视图把输入框绑定到 `model.draft`，把每条待办的复选框绑定到该项的 `done` 字段。将视图保存为 `App.weft`：

```weft
model Todo {
    id: Int,
    name: String,
    done: Bool
}

model Model {
    clicked: Bool,
    draft: String,
    todos: Todo[]
}

event Click
event Draft(value: String)
event Add
event Toggle(id: Int)
event Mount
event Unmount

component App(model: Model) {
    Column(onMount = Mount, onUnmount = Unmount) {
        Button(onClick = Click) {
            Text(if (model.clicked) "You clicked!" else "Click me")
        }
        Input(model.draft, onChange = Draft)
        Button(onClick = Add, disabled = model.draft.trim().isEmpty) {
            Text("Add")
        }
        for (todo in model.todos; key = todo.id) {
            Row {
                Checkbox(todo.done, onChange = Toggle(todo.id))
                Text(todo.name)
            }
        }
    }
}
```

在 `index.ts` 中按名称导入组件，再把初始模型传给构造函数：

```ts
import { App } from "./App.weft";
import type { Model } from "./App.weft";
import { run, storage } from "@weft-ui/platform";

const initial: Model = { clicked: false, draft: "", todos: [] };
const app = new App(initial);
let nextId = 1;
```

TypeScript 从 `.weft` 声明中获得构造函数、模型和事件的类型。可以像上面这样导入 `Model` 类型，也可以直接传入对象字面量，由构造函数的参数类型检查。如何启用类型支持，见[工具指南](/zh/guides/tooling/)。构造函数会把普通数据转成响应式模型实例。修改数据时，用处理函数收到的模型（也可以通过 `app.model` 访问），不要改原来的 `initial` 对象。

## 处理事件并更新模型

组件或其子组件能发出的每个事件，都有对应的注册方法。方法名以 `on` 开头，接上首字母大写的事件名，例如 `Toggle` 对应 `app.onToggle`。方法名取决于事件声明，与绑定事件的元素属性名无关。处理函数的第一个参数是模型，第二个参数是以事件字段名为键的对象。`Toggle(id: Int)` 的载荷是 `{ id: number }`；没有字段的事件传入 `{}`，可以不接收这个参数。

```ts
app.onClick((model) => {
  model.clicked = true;
  void storage.set("clicked", "true");
});

app.onAdd((model) => {
  model.todos = [...model.todos, { id: nextId++, name: model.draft.trim(), done: false }];
  model.draft = "";
});

app.onToggle((model, { id }) => {
  const todo = model.todos.find((item) => item.id === id);
  if (todo) todo.done = !todo.done;
});
```

Weft UI 用生成的 setter 跟踪赋值，不使用代理（Proxy）。给列表项的 `todo.done` 赋值也会被跟踪。数组的类型是只读的，运行时也会冻结数组。增删条目时，给字段赋一个新数组，不要调用 `push` 或给数组下标赋值。数组里的模型对象仍可修改。

赋值立即改变模型，视图更新通常合并到一个微任务（microtask）中。视图层通过视图协议派发事件时，运行时会在答复视图层前同步处理待更新的内容。Weft UI 不会等待处理函数返回的 Promise，但 `await` 之后的赋值仍和同步赋值一样会被跟踪。

## 接受或拒绝输入

`Input.value` 和 `Checkbox.checked` 是受控属性。用户操作会提交一个新值，但控件最终显示什么，由绑定的表达式决定。`onChange = Draft` 直接绑定事件名，把输入框收到的字符串传给事件的唯一字段 `value`。`onChange = Toggle(todo.id)` 显式传参，忽略复选框提交的布尔值，只发送待办事项的 ID。上面的处理函数会反转该项的 `done` 值。

```ts
const MAX_LENGTH = 12;

app.onDraft((model, { value }) => {
  if (value.length <= MAX_LENGTH) model.draft = value;
});
```

输入过长时，处理函数不改 `model.draft`，输入框就会恢复为上一次绑定的值。复选框也遵循同样的规则。处理函数也可以写入另一个值，比如整理输入文本的格式；这时控件会显示改写后的值。要让本次更新接受或拒绝输入，请在任何 `await` 之前决定是否写入模型。处理函数的返回值即使是 `true` 或 `false`，也不能决定是否接受输入。

在 Web 上，一轮更新结束后，如果 DOM 中的值与绑定值不同，运行时会恢复绑定值。通过视图协议通信时，运行时在同步更新后比较用户提交的值和绑定值，并告诉视图层是否需要恢复。完整规则见[语法规范的事件参数](https://github.com/weft-ui/weft-ui/blob/master/crates/parser/GRAMMAR.zh-CN.md#事件参数)和[视图协议的事件规则](https://github.com/weft-ui/weft-ui/blob/master/protocol/SPEC.zh-CN.md#事件)。

## 响应挂载和卸载

在 `.weft` 中，`onMount` 和 `onUnmount` 要绑定具名事件，不能用内联处理函数。上面的 `Column` 在子树创建后发出 `Mount`，在子树移除后发出 `Unmount`。事件名是 `Mount` 和 `Unmount`，所以分别用 `app.onMount` 和 `app.onUnmount` 注册。运行时会在本轮视图更新结束后派发这些生命周期事件；处理函数修改模型时，会再安排一轮更新。

```ts
app.onMount(async (model) => {
  model.clicked = (await storage.get("clicked")) === "true";
});

app.onUnmount((model) => {
  model.draft = "";
});
```

读取存储可能在首次渲染之后才完成；这时给 `model.clicked` 赋值，仍会更新按钮。卸载时清空草稿，同一个应用实例再次挂载时就不会带入上次的输入。

## 启动应用

先注册处理函数，再调用 [`@weft-ui/platform`](/zh/guides/platform-api/) 的 `run(app)`，这样首次挂载时就能收到事件。

```ts
run(app);
```

在 Web 上，`run` 会挂载到 `id="app"` 的元素上。原生应用通过平台壳挂载；微信小程序会向宿主注册应用，由宿主在视图就绪时挂载。
