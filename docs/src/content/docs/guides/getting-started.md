---
title: Getting started
description: Build and run the Weft UI todo example in your browser.
sidebar:
  order: 1
---

With Weft UI, you write the view in `.weft` and share one JavaScript or TypeScript codebase across platforms. Weft UI compiles the view to browser DOM on Web, WXML in WeChat Mini Programs, and native UI on iOS, macOS, Android, Windows, and Linux. Start with the Web build of the example todo app; you won't need any native platform SDKs.

## Set up the workspace

You'll need Git, Node.js 26, and the pnpm version pinned in the [root `package.json`](https://github.com/weft-ui/weft-ui/blob/master/package.json). The example uses the Weft UI compiler built from this checkout, so you'll also need Rust and Cargo, the [`wasm32-unknown-unknown` target](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html), and `wasm-bindgen-cli` matching the [workspace's pinned version](https://github.com/weft-ui/weft-ui/blob/master/Cargo.toml). If you installed Rust through rustup, set up the target and CLI with:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.130 --locked
```

Clone the repository, install dependencies, and build the compiler:

```sh
git clone https://github.com/weft-ui/weft-ui.git
cd weft-ui
pnpm install
pnpm build
```

## Run the Web example

From the repository root, build the example and serve the result:

```sh
pnpm --filter example build:web
pnpm --filter example exec vite preview --outDir apps/web
```

The build writes `example/apps/web/`. Open the local URL Vite prints, type `Buy milk` into **New todo**, and click **Add**. The new item should appear and the count should increase to `1 todos`.

When editing the source, use `pnpm --filter example exec vite` instead of building and previewing each time. The Vite plugin compiles `.weft` imports for Web in the dev server too.

## Find your way around the example

- [`src/App.weft`](https://github.com/weft-ui/weft-ui/blob/master/example/src/App.weft) declares the data model, events, and view.
- [`src/index.ts`](https://github.com/weft-ui/weft-ui/blob/master/example/src/index.ts) initializes the model, handles events, and starts the app.
- [`vite.config.ts`](https://github.com/weft-ui/weft-ui/blob/master/example/vite.config.ts) registers `@weft-ui/vite`.
- [`index.html`](https://github.com/weft-ui/weft-ui/blob/master/example/index.html) is the Web entry point. It loads `src/index.ts` and provides the `#app` mount element.
- `apps/` holds platform projects and build output.

## Follow the Add button

In `App.weft`, the `Input` displays `model.draft` and emits `Draft` when the user types. The button emits `Add` and is disabled when the draft is empty after trimming:

```weft
Row(gap = 8) {
    Input(model.draft, onChange = Draft, placeholder = "New todo")
    Button(onClick = Add, disabled = model.draft.trim().isEmpty) {
        Text("Add")
    }
}
```

`index.ts` imports the generated `App` from `./App.weft` and creates it with `new App(...)`. Its event handlers update the model. Adding an item updates the list and clears the input because the view reads the same model:

```ts
app.onDraft((model, { value }) => {
  if (value.length <= MAX_LENGTH) model.draft = value;
});

app.onAdd((model) => {
  model.todos = [...model.todos, { id: nextId++, name: model.draft.trim(), done: false }];
  model.draft = "";
});
```

Once the handlers are registered, `run(app)` from `@weft-ui/platform` mounts the app into `#app` on Web.

## Next steps

- [Views](/guides/views/): write layouts, bindings, and lists. See the [grammar specification](https://github.com/weft-ui/weft-ui/blob/master/crates/parser/GRAMMAR.md) for the full language rules.
- [Logic](/guides/logic/): initialize models and handle view events in JavaScript or TypeScript.
- [Platform API](/guides/platform-api/): share code that uses storage or makes network requests.
- [Platforms](/guides/platforms/): build and open the app on another target.
- [Tooling](/guides/tooling/): format `.weft` files, connect your editor to the language server, and type-check `.weft` imports in TypeScript.
