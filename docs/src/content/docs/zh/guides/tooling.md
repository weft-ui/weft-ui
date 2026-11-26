---
title: 编辑器与 TypeScript 工具
description: 格式化 Weft UI 文件，为编辑器接入 Weft UI 语言服务器，并检查 .weft 导入的类型。
sidebar:
  order: 6
---

编辑 `.weft` 文件时，可以用 Weft UI 语言服务器查看错误、补全代码。[仓库示例](https://github.com/weft-ui/weft-ui/blob/master/example/src/index.ts)中的 `import { Showcase } from "./App.weft"` 则由 TypeScript 内容映射器提供类型信息。同一个项目可以同时使用这两种工具。

## 安装 CLI

在 Weft UI 源码仓库的根目录运行以下命令。它会安装 `weft` 可执行文件，其中包含格式化工具和语言服务器。

```sh
cargo install --path crates/cli
```

## 格式化 Weft UI 文件

`weft fmt` 会直接改写文件。可以指定文件或目录，不传路径时从当前目录开始。扫描目录时会递归查找 `.weft` 文件，遵循 `.gitignore`，并跳过隐藏文件和目录。直接指定文件时，不限制扩展名。

```sh
weft fmt
weft fmt example/src/pages/Hello.weft
weft fmt --check example/src
```

在 CI 中可以用 `--check`：它只打印需要格式化的文件路径，不改写文件。如果有文件需要格式化，或检查时遇到错误，退出状态为 `1`。CLI 默认每层缩进 4 个空格，目标行宽为 100 列。遇到语法错误时会报告错误，不改写该文件；格式化不会加载导入的文件，也不会检查类型。

要格式化一段输入，可以从标准输入读取，再把结果写到标准输出。`--path` 可省略，只用于指定错误信息里显示的文件名。`--stdin` 不能与 `--check` 或位置参数一起使用。

```sh
weft fmt --stdin --path example/src/pages/Hello.weft < example/src/pages/Hello.weft
```

## 使用 Weft UI 语言服务器

`weft lsp` 通过标准输入和输出与编辑器通信，使用语言服务器协议（LSP）。在已接入的编辑器里打开 [`Feed.weft`](https://github.com/weft-ui/weft-ui/blob/master/example/src/pages/Feed.weft)（或任意 `.weft` 视图，比如待办组件），就可以试用以下功能：

- **诊断：** 编辑时会报告语法或语义错误。比如把 `todo.name` 改成 `Todo` 中没有声明的字段，就会看到错误提示。
- **补全：** 在循环体内输入 `todo.`，可以看到模型的字段。服务器还会根据当前位置提示可用的名称和关键字，包括尚未填写的具名参数。
- **悬停与跳转到定义：** 把鼠标停在 `todo.name` 上可以查看字段的类型，也可以跳转到字段声明。定义可以位于导入的 `.weft` 文件中。服务器对已打开的文件使用编辑器里尚未保存的内容，其余导入从磁盘读取。
- **格式化文档：** 使用编辑器的文档格式化命令。服务器与 CLI 使用同一个格式化工具，但会采用编辑器的缩进设置。

Weft UI 语言服务器不提供查找引用或重命名。下文介绍的 TypeScript 内容映射器可以在 TypeScript 代码和映射后的 Weft UI 声明之间跳转。

### Zed

通过 [rustup](https://rustup.rs/) 安装 Rust 后，在 Zed 的命令面板运行 `zed: install dev extension`，选择源码仓库里的 [`crates/zed/`](https://github.com/weft-ui/weft-ui/blob/master/crates/zed/)。扩展会从当前工作树的 `PATH` 查找 `weft`，并运行 `weft lsp`。如果 Zed 找不到它，在设置中将 `lsp.weft.binary.path` 指向该可执行文件的绝对路径：

```jsonc
{
  "lsp": {
    "weft": {
      "binary": { "path": "/absolute/path/to/weft" }
    }
  }
}
```

扩展还会从固定的提交加载 [Weft UI 的 Tree-sitter 语法](https://github.com/weft-ui/weft-ui/blob/master/packages/tree-sitter/)，用于语法高亮、括号匹配、缩进和文档大纲。

### 其他编辑器

如果编辑器的 LSP 客户端支持添加自定义服务器，把服务器关联到 `.weft` 文件，将可执行文件设为 `weft` 或它的绝对路径，唯一的启动参数填 `lsp`。如果需要选择通信方式，选 stdio。语法高亮与语言服务器是两回事，需要单独配置。

## 用 TypeScript 检查 Weft UI 导入

使用支持[内容映射器](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/#content-mappers)的 TypeScript 版本。这个功能从 7.1 开始提供。将 `@weft-ui/content-mapper` 加到开发依赖里。[示例项目](https://github.com/weft-ui/weft-ui/blob/master/example/package.json)已经将它列为工作区依赖；按[快速开始](/zh/guides/getting-started/)安装依赖，再运行 `pnpm build` 构建编译器的 WASM 和各个包。

参照[示例配置](https://github.com/weft-ui/weft-ui/blob/master/example/tsconfig.json)，将 `contentMappers` 加到 `tsconfig.json` 的顶层，不要放进 `compilerOptions`：

```jsonc
{
  "contentMappers": [{ "package": "@weft-ui/content-mapper", "extensions": [".weft"] }]
}
```

运行项目的 TypeScript 编译器时加上 `--runExternalCode`，允许它启动映射器。在仓库根目录运行 `pnpm --filter example typecheck`，会用同样的命令检查示例应用。

```sh
tsc --runExternalCode
```

在 VS Code 中，要使用支持内容映射器的 TypeScript 工具。工作区必须受信任，同时还要允许映射器运行。只给你信任的代码授予权限。

映射器把生成的[逻辑模块](/zh/guides/logic/)声明交给 TypeScript，不需要写出声明文件。Weft UI 错误会标在原始 `.weft` 文件里。生成的模型、字段、事件、组件和参数名会映射回各自的声明，因此可以跨文件跳转到定义、查找引用。例如，在 `index.ts` 里对 `app.onToggle` 执行“转到定义”，可以跳到 `App.weft` 中的 `event Toggle`。TypeScript 代码里的类型错误仍会标在 `.ts` 文件中，但相关的声明位置可以指向 `.weft`。

## 改用生成的声明文件

如果 TypeScript 环境无法运行内容映射器，可以在 Weft UI 的 Vite 插件中启用 `dts: true`。这个选项默认关闭。

```ts
import { defineConfig } from "vite";
import weft from "@weft-ui/vite";

export default defineConfig({
  plugins: [weft({ dts: true })],
});
```

如果之前为 `.weft` 添加了 `contentMappers` 配置，先移除这一项。然后在 `tsconfig.json` 的 `compilerOptions` 中启用 `allowArbitraryExtensions`：

```jsonc
{
  "compilerOptions": {
    "allowArbitraryExtensions": true
  }
}
```

类型检查前先运行 Vite，让插件生成声明文件。比如示例应用启用 `dts` 后，运行 `pnpm --filter example build:web` 会在 `src/App.weft` 旁生成 `src/App.d.weft.ts`。导入路径仍然写 `./App.weft`：TypeScript 从相邻的声明文件读取类型，Vite 仍然编译 Weft UI 源文件。这种方式不会把 TypeScript 的跳转位置映射回 `.weft`。
