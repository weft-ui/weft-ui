# 视图协议

[English](SPEC.md)

JS 逻辑层（`@weft-ui/runtime/remote` 和生成的 remote 模式逻辑模块）与视图层（小程序 WXML、原生平台、无头渲染器）之间的约定，实现以本文为准。

参考实现是 `@weft-ui/runtime/testing` 的无头渲染器：它把每批 ops 编码、解码、按布局校验后应用到内存树上。`tests/conformance/golden/` 的黄金文件就是它记录的 ops 文本。

## 布局

`ViewLayout`（`crates/transformer/src/view/mod.rs`）从整个应用的 Program 推导，JSON 形式由 WASM 的 `compileApp(...).layout` 给出，例子见 `crates/transformer/tests/snapshots/TodoList/layout.json`。

```json
{
  "hash": "a6bb96edf9a9ad2d",
  "safeArea": true,
  "templates": [
    {
      "label": "TodoList",
      "kind": "component",
      "roots": [0],
      "nodes": [{"element": "Column", "props": {}, "children": [1, 2]}, {"point": 0}],
      "values": [{"node": 1, "prop": "value", "type": "String"}],
      "events": [{"node": 1, "event": "onChange", "payload": "String", "controls": 0}],
      "points": [{"node": 2, "kind": "branch", "templates": [1]}]
    }
  ]
}
```

