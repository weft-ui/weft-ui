---
title: 页面与导航
description: 声明页面，在逻辑层跳转并监听页面的显示状态。
sidebar:
  order: 4
---

导航由逻辑层控制：页面发出事件，处理器调用 `navigation`。页面不是组件，不能作为视图节点使用，也不能直接挂载。

## 声明应用和页面

将下面内容保存为 `Notes.weft`：

```weft
event OpenDetail
event BackHome

page Home() {
    NavBar(title = "笔记")
    Button(onClick = OpenDetail) { Text("打开笔记") }
}

page Detail(id: String) path "/notes/{id}" {
    NavBar(title = "笔记 ${id}") {
        BarButton(label = "首页", onTap = BackHome)
    }
    Text("笔记 ${id}")
}

app Notes { start = Home }
```

应用有一个起始页，它不能有必填路由参数。应用包含声明文件的传递导入闭包内的所有页面；每个页面都需要工厂，包括不能通过按钮到达的页面。一个程序最多声明一个 `app`。没有 `app` 的程序仍可按[逻辑与事件](/zh/guides/logic/)中的方式挂载根组件。

页面体与组件一样可以包含 `state`、`let` 和节点。第一个参数可以是模型，其余参数为路由参数，类型可以是 `Int`、`Float`、`Bool`、`String`、字符串字面量联合及其可空形式。可空参数和带常量默认值的参数可以省略。路径以 `/` 开头，可包含字面量段和 `{name}` 参数段；路径参数必须是必填的 `String`、`Int` 或联合类型。其他参数放在查询字符串中。省略 `path` 时，页面名转为 kebab-case 路径，例如 `/user-profile`。路径不能重叠。详细规则见[语法](https://github.com/weft-ui/weft-ui/blob/master/crates/parser/GRAMMAR.zh-CN.md#页面)。

## 创建页面并跳转

在 `index.ts` 中为每个页面提供工厂，并在工厂里为新实例注册处理器：

```ts
import { run, navigation } from "@weft-ui/platform";
import { Notes, Home, Detail } from "./Notes.weft";

run(new Notes({
  Home: () => {
    const page = new Home({});
    page.onOpenDetail(() => navigation.push(Detail, { id: "42" }));
    return page;
  },
  Detail: (params) => {
    const page = new Detail(params);
    page.onBackHome(() => navigation.popToRoot());
    page.onShow(() => console.log("Detail shown"));
    page.onHide(() => console.log("Detail hidden"));
    return page;
  },
}));
```

有模型的页面构造函数先接收模型，再接收路由参数。生成的 `PageParams` 类型描述路由参数，`page.params` 为只读。每次需要新页面实例时都会调用工厂，因此实例的处理器应在工厂内注册，而不是全局注册一次。

- `navigation.push(Page, params)` 在当前页面上方创建页面。
- `navigation.replace(Page, params)` 替换栈顶页面，不能替换根页面。
- `navigation.pop(count)` 返回指定页数，默认一页；超过栈深度时停在根页面，小于一时抛出 `RangeError`。
- `navigation.popToRoot()` 移除根页面上方的所有页面。
- `navigation.stack` 是从根到栈顶的只读路由列表，每条路由包含页面名和只读参数。`navigation.onChange(listener)` 订阅变化并返回取消订阅函数。

请在应用挂载后调用导航接口。没有 `app` 声明的程序不能使用这些接口。

## Tab

可以用两个到五个不同的 Tab 页面代替 `start`；这些页面不能有必填路由参数：

```weft
app Notes {
    tabs {
        Home(title = "首页", icon = "asset:tab_home")
        Settings(title = "设置", icon = "asset:tab_settings", activeIcon = "asset:tab_settings_active")
    }
}
```

每项都需要字面量标题和 `asset:` 图标；省略 `activeIcon` 时使用 `icon`。微信小程序的 Tab 图标必须是 PNG 或 JPEG。与上面的示例一样，为所有页面提供工厂：Tab 根页面首次选中时创建，之后保留。

使用 `navigation.switchTab(Settings)` 切换 Tab 并清空推入的页面栈。`navigation.tab` 返回当前 Tab 的页面名，没有 Tab 时为 `null`。`navigation.setBadge(Settings, "3")` 显示角标，传入 `""` 显示红点，传入 `null` 移除角标。macOS 的 Tab 显示在工具栏的分段选择器中，不显示图标；角标显示在 Tab 标题中。Linux 的 GTK 只能显示圆点，文字角标也显示为圆点。推入的页面会盖住 Tab 栏。Web 切换 Tab 时回到根历史条目，再将它替换为所选 Tab 的 URL。

## 模态页面

用 `navigation.present(Detail, { id: "42" })` 在当前导航栈上方呈现页面。默认样式为 `sheet`；全屏页面可用 `navigation.present(Detail, { id: "42" }, { style: "fullScreen" })`。模态页面与其他页面一样需要工厂。`navigation.modal` 返回其路由，没有模态页面时为 `null`；`navigation.dismiss()` 关闭模态页面，没有打开时不做任何操作。

同一时间只能呈现一个模态页面。模态打开时调用 `push` 或 `replace` 会抛错；多步骤流程可以在模态页内切换内容。返回时先关闭模态，在 `pop(count)` 中计为一页；`popToRoot()` 和 `switchTab()` 也会关闭它。下方页面仍保留在栈中，模态关闭后重新成为当前页。

Web 上可用 Escape、浏览器后退、关闭按钮或（对 sheet）点击遮罩关闭模态。打开时焦点限制在对话框内。微信小程序使用带独立标题行的页面容器；sheet 还可以下滑关闭。

## 标题、显示状态与返回

`NavBar` 可以省略；使用时必须是页面的第一个顶层节点，且每个页面最多一个。`title` 可以动态变化。`hidden = true` 隐藏标题栏，但不禁用返回手势或按键。没有 `NavBar` 时宿主显示空标题。`BarButton` 只能放在标题栏内，必须提供无障碍名称 `label`；没有 `icon` 时显示标签文字。图标使用 `asset:` 资源。

页面在应用处于前台时成为当前页会触发 `onShow`；不再是当前页或应用进入后台时触发 `onHide`。导航状态改变后、同一次 flush 之前同步调用，先隐藏旧页再显示新页。首次挂载时起始页收到 `onShow`。离开导航状态的页面会被销毁。页面事件名不能使用保留的 `Show` 和 `Hide`。

返回手势、浏览器后退和小程序返回按钮都回到上一页；在根页面则交给系统处理。被遮住的页面在移出栈之前仍然保留。

## 平台差异

- **Web**：导航使用 History API 路径，不使用 hash 路由。静态托管需要将未知路径回退到 `index.html`。刷新会恢复起始页和当前路由；浏览器后退使用历史条目中保存的路由。转场遵守 `prefers-reduced-motion`。
- **微信小程序**：每个 Weft 页面对应一个小程序页面。平台页面栈最多 10 层，超过时 push 抛错。直接启动到非起始页时，栈中只有该页，平台提供返回首页入口。动态标题会更新原生标题栏。`BarButton` 被忽略，因此必要操作也要放在页面内容中。
- **iOS**：SwiftUI `NavigationStack`，标题内联显示；从前沿边缘滑动返回。`BarButton` 显示为工具栏的主要操作。
- **macOS**：窗口工具栏显示标题、返回按钮和 `BarButton`；⌘[ 也能返回，标题栏隐藏时同样有效。
- **Android**：Navigation 3 返回栈加 Material 顶部应用栏。系统返回与预测性返回回到上一页。
- **Windows**：标题行包含返回按钮、标题，`BarButton` 显示为应用栏按钮；Alt+Left 与鼠标后退键也能返回。
- **Linux**：GTK 标题区包含返回按钮、标题和 `BarButton`；Alt+Left 与鼠标后退键也能返回。
