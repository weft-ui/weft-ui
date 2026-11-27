# Weft 语法

[English](GRAMMAR.md)

本文是 `.weft` 语言的规范语法，解析器（`weft_ui_parser::parse`）按此实现。语义规则（作用域、类型、依赖）见文末[语义约束](#语义约束)。

## 词法

- 源码为 UTF-8。换行与其他空白一样不敏感，只用来分隔 token。
- 注释：`// 行注释`、`/* 块注释 */`（块注释不嵌套）。
- 标识符：`[A-Za-z_][A-Za-z0-9_]*`。
- 保留关键字：`if` `else` `for` `in` `true` `false` `null`。
- 上下文关键字（其他位置是普通标识符，例如 Demo 中的参数 `model`）：
  - `import`（后跟字符串）、`model` / `event` / `component` / `page` / `app` / `type` / `style`（后跟标识符）只在顶层开启声明；
  - `theme`（后跟 `{`）开启顶层主题声明；`dark` 只在主题条目中引出第二个颜色；
  - `state`（后跟标识符）只在组件体内开启状态声明；
  - `let`（后跟标识符）在组件体或块的开头开启局部声明；
  - `path` 只在页面参数表之后引出可选路径；`start` 和 `tabs` 只在 `app` 内分别指定入口页面和标签页；
  - `key` 只在 `for` 头部出现。
- 整数：`[0-9]+`，范围为 `i64`。浮点：`[0-9]+ "." [0-9]+ ([eE] [+-]? [0-9]+)?` 或 `[0-9]+ [eE] [+-]? [0-9]+`。
- 字符串：`"..."`，转义 `\n` `\r` `\t` `\0` `\\` `\"` `\$` `\u{XXXX}`。
  `${ 表达式 }` 为插值，插值内部可以再写字符串。字符串不能跨行。
- 符号：`( ) { } [ ] , : ; . ?. ? ?? = += -= == != < <= > >= + - * / % ! && | || ->`

## 文法

EBNF 记法：`X?` 可选，`X*` 零或多次，`X+` 一或多次，`"tok"` 为 token。

```text
File        = Import* Item* EOF ;
Import      = "import" STRING ;               (* 不允许插值 *)
Item        = Model | Event | Component | Page | App | TypeAlias | Style | Theme ;
App         = "app" IDENT "{" AppEntry "}" ;
AppEntry    = "start" "=" IDENT | "tabs" "{" TabItem+ "}" ;
TabItem     = IDENT "(" ArgList? ")" ;
TypeAlias   = "type" IDENT "=" Type ;
Style       = "style" IDENT "{" ( StyleEntry ","? )* "}" ;
StyleEntry  = IDENT "=" ConstValue ;
Theme       = "theme" "{" ( ThemeEntry ","? )* "}" ;
ThemeEntry  = IDENT "=" ( COLOR_STRING ( "dark" COLOR_STRING )? | "-"? INT | "-"? FLOAT ) ;
ConstValue  = STRING | "-"? INT | "-"? FLOAT | "true" | "false" | "theme" "." IDENT ;
(* ConstValue 中的 STRING 和 COLOR_STRING 不允许插值。 *)

Model       = "model" IDENT "{" FieldList? "}" ;
Event       = "event" IDENT ( "(" FieldList? ")" )? ;
FieldList   = Field ( "," Field )* ","? ;
Field       = IDENT ":" Type ;

Component   = "component" IDENT "(" ParamList? ")" "{" StateDecl* LetDecl* Node* "}" ;
Page        = "page" IDENT "(" ParamList? ")" ( "path" STRING )? "{" StateDecl* LetDecl* Node* "}" ; (* 路径不允许插值 *)
ParamList   = Param ( "," Param )* ","? ;
Param       = IDENT ":" Type ( "=" Expr )? ;
StateDecl   = "state" IDENT ( ":" Type )? "=" Expr ;
LetDecl     = "let" IDENT ( ":" Type )? "=" Expr ;

Type        = UnionType | IDENT TypeArgs? TypeSuffix* ;
TypeArgs    = "<" Type ">" ;
UnionType   = STRING ( "|" STRING )+ ;       (* 不允许插值 *)
TypeSuffix  = "[" "]" | "?" ;

Block       = "{" LetDecl* Node* "}" ;
Node        = ElementNode | IfNode | ForNode | SlotFill ;
SlotFill    = IDENT ":" Block ;                  (* 只能直接写在组件调用的子块里 *)
ElementNode = Path ( "(" ArgList? ")" )? Block? ;
Path        = IDENT ( "." IDENT )* ;
IfNode      = "if" "(" Expr ")" Block ( "else" ( IfNode | Block ) )? ;
ForNode     = "for" "(" IDENT "in" Expr ( ";" "key" "=" Expr )? ")" Block ;

ArgList     = Arg ( "," Arg )* ","? ;
Arg         = ( IDENT "=" )? Expr ;              (* 命名参数必须在位置参数之后 *)

Expr        = IfExpr | Binary ;
IfExpr      = "if" "(" Expr ")" Expr "else" Expr ;
Binary      = Unary ( BinOp Unary )* ;            (* 按下方优先级结合 *)
Unary       = ( "!" | "-" ) Unary | Postfix ;
Postfix     = Primary ( "." IDENT | "?." IDENT | "(" ArgList? ")" )* ;
Primary     = INT | FLOAT | STRING | "true" | "false" | "null"
            | IDENT | "(" Expr ")" | Lambda ;
Lambda      = "{" ( IDENT "->" )? ( Stmt ";"? )* "}" ;
Stmt        = Assign | Call ;
Assign      = IDENT ( "=" | "+=" | "-=" ) Expr ;
Call        = IDENT "(" ArgList? ")" ;
```

二元运算符优先级（从低到高，全部左结合）：

| 优先级 | 运算符              |
| ------ | ------------------- |
| 1      | `??`                |
| 2      | `\|\|`              |
| 3      | `&&`                |
| 4      | `==` `!=`           |
| 5      | `<` `<=` `>` `>=`   |
| 6      | `+` `-`             |
| 7      | `*` `/` `%`         |

说明：

- `state` 只能写在组件体顶层，并且在所有 `let` 声明和节点之前。
- `let` 写在组件体、`if` 或 `for` 块、组件调用的子块开头，且在节点之前。内置元素的子块不能直接包含 `let` 声明。
- 节点之间不需要分隔符。`Name` 后面紧跟的 `(` 和 `{` 都属于这个节点，包括换行之后的 `{`。
- `if` 出现在节点位置时是条件渲染，分支是节点块；出现在表达式位置时是条件表达式，必须带 `else`，分支是表达式。
- 调用只允许出现在标识符或成员访问之后：`Remove(todo.id)`、`name.trim()`。
- Lambda 只能直接作为元素的事件参数或组件的回调实参使用。
- `for` 头部的 `key` 在语法上可以省略，缺失时由语义分析报错，以便给出更准确的提示。

## 错误恢复

解析器在出错后继续解析，尽量报告所有错误：

- 顶层：跳到下一个 `import` / `model` / `event` / `component` / `page` / `app` / `type` / `style` / `theme`。
- 节点块：跳过无法识别的 token（括号成对跳过），直到下一个节点起始 token 或 `}`。
- 参数/字段列表：跳到下一个 `,` 或右括号。
- 同一位置只报告第一个错误。

所有 AST 节点都带源码区间（文件 + 字节偏移），诊断以 `文件:行:列` 定位并附带源码片段。

## 语义约束

### 作用域与导入

- 每个文件可见：本文件声明 + 直接 `import` 的文件声明。导入不传递。
- 导入闭包内 `model`、`event`、`component`、`page`、`type`、`style` 共用一个命名空间，任何重名都报错；也不能与内置元素重名。
- 宿主侧的事件注册方法由事件名派生（`onFooBar` / `on_foo_bar`），因此忽略大小写和下划线后相同的两个事件名（如 `FooBar` 与 `foo_bar`）也报错。
- 循环导入、找不到的文件都报错。
- `theme` 是主题令牌的保留名，不能作为组件参数、`state`、`let`、`for` 循环变量或 lambda 参数的名字。
- 组件内名称查找顺序：lambda 参数 → `let` 绑定（由内向外） → `for` 变量 → `state` → 组件参数。组件内不允许遮蔽已有名称。
- `let` 声明不可变的表达式别名，在同一块内的声明之后可见，也可以在嵌套块和 lambda 中使用。省略类型标注时，类型由表达式推导。编译器在每个使用处内联表达式，因此依赖与直接写出表达式相同。

### 页面

- 页面体的语法和作用域与组件相同，但页面不能作为组件节点调用。第一个参数可以是模型；其余路由参数只能是 `Int`、`Float`、`Bool`、`String`、字符串字面量联合或这些类型的可空形式，可以有常量默认值。
- 显式路径以 `/` 开头，由字面量段（`[a-z0-9._~-]+`）或 `{name}` 参数段组成。每个路径参数最多出现一次，且必须是必填的 `String`、`Int` 或联合路由参数；其他路由参数走查询字符串。省略路径时页面名转为 kebab-case 路径，例如 `/user-profile`。
- 两条路径段数相同，且每对段要么是相同字面量、要么至少一侧为参数时，路径重叠并报错。页面事件不能命名为 `Show` 或 `Hide`，这两个名字留给页面方法。

### 应用

- 一个编译单元最多声明一个 `app`。`start` 必须指向没有必填路由参数的页面。应用包含声明 `app` 的文件的传递导入闭包内的全部页面；闭包外的页面会报错。
- 也可以用 `tabs` 指定 2–5 个互不重复且没有必填路由参数的页面。每项必须提供字符串字面量命名参数 `title`、`icon`，可选 `activeIcon`；图标必须采用 `asset:<name>`，省略 `activeIcon` 时使用 `icon`。
- 使用生成的应用类和每个页面对应的工厂挂载应用。工厂创建页面实例并注册处理器。页面不能直接挂载；没有 `app` 的程序仍以组件为根挂载。
- `NavBar` 每个页面最多一个，必须是页面的第一个顶层节点，不能放在 `if` 或 `for` 内。`BarButton` 只能放在 `NavBar` 中，必须提供作为无障碍名称的 `label`。

### 类型

- 基础类型 `Int`、`Float`、`Bool`、`String`、`Color`，复合类型 `T[]`、`T?`，以及 `model` 名。
- 一个组件可以声明多个 `Children` 参数（插槽）。组件体内以参数名作为节点使用。插槽没有默认值，调用时可以不填。
- 调用方在尾随块里用 `name: { ... }` 填充同名 `Children` 参数，其余节点填充按声明顺序排列的第一个 `Children` 参数。具名填充只能直接写在组件调用的尾随块里。未知插槽名、同一插槽填充两次（包括同时使用具名和非具名内容），以及给没有插槽的组件传入子块，都会报错。
- `type` 为其他类型声明别名，例如 `type Kind = "text" | "image"`。类型检查时展开别名；别名不能直接或间接引用自身。可用别名书写可空联合（`Kind?`）和联合数组（`Kind[]`）。
- 字面量联合至少有两个不同的字符串字面量，转义解码后比较是否重复。联合值在运行时就是字符串，在 TypeScript 声明里保留为字面量联合。
- 赋值兼容：相同类型；`Int` → `Float`；`null` → `T?`；`T` → `T?`。字符串字面量可以赋给包含它的联合，普通 `String` 值不可以。联合可以赋给包含其全部成员的联合，也可以赋给 `String`。
- 期望类型为联合时，`if` 表达式的两个分支和 `??` 的右侧按该联合检查。联合值与字符串字面量用 `==` 或 `!=` 比较时，字面量必须是联合的成员。
- 算术：`Int op Int → Int`（整除），含 `Float` 时为 `Float`；`String + String → String`。
- 比较 `< <= > >=` 只用于数值或字符串；`== !=` 只用于 `Color` 之外的标量及其可空类型。
- `a ?? b` 要求 `a: T?`；`a?.f` 要求 `a` 可空，结果可空。对非空值用 `?.` 给出警告。
- 字符串插值只接受 `Int`、`Float`、`Bool`、`String` 和字符串字面量联合。
- `model` 不允许不经过数组或可空类型的直接递归。

### 内置成员

| 接收者           | 成员                                                         |
| ---------------- | ------------------------------------------------------------ |
| `String`         | `length: Int` `isEmpty: Bool` `trim()` `uppercase()` `lowercase()` `contains(String): Bool` |
| `T[]`            | `length: Int` `isEmpty: Bool` `contains(T): Bool`（`T` 为 `Color` 之外的标量） |
| `Int` `Bool`     | `toString(): String`                                         |
| `Float`          | `toString(): String` `toFixed(Int): String`                  |

`length` / `isEmpty` 是属性，其余是方法。字符串字面量联合与 `String` 的成员相同。

### 事件参数

元素的事件参数有载荷类型（`onClick` 无载荷，`Input.onChange` 载荷为 `String`）。可接受的值：

- `Event`：事件名当函数用，事件参数个数必须等于载荷个数（0 或 1），载荷填充唯一参数。
- `Event(args)`：直接构造事件实例，参数在渲染时绑定，忽略载荷。
- `{ stmts }` / `{ v -> stmts }`：内联 lambda，可以给 `state` 赋值、发出事件或调用回调。`v` 接收载荷，语句按书写顺序执行。
- 回调参数名或 `callback(args)`：前者将载荷转交给回调，后者在渲染时绑定参数。
- `onMount` / `onUnmount` 只接受声明的事件，不接受回调或 lambda。

### 回调参数

类型为 `Event` 的回调不接收载荷；`Event<T>` 接收一个载荷，类型可以是 `Int`、`Float`、`Bool`、`String`、`Color` 或字符串字面量联合。这两种类型只能直接用于组件参数。回调参数总是可选的，不能声明默认值。调用方可以传入上述任一种事件参数形式；直接按名称转发载荷时，载荷类型须能赋给接收方。调用未传入的回调没有效果。

例如，`Rating(value: Int, onSelect: Event<Int>)` 组件可以写 `Button(onClick = onSelect(1))`。调用方可以写 `Rating(score, onSelect = Rated)` 发出宿主事件，也可以写 `Rating(score, onSelect = { v -> score = v; Rated(score) })`，先更新本地状态再发出事件。经回调传递的宿主事件仍归提供回调的组件。

### 视图

- `if` 条件为 `Bool`。
- `for` 必须有 `key`，类型为 `Int`、`String` 或字符串字面量联合；被迭代对象必须是数组。
- 自定义组件不允许不经过 `if` / `for` 的递归实例化。

### 样式

- 顶层声明 `style Muted { color = "#6b7280", size = 12 }` 为内置元素的具名值属性设置默认值。样式值可以是字面量或 `theme.name`。样式不能设置位置属性或事件，不能引用其他样式，也不能使用计算表达式。
- `Text("note", style = Muted, size = 14)` 只应用一个可见的样式。元素必须接受样式中的每个属性。显式参数覆盖样式默认值（这里的 `size` 为 `14`），其余值按普通元素参数检查类型。类型错误会报在 `style = Muted` 参数处。
- 只有内置元素能使用 `style`，组件调用不能使用。

### 主题

- 整个导入闭包最多允许一个 `theme` 声明，其中的令牌名不能重复。`theme.name` 必须写在声明主题的文件中，或写在直接导入它的文件中。样式里的令牌引用按样式声明所在文件解析。
- 颜色令牌包含浅色值和可选的 `dark` 深色值。省略时，深色模式也使用浅色值。系统外观变化时，宿主自动更新所渲染的颜色。整数和浮点数令牌没有深浅色变体，在编译期替换为字面量。
- `Color` 是独立类型，可用于模型字段、`Event<Color>` 回调参数等类型标注。需要 `Color` 的位置可传入 `String`：字面量必须是十六进制颜色，其他值在运行时解析。`Color` 不能赋给 `String`，也不能比较或插值。在 TypeScript 声明中表示为 `string`。
- 所有目标平台都支持主题声明和引用。

### 内置元素与布局

使用目标平台标为「不支持」的元素、属性或事件时，编译器会报错；标为「忽略」的写法可以编译，但没有效果。受支持的布局语义一致，外观贴近各平台原生风格。

<!-- elements:begin -->
<!-- Generated from protocol/weft.elements.json by protocol/elements.ts; do not edit. -->

| 元素 | 位置属性 | 事件 | 子节点 |
| --- | --- | --- | --- |
| `NavBar` | — | — | `BarButton` |
| `BarButton` | — | `onTap` | 无 |
| `Column` | — | `onTap` | 不限 |
| `Row` | — | `onTap` | 不限 |
| `Text` | `value` | `onTap` | `Span` |
| `Span` | `value` | — | 无 |
| `Button` | — | `onClick` | 不限 |
| `Input` | `value` | `onChange(String)`, `onSubmit`, `onFocusChange(Bool)` | 无 |
| `Checkbox` | `checked` | `onChange(Bool)` | 无 |
| `Image` | `src` | `onTap` | 无 |
| `Stack` | — | `onTap` | 不限 |
| `List` | — | — | 不限 |
| `Grid` | — | — | 不限 |
| `Scroll` | — | — | 不限 |
| `Spacer` | — | — | 无 |
| `Switch` | `checked` | `onChange(Bool)` | 无 |
| `TextArea` | `value` | `onChange(String)`, `onFocusChange(Bool)` | 无 |
| `Spinner` | — | — | 无 |
| `Progress` | `value` | — | 无 |
| `Divider` | — | — | 无 |
| `Slider` | `value` | `onChange(Int)` | 无 |
| `Picker` | `selected` | `onChange(Int)` | 无 |

完整的属性、事件及各平台的支持情况见[元素参考](https://weftui.mioyi.net/zh/reference/elements/)。
<!-- elements:end -->

所有元素另有 `onMount` / `onUnmount`。

- **受控值**：`Input`、`TextArea`、`Checkbox`、`Switch`、`Slider` 和 `Picker` 显示绑定值。`onChange` 将用户提出的新值传给处理器；绑定未接受新值时，宿主恢复绑定值。
- **`Picker` / `Slider`**：`Picker.options` 是必填的具名参数，类型为 `String[]`。`selected` 和事件载荷都是从 0 开始的索引；索引越界时显示占位文字。`Slider` 的当前值、上下限、步长和事件载荷均为整数。
- **`Progress` / `Divider`**：`Progress` 接收 0 到 1 的比例。`Divider` 默认绘制横线，`vertical` 必须是编译期常量。

- **长度**：`Int`，单位是逻辑像素：iOS / macOS 的 pt、Android 的 dp、Windows 的 DIP、Web 的 CSS px；小程序用 `px`，不用 `rpx`。
- **盒模型**：`width`、`height` 及对应的 `min*`、`max*` 限制作用于内容盒，内容盒外依次是内边距、元素的边框（如果有）和外边距。`padding` 设置四边，`paddingX` 设置左右，`paddingY` 设置上下，单边属性覆盖前两种写法。`margin` 按相同规则处理。边距属性中的 `Start` 和 `End` 分别指左边和右边。
- **外观**：`background` 填充内边距盒，也延伸到边框下方。`border` 添加指定宽度的实线边框，`radius` 为边框盒、背景和边框设置圆角。`shadow`（`"none"`、`"small"`、`"medium"` 或 `"large"`）绘制在边框盒外。`clip = true` 将子内容裁剪到带圆角的内边距盒内。`opacity` 作用于整个元素及其后代；`hidden = true` 时元素不显示，也不参与布局。
- **`Column` / `Row`**：子元素沿主轴依次排列，`Column` 的主轴为纵向，`Row` 为横向。`gap` 是相邻子元素的间距，子元素的外边距另计。`justify` 分配主轴剩余空间，`align` 决定交叉轴对齐方式，两者默认都是 `"start"`。设 `align = "stretch"` 时，没有固定交叉轴尺寸的子元素会撑满容器的交叉轴内容尺寸。
- **`grow`**：在 `Column`、`Row` 或 `Scroll` 中，主轴剩余空间按 `grow` 的比例分给 `grow > 0` 的子元素，不计这些子元素在主轴上的自然尺寸。主轴无界时按自然尺寸测量。其他父元素忽略 `grow`。
- **`fill`**：在 `Column`、`Row` 或 `Scroll` 中撑满交叉轴，在 `Stack` 中撑满两个方向，在根上撑满可用窗口宽度。固定的 `width` 或 `height` 在对应轴上优先于 `fill`。线性布局中要占满主轴剩余空间，应使用 `grow`。
- **`aspectRatio`**：宽度由固定值、`fill`、交叉轴拉伸或横向的 `grow` 确定且高度未固定时，以宽度除以比例得到高度；否则，若只有高度确定，就以高度乘以比例得到宽度。宽高都固定时忽略比例。
- **`Spacer`**：只能作为 `Column`、`Row` 或 `Scroll` 的直接子元素。设置 `size` 时在主轴占用固定长度，不设置则相当于 `grow = 1`。交叉轴尺寸为零。
- **`Stack`**：子元素按顺序叠放，后写的在上层。未指定固定尺寸时，内容尺寸取不带 `fill` 的子元素（含外边距）在各轴上的最大尺寸。`alignment` 决定子元素在内容盒里的位置。带 `fill` 的子元素撑满两个方向，不计入 `Stack` 的自然尺寸。
- **`Scroll`**：按 `direction` 像 `Column` 或 `Row` 一样排列内容，支持 `gap`、`align`。`direction` 必须是常量，默认为 `"vertical"`。内容只能沿滚动轴超出并滚动。未显式设置时，`grow` 为 `1`，`fill` 为 `true`。`indicators = false` 隐藏滚动条。
- **根节点与溢出**：根组件的顶层节点像 `Column` 的子元素一样排列，内容盒默认等于窗口减去安全区。在 Vite 插件中设置 `safeArea: false`，可改用整个窗口。根不滚动；需要滚动时请使用 `Scroll`。如果子元素的自然尺寸超过不滚动的主轴上的可用空间，平台可能压缩子元素，也可能让它们溢出，不要依赖其中一种行为。
- **颜色**：`Color` 属性接受 `theme.accent` 等 `Color` 值，也接受 `#RGB`、`#RRGGBB` 或 `#RRGGBBAA`（十六进制，大小写不限）。颜色字面量在编译期校验并以 RGBA 写入视图布局。动态值中的无效颜色和未知令牌显示为透明，开发构建还会发出警告。
- **`Text` / `Span`**：`Text` 接受一个字符串，或至少一个直接写出的 `Span` 子元素，二者不能同时使用。`Span` 接受字符串，不能有子元素。`Text` 按可用宽度换行；`align`（`"start"`、`"center"` 或 `"end"`）设置各行在文本框中的对齐方式。`maxLines` 大于零时，超出指定行数的文本会被截断，末尾显示省略号；小于或等于零时不限行数。`lineHeight` 用逻辑像素指定每行的高度。
- **`Image`**：`src` 是图片 URL，没有内置网络图片控件的平台由内核下载。

### 依赖分析

- 依赖是“根 + 字段路径”：根为组件参数、`state` 或 `for` 变量，例如 `model.user.name`、`expanded`、`todo.name`。
  路径只穿过非空 `model` 字段，遇到数组、可空类型、基础类型或内置成员（如 `length`）即截止。
- 脏位：组件参数和 `state` 按上述规则展开到叶子，每个叶子一位；每个 `for` 另有一套按元素类型展开的逐项脏位。
  依赖覆盖所有以它为前缀的叶子，例如把 `model.user` 传给子组件会依赖 `model.user` 下的每一位。
- 绑定点：元素属性、组件实参、`if` 条件（整条 `if / else if` 链的条件并集）、`for` 列表与 key、带参数的事件构造（参数在渲染时绑定）。
  没有依赖的值是静态的，不生成绑定；lambda 在触发时求值，也不生成绑定。