- **模板编号**：先是每个组件体，按 Program 中组件的顺序，所以模板 `i` 就是组件 `i` 的组件体；之后按出现顺序是各组件内的 `if` 分支（每个分支一个）、`for` 行体和插槽内容。`label` 只用于调试：`TodoList`、`TodoList:if8.0`（节点 8 的第 0 个分支）、`TodoList:for7`、`Board:slot12`。
- **节点**：`nodes` 是模板内的局部节点表，`roots` 是顶层节点。元素节点带静态属性 `props`（没有绑定的字面量，平台直接内联进模板，不占槽位）和子节点；`{"point": n}` 是挂载点 `n` 在树中的位置。
- **值槽** `values[i]`：节点的一个动态属性，`type` 是元素属性声明的类型：`Int` / `Float` / `Bool` / `String` / `Color` / `Strings`。`Strings` 槽接收字符串数组（线路标签 4）。`Color` 槽的值是字符串，由平台解析（规则见[语法的内置元素与布局](../crates/parser/GRAMMAR.zh-CN.md#内置元素与布局)）；静态颜色已在编译期校验，`props` 里写成规范化的 `#rrggbb` 或 `#rrggbbaa`。受控属性（如 `Input.value`、`Checkbox.checked`、`Picker.selected`）即使是常量也总是值槽。
- **事件槽** `events[i]`：节点的一个事件属性，`payload` 是载荷类型（`null` 表示无载荷）。受控元素总有 `onChange` 事件槽，`controls` 是它控制的值槽下标，其余事件为 `null`。生命周期属性（`onMount` / `onUnmount`）由 JS 处理，不进入布局。
- **挂载点** `points[i]`：`branch`（`templates` 依次是各分支的模板）、`list`（`template` 是行体）、`instance`（`template` 是被实例化组件的组件体）或 `slot`（插槽内容由使用方提供，可以是任意 `slot` 种类的模板）。
- **页面与惰性模板**：页面体模板的 `kind` 是 `page`。惰性挂载点写成 `{"node": n, "kind": "lazy", "templates": [row]}`，分组列表为 `[header, row]`。
- **应用**：应用布局有顶层 `app`，为 `{"start": 模板}` 或 `{"tabs": [{"page": 模板, "title": "…", "icon": "asset:…", "activeIcon": "asset:…"}]}`。它参与哈希，路由仍由 JS 处理。
- **主题**：应用声明了主题时，顶层 `theme` 对象将颜色令牌名映射到 `[浅色, 深色]`。两项均为小写 `#rrggbbaa`；仅声明一种外观时两项相同。数值令牌已在编译期折叠，不写进布局。静态 `props` 中的令牌和动态 `Color` 值槽中的令牌都使用字符串 `"@name"`，由宿主按当前外观解析。
- **安全区**：顶层布尔值 `safeArea` 表示应用是否要求为安全区留出内边距，默认为 `true`，并参与布局哈希计算。
- **哈希**：去掉 `hash` 字段后的 JSON 的 FNV-1a 64 位哈希，16 位十六进制。它同时写进 JS 逻辑（`App` 构造参数）和平台视图，sink 在 `open` 时比对，不一致直接报错。

## Scope

运行时每个模板实例是一个 scope。id 由 JS 按 app 分配，从 1 开始递增，不复用。scope 0 是虚拟的根，它只有挂载点 0：根组件实例用 `attach 0 0 <id>` 挂上去。

scope 在 `create` 时创建，此时还没挂上树。它被 `branch` 换掉、不再出现在 `rows` 里、或者祖先被销毁时隐式销毁，后代一起销毁。`unmount` 时 sink 收到 `close`，所有 scope 一起作废。

应用用 `nav` 引用页面根 scope，不发送 `attach`；同一程序只使用一种根。页面根在引用它的 `nav` 之前创建并设置全部值，位于同一批次。首批包含完整导航状态，之后只在状态变化时发送 `nav`。最新状态（包括宿主上报的导航状态）不再引用的页面及其后代被销毁，JS 不再为它发送 op。

宿主比较前后状态选择转场：栈尾追加为推入，栈截短为弹出，其他变化为无动画替换。用户返回时宿主先应用变化，再以 `Session.signal("navigation", json)` 上报，例如 `{"tab": 0, "stack": [9], "modal": 0}`（栈和模态值为页面 scope ID）。JS 采纳有效的返回状态，调用页面显示状态处理器并销毁移除的 scope，不回送 `nav`。有效变化仅包括关闭模态、截短栈，或切换 Tab 并清空栈；其他状态是协议错误，JS 以 `console.error` 记录并重新下发自己的状态。Web 和小程序将相同事件直接交给运行时。

惰性挂载点拥有扁平项序列，item ID 在该挂载点内从 1 递增且不复用；稳定 key 离开列表前保持同一 ID。`splice` 替换公共前后缀之间变化的部分，保留 ID 的已物化 scope，销毁被移除项的 scope。`bind` 将项关联到已创建的 scope，child 为 0 时释放。窗口请求物化范围内的项并释放范围外的 scope；首次最多物化前 20 项。项 scope 的创建与初始值在同一批次中先于 `bind`。

## Ops

| op       | 参数                     | 含义                                                         |
| -------- | ------------------------ | ------------------------------------------------------------ |
| `create` | scope, template          | 创建实例                                                     |
| `set`    | scope, slot, value       | 写值槽，值的类型与槽的类型一致                               |
| `branch` | scope, point, child \| 0 | `branch` 挂载点切换到 child（0 表示没有分支），旧的子 scope 销毁 |
| `rows`   | scope, point, [child…]   | `list` 挂载点的完整新顺序，不在新列表里的行销毁              |
| `attach` | scope, point, child      | `instance` / `slot` 挂载点挂上 child，每个挂载点只发一次     |
| `splice` | scope, point, index, remove, items | 替换 `lazy` 挂载点的一段，项为 `(item, template)` 对，template 是该挂载点 `templates` 下标 |
| `bind` | scope, point, item, child \| 0 | 物化或释放惰性项 |
| `nav` | tab, tabs, stack, modal, style | 替换完整导航状态；未创建的 Tab 和不存在的模态为 0 |

保证：

- 一批 ops 对应一次 flush，sink 在 `commit` 时整批应用。
- 新 scope 的 `create` 和它所有值槽的 `set` 都在同一批里，且先于挂载它的 op。平台总是先建好子树再插入。
- 新 scope 的 `branch` 挂载点为空、`list` 挂载点没有行；状态不变时不发 op（空列表不发 `rows`，顺序不变的列表不重发，值没变不发 `set`）。
- 同一个挂载点上的 child 只能是该挂载点允许的模板的实例，一个 scope 最多挂载一次。

## 事件

元素事件使用 `Session.dispatch(scope, slot, payload) → boolean`，`slot` 是事件槽下标，`payload` 的类型由事件槽决定。JS 同步执行处理函数并 flush，所以返回前 sink 已经收到这次事件引起的 ops。返回值表示受控编辑是否被接受：事件槽没有 `controls`、scope 已销毁、或者被控值槽的当前值等于载荷时为 `true`。返回 `false` 时视图把控件恢复成被控值槽的当前值（宿主改写过的值已经通过 `set` 到达）。已销毁或未知 scope 的事件被忽略并返回 `true`。

## 二进制编码（版本 3）

一批 ops 是一段字节：第一个字节是版本号 `3`，之后是连续的 op。整数都是 u32 小端。

| opcode | op       | 字段                                       |
| ------ | -------- | ------------------------------------------ |
| 1      | `create` | scope, template                            |
| 2      | `set`    | scope, slot, value                         |
| 3      | `branch` | scope, point, child                        |
| 4      | `rows`   | scope, point, count, child × count         |
| 5      | `attach` | scope, point, child                        |
| 6      | `splice` | scope, point, index, remove, count, (item, template) × count |
| 7      | `bind` | scope, point, item, child |
| 8      | `nav` | tab, n, scope × n, m, scope × m, modal, style |

表中字段均为小端 u32。`style` 使用 `modalStyles`：`sheet` = 0，`fullScreen` = 1；`modal` 为 0 时它也为 0。

值以一个 u8 标签开头：`0` false、`1` true、`2` 数字（f64 小端，`Int` 槽的值也按 f64 传）、`3` 字符串（u32 字节长度 + UTF-8），或 `4` 字符串数组（u32 元素数，后接对应数量的字符串，每个字符串为 u32 字节长度加 UTF-8 字节，不带标签）。JS 侧的 `OpWriter`（`@weft-ui/runtime` 的 `src/ops.ts`）复用同一块缓冲，每批的字节只在下一次写入前有效。

版本号、opcode、值标签、解码错误种类、平台名和平台调用模块，都只在 [`protocol/weft.protocol.json`](weft.protocol.json) 中定义一次。`pnpm gen:protocol`（`protocol/generate.ts`）据此生成 TypeScript、Rust、C++、Swift、Kotlin 和 C# 的常量；生成文件过期时 `pnpm test` 会失败。

内置元素单独定义在 [`protocol/weft.elements.json`](weft.elements.json) 中。同一命令生成 Rust 和 TypeScript 目录、内置字符串联合的原生枚举，以及来自 [`protocol/weft.css`](weft.css) 的基础样式表常量。成员顺序不能随意改动：属性下标是小程序数据键的一部分。两份目录共用 `CSS_PROPS` 映射表，按首次使用顺序列出去重后的 CSS 映射。

## 解码错误

一批 ops 解码失败时只会报下面 5 种错误之一，所有读取器使用相同的种类名：

| 种类        | 原因 |
| ----------- | ---- |
| `truncated` | 批次为空，或者某个长度、数量超出剩余字节。 |
| `version`   | 第一个字节不是支持的版本号。 |
| `opcode`    | op 以未知的 opcode 开头。 |
| `tag`       | 值以未知的标签开头。 |
| `utf8`      | 字符串值不是格式良好的 UTF-8：overlong 编码、代理项、超过 U+10FFFF 的码点、截断的多字节序列和孤立的续字节都会被拒绝。 |

- 解码失败的批次按各宿主现有的方式处理，整批都不应用。
- 读取器先判断 opcode，再读取该 op 的字段，所以未知 opcode 后面即使没有字节，也报 `opcode`。
- 事件载荷解码失败时，内核记录错误，`weft_runtime_dispatch` 返回 `true`。

共享样例在 [`protocol/corpus/`](corpus/)，列出编码后的批次及其解码结果或错误种类、编码后的值，以及平台调用的帧。各宿主的读取器、值编码器和帧编解码都用它测试。

## 版本

启动时内核比较壳的 `weft_host` 第一个字段 `protocol` 与生成的 `weft::protocol::kVersion`；不一致时记录 `weft: protocol mismatch: kernel speaks 3, shell speaks 2` 并返回 NULL。`__weft.open` 先比较 bundle 与内核的协议版本，再检查布局哈希；版本不一致时抛出 `weft: protocol mismatch: bundle speaks 3, kernel speaks 2`。启动失败时壳原样记录内核日志。这是构建期检查的补充；Web 和小程序的 bundle 与视图一起构建，无需协商。

- 协议版本是 [`weft.protocol.json`](weft.protocol.json) 里的整数 `version`，写在每个批次的第一个字节。凡是现有读取器或内核会误读的变化（新增 opcode、值标签、字段布局，或者改变某个 op、事件的语义），都要把它加一。旧读取器永远收不到的新增内容不需要加一。
- 每个原生壳包（`@weft-ui/native-<target>`）在 `package.json` 的 `weft.protocol` 里记录它实现的协议版本，由 `pnpm gen:protocol` 写入。原生构建之前，`@weft-ui/vite` 把它与编译产物所用的 `@weft-ui/runtime` 的协议版本比较，不一致时直接报错并给出两边的版本，不会等到设备上才失败。
- 所有 `@weft-ui/*` 包一起发布，版本号相同。1.0 之前，minor 版本可以有破坏性变更；协议版本每次变化都伴随一个新的 minor 版本，patch 版本不改协议。请让所有 `@weft-ui/*` 包保持同一版本。
- 1.0 起，同一主版本内编译器、运行时、内核和壳可以混用的范围写在本节（ROADMAP M6.6）。

## 文本形式

调试 dump 和黄金文件使用的一行一个 op 的形式，字符串、字符串数组和布尔值按 JSON 书写：

```
create 3 2
set 3 0 "milk"
rows 2 0 [3 4 5]
branch 1 0 0
attach 0 0 1
splice 2 0 0 0 [1/0 2/1 3/1]
bind 2 0 1 7
bind 2 0 3 0
nav 0 [4 0] [9 11] 13 sheet
nav 0 [4] [] 0
```

无头渲染器在 `#` 后附上模板 label 或槽位说明，例如 `create 1 0  # TodoList`、`set 1 0 ""  # Input.value`。

## Sink

`Sink` 是平台一侧的接口（`src/remote.ts`）：

- `open(session)`：mount 时调用一次，`session` 带 `hash`、`dispatch` 和 `detach`（平台视图先于 app 消失时调用）。
- `create` / `set` / `branch` / `rows` / `attach` / `splice` / `bind` / `nav`：记录本批 ops。
- `commit()`：一次 flush 结束，应用整批。
- `close()`：unmount，丢弃所有 scope。

小程序 sink（`./wechat`）不编码，直接把 ops 翻译成 `setData` 路径，数据形状见下文；无头渲染器经过二进制编码；原生 sink（`./native`）把缓冲交给 `__weft.commit`，见下一节。

### 小程序数据布局

WXML 只渲染 `{{key}}`，`setData` 的路径就是块数据树中的路径（`N` 是 IR 中的节点编号）：

| key             | 内容                                                                     |
| --------------- | ------------------------------------------------------------------------ |
| `n{N}_{i}`      | 属性值、文本                                                             |
| `e{N}_{k}`      | 元素第 `k` 个事件的处理器 id（从 0 开始，由 sink 分配）。WXML 写成 `bind<type>="$e"` 和 `data-e<type>="{{e{N}_{k}}}"`，`type` 是小写的小程序事件名。`tap` 使用 `catchtap` 而非 `bindtap`，因此只有最内层的处理器会执行。 |
| `i{N}` / `b{N}` | `if` 当前分支下标 / 分支数据                                             |
| `l{N}`          | 普通 `for` 的行数组，每行带 `k`（行的 scope ID）；惰性挂载点为段数组 `{k, h, r}`：`k` 是段号，`h` 是占位高度（像素），`r` 是项数组，窗口外为 `null`。每项有 `k`（item ID）、`t`（模板下标），绑定后还包含物化 scope 的数据。 |
| `c{N}`          | 组件实例数据                                                             |
| `y{N}`          | 第一个 `Children` 参数的插槽数据                                         |
| `y{N}_{p}`      | 其他 `Children` 参数的插槽数据，`p` 是该参数在整个参数列表中从 0 开始的下标 |

List 段最多包含 20 项。Grid 段容量为不超过 20 的最大 `columns` 整数倍；`columns` 大于 20 时一段为一行，确保行不跨段。窗口外的段将 `r` 设为 `null`，以 `h` 保留测量高度；尚未测量时按同模板已测量项的平均高度估计，无测量值时使用 44 逻辑像素。网格段按行渲染。相对于滚动视图的 IntersectionObserver 请求向视口两侧各扩展约一屏的窗口。

插槽数据的 `t` 字段保存插槽内容的模板名。调用方为被调用组件的第一个 `Children` 参数使用 `{组件}-s{N}`，其他插槽用 `{组件}-s{N}_{p}`。这里的 `N` 是调用节点编号，不是接收方数据键里的插槽节点编号。

`$e` 从 `currentTarget.dataset["e" + event.type]` 取处理器 id。`tap` 和 `confirm` 不带载荷；`input`、`change` 和 `changing` 的载荷为 `detail.value`。`focus` 和 `blur` 分别传入 `true` 和 `false`，两者绑定到同一个 `onFocusChange` 处理器 id。

生成的视图表中，直接使用的值槽写成 `[key]`，样式值槽写成 `[key, cssIndex]`。sink 按 `CSS_PROPS[cssIndex]` 把样式值转换为完整的 CSS 声明。模板按 schema 的成员顺序拼接静态和动态声明，使单边等更具体的内外边距设置覆盖较宽泛的设置。

图片的 `src` 在布局和 ops 中仍是字符串。小程序视图表用 `[key, "src"]` 标记图片槽（后面可带尺寸键），静态 `asset:` 地址放在表的 `a` 字段里。sink 根据 `assets.js` 和窗口像素比解析资源地址。图片加载成功时，尺寸声明写入 `m{N}`，占位色消失；这个过程独立于逻辑批次，由 `ws` 标识接收事件的 scope。

`view.wxss` 总是包含基础样式表。声明了主题时，它还在 `:host` 上定义令牌变量，并在深色媒体查询中覆盖其值。生成的视图表列出有效令牌名；引用这些令牌的动态 `Color` 值写成 `var(--weft-name)`。未知令牌显示为透明。

`setData` 规则：

- 每次 flush 每个视图只调用一次 `setData`。块的 `set` 用 `===` 比较新旧值，只发送变化的叶子，路径如 `r.b8.l7[2].n3_0`。
- 列表只在末尾追加时发送新行的下标路径（`l7[3]`）；删除、移动、插入时整体发送行数组，复用的行保留原有处理器 id；顺序没变时不发送。
- 同一次 flush 中被其他路径覆盖的路径（祖先已整体发送）会被丢弃。

## 原生内核

原生平台的 JS bundle 跑在 `native/core` 的内核里：内核嵌入 Hermes，执行 `bundle.hbc`，通过 C ABI（[`native/core/include/weft/runtime.h`](../native/core/include/weft/runtime.h)）和平台壳通信。iOS / macOS 的平台壳是 `native/apple` 的 WeftKit，Android 的是 `native/android` 的 Kotlin 模块（通过 JNI 加载 `libweft.so`），Windows 的是 `native/windows` 的 Weft.WinUI（通过 P/Invoke 加载 `weft_core.dll`），Linux 的是 `native/linux` 的 C++ 库（链接 `libweft_core.so`）。内核不开线程，所有函数都在 UI 线程上调用，且不能在 `weft_host` 回调里重入。

平台壳通过 `weft_host.launch` 提供以 NUL 结尾的 UTF-8 JSON 启动参数，内核在启动时复制，NULL 表示 `{}`。壳以 `weft_runtime_window(rt, scope, point, start, end)` 请求惰性挂载点的半开窗口，以 `weft_runtime_signal(rt, name, json, len)` 发送宿主事件，未知名称被忽略。信号包括 `navigation`（`tab`、`stack`、`modal`）、`lifecycle`（`state`）、`memory`（`{}`）和 `link`（`url`）。

### `__weft` 全局

内核在 bundle 运行前安装，`@weft-ui/runtime/native` 和 `@weft-ui/platform` 的原生实现通过它工作：

| 成员                              | 含义                                                         |
| --------------------------------- | ------------------------------------------------------------ |
| `open(hash, dispatch, protocol, window)` | 打开 sink；`window` 接收 scope、point、start、end。先检查协议再检查布局哈希；不一致或已有 app 打开时抛错 |
| `protocol`                        | 内核的协议版本 |
| `launch`                          | 启动参数 JSON 字符串，默认为 `{}` |
| `on(name, callback)`              | 每个名称注册一个信号回调，再次注册替换前一个；回调接收 JSON 字符串 |
| `commit(buffer, offset, length)`  | 一批 ops。内核把这段字节直接交给 `weft_host.commit`，不复制  |
| `close()`                         | sink 的 `close`；之后的事件被忽略                            |
| `supports(module)`                | 平台壳是否实现平台模块 `module`                              |
| `call(module, method, args?)`     | 平台调用，返回 `Promise<ArrayBuffer>`。`args` 是字符串（按 UTF-8 发送）、`ArrayBuffer` 或其视图。模块不受支持时立即以 `Error` 拒绝 |
| `version`                         | 平台壳报告的系统版本（`weft_host.version`）                  |
| `environment`                     | 当前窗口环境的 JSON 字符串                                    |
| `listen(callback)`                | 注册一个无参数的环境变化回调；再次注册会替换前一个            |

内核还注入 `setTimeout` / `setInterval` / `clearTimeout` / `clearInterval`、`queueMicrotask` 和 `console`（`debug` / `log` / `info` / `warn` / `error` 对应 `weft_host.log` 的 0–3 级；非字符串参数按 JSON 输出，错误对象输出 `stack`）。`TextEncoder` / `TextDecoder` 由 Hermes 自带。

### 环境

平台壳通过 `weft_host.environment` 提供初始环境：以 NUL 结尾的 UTF-8 JSON 字符串，内核在 `weft_runtime_new` 时复制。传空指针时使用 `{}`。对象格式如下：

```json
{
  "colorScheme": "light",
  "screen": { "width": 390, "height": 844, "scale": 2 },
  "safeArea": { "top": 47, "bottom": 34, "start": 0, "end": 0 },
  "orientation": "portrait"
}
```

`colorScheme` 为 `light` 或 `dark`。`screen` 提供窗口内容尺寸（逻辑像素）和像素密度。`safeArea` 是窗口各边被系统界面占用的内边距（逻辑像素，`start` 是左边，`end` 是右边），桌面平台的四边均为 0。宽度大于高度时，`orientation` 为 `landscape`；否则为 `portrait`。

任一字段变化时，平台壳在 UI 线程调用 `weft_runtime_environment(rt, json, len)`，传入完整对象的 UTF-8 字节；字段值都相同时不推送。内核先替换 `__weft.environment`，再调用已注册的回调，返回前清空微任务队列。

### 事件循环

- `weft_runtime_new` 执行 bundle（bundle 在其中挂载 app），之后每个会执行 JS 的入口（`new`、`tick`、`dispatch`、`resolve`、`environment`、`window`、`signal`）返回前都清空微任务队列。所以 `weft_runtime_new` 返回时第一批 ops 已经提交。
- 定时器按到期时间、同一时间按设置顺序执行，每个定时器之后清空一次微任务；在一次 `tick` 里新设的定时器留到下一次。内核用 `weft_host.schedule(delay)` 请求下一次 `tick`，平台壳可以合并请求，提前或多余的 `tick` 无害。
- 未捕获的异常（bundle、定时器、微任务、事件处理函数或环境变化回调中）以 `WEFT_LOG_ERROR` 报告，不终止运行时。bundle 本身抛错（包括布局哈希不一致）时 `weft_runtime_new` 返回 `NULL`。

### 事件载荷

`weft_runtime_dispatch(rt, scope, slot, payload, len)` 的 `payload` 是一个按[二进制编码](#二进制编码版本-3)的值（标签字节加数据）。字符串数组只用作视图值，不能作为事件载荷。无载荷的事件传空。返回值即 `Session.dispatch` 的返回值。

若 `Input` 或 `TextArea` 设置了 `maxLength`，宿主在派发 `onChange` 前按 UTF-16 码元数截断用户编辑后的文本。内核收到的是截断后的载荷。

### 平台调用

`__weft.call` 分配调用 id 并调用 `weft_host.call(id, module, method, args)`；平台壳异步完成后在 UI 线程调用 `weft_runtime_resolve(id, ok, result)`，每个 id 恰好一次。`ok` 时 Promise 以 `result` 的 `ArrayBuffer` 副本兑现，否则以消息为 `result`（UTF-8）的 `Error` 拒绝。字节的含义由各模块约定：

| 模块      | 方法                         | 参数                                                         | 结果                                       |
| --------- | ---------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| `fetch`   | `request`                    | 帧：`u32 头长度（小端） \| 头（UTF-8 JSON）\| 请求体`，头是 `{"url", "method", "headers"}` | 同样的帧，头是 `{"status"}`，之后是响应体 |
| `storage` | `get` / `set` / `remove`     | JSON 数组：`[key]` 或 `[key, value]`                         | `get`：JSON 字符串或 `null`；其余为空      |
| `ui` | `alert` / `confirm` / `actionSheet` / `toast` | UTF-8 JSON 对象，字段为对应 UI 选项；`toast` 使用 `{"message", "icon", "duration"}` | `alert` 和 `toast`：空；`confirm`：JSON `true` 或 `false`；`actionSheet`：JSON 选中项下标或 `null`。`toast` 显示后立即完成。 |
| `navigation` | `badge` | UTF-8 JSON 对象 `{"tab", "text"}`：`tab` 是布局 `app.tabs` 的下标，`text` 为字符串（`""` 显示圆点）或 `null`（移除角标） | 空，立即完成 |

`navigation.badge` 由运行时在应用调用 `navigation.setBadge` 时同步发起，不随 op 批次排序，可能早于第一个 `nav`；壳按 Tab 下标保存角标，建好 Tab 栏时再应用。壳不支持 `navigation` 时运行时不发起调用。

`@weft-ui/platform` 在 `supports(api)` 为假时直接抛 `PlatformError`，不发起调用。

### 列表移动

自己移动原生行的平台壳（WinUI、GTK）可以用 `weft_stable_rows(old, new, stable)`：它标出新顺序里保持原位的行（旧位置的最长递增子序列），其余行需要移动或插入。C++ 平台壳可以用 `weft/ops.hpp` 解码 ops，解码不分配内存，字符串和行列表直接指向这批字节。
