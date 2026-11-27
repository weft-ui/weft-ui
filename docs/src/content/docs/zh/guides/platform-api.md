---
title: 平台 API
description: 在各平台使用同一套 API 启动 Weft UI 应用、发送 HTTP 请求和保存数据。
sidebar:
  order: 4
---

在应用入口和[逻辑层](/zh/guides/logic/)中，从 `@weft-ui/platform` 导入接口。Web、微信小程序和原生应用共用这套 API，具体可用的接口和类型见 [TypeScript 声明](https://github.com/weft-ui/weft-ui/blob/master/packages/platform/src/index.d.ts)。

## 用 `run` 启动应用

`run(app: App): void` 接收生成的根组件或应用实例。包含页面的应用见[页面与导航](/zh/guides/navigation/)。包导出的 `App` 类型描述了实例的生命周期：`mount(target: never): void` 和 `unmount(): void`。宿主负责提供挂载目标，启动应用时无需自己调用 `mount`。

在[待办事项示例](/zh/guides/logic/)中，`App` 由 `App.weft` 生成。先注册需要的事件处理器，再调用 `run`：

```ts
import { run } from "@weft-ui/platform";
import { App } from "./App.weft";

const app = new App({ clicked: false, draft: "", todos: [] });
run(app);
```

在 Web 上，`run` 将应用挂载到 `id="app"` 的元素上；找不到该元素时会抛出 `Error`。在微信小程序中，它通过 `App(...)` 注册生成的视图和生命周期回调。在原生目标上，它通过原生运行时把应用挂载到平台壳提供的视图中。应用入口和构建配置见[快速上手](/zh/guides/getting-started/)。

## 用 `fetch` 发送 HTTP 请求

包导出了 `fetch`，以及跨平台的 `RequestInit`、`Response` 类型：

```ts
export declare function fetch(url: string, init?: RequestInit): Promise<Response>;

export interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
}

export interface Response {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
```

- 不传 `method` 时默认为 `GET`。发送 JSON 时，用 `JSON.stringify(data)` 生成请求体，并在 `headers` 中设置 `Content-Type: application/json`。跨平台请求建议使用绝对 HTTPS URL，具体哪些请求能发出仍取决于宿主的网络规则。
- HTTP 错误状态本身不会让请求的 Promise 拒绝。读取响应体前先检查 `ok`（状态码为 200–299 时是 `true`）或 `status`。`text()` 读取 UTF-8 文本，`json()` 解析 JSON，`arrayBuffer()` 读取原始字节。浏览器中的响应体只能读取一次，因此跨平台代码中每次只调用一种读取方法。
- 通用接口不提供响应头、流式响应体、`FormData` 请求体、取消信号或超时选项。Weft UI 没有规定统一的大小上限，宿主的限制仍然适用。共用代码不要依赖浏览器 Fetch 独有的选项。

下面的函数从你提供的 JSON 接口加载初始待办事项。加载失败时不改动本地列表。将结果写入模型前，先检查数据结构：`json()` 只解析 JSON，不会根据模型类型校验数据。

```ts
import { fetch, PlatformError } from "@weft-ui/platform";

async function loadStarterTodos(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      console.error(`Could not load starter todos: HTTP ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    if (error instanceof PlatformError && error.api === "fetch") {
      console.warn("Network requests are unavailable; keeping local todos.");
    } else {
      console.error("Could not request or decode starter todos", error);
    }
    return null;
  }
}
```

## 用 `storage` 保存状态

键和值都是字符串。键不存在时，`get` 返回的 Promise 兑现为 `null`，与存入的空字符串不同。要保存对象，先用 `JSON.stringify` 序列化，读取后再解析。要清除保存的值，用 `remove`，不要存入字符串 `"null"`。

```ts
export declare const storage: {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};
```

在待办事项示例的入口中，把这些处理器加在 `run(app)` 前面；如果已有挂载和点击处理器，就替换它们。根组件挂载时恢复 `clicked`，点击后保存。即使存储不可用或写入失败，点击仍会更新视图。

```ts
import { isSupported, storage } from "@weft-ui/platform";

app.onMount(async (model) => {
  if (!isSupported("storage")) return;
  try {
    model.clicked = (await storage.get("clicked")) === "true";
  } catch (error) {
    console.warn("Could not restore the clicked state", error);
  }
});

