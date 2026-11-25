---
title: 快速上手
description: 构建 Weft UI 待办示例，并在浏览器中运行。
sidebar:
  order: 1
---

用 Weft UI 开发时，视图写在 `.weft` 文件里，各平台共用一套 JavaScript 或 TypeScript 逻辑。Weft UI 会把视图编译为 Web 上的 DOM、微信小程序里的 WXML，以及 iOS、macOS、Android、Windows 和 Linux 上的原生界面。先运行待办示例的 Web 版本，不需要安装原生平台的 SDK。

## 准备工作区

你需要 Git、Node.js 26，以及[仓库根目录 `package.json`](https://github.com/weft-ui/weft-ui/blob/master/package.json) 指定版本的 pnpm。示例用的是从仓库源码构建的 Weft UI 编译器，因此还需要 Rust 和 Cargo、[`wasm32-unknown-unknown` 目标](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html)，以及与[工作区锁定版本](https://github.com/weft-ui/weft-ui/blob/master/Cargo.toml)一致的 `wasm-bindgen-cli`。如果你用 rustup 安装了 Rust，可用以下命令安装目标和 CLI：

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.130 --locked
```

克隆仓库，安装依赖并构建编译器：

```sh
git clone https://github.com/weft-ui/weft-ui.git
cd weft-ui
pnpm install
pnpm build
```

## 运行 Web 示例

在仓库根目录构建示例，再启动本地预览：

```sh
pnpm --filter example build:web
pnpm --filter example exec vite preview --outDir apps/web
```

构建产物位于 `example/apps/web/`。打开 Vite 打印的本地网址，在 **New todo** 输入框里输入 `Buy milk`，然后点击 **Add**。列表中应出现这条待办，计数变为 `1 todos`。

修改源码时，可以用 `pnpm --filter example exec vite` 启动开发服务器，不用每次都重新构建和预览。Vite 插件在开发服务器里也会把导入的 `.weft` 文件编译为 Web 版本。

## 示例目录

- [`src/App.weft`](https://github.com/weft-ui/weft-ui/blob/master/example/src/App.weft) 声明数据模型、事件和视图。
- [`src/index.ts`](https://github.com/weft-ui/weft-ui/blob/master/example/src/index.ts) 初始化模型、处理事件并启动应用。
- [`vite.config.ts`](https://github.com/weft-ui/weft-ui/blob/master/example/vite.config.ts) 注册 `@weft-ui/vite` 插件。
- [`index.html`](https://github.com/weft-ui/weft-ui/blob/master/example/index.html) 是 Web 入口，负责加载 `src/index.ts`，并提供挂载点 `#app`。
- `apps/` 存放各平台的项目和构建产物。

## 点击 Add 后发生了什么

在 `App.weft` 中，`Input` 显示 `model.draft` 的值，输入时发出 `Draft` 事件。按钮触发 `Add` 事件；如果草稿去掉首尾空白后为空，按钮就不可点击：

```weft
Row(gap = 8) {
    Input(model.draft, onChange = Draft, placeholder = "New todo")
    Button(onClick = Add, disabled = model.draft.trim().isEmpty) {
        Text("Add")
    }
}
```

`index.ts` 从 `./App.weft` 导入编译生成的 `App`，用 `new App(...)` 创建实例，再注册更新模型的事件处理函数。视图读取的是同一个模型，所以添加待办后，列表随之更新，输入框也会清空：

```ts
app.onDraft((model, { value }) => {
  if (value.length <= MAX_LENGTH) model.draft = value;
});

app.onAdd((model) => {
  model.todos = [...model.todos, { id: nextId++, name: model.draft.trim(), done: false }];
  model.draft = "";
});
```

注册完事件处理函数后，调用 `@weft-ui/platform` 的 `run(app)`。在 Web 端，这会把应用挂载到 `#app`。

## 下一步

- [视图](/zh/guides/views/)：编写布局、数据绑定和列表。完整语言规则见 [Weft UI 语法规范](https://github.com/weft-ui/weft-ui/blob/master/crates/parser/GRAMMAR.zh-CN.md)。
- [逻辑](/zh/guides/logic/)：用 JavaScript 或 TypeScript 初始化模型、处理视图事件。
- [平台 API](/zh/guides/platform-api/)：在各平台共用存储和网络请求代码。
- [平台](/zh/guides/platforms/)：为其他平台构建并运行应用。
- [工具](/zh/guides/tooling/)：格式化 `.weft` 文件、在编辑器中连接语言服务器，以及用 TypeScript 检查 `.weft` 导入的类型。
