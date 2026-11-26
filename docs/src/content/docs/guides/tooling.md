---
title: Editor and TypeScript tooling
description: Format Weft UI files, connect your editor to the Weft UI language server, and type-check .weft imports.
sidebar:
  order: 6
---

The Weft UI language server helps you edit `.weft` files. The TypeScript content mapper lets TypeScript understand imports such as `import { Showcase } from "./App.weft"` in the [workspace example](https://github.com/weft-ui/weft-ui/blob/master/example/src/index.ts). You can use both in the same project.

## Install the CLI

Run this from the root of a Weft UI checkout. It installs the `weft` executable, which includes the formatter and language server.

```sh
cargo install --path crates/cli
```

## Format Weft UI files

`weft fmt` rewrites files in place. Pass files or directories, or omit the paths to start at the current directory. Directory scans recurse, honor `.gitignore`, and skip hidden entries and files without the `.weft` extension. An explicitly named file is formatted regardless of its extension.

```sh
weft fmt
weft fmt example/src/pages/Hello.weft
weft fmt --check example/src
```

Use `--check` in CI: it prints the paths of files that would change without writing to them, and exits with status `1` if any need formatting or an error occurs. The CLI uses four spaces per level and a target line width of 100 columns. It reports syntax errors instead of rewriting invalid files; it does not resolve imports or check types.

To format a buffer, read from stdin and write the result to stdout. `--path` is optional and only supplies the filename for diagnostics. Do not combine `--stdin` with `--check` or positional paths.

```sh
weft fmt --stdin --path example/src/pages/Hello.weft < example/src/pages/Hello.weft
```

## Use the Weft UI language server

`weft lsp` speaks the Language Server Protocol over stdin and stdout. Open [`Feed.weft`](https://github.com/weft-ui/weft-ui/blob/master/example/src/pages/Feed.weft) (or any `.weft` view, such as a todo component) in a connected editor to try these features:

- **Diagnostics:** Weft UI reports syntax and semantic errors as you edit, for example if you replace `todo.name` with a field that `Todo` does not declare.
- **Completion:** Type `todo.` inside the loop to see the model's fields. The server also suggests names and keywords in context, including named arguments you have not supplied yet.
- **Hover and go to definition:** Hover over `todo.name` to see the field's type, or jump to its declaration. Definition lookup works across `.weft` imports. The server uses unsaved buffers for open files and reads other imports from disk.
- **Document formatting:** Use your editor's format-document command. The server uses the same formatter as the CLI and follows the editor's indentation settings.

The Weft UI server does not provide find references or rename. TypeScript can navigate between its own code and mapped Weft UI declarations using the content mapper below.

### Zed

With Rust installed through [rustup](https://rustup.rs/), run `zed: install dev extension` from Zed's command palette and select [`crates/zed/`](https://github.com/weft-ui/weft-ui/blob/master/crates/zed/) in your checkout. The extension runs `weft lsp` using the `weft` it finds on the worktree's `PATH`. If Zed cannot find it, set `lsp.weft.binary.path` in Zed's settings to the full path of your executable:

```jsonc
{
  "lsp": {
    "weft": {
      "binary": { "path": "/absolute/path/to/weft" }
    }
  }
}
```

The extension also loads the [Weft UI Tree-sitter grammar](https://github.com/weft-ui/weft-ui/blob/master/packages/tree-sitter/) from a pinned commit for highlighting, brackets, indentation, and the outline.

### Other editors

If your editor's LSP client lets you register a custom server, associate it with `.weft` files, set the executable to `weft` (or its full path), and pass `lsp` as its only argument. Select stdio transport if the client asks. Syntax highlighting is separate from the language server.

## Type-check Weft UI imports with TypeScript

Use a TypeScript version that supports [content mappers](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/#content-mappers), introduced in 7.1. Add `@weft-ui/content-mapper` as a dev dependency. The [example project](https://github.com/weft-ui/weft-ui/blob/master/example/package.json) already declares it as a workspace dependency; follow [Getting started](/guides/getting-started/) to install dependencies and build the compiler WASM and packages with `pnpm build`.

Add `contentMappers` at the top level of `tsconfig.json`, outside `compilerOptions`, as in the [example config](https://github.com/weft-ui/weft-ui/blob/master/example/tsconfig.json):

```jsonc
{
  "contentMappers": [{ "package": "@weft-ui/content-mapper", "extensions": [".weft"] }]
}
```

Run the project's TypeScript compiler with `--runExternalCode` to let it start the mapper. From the repository root, `pnpm --filter example typecheck` runs the same command for the example.

```sh
tsc --runExternalCode
```

In VS Code, use TypeScript support that includes content mappers. The workspace must be trusted and the mapper must be granted permission to run. Only grant permission for code you trust.

The mapper gives TypeScript the generated declarations for the [logic module](/guides/logic/) without writing a declaration file. Weft UI errors appear in the original `.weft` file. Generated names for models, fields, events, components, and their parameters map back to the corresponding declarations, so go to definition and find references can cross the file boundary. For example, go to definition on `app.onToggle` in `index.ts` can take you to `event Toggle` in `App.weft`. TypeScript errors in your `.ts` code still point to that code, but related declaration locations can point into `.weft`.

## Generate declaration files instead

If your TypeScript setup cannot run content mappers, enable `dts: true` in the Weft UI Vite plugin. It is off by default.

```ts
import { defineConfig } from "vite";
import weft from "@weft-ui/vite";

export default defineConfig({
  plugins: [weft({ dts: true })],
});
```

Remove the `contentMappers` entry for `.weft` if you previously added it. In `tsconfig.json`, add `allowArbitraryExtensions` under `compilerOptions`:

```jsonc
{
  "compilerOptions": {
    "allowArbitraryExtensions": true
  }
}
```

Run Vite before type-checking so the plugin can generate the files. For example, the example app's `pnpm --filter example build:web` command generates `src/App.d.weft.ts` next to `src/App.weft` once you enable `dts`. Keep your imports as `./App.weft`: TypeScript reads the sibling declaration for types, while Vite still compiles the Weft UI source. This fallback does not map TypeScript navigation back to `.weft`.
