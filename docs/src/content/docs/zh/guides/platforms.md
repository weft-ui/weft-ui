---
title: 构建各平台应用
description: 配置 Weft UI 的 Vite 插件，构建各平台工程并运行示例的 UI 测试。
sidebar:
  order: 5
---

同一套 `.weft` 文件和 TypeScript 逻辑可以构建成网页、微信小程序或原生应用。如果你在使用仓库示例，先按[快速开始](/zh/guides/getting-started/)准备工作区，再在工作区根目录运行 `pnpm --filter example` 命令。下文中的 `apps/` 路径相对于 Vite 项目根目录；仓库示例的项目根目录是 `example/`。

## 配置 Vite

在 `vite.config.ts` 中注册 `@weft-ui/vite`。下面是[仓库示例](https://github.com/weft-ui/weft-ui/blob/master/example/vite.config.ts)的配置：

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

| 选项 | 默认值 | 用途 |
| --- | --- | --- |
| `platforms` | `web`、`wechat`、`ios`、`macos`、`android`、`windows`、`linux` | `vite build --app` 构建的平台，也是 `WEFT_PLATFORM` 可显式指定的平台。 |
| `apps` | `./apps` | 各平台工程的输出目录，可用绝对路径或相对于 Vite 根目录的路径。 |
| `assets` | `assets` | 打包图片、图标和字体的目录，相对于 Vite 根目录。 |
| `native` | 按目标平台解析已安装的原生壳包 | 指定包含 `apple/`、`android/`、`windows/` 和 `linux/` 原生壳包的目录，覆盖已安装的包。可用绝对路径或相对于 Vite 根目录的路径。 |
| `app.id` | `com.example.<name>`（由 `app.name` 推导） | 填入需要应用 ID 的模板，例如 Apple 的 Bundle ID 或 Android 的应用 ID。请在首次构建前设置；它不是微信小程序的 AppID。 |
| `app.name` | Vite 根目录的目录名 | 首次构建时填入平台工程模板的显示名称。 |
| `include` | `src/**/*.weft` | 相对于 Vite 根目录的 glob。Web 以外的平台会将匹配的 `.weft` 文件一起编译。 |
| `entry` | 按顺序查找，取第一个存在的文件：`src/index.js`、`src/index.ts`、`src/index.mjs`、`src/index.mts`、`src/index.cjs`、`src/index.cts` | Web 以外平台的 JS 或 TS 逻辑入口，相对于 Vite 根目录解析。Web 从 `index.html` 启动。 |
| `safeArea` | `true` | 让根内容避开系统界面。设为 `false` 时，内容可以延伸到窗口边缘。桌面平台没有安全区，此选项不起作用。 |
| `links` | 不配置 scheme 和主机 | 用 `{ scheme?: string, hosts?: string[] }` 配置深链。scheme 须符合 `[a-z][a-z0-9+.-]*`，hosts 指定接受的 HTTPS 域名。 |
| `dts` | `false` | 不使用 `@weft-ui/content-mapper` 时，可设为 `true`，在 `X.weft` 旁生成 `X.d.weft.ts`。同时在 TypeScript 中启用 `allowArbitraryExtensions`。 |

例如，配置 `navigation.open` 接受的 scheme 和 HTTPS 主机：

```ts
weft({ links: { scheme: "notes", hosts: ["example.com"] } })
```

此配置用于匹配路由；网站部署和平台链接的域名所有权验证需要另外完成。详见[路由与深链](/zh/guides/navigation/#路由与深链)。

## 选择构建目标

在 Vite 项目中用 `WEFT_PLATFORM=<platform> vite build` 选择目标。一次构建多个平台时，用逗号分隔平台名。例如，在 `example/` 下运行：

```sh
WEFT_PLATFORM=web,wechat pnpm exec vite build
```

未设置 `WEFT_PLATFORM` 时，`vite build` 构建 Web，`vite build --app` 则构建 `platforms` 中的所有目标。原生平台默认构建 Debug 版本，传入 `--mode release` 可构建 Release 版本。

如果项目通过 npm 使用 Weft UI，请安装 Vite 插件和 `@weft-ui/platform`，再按需安装原生壳包。`@weft-ui/runtime` 由 Vite 插件自带，应用无需单独安装：

| 目标平台 | 在应用项目中运行 |
| --- | --- |
| macOS 和 iOS | `pnpm add -D @weft-ui/native-apple` |
| Android | `pnpm add -D @weft-ui/native-android` |
| Windows | `pnpm add -D @weft-ui/native-windows` |
| Linux | `pnpm add -D @weft-ui/native-linux` |

原生壳包自带预编译内核。构建应用仍需安装下文列出的平台工具；只有在 Weft UI 工作区内开发时，才需要运行内核构建脚本。工作区里的示例已经声明了对各原生壳包的依赖。

## 工程目录

Web 按 Vite 的常规方式输出到 `apps/web/`。其他平台首次构建时，Weft UI 会将工程模板复制到 `apps/<platform>/`。`weft/` 以外的工程文件由你维护，可以在里面修改签名、图标或平台配置。后续构建会重新生成 `apps/<platform>/weft/`，不再覆盖模板文件。修改 `app.id` 或 `app.name` 不会更新已有工程，请直接修改工程文件。

Web 以外平台的逻辑层打包在 `weft/js/index.js` 中。原生平台还会生成视图代码、`layout.json` 和 Hermes 字节码（除 Android 外都在 `weft/bundle.hbc`）。布局文件及逻辑层与视图层的交互见[视图协议](https://github.com/weft-ui/weft-ui/blob/master/protocol/SPEC.zh-CN.md)。

如果只想生成原生工程，不运行该平台的构建工具，可以设置 `WEFT_NATIVE=0`。当前主机无法运行目标平台的构建工具时，插件也只生成工程，并给出警告。两种情况下都仍需使用 `hermesc` 生成字节码。插件通常会自动找到它；如需换用其他二进制文件，可设置 `WEFT_HERMESC`，所用 Hermes 版本须与内核一致。

## Web

[示例的 `index.html`](https://github.com/weft-ui/weft-ui/blob/master/example/index.html) 通过模块脚本加载 `/src/index.ts`，由 `run(app)` 把应用挂载到 `id="app"` 的元素上。将挂载点的高度设为 `100dvh`、`body` 的外边距设为 `0`，让应用占满窗口。用 Vite 开发服务器在浏览器里查看改动，再把静态站点构建到 `apps/web/`：

```sh
pnpm --filter example exec vite
pnpm --filter example build:web
```

在 viewport 元标签中加入 `viewport-fit=cover`，让移动浏览器提供安全区内边距。应用默认将这些内边距加到挂载元素上。即使设置了 `safeArea: false`，仍可以通过 [`platform.safeArea`](/zh/guides/platform-api/#读取窗口环境) 读取各边的值。

可以在浏览器里打开目录中的页面（例如 `page:hello` 或 `page:feed`），检查界面是否正常更新。

## 微信小程序

```sh
pnpm --filter example build:wechat
```

在微信开发者工具中打开 `example/apps/wechat/`，不要打开下一级的 `weft/`。生成的 WXML 和逻辑代码包都在 `weft/` 中。[模板](https://github.com/weft-ui/weft-ui/blob/master/packages/vite/templates/wechat/project.config.json)默认使用 `touristappid`。要使用已注册的小程序，请在工程的 `project.config.json` 中设置 `appid`。

在 Vite 插件中配置 `wechat.subPackages`，将页面放入分包：

```ts
weft({
  wechat: { subPackages: { gallery: ["Gallery", "Photo"], account: ["Profile"] } },
})
```

键是分包根目录，只能包含小写字母、数字、`_` 和 `-`；值是页面名。页面必须存在，且最多属于一个分包；起始页和 Tab 页必须留在主包。Weft 每次构建都会更新 `app.json`，保留其他设置。分包页面和视图输出到 `<root>/weft/`，其视图包含主包模板的副本，以便共享组件渲染分包中的插槽内容。仅被某个分包页面引用的资源放进该分包；共享资源和可能被动态引用的资源留在主包。逻辑层 JavaScript 全部留在主包，不随分包异步加载。

主包超过 1536 KiB 时构建警告；主包或任一分包超过 2048 KiB，或总量超过 20 MiB 时构建失败。体积统计不包含 `project.config.json`、`project.private.config.json` 和 `packOptions.ignore` 排除的文件。

Weft 默认按安全区给页面底部留出内边距，顶部由小程序导航栏处理。设置 `safeArea: false` 可移除底部内边距，不影响导航栏。

在模拟器里也可以打开目录中的页面检查界面。工作区还有[Web 和小程序的自动化测试](https://github.com/weft-ui/weft-ui/blob/master/tests/vite/platforms.test.ts)，不需要启动微信开发者工具：

```sh
pnpm --filter @weft-ui/tests test
```

## macOS 和 iOS

在 macOS 主机上安装 Xcode（Swift 6）。如果要构建 iOS 模拟器版本，还需安装对应的模拟器运行时。模板最低支持 macOS 14 和 iOS 17。

在 Weft UI 工作区中，运行一次 `native/apple/build-core.sh`，生成 `native/apple/build/WeftCore.xcframework`。脚本需要 CMake 3.28 或更高版本、Ninja 和 Python 3。内核默认包含 macOS、iOS 模拟器和 iOS 真机的产物。如果只需要其中一部分，可将 `WEFT_APPLE_SDKS` 设为由空格分隔的 SDK 列表，从 `macosx`、`iphonesimulator` 和 `iphoneos` 中选择。

```sh
native/apple/build-core.sh
pnpm --filter example build:macos
pnpm --filter example build:ios
pnpm --filter example test:macos
pnpm --filter example test:ios
```

可以在 Xcode 中打开 `apps/macos/App.xcodeproj` 或 `apps/ios/App.xcodeproj`。两个工程都链接 `weft/` 下生成的 `WeftApp` Swift 包，SwiftUI 视图和字节码都在包里。插件通过 `xcodebuild` 构建 `App` scheme。iOS 的 Debug 版本面向模拟器，Release 版本面向真机；构建真机版本前请在 Xcode 工程中配置签名。

插件生成 `weft/Info.plist` 注册配置的 URL scheme，并生成 `weft/App.entitlements` 配置关联域名。启用 Universal Links 还需配置签名，并在各主机部署 Apple 关联文件；域名验证是单独的部署步骤。

测试脚本使用 XCUITest。`test:ios` 默认使用 `iPhone 17` 模拟器；要换设备，将 `WEFT_IOS_DEVICE` 设为已安装的模拟器名称。

## Android

准备 Android SDK（模板使用 API 37 编译）和 JDK 17 或更高版本。如果 SDK 不在默认位置，请设置 `ANDROID_HOME`（或 `ANDROID_SDK_ROOT`）。

在 Weft UI 工作区构建内核还需要 Android NDK、Bash、主机 C++ 工具链、CMake 3.28 或更高版本、Ninja 和 Python 3。脚本优先使用 `ANDROID_NDK_HOME` 指定的 NDK；未设置时会在 SDK 的 `ndk/` 目录中查找最新版本。脚本会在 `native/android/build/jniLibs/<abi>/libweft.so` 生成对应架构的库，默认覆盖 `arm64-v8a`、`armeabi-v7a`、`x86_64` 和 `x86`。如果只需要部分 ABI，可把 `WEFT_ANDROID_ABIS` 设为空格分隔的列表，例如 `arm64-v8a x86_64`。

```sh
native/android/build-core.sh
pnpm --filter example build:android
pnpm --filter example test:android
```

可以在 Android Studio 中打开 `apps/android/`。生成的 `weft/` Gradle 模块包含 Compose 视图和字节码资源 `src/main/assets/weft/bundle.hbc`。插件可以从环境变量、工程 `local.properties` 的 `sdk.dir` 或默认安装目录找到 SDK，然后用工程的 Gradle Wrapper（Windows 上是 `gradlew.bat`）运行 `assembleDebug` 或 `assembleRelease`。APK 输出到 `apps/android/app/build/outputs/apk/`；未配置签名时，Release APK 不会签名。

生成的 `weft` 模块通过转发 Activity 注册配置的 scheme 和 HTTPS 主机，无需修改应用的清单文件。HTTPS App Links 还需部署 Digital Asset Links 文件并验证域名。

先启动模拟器或连接设备，再运行 `test:android`。脚本通过 `connectedDebugAndroidTest` 执行 Compose UI 测试。

## Windows

在 Windows 主机上安装 .NET 10 SDK 或更高版本。未打包应用启动时注册 `links.scheme`，打开协议链接前须先运行一次应用。Windows 会将后续激活转发给已有实例；Windows 不提供 HTTPS 主机注册。

在 Weft UI 工作区构建内核还需要 PowerShell 7、带 C++ 工具链和 CMake 工具的 Visual Studio Build Tools，以及可通过 `PATH` 找到的 Python 3。脚本会按主机架构生成 `native/windows/build/win-<arch>/weft_core.dll`。如果应用面向其他架构，请传入 `-Arch arm64` 或 `-Arch x64`，与工程的 `RuntimeIdentifier` 对应。

```powershell
./native/windows/build-core.ps1
pnpm --filter example build:windows
pnpm --filter example test:windows
```

插件使用 `dotnet build` 构建 `apps/windows/App.csproj`。工程导入 `weft/Weft.targets`，并编译 `weft/Generated.cs` 中的 WinUI 3 视图。构建完成后，在可交互的桌面会话中运行 `test:windows`；测试会启动应用，通过 FlaUI 使用 UI Automation 操作界面。

## Linux

在 Linux 主机上准备 C++20 工具链、CMake 3.28 或更高版本、`pkg-config`，GTK 4.10 或更高版本、libsoup 3、json-glib 和 Fontconfig 的开发包，以及显示 SVG 图标所需的 GdkPixbuf SVG 加载器。在 Debian 或 Ubuntu 上，对应的包是 `libgtk-4-dev`、`libsoup-3.0-dev`、`libjson-glib-dev`、`libfontconfig-dev` 和 `librsvg2-common`。预构建的内核自带 Unicode 数据，无需安装系统 ICU。

`hermes-compiler` 不提供 Linux arm64 版本，所以 Vite 在这类主机上使用 `@weft-ui/native-linux` 提供的 `hermesc`。即使目标是其他原生平台，也要安装这个包，或设置 `WEFT_HERMESC`。

在 Weft UI 工作区构建内核还需要 Ninja 和 Python 3。CMake 会下载与主机架构匹配的 ICU4X 预构建归档，因此构建内核无需 Rust 工具链或系统 ICU。内核脚本会在 `native/linux/build/linux-<arch>/` 下生成 `libweft_core.so` 和 `bin/hermesc`。

```sh
native/linux/build-core.sh
pnpm --filter example build:linux
pnpm --filter example test:linux
```

插件构建 `apps/linux/` 中的 CMake 工程，链接 `weft/Generated.cpp` 中生成的 GTK 视图。可执行文件在 `apps/linux/build/app`。通过 CTest 运行 UI 测试时，需要桌面会话或其他可用的显示环境。

配置 `links.scheme` 后，插件生成 `apps/linux/weft/app.desktop`，其中包含 scheme 处理器和构建所得可执行文件的绝对路径。将其复制到用户的桌面应用目录，用 `update-desktop-database` 更新数据库，再用 `xdg-mime default app.desktop x-scheme-handler/<scheme>` 选择它。打包和安装尚未自动化；项目移动后需要重新注册。

### 在 Docker 中构建 Linux 应用

[Docker Compose 配置](https://github.com/weft-ui/weft-ui/blob/master/native/linux/docker/compose.yaml)包含 Linux 构建工具和 XFCE 桌面。先在主机的工作区根目录构建编译器的 WASM，再启动并进入容器：

```sh
pnpm build:wasm
docker compose -f native/linux/docker/compose.yaml up -d --build
docker compose -f native/linux/docker/compose.yaml exec linux bash
```

容器将工作区挂载到 `/workspace`，并使用独立的 `node_modules` 卷，因此要在容器内安装 Node 依赖：

```sh
pnpm install
native/linux/build-core.sh
pnpm --filter example build:linux
pnpm --filter example test:linux
```

用 VNC 客户端连接 `vnc://localhost:5901`（密码为 `weft`），即可在容器桌面上查看应用和 UI 测试过程。
