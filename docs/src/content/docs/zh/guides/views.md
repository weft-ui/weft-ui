---
title: 编写 Weft UI 视图
description: 用类型化参数、布局、带键列表、局部状态和可复用组件编写 .weft 视图。
sidebar:
  order: 2
---

`.weft` 文件描述要渲染的内容和要发出的事件。视图通过类型明确的参数接收逻辑层的数据，用局部 `state` 保存只属于当前视图的状态。完整的 `.weft` 视图例子见[示例页面](https://github.com/weft-ui/weft-ui/tree/master/example/src/pages)。

## 声明模型、事件和组件

如果要导入其他文件，把 `import "./File.weft"` 写在文件开头。接下来，用 `model` 描述数据结构，用 `event` 声明逻辑层可以处理的消息，用 `component` 定义可渲染的视图。组件体里的节点之间不需要分隔符。

把下面的待办行组件保存为 `Todo.weft`：

```weft
model Todo {
  id: Int,
  name: String,
  done: Bool,
}

event Toggle(id: Int)
event Remove(id: Int)

component TodoRow(todo: Todo, showRemove: Bool = true) {
  Row(gap = 8) {
    Checkbox(todo.done, onChange = Toggle(todo.id))
    Text(todo.name)
    if (showRemove) {
      Button(onClick = Remove(todo.id)) {
        Text("Remove")
      }
    }
  }
}
```

`Int`、`Float`、`Bool` 和 `String` 是基础类型。`Todo` 这样的模型名也可以用作类型，用 `todo.name` 这样的写法读取字段。`Todo[]` 是待办事项数组；`Todo?` 可以是一个待办事项，也可以是 `null`。需要 `Float` 的地方可以传 `Int`；需要 `T?` 的地方可以传 `T` 或 `null`。

用组件名实例化组件。位置参数按声明顺序传入，命名参数写在位置参数之后。`TodoRow(todo)` 会让 `showRemove` 采用默认值 `true`，而 `TodoRow(todo, showRemove = false)` 会覆盖默认值。没有默认值的普通参数都必须传入，即使它的类型可空。

## 排列元素

`Column` 将子节点纵向排列，`Row` 将子节点横向排列。排列方向是主轴，垂直于主轴的方向是交叉轴。用 `justify` 分配主轴上的剩余空间，用 `align` 设置交叉轴对齐方式，两者默认为 `"start"`。`gap` 在相邻子节点之间留出间距，子节点的 `margin` 另计。

给子节点设置 `grow = 1`，可让它分得一份主轴剩余空间；设置 `fill = true`，则可让它撑满交叉轴。`Spacer()` 和 `grow = 1` 一样分配剩余空间，`Spacer(size = 8)` 则留出固定的空隙。`Spacer` 只能直接放在 `Column`、`Row` 或 `Scroll` 中。

```weft
Column(width = 240, padding = 12, gap = 8) {
  Row(fill = true, align = "center") {
    Text("待办事项", size = 20, weight = "bold")
    Spacer()
    Text("3 项未完成")
  }
  Scroll(height = 64, grow = 0, gap = 8) {
    Text("取钥匙")
    Text("发送图纸")
    Text("打包样品")
  }
}
```

`width` 和 `height` 设置内容盒的尺寸，`padding` 在内容盒周围留出内边距，`margin` 在元素外留出外边距。`paddingTop` 等单边属性优先于 `paddingY` 和 `padding`。用 `minWidth`、`maxWidth`、`minHeight` 和 `maxHeight` 限制尺寸范围。`aspectRatio` 根据一个方向的尺寸推导另一个方向的尺寸；宽高都固定时不生效。

用 `Stack` 叠放子节点，后写的显示在上层，`alignment` 决定它们的位置。带 `fill = true` 的子节点在两个方向上撑满容器，但不影响 `Stack` 的自然尺寸。根节点不滚动；需要滚动时使用 `Scroll`。它默认纵向滚动，设 `direction = "horizontal"` 可改为横向。

布局功能在所有目标平台上都可用。各元素及属性的平台支持情况见[内置元素参考](/zh/reference/elements/)。

`Text`、`Input`、`Checkbox` 和 `Image` 的值都可以作为第一个位置参数。长度（包括字号 `size`）用逻辑像素计量，直接写 `Int`，不加单位后缀。它对应 iOS 和 macOS 的 pt、Android 的 dp、Windows 的 DIP、Web 的 CSS px，以及小程序的 `px`（不是 `rpx`）。布局功能的语义在支持它的平台上一致，控件外观可能不同。

`Text.color`、`Row.background` 等颜色属性接收 `#RGB`、`#RRGGBB` 或 `#RRGGBBAA` 格式的字符串。非法颜色字面量会在编译时报错；非法的动态颜色值按透明处理，并在开发构建中发出警告。

## 设置元素外观与可见性

在所有目标平台上，都可以为布局容器、`Text` 和 `Image` 设置 `background`、`radius`、`border`、`borderColor`、`shadow` 和 `clip`。`border` 用逻辑像素指定边框宽度。省略 `borderColor` 时，浅色模式默认使用 `#0000001f`，深色模式默认使用 `#ffffff26`。

```weft
Column(padding = 12, background = "#ffffff", radius = 12, border = 1, shadow = "medium", clip = true) {
  Text("预览")
}
```

边框增加元素的外部尺寸，不改变内容盒大小。背景延伸到边框下方，`radius` 同时为背景和边框设置圆角。`clip = true` 将子元素裁剪在带圆角的内边距盒内。`Image` 设置 `radius` 后，图片本身总会按圆角裁剪。`"small"`、`"medium"` 和 `"large"` 阴影画在边框盒外，默认为 `"none"`。

`opacity` 改变整个元素及其子元素的不透明度，但不影响布局。要隐藏元素且不留空位，设置 `hidden = true`。各元素可用的属性见[内置元素参考](/zh/reference/elements/)。

## 设置文本与行内样式

`weight` 可设为 `"light"`、`"regular"`、`"medium"`、`"semibold"` 或 `"bold"`。设 `italic = true` 可使用斜体，设 `decoration = "underline"` 或 `"lineThrough"` 可添加下划线或删除线。新代码用 `weight = "bold"` 设置粗体；`weight = "bold"` 仍然可用。系统字体缺少的字重会用最接近的字重显示，例如 Windows 默认字体把 `"medium"` 画得和 `"regular"` 一样。

`Text` 在可用宽度内自动换行。用 `align = "start"`、`"center"` 或 `"end"` 设置各行的对齐方式，用 `lineHeight` 以逻辑像素指定行高。设 `maxLines = 2` 时最多显示两行，被截断的内容用省略号表示；设为零或负数则不限行数。在 iOS 和 macOS 上，`lineHeight` 只能增加行间距，小于字体自然行高的值不起作用。

```weft
Text(width = 200, lineHeight = 22) {
  Span("新消息：", weight = "semibold")
  Span("查看发布说明", decoration = "underline")
}
```

`Text` 接受字符串或至少一个直接写出的 `Span`，不能同时使用。每个 `Span` 接收一个字符串，可单独设置该片段的样式。片段之间如果需要空格，要写进字符串。动态文字可以写成 `Span` 内的字符串表达式；不要在 `Text` 中直接写 `if`、`for`、组件调用或插槽。

## 表单控件与进度

用 `Switch` 切换设置，用 `TextArea` 编辑多行文本，用 `Slider` 选择整数，用 `Picker` 从列表中选一项。这些控件都是受控的：用户操作时，`onChange` 提供新值，控件仍以绑定的属性为准。如果处理器没有修改该属性，控件就恢复原值。如果不希望用户操作，设为 `disabled = true`。

`Picker` 必须通过具名参数 `options` 提供 `String[]`。当前选项和事件载荷都是从 0 开始的索引。索引越界（例如 `-1`）时显示占位文字。`Slider` 默认范围为 0–100，步长为 1。

无法确定完成比例时，用 `Spinner` 表示操作仍在进行；有明确进度时，给 `Progress` 传入 0 到 1 的比例。`Divider()` 绘制横线，`Divider(vertical = true)` 绘制竖线，方向必须是编译期常量。各平台支持情况见[元素参考](/zh/reference/elements/)。

```weft
component Preferences(choices: String[]) {
  state locked = false
  state choice = -1
  Column(gap = 8, width = 240) {
    Switch(locked, onChange = { value -> locked = value })
    Picker(choice, options = choices, placeholder = "选择位置",
      onChange = { value -> choice = if (locked) choice else value })
    Divider()
    Progress(0.3)
  }
}
```

## 文本输入

`Input` 用于单行输入。`type` 可设为 `text`、`password`、`number`、`email` 或 `phone`，用来选择输入框和键盘类型，输入值始终是字符串。`returnKey` 提示键盘显示哪种操作（`done`、`go`、`next`、`search`、`send`），`onSubmit` 处理提交。在微信小程序中，`phone` 使用数字键盘，`email` 使用默认键盘。macOS、Windows 和 Linux 没有屏幕键盘，会忽略 `returnKey`；macOS 只区分 `password` 和其他类型。各平台支持情况见[元素参考](/zh/reference/elements/#input)。

`Input` 和 `TextArea` 都可以用 `maxLength` 限制编辑后的长度。长度按 UTF-16 码元计算，与 `String.length` 一致；`onChange` 收到的是截断后的文本。`focused` 变为 `true` 时请求焦点，变回 `false` 时放弃焦点。值不变时不会重复请求。用 `onFocusChange` 监听实际焦点变化，该事件不会改写 `focused`。

```weft
component SearchBox() {
  state query = ""
  state requestFocus = false
  Column(gap = 8) {
    Input(query, returnKey = "search", maxLength = 20, focused = requestFocus,
      onChange = { value -> query = value }, onSubmit = { query = "" })
    Text("${query.length}/20")
    Button(onClick = { requestFocus = !requestFocus }) { Text("切换焦点请求") }
  }
}
```

## 让元素可点击

给 `Column`、`Row`、`Stack`、`Text` 或 `Image` 加上 `onTap`，就能像按钮一样点击它。按住时，整个元素的不透明度降为平时的 60%。在 Web 上，可用 Tab 聚焦，再按 Enter 或空格激活。`onTap` 不接收参数。

```weft
component TapRow() {
  state tapCount = 0
  Row(padding = 12, gap = 8, onTap = { tapCount = tapCount + 1 }) {
    Text("点击次数：${tapCount}")
    Text("›")
  }
}
```

如果可点击元素内部还有带 `onTap` 的元素，或带 `onClick` 的 `Button`，点击内层时只执行内层的处理器。各平台的支持情况见[元素参考](/zh/reference/elements/#row)。

## 复用元素样式

在文件顶层声明 `style`，再把样式名传给内置元素：

```weft
style Muted { color = "#6b7280", size = 12 }

component Notes() {
  Column {
    Text("提示", style = Muted)
    Text("备注", style = Muted, size = 14)
  }
}
```

两行文本颜色相同，但第二行的显式 `size` 覆盖了样式的默认字号。样式只能设置该元素接受的具名值属性，属性值只能写字面量，不能写计算表达式或插值字符串。一个元素只能应用一个样式；组件调用不能应用样式。

## 用表达式计算属性值

实参可以直接写表达式。数值运算支持 `+`、`-`、`*`、`/` 和 `%`，两个 `Int` 相除是整除。`+` 也能拼接两个字符串。用 `==`、`!=` 判断标量是否相等，用 `<`、`<=`、`>`、`>=` 比较数值或字符串的大小，用 `!`、`&&`、`||` 组合布尔条件。

```weft
component Estimate(title: String, note: String? = null, hours: Float = 0.0) {
  Column(gap = 4) {
    Text(title.trim())
    Text(note?.trim() ?? "No note")
    Text(if (hours > 0.0) "Estimate: ${hours.toFixed(1)} h" else "Not estimated")
  }
}
```

在字符串里用 `${...}` 插入 `Int`、`Float`、`Bool` 或 `String` 类型的值。`if` 表达式返回一个值，条件必须是 `Bool`，必须有 `else`，两个分支的值类型要兼容。用 `?.` 访问可空值的成员，用 `??` 为左侧是 `null` 的情况提供备用值。`length` 和 `isEmpty` 是字符串和数组的属性，不加括号；`trim()` 和 `toFixed(1)` 则是方法调用。

## 按条件渲染和遍历列表

`if` 节点选择要渲染的节点块，不返回值。条件仍然必须是 `Bool`，但 `else` 可以省略，也可以用 `else if` 串接多个条件。`for` 节点遍历数组，循环头必须写 `; key = ...`。给每一项一个稳定且唯一的 `Int` 或 `String` 键，例如待办事项的 ID。这样数组重排时，Weft UI 仍能识别原来的各行。

把下面的代码保存为 `TodoList.weft`，与 `Todo.weft` 放在同一目录：

```weft
import "./Todo.weft"

component TodoList(todos: Todo[]) {
  Column(gap = 8) {
    if (todos.isEmpty) {
      Text("No tasks yet")
    } else {
      for (todo in todos; key = todo.id) {
        TodoRow(todo)
      }
      Text("${todos.length} tasks")
    }
  }
}
```

## 局部状态

组件私有的 `state` 写在组件体开头，放在所有节点之前。每个组件实例都有独立的状态。类型可以从初始值推断，也可以像 `state draft: String = ""` 一样显式标注。初始值为 `null` 时，必须显式标注可空类型。

```weft
component DraftPreview() {
  state draft: String = ""
  state preview = false

  Column(gap = 8) {
    Input(draft, placeholder = "New todo", onChange = { value -> draft = value })
    Button(onClick = { preview = !preview }) {
      Text(if (preview) "Hide preview" else "Show preview")
    }
    if (preview && !draft.trim().isEmpty) {
      Text(draft.trim())
    }
  }
}
```

内联处理器只能给 `state` 赋值，不能修改组件参数、模型字段或循环变量。`draft` 或 `preview` 变化后，读取它们的视图会随之更新。要修改应用数据，而非局部显示状态，请发出事件交给[逻辑层](/zh/guides/logic/)处理。

## 处理事件

根据需要使用的数据，选择事件参数的写法：

- **只写事件名：** `onChange = DraftChanged` 会将 `Input` 的载荷传给声明为 `event DraftChanged(value: String)` 的事件。有载荷时，事件必须有一个类型兼容的参数；没有载荷时，事件不能带参数。按钮的 `onClick` 没有载荷，复选框的 `onChange` 提供一个 `Bool`。
- **显式传参：** `onChange = Toggle(todo.id)` 在渲染时绑定当前行的 ID，忽略复选框的载荷。要忽略载荷并发出一个不带参数的事件，可以写 `EventName()`。
- **内联 lambda：** `{ value -> draft = value }` 在触发时接收载荷并修改局部状态。无需接收载荷时，可以写成 `{ preview = !preview }`。lambda 只能直接作为事件参数的值使用。

内置元素和组件调用都可以使用 `onMount` 和 `onUnmount`。它们分别在元素或组件挂载和卸载时触发，不提供载荷，只接受已声明的事件，可以显式传参，但不能使用 lambda。

```weft
event DraftChanged(value: String)
event DraftMounted
event DraftUnmounted

component DraftField(value: String) {
  Input(value, onChange = DraftChanged, onMount = DraftMounted, onUnmount = DraftUnmounted)
}
```

## 跨文件组合组件

组件可以声明多个 `Children` 参数作为插槽。在组件体内，把参数名作为节点写在内容要出现的位置。调用时，在尾随块中用 `name: { ... }` 填充同名插槽；不在具名块里的节点填入第一个 `Children` 参数。插槽可以留空，但同一个插槽不能填两次。

把下面的 `App.weft` 和前面两个待办文件放在同一目录：

```weft
import "./Todo.weft"
import "./TodoList.weft"

component Panel(title: String, content: Children, footer: Children) {
  Column(padding = 16, gap = 12) {
    Text(title, size = 20, weight = "bold")
    content
    footer
  }
}

component App(todos: Todo[]) {
  Panel("我的待办") {
    TodoList(todos)
    footer: { Text("列表结束") }
  }
}
```

导入路径相对于发起导入的文件。导入不传递：`App.weft` 要使用 `TodoList`，就导入 `TodoList.weft`；要引用 `Todo` 类型，还要直接导入 `Todo.weft`。通过导入关联起来的文件中，模型、事件和组件不能重名，也不能与内置元素重名。

完整的语法和类型规则见 [Weft UI 语法规范](https://github.com/weft-ui/weft-ui/blob/master/crates/parser/GRAMMAR.zh-CN.md)。
