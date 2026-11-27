---
title: Build for each platform
description: Configure the Weft UI Vite plugin, build a platform project, and run the example’s UI tests.
sidebar:
  order: 5
---

Use the same `.weft` files and TypeScript logic to build for the browser, WeChat, or a native platform. If you’re following the workspace example, complete the [workspace setup](/guides/getting-started/) first. Run `pnpm --filter example` commands from the workspace root. The `apps/` paths below are relative to the Vite project root (`example/` for the workspace example).

## Configure Vite

Register `@weft-ui/vite` in `vite.config.ts`, as in the [workspace example](https://github.com/weft-ui/weft-ui/blob/master/example/vite.config.ts):

```ts
import { defineConfig } from "vite";
import weft from "@weft-ui/vite";

export default defineConfig({
  plugins: [weft({
    app: { id: "net.mioyi.weftui.showcase", name: "Weft Showcase" },
    include: "src/App.weft",
  })],
});
```

| Option | Default | What it controls |
| --- | --- | --- |
| `platforms` | `web`, `wechat`, `ios`, `macos`, `android`, `windows`, `linux` | The targets for `vite build --app` and the targets you can explicitly request with `WEFT_PLATFORM`. |
| `apps` | `./apps` | The output directory for platform projects. Use an absolute path or a path relative to the Vite root. |
| `assets` | `assets` | The directory for bundled images, icons, and fonts, relative to the Vite root. |
| `native` | Resolve the installed native shell package for the target | Override the packages with a directory containing the `apple/`, `android/`, `windows/`, and `linux/` shell packages. Use an absolute path or a path relative to the Vite root. |
| `app.id` | `com.example.<name>` (derived from `app.name`) | The ID filled into templates that use it, such as the Apple bundle identifier or Android application ID. Set it before the first build; it does not set the WeChat AppID. |
| `app.name` | The name of the Vite root directory | The display name filled into platform templates on the first build. |
| `include` | `src/**/*.weft` | A glob relative to the Vite root. Non-Web builds compile the matched `.weft` files together. |
| `entry` | The first existing `src/index.js`, `src/index.ts`, `src/index.mjs`, `src/index.mts`, `src/index.cjs`, or `src/index.cts`, in that order | The JS or TS logic entry for non-Web builds, resolved from the Vite root. Web starts from `index.html`. |
| `safeArea` | `true` | Keep root content clear of system UI. Set to `false` for an edge-to-edge layout. Desktop targets have no insets, so the option changes nothing there. |
| `links` | No scheme or hosts | Configure deep links with `{ scheme?: string, hosts?: string[] }`. The scheme must match `[a-z][a-z0-9+.-]*`; hosts identify accepted HTTPS domains. |
| `dts` | `false` | Set to `true` to write `X.d.weft.ts` next to `X.weft` when not using `@weft-ui/content-mapper`. Enable `allowArbitraryExtensions` in TypeScript. |

For example, configure the schemes and HTTPS hosts accepted by `navigation.open`:

```ts
weft({ links: { scheme: "notes", hosts: ["example.com"] } })
```

This configures route matching; serving the website or verifying domain ownership for platform links is a separate deployment step. See [routes and deep links](/guides/navigation/#routes-and-deep-links).

## Choose a target

In a Vite project, use `WEFT_PLATFORM=<platform> vite build` to choose a target. Separate names with commas to build more than one. For example, from `example/`:

```sh
WEFT_PLATFORM=web,wechat pnpm exec vite build
```

Without `WEFT_PLATFORM`, `vite build` builds Web, while `vite build --app` builds every target in `platforms`. For native targets, the plugin uses Debug by default; pass `--mode release` to select Release.

In an app using the npm packages, install `@weft-ui/platform` alongside the Vite plugin. The plugin depends on `@weft-ui/runtime` itself, so the app does not install it. Add a shell package only for the native platforms you build:

| Target | Install in the app project |
| --- | --- |
| macOS and iOS | `pnpm add -D @weft-ui/native-apple` |
| Android | `pnpm add -D @weft-ui/native-android` |
| Windows | `pnpm add -D @weft-ui/native-windows` |
| Linux | `pnpm add -D @weft-ui/native-linux` |

Each shell ships a prebuilt kernel. Install the platform tools below to build the app; the kernel build scripts are only for development in the Weft UI workspace. The workspace example already depends on the shell packages.

## Project layout

Web is ordinary Vite output in `apps/web/`. For other targets, Weft UI copies a project template into `apps/<platform>/` on the first build. The project files outside `weft/` are yours: edit signing, icons, or platform configuration there. Later builds regenerate `apps/<platform>/weft/`, not the template files. Changing `app.id` or `app.name` does not update an existing project; edit its files directly.

For non-Web targets, `weft/js/index.js` contains the bundled logic. For native targets, Weft UI also writes generated views, `layout.json`, and Hermes bytecode (`weft/bundle.hbc`, except on Android). The [view protocol spec](https://github.com/weft-ui/weft-ui/blob/master/protocol/SPEC.md) describes the layout and the connection between the logic and view layers.

Set `WEFT_NATIVE=0` to generate the native project without running its build tool. On a host that cannot run the target’s build tool, the plugin generates the project and warns instead. Either way, bytecode generation still needs `hermesc`. The plugin normally finds it for you; set `WEFT_HERMESC` to use a different binary from the same Hermes release as the kernel.

## Web

In the [example’s `index.html`](https://github.com/weft-ui/weft-ui/blob/master/example/index.html), the module script loads `/src/index.ts` and `run(app)` mounts into the element with `id="app"`. Set the mount point’s height to `100dvh` and the body’s margin to `0` for a full-window app. Use Vite’s dev server to try changes in a browser, then build the static site into `apps/web/`:

```sh
pnpm --filter example exec vite
pnpm --filter example build:web
```

Include `viewport-fit=cover` in your viewport meta tag so mobile browsers expose the safe-area insets. The app adds those insets as padding on the mount element by default. If you set `safeArea: false`, you can still read the insets from [`platform.safeArea`](/guides/platform-api/#read-the-window-environment).

To check the UI in the browser, open pages from the example catalog such as `page:hello` or `page:feed`.

## WeChat Mini Program

```sh
pnpm --filter example build:wechat
```

Open `example/apps/wechat/` in WeChat DevTools, not its `weft/` subdirectory. The generated WXML and logic bundle live in `weft/`. The [template](https://github.com/weft-ui/weft-ui/blob/master/packages/vite/templates/wechat/project.config.json) starts with `touristappid`; to use your registered Mini Program, set `appid` in the project’s `project.config.json`.

Configure `wechat.subPackages` in the Vite plugin to move pages into named sub-packages:

```ts
weft({
  wechat: { subPackages: { gallery: ["Gallery", "Photo"], account: ["Profile"] } },
})
```

Keys are package roots and may contain only lowercase letters, digits, `_` and `-`. Values are page names. Every page must exist and occur in at most one sub-package; the start page and tab pages must remain in the main package. Weft updates `app.json` on each build while preserving unrelated settings. Sub-package pages and views are emitted under `<root>/weft/`; their views import the main package templates. Assets referenced only by pages in one sub-package are placed there; shared assets and assets that may be referenced dynamically stay in the main package. All logic JavaScript remains in the main package; it is not loaded asynchronously by sub-package.

The build warns when the main package exceeds 1536 KiB and fails if the main package or any sub-package exceeds 2048 KiB, or the total exceeds 20 MiB. The size calculation excludes `project.config.json`, `project.private.config.json`, and files excluded by `packOptions.ignore`.

By default, Weft pads the bottom of the page by the safe-area inset. The mini program navigation bar handles the top. `safeArea: false` removes the bottom padding without changing the navigation bar.

In the simulator, open pages from the catalog to check the UI. The workspace also has [automated Web and Mini Program tests](https://github.com/weft-ui/weft-ui/blob/master/tests/vite/platforms.test.ts) that run without WeChat DevTools:

```sh
pnpm --filter @weft-ui/tests test
```

## macOS and iOS

Use a macOS host with Xcode (Swift 6). Install the iOS Simulator runtime if you’re building for the simulator. The templates target macOS 14 and iOS 17 or later.

In the Weft UI workspace, run `native/apple/build-core.sh` once to build `native/apple/build/WeftCore.xcframework`. The script requires CMake 3.28 or later, Ninja, and Python 3. By default the kernel includes macOS, iOS Simulator, and iOS device builds; set `WEFT_APPLE_SDKS` to a space-separated subset of `macosx`, `iphonesimulator`, and `iphoneos` if you only need some of them.

```sh
native/apple/build-core.sh
pnpm --filter example build:macos
pnpm --filter example build:ios
pnpm --filter example test:macos
pnpm --filter example test:ios
```

Open `apps/macos/App.xcodeproj` or `apps/ios/App.xcodeproj` in Xcode. Each links the generated `WeftApp` Swift package in `weft/`, which contains the SwiftUI views and bytecode. The plugin runs `xcodebuild` with scheme `App`. For iOS it builds for the simulator in Debug and for a device in Release; configure signing in the Xcode project for the device build.

The plugin generates `weft/Info.plist` for the configured URL scheme and `weft/App.entitlements` for associated domains. Configure signing and deploy the Apple association file on each host to enable Universal Links; domain verification is a separate deployment step.

The test scripts run XCUITest. `test:ios` defaults to the `iPhone 17` simulator; set `WEFT_IOS_DEVICE` to the name of an installed simulator to change it.

## Android

Install the Android SDK (the template compiles against API 37) and a JDK 17 or later. Define `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) if the SDK is not in the default location.

In the Weft UI workspace, building the kernel also requires an Android NDK, Bash, a host C++ toolchain, CMake 3.28 or later, Ninja, and Python 3. The script uses `ANDROID_NDK_HOME` if set; otherwise it looks for the newest NDK under the SDK’s `ndk/` directory. It writes `native/android/build/jniLibs/<abi>/libweft.so` for `arm64-v8a`, `armeabi-v7a`, `x86_64`, and `x86` by default. Set `WEFT_ANDROID_ABIS` to a space-separated list to build only the ABIs you need, such as `arm64-v8a x86_64`.

```sh
native/android/build-core.sh
pnpm --filter example build:android
pnpm --filter example test:android
```

Open `apps/android/` in Android Studio. The generated `weft/` Gradle module contains the Compose views and the bytecode asset `src/main/assets/weft/bundle.hbc`. The plugin can find the SDK from the environment, `sdk.dir` in the project’s `local.properties`, or the default install location. It uses the project’s Gradle wrapper (`gradlew.bat` on Windows) to run `assembleDebug` or `assembleRelease`. APKs land in `apps/android/app/build/outputs/apk/`; release APKs are unsigned unless you configure signing.

The generated `weft` module registers the configured scheme and HTTPS hosts through a forwarding activity; the app's manifest does not need editing. HTTPS App Links require a deployed Digital Asset Links file and domain verification.

Start an emulator or connect a device before running `test:android`. The script runs the Compose UI tests via `connectedDebugAndroidTest`.

## Windows

Use a Windows host with the .NET 10 SDK or later. The unpackaged app registers `links.scheme` at startup; run it once before opening a protocol URL. Windows forwards subsequent activations to the existing instance. HTTPS host registration is not provided on Windows.

In the Weft UI workspace, building the kernel also requires PowerShell 7, Visual Studio Build Tools with the C++ toolchain and CMake tools, and Python 3 on `PATH`. The script writes `native/windows/build/win-<arch>/weft_core.dll` for the host architecture by default. If your app targets a different architecture, pass `-Arch arm64` or `-Arch x64` to match the app project’s `RuntimeIdentifier`.

```powershell
./native/windows/build-core.ps1
pnpm --filter example build:windows
pnpm --filter example test:windows
```

The plugin builds `apps/windows/App.csproj` with `dotnet build`. The project imports `weft/Weft.targets` and compiles `weft/Generated.cs` for WinUI 3. After building, run `test:windows` in an interactive desktop session; the tests launch the built app and use UI Automation through FlaUI.

## Linux

Use a Linux host with a C++20 toolchain, CMake 3.28 or later, `pkg-config`, and development packages for GTK 4.10 or later, libsoup 3, json-glib, and Fontconfig, plus the GdkPixbuf SVG loader for SVG icons. On Debian or Ubuntu the packages are `libgtk-4-dev`, `libsoup-3.0-dev`, `libjson-glib-dev`, `libfontconfig-dev`, and `librsvg2-common`. The prebuilt kernel bundles its Unicode data and does not require system ICU.

On Linux arm64, Vite uses the `hermesc` shipped in `@weft-ui/native-linux`, because `hermes-compiler` does not provide one. Install that package on a Linux arm64 host even when targeting a different native platform, or set `WEFT_HERMESC`.

In the Weft UI workspace, building the kernel also requires Ninja and Python 3. CMake downloads the prebuilt ICU4X archive for the host architecture, so the kernel build does not need a Rust toolchain or system ICU. The kernel script writes `native/linux/build/linux-<arch>/libweft_core.so` and `bin/hermesc` under the same build directory.

```sh
native/linux/build-core.sh
pnpm --filter example build:linux
pnpm --filter example test:linux
```

The plugin builds the CMake project in `apps/linux/`, which links the generated GTK views in `weft/Generated.cpp`. The executable is `apps/linux/build/app`. Use a desktop session or another available display for the CTest UI test.

With `links.scheme`, the plugin generates `apps/linux/weft/app.desktop` with the scheme handler and the build executable's absolute path. Register a copy in the user's desktop applications directory and select it with `xdg-mime default app.desktop x-scheme-handler/<scheme>`; refresh the desktop database with `update-desktop-database`. Packaging and installation are not yet automated. Re-register the file if the project moves.

### Linux in Docker

The [Docker Compose setup](https://github.com/weft-ui/weft-ui/blob/master/native/linux/docker/compose.yaml) includes the Linux build tools and an XFCE desktop. From the workspace root on the host, build the compiler WASM, then start and enter the container:

```sh
pnpm build:wasm
docker compose -f native/linux/docker/compose.yaml up -d --build
docker compose -f native/linux/docker/compose.yaml exec linux bash
```

Inside the container, the workspace is mounted at `/workspace`. Install its Node dependencies there because it uses separate `node_modules` volumes:

```sh
pnpm install
native/linux/build-core.sh
pnpm --filter example build:linux
pnpm --filter example test:linux
```

Connect your VNC client to `vnc://localhost:5901` (password `weft`) to see the app and UI tests on the container’s desktop.