app.onClick(async (model) => {
  model.clicked = true;
  if (!isSupported("storage")) return;
  try {
    await storage.set("clicked", "true");
  } catch (error) {
    console.warn("Could not save the clicked state", error);
  }
});
```

要清除保存的状态，调用 `await storage.remove("clicked")`。这只删除持久化数据，不改变当前模型。

## 用 `ui` 显示对话框、操作表和提示

```ts
import { ui } from "@weft-ui/platform";

await ui.alert({ title: "已保存", message: "更改已保存。" });
const confirmed = await ui.confirm({ message: "删除此项？", destructive: true });
const selected = await ui.actionSheet({ title: "选择操作", options: ["编辑", "删除"], destructiveIndex: 1 });
ui.toast("已保存", { icon: "success", duration: "short" });
```

`alert` 接受可选的 `title`、`message` 和 `confirmText`，兑现时没有返回值。`confirm` 还接受 `cancelText` 和 `destructive`，返回布尔值。按钮文字默认为 `OK` 和 `Cancel`。`actionSheet` 接受可选的 `title`、必填的 `options`、可选的从零开始的 `destructiveIndex` 和可选的 `cancelText`；返回选中项的下标，取消时返回 `null`。选项必须为 1–6 项，否则立即以 `RangeError` 拒绝。微信小程序无法单独为操作表选项着色，因此 `destructiveIndex` 在该平台没有视觉效果。

同一时刻最多显示一个对话框或操作表，后续调用按先进先出排队。通过系统方式关闭（如返回键、Esc、点击遮罩）时，`confirm` 返回 `false`，`actionSheet` 返回 `null`。Toast 不排队，新的会替换旧的。Toast 的 `icon` 可为 `none`、`success` 或 `error`；`duration` 可为 `short`（默认，1.5 秒）或 `long`（3 秒）。

五个原生平台壳都用各自平台的对话框实现了 `ui`：SwiftUI 的 alert 与 confirmationDialog（macOS 上操作表以对话框呈现）、Android 的 Material 对话框与底部面板、Windows 的 `ContentDialog`、Linux 的 `GtkAlertDialog`（无法为危险选项单独着色）。不支持 `ui` 的宿主让 `isSupported("ui")` 返回 false，此时对话框和操作表调用以 `PlatformError` 拒绝，`toast` 则同步抛出该错误。

## 监听应用生命周期

`lifecycle.state` 初始为 `foreground`，应用隐藏时变为 `background`。用 `onForeground`、`onBackground` 或 `onMemoryWarning` 注册监听器；注册时不会立即调用，返回值是取消订阅函数。进入后台时当前页收到 `onHide`，回到前台时收到 `onShow`。桌面上的后台指窗口最小化或隐藏。

`lifecycle.launch.url` 是冷启动链接，没有时为 `null`。Web 上是加载时的 `location.href`，小程序上由启动路径和编码后的查询参数组成。Web 不会发出内存告警；原生通知取决于平台壳。

```ts
import { lifecycle } from "@weft-ui/platform";
const stop = lifecycle.onBackground(() => console.log("background"));
console.log(lifecycle.state, lifecycle.launch.url);
// 不再需要时调用 stop()。
```

## 查看宿主和可用能力

用 `platform.os` 和 `platform.version` 查看当前宿主。`os` 的取值为 `web`、`wechat`、`ios`、`macos`、`android`、`windows` 或 `linux`。`version` 是宿主报告的字符串，不是 Weft UI 的包版本，也没有跨平台的统一格式。比如，在 Web 上它是完整的用户代理字符串；在原生目标上，如果没有内核或平台壳没有提供版本，它就是空字符串。

`isSupported(api: "fetch" | "storage" | "ui" | "navigation"): boolean` 检查当前宿主是否提供该能力，不会实际执行操作。`navigation` 表示宿主能否显示 `navigation.setBadge` 设置的 Tab 角标。可以据此选择备用方案。返回 `true` 不代表某次调用一定成功。

| 目标 | `fetch` | `storage` | `platform.version` |
| --- | --- | --- | --- |
| Web | `globalThis.fetch`（如果存在） | 浏览器的 `localStorage`（如果可访问） | `navigator.userAgent` |
| 微信小程序 | `wx.request`（如果存在） | 需要同时提供 `wx.getStorage`、`wx.setStorage` 和 `wx.removeStorage` | `wx.getAppBaseInfo().version` |
| iOS 和 macOS | `URLSession` | `UserDefaults.standard` | 操作系统的主版本号、次版本号和补丁版本号 |
| Android | `HttpURLConnection` | 应用的 `SharedPreferences` | `Build.VERSION.RELEASE` |
| Windows | `HttpClient` | 应用本地数据目录中的 `storage.json` | `Environment.OSVersion.Version` 转成的字符串 |
| Linux | libsoup | 应用的 XDG 用户数据目录中的 `storage.json` | 发行版版本标识，取不到时用内核版本 |

Weft UI 自带的五个原生平台壳均实现了这两项能力。原生实现会向正在运行的平台壳查询支持情况。宿主配置见[平台指南](/zh/guides/platforms/)，原生调用格式见[视图协议规范](https://github.com/weft-ui/weft-ui/blob/master/protocol/SPEC.zh-CN.md#平台调用)。

## 读取窗口环境

- `platform.colorScheme` 为 `"light"` 或 `"dark"`。微信小程序需要在 `app.json` 中开启 `"darkmode": true` 才能读取系统外观；Linux 通过桌面设置门户读取。取不到时为 `"light"`。
- `platform.screen` 提供窗口内容的 `width` 和 `height`（逻辑像素），以及像素密度 `scale`。原生窗口首次布局前，宿主可能先报告临时尺寸。
- `platform.safeArea` 是窗口各边被系统界面占用的内边距（逻辑像素），其中 `start`、`end` 分别是左边和右边。原生桌面平台四边均为 0。
- 窗口宽度大于高度时，`platform.orientation` 为 `"landscape"`；否则为 `"portrait"`。

可以直接读取这些字段，也可以订阅变化。`onChange` 注册时不会立即调用监听器，更新后的值可读时才会调用。它返回一个取消订阅的函数。

```ts
import { platform } from "@weft-ui/platform";

