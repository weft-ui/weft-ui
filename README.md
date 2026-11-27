# Weft UI

A cross-platform UI library for Web, WeChat mini programs, iOS, macOS, Android, Windows, and Linux. Build views with [22 built-in elements](https://weftui.mioyi.net/reference/elements/) and write logic in JavaScript or TypeScript. Weft supports reusable styles and light/dark themes, bundled images and fonts, input and safe-area layout, typed pages with stack, tab and modal navigation, and lazy lists and grids with refresh and load-more. Platform APIs provide navigation, dialogs, lifecycle and deep links.

## Example

The commands below are for development in this repository, where the native kernels are built from source. For an app using the npm packages, see [Vite plugin](#vite-plugin).

```sh
pnpm install
pnpm build                      # compiler WASM and package builds
pnpm --filter example build:web      # Vite app in example/apps/web/
pnpm --filter example build:wechat   # mini program project in example/apps/wechat/
pnpm gen:protocol               # regenerate protocol constants from protocol/weft.protocol.json
pnpm test                       # includes tests/conformance/: headless ops goldens, Web and mini program parity
cargo test --workspace          # parser, transformer backends, TodoList snapshots

# Native kernel (Hermes is fetched and built from source on the first configure)
cmake -S native/core -B native/core/build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build native/core/build
ctest --test-dir native/core/build   # kernel tests + conformance fixtures in Hermes

# Apple (macOS host with Xcode): the kernel as WeftCore.xcframework, once
native/apple/build-core.sh
pnpm --filter example build:macos    # Xcode project in example/apps/macos/, built with xcodebuild
pnpm --filter example build:ios      # same for the iOS simulator
pnpm --filter example test:macos     # XCUITest click flow (test:ios for the simulator)

# Android (any host with the Android SDK + NDK, CMake, Ninja, Python 3, JDK 17+): the kernel as libweft.so, once
native/android/build-core.sh         # WEFT_ANDROID_ABIS="arm64-v8a x86_64" for a subset
pnpm --filter example build:android  # Gradle project in example/apps/android/, built with its wrapper
pnpm --filter example test:android   # Compose UI Test click flow on a connected device or emulator

# Windows (Windows host with VS Build Tools C++ + CMake, Python 3, .NET SDK 10 or later): the kernel as weft_core.dll, once
native/windows/build-core.ps1        # -Arch arm64|x64, default: the host's
pnpm --filter example build:windows  # dotnet project in example/apps/windows/, built with dotnet build
pnpm --filter example test:windows   # UI Automation (FlaUI) click flow; needs an interactive desktop
dotnet test native/windows/Weft.WinUI.Tests

# Linux (C++20 compiler, CMake, Ninja, Python 3 and GTK 4 / libsoup 3 / json-glib dev packages)
# CMake downloads prebuilt ICU4X; building libweft_core.so needs neither Rust nor system ICU.
native/linux/build-core.sh           # also builds hermesc, which hermes-compiler lacks for arm64
pnpm --filter example build:linux    # CMake project in example/apps/linux/, built into apps/linux/build/
pnpm --filter example test:linux     # in-process click flow; needs a display
# Or run the Linux steps in Docker after building the compiler WASM on the host (pnpm build:wasm).
# The XFCE desktop is on vnc://localhost:5901 (password weft).
docker compose -f native/linux/docker/compose.yaml up -d --build
docker compose -f native/linux/docker/compose.yaml exec linux bash
```

## Editor support

```sh
cargo install --path crates/cli      # installs `weft`
weft fmt [--check] [paths...]        # format .weft files (default: current directory, honoring .gitignore)
weft lsp                             # language server on stdio: diagnostics, completion, hover, go to definition, formatting
```

Zed: run `zed: install dev extension` and pick `crates/zed/` (needs Rust installed through rustup). The extension starts `weft lsp` from `PATH`; set `lsp.weft.binary.path` in Zed's settings to use another binary. Highlighting, brackets, indentation and the outline come from the tree-sitter grammar in `packages/tree-sitter/`. Zed fetches the grammar from a pinned commit; see [how to update the pin](packages/tree-sitter/README.md).

## TypeScript

Types of `.weft` imports come from the [TypeScript 7.1 content mapper](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/#content-mappers) `@weft-ui/content-mapper` (after `pnpm build`). Add it as a dev dependency and register it in `tsconfig.json`, as `example/tsconfig.json` does:

```jsonc
"contentMappers": [{ "package": "@weft-ui/content-mapper", "extensions": [".weft"] }]
```

Then run `tsc --runExternalCode` (`pnpm --filter example typecheck`); VS Code starts the mapper in trusted workspaces. TypeScript sees each `.weft` file as the declarations of its logic module: Weft errors are reported in the `.weft` file, and the names of models, fields, events, components and parameters map back to their declarations, so type errors, go to definition and find references land in the `.weft` source. Without content mappers, `dts: true` makes the Vite plugin write `X.d.weft.ts` next to every `X.weft` (needs `allowArbitraryExtensions`).

## Vite plugin

With `@weft-ui/vite`, `entry` selects the JS/TS entry for non-Web builds, relative to the Vite root. It defaults to the first existing file in `src/index.{js,ts,mjs,mts,cjs,cts}`, in that order. Web builds start from `index.html`. Set `apps` to change the output directory for platform projects (an absolute path or a path relative to the Vite root; default `./apps`). The paths below assume the default.

In an app using the npm packages, install `@weft-ui/platform` alongside the Vite plugin; the plugin brings `@weft-ui/runtime` and resolves the generated code's runtime imports to it. Add the native shell for each target you build, for example:

```sh
pnpm add -D @weft-ui/native-android
WEFT_PLATFORM=android pnpm exec vite build
```

Use `@weft-ui/native-apple` for iOS or macOS, `@weft-ui/native-windows` for Windows, and `@weft-ui/native-linux` for Linux. Web and WeChat do not need a native package. Native packages include prebuilt kernels: you need the target's app build tools, but you only build the kernel from source when developing in this repository. On Linux arm64, install `@weft-ui/native-linux` for the bundled `hermesc` even when targeting another native platform, or set `WEFT_HERMESC` to a compiler from the same Hermes release.

The plugin resolves the installed shell package by target. Set `native` to override it with a directory containing the shell packages (`apple/`, `android/`, `windows/`, `linux/`). It accepts an absolute path or a path relative to the Vite root.

`WEFT_PLATFORM=<platform> vite build` (comma-separated for several) builds into `apps/<platform>/`. The project template there is copied on the first build and then belongs to you; `apps/<platform>/weft/` is regenerated on every build. Open `apps/wechat/` in WeChat DevTools. Platform APIs come from `@weft-ui/platform` (`run`, `fetch`, `storage`, `platform`, `navigation`, `ui`, `lifecycle`, `isSupported`); unsupported calls reject with `PlatformError`.

Native builds generate `layout.json`, Hermes bytecode (`weft/bundle.hbc`, or an Android asset), and platform views. On macOS and iOS, the `WeftApp` Swift package in `weft/` links the WeftKit shell and builds with `xcodebuild`. Windows links the Weft.WinUI shell and builds `App.csproj` with `dotnet build`. Android links its shell through the generated `weft/` Gradle module and builds with `./gradlew assembleDebug` by default. Linux links its C++ shell and builds `apps/linux/build/app` with CMake. Set `WEFT_NATIVE=0` to generate the project without running the native build tool.

## Protocol

`protocol/` holds the cross-language contract between the compiler, the JS runtime and the native shells. `weft.protocol.json` is the schema: the protocol version, opcodes, value tags, decoding error kinds, WeChat style units, platform names and platform call modules. `generate.ts` writes the constants for TypeScript, Rust, C++, Swift, Kotlin and C# from it (`pnpm gen:protocol`); generated files start with a "do not edit" header, and `pnpm test` fails when one is out of date. `corpus/` is the shared test corpus of encoded batches, values and platform call frames that every reader and encoder is tested against.

`WEFT_UPDATE_SNAPSHOTS=1` rewrites Rust snapshots (`crates/transformer/tests/snapshots/`) and conformance goldens (`tests/conformance/golden/`).

## Docs

The documentation site lives in `docs/` (Astro + Starlight) and is published to <https://weftui.mioyi.net/> (GitHub Pages) by `.github/workflows/docs.yml` on every push to `master` that touches it. English is the root locale, Chinese lives under `/zh/`; a first visit follows the browser language. Guides live in `docs/src/content/docs/guides/` (Chinese: `docs/src/content/docs/zh/guides/`). Landing page copy: `docs/src/i18n/landing.ts`.

The specs live next to the code that implements them: the grammar in [crates/parser/GRAMMAR.md](crates/parser/GRAMMAR.md) ([中文](crates/parser/GRAMMAR.zh-CN.md)), the view protocol in [protocol/SPEC.md](protocol/SPEC.md) ([中文](protocol/SPEC.zh-CN.md)).

```sh
pnpm --filter docs dev     # http://localhost:4321/
pnpm --filter docs build   # static site in docs/dist/
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the tools of each platform, the checks CI runs on every pull request (`.github/workflows/ci.yml`; the Android and iOS UI flows run nightly in `nightly.yml`) and the conventions. Every user-visible change to a published package comes with a changeset (`pnpm changeset`). Report vulnerabilities as described in [SECURITY.md](SECURITY.md).