function reportEnvironment() {
  console.log(platform.colorScheme, platform.screen, platform.safeArea);
}

reportEnvironment();
const stop = platform.onChange(reportEnvironment);
// 不再需要更新时调用 stop()。
```

## 用 `PlatformError` 处理不可用的 API

如果宿主不提供所需能力，`fetch` 和 `storage` 的三个方法都会以 `PlatformError` 拒绝 Promise。`PlatformError` 继承自 `Error`。构造函数接收 `(api, os)`，其中 `api` 为 `"fetch"`、`"storage"` 或 `"ui"`，`os` 为上面列出的平台名称。错误对象的 `name` 固定为 `"PlatformError"`，有只读的 `api` 字段以及 `message`，例如 `fetch is not supported on web`。错误对象没有单独的 `code` 或 `os` 字段。判断错误时，用 `instanceof PlatformError` 和 `error.api`，不要匹配错误消息。

网络、存储操作和 JSON 解析失败仍可能以其他错误拒绝 Promise。`PlatformError` 只表示宿主没有提供相应能力。

## 构建时如何选择实现

各目标都使用同一个 `@weft-ui/platform` 导入路径。[包的导出配置](https://github.com/weft-ui/weft-ui/blob/master/packages/platform/package.json)提供共用的 `types` 入口和三个运行时导出条件：Web 使用 `weft-web`，微信小程序使用 `weft-wechat`，iOS、macOS、Android、Windows 和 Linux 使用 `weft-native`。运行时没有 `default` 导出条件。

[`@weft-ui/vite` 插件](https://github.com/weft-ui/weft-ui/blob/master/packages/vite/src/index.ts)把 `weft-<platform>` 加入各 Vite 构建环境的解析条件；如果是原生目标，再加入 `weft-native`。插件还会把构建期常量 `__WEFT_PLATFORM__` 定义为该目标的名称。开发服务器使用 Web 实现。在构建时选择目标即可，例如 `WEFT_PLATFORM=android vite build`，无需在运行时按平台切换导入。构建配置见[平台指南](/zh/guides/platforms/#配置-vite)。
