# Contributing to Weft UI

Thanks for helping. This guide covers the tools each platform needs, the checks a change must pass, and the conventions of the repository. The roadmap is [ROADMAP.md](ROADMAP.md); work happens in milestone plans such as [PLAN-M0.md](PLAN-M0.md).

## Tools

The versions match the CI workflows in `.github/workflows/`.

| For | Tools |
| --- | --- |
| Workspace | Git, Node.js 26, pnpm 11 (`corepack enable` picks the version in `package.json`) |
| Compiler WASM | Rust stable with the `wasm32-unknown-unknown` target, `wasm-bindgen-cli` 0.2.130 (`cargo install wasm-bindgen-cli --version 0.2.130 --locked`) |
| Native kernel | CMake 3.28 or later, Ninja, Python 3 |
| Apple | macOS 26 with Xcode 27 |
| Android | Android SDK (platform 37) and NDK, JDK 21 |
| Windows | Windows 11, Visual Studio Build Tools with the C++ workload (includes CMake and Ninja), .NET SDK 10, PowerShell 7 |
| Linux | Docker (the `native/linux/docker` image has everything), or a Linux host with a C++20 compiler, GTK 4, libsoup 3, json-glib and Fontconfig development packages, and the GdkPixbuf SVG loader (`libfontconfig-dev` and `librsvg2-common` on Debian/Ubuntu for the asset dependencies) |
| Docs | Nothing beyond the workspace |

You only need the rows of the platforms you change. A change to the compiler or the runtime is checked on every platform by CI.

## First build

```sh
pnpm install
pnpm --filter showcase exec playwright install chromium # theme browser test
pnpm build                       # compiler WASM and package builds
native/apple/build-core.sh       # macOS: WeftCore.xcframework, for swift test and the Apple apps
native/android/build-core.sh     # libweft.so for every ABI; WEFT_ANDROID_ABIS="x86_64" for a subset
```

The first kernel build fetches and compiles Hermes, which takes a while; later builds reuse it. On Linux, CMake also downloads a prebuilt ICU4X archive and its matching C++ headers, so the kernel build needs neither Rust nor system ICU. To reuse local copies, pass `-DWEFT_ICU4X_ARCHIVE=/path/to/icu4x.a` and `-DWEFT_ICU4X_HEADERS=/path/to/source.tar.gz` to CMake; both must match the pinned upstream SHA-256 hashes. The README lists the commands for each platform.

## Checks

Run the checks of the code you touched before opening a pull request. CI runs every check the changed files can affect, so a change to docs alone skips the kernel builds; a manual run checks everything. The UI flows run nightly, when master has changed since the last successful nightly run.

| Code | Command |
| --- | --- |
| C-rust | `cargo fmt --all --check && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings` |
| C-ts | `pnpm build && pnpm typecheck && pnpm test`; TypeScript errors (`pnpm typecheck`) must be zero |
| C-core | `cmake -S native/core -B native/core/build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build native/core/build && ctest --test-dir native/core/build --output-on-failure` |
| C-apple | `swift test --package-path native/apple` |
| C-android | `WEFT_NATIVE=0 pnpm --filter example build:android && example/apps/android/gradlew -p example/apps/android :weft-android:testDebugUnitTest` |
| C-windows | On Windows: `native/windows/build-core.ps1`, the kernel tests with `-DWEFT_CORE_SHARED=ON` (as C-core), then `dotnet test native/windows/Weft.WinUI.Tests` |
| C-linux | In the container (below): `native/linux/build-core.sh`, then `cmake -S native/linux -B /tmp/weft-linux-tests -G Ninja -DWEFT_LINUX_TESTS=ON && cmake --build /tmp/weft-linux-tests && ctest --test-dir /tmp/weft-linux-tests --output-on-failure` |
| C-ui | `pnpm --filter example test:<platform>` after `pnpm --filter example build:<platform>` |
| C-shot | `pnpm --filter showcase shot:web` (in the `web` container, below), `pnpm --filter showcase shot:ios` and `pnpm --filter showcase shot:android`; at most 0.1% of pixels may differ in each screenshot |
| C-shot-local | `pnpm --filter showcase shot:wechat`, `shot:macos`, `shot:windows` (via `/tmp/weft-win.sh` on macOS), and `shot:linux` (in the container); compare WeChat and open the three desktop screenshots for manual review |

`WEFT_UPDATE_SNAPSHOTS=1` rewrites the Rust snapshots and the conformance goldens. Only do so when the change is meant to alter generated code, and review the diff.

### UI flows

CI runs the Android and iOS flows nightly (`nightly.yml`). The other platforms run locally:

- **macOS**: `pnpm --filter example test:macos`. Switch to an English input source (ABC) first; other input methods intercept XCUITest's typing.
- **Windows**: `pnpm --filter example build:windows`, then `pnpm --filter example test:windows` from an interactive desktop session (FlaUI drives the real window).
- **Linux**: build the compiler WASM on the host (`pnpm build:wasm`), then start the container (`docker compose -f native/linux/docker/compose.yaml up -d --build`), then in `docker compose -f native/linux/docker/compose.yaml exec linux bash`: `pnpm install`, `native/linux/build-core.sh`, `pnpm --filter example build:linux` and `pnpm --filter example test:linux`. The desktop is on `vnc://localhost:5901` (password `weft`).

## Screenshot regression

The [showcase](showcase/README.md) records screenshots in `showcase/screenshots/actual/<platform>/` and writes failed comparisons to `showcase/screenshots/diff/<platform>/`. Run one platform at a time in a checkout. When a visual change is intentional, run `WEFT_UPDATE_SNAPSHOTS=1 pnpm --filter showcase shot:<platform>` and review each updated image under `showcase/screenshots/baseline/` before committing it. macOS, Windows and Linux screenshots are for manual review only.

Rendering depends on the OS, so record the Web, iOS and Android baselines in the environment the nightly jobs use: the `web` container, Xcode 27.2 with its iOS 27.2 simulator, and a Pixel 10 emulator (1080×2424, 420 dpi) with the Android 37.0 ATD image.

- **Web:** build the compiler WASM on the host (`pnpm build:wasm`), then run `docker compose -f native/linux/docker/compose.yaml run --rm web sh -c 'pnpm install && pnpm --filter showcase shot:web'`. The container has the browser and fonts the baselines use, so they come out the same on any host. Pass `-e WEFT_UPDATE_SNAPSHOTS=1` or `-e WEFT_SHOT_PAGES=…` after `run`.
- **iOS:** install the `iPhone 17` simulator (`WEFT_IOS_DEVICE` can override its name or UDID). The driver boots it, switches it to Simplified Chinese (China) if needed, and fixes the status bar for the shots.
- **Android:** create the emulator once with `sdkmanager "system-images;android-37.0;google_atd;arm64-v8a"` and `avdmanager create avd -n Weft_Shots -k "system-images;android-37.0;google_atd;arm64-v8a" -d pixel_10` (`x86_64` on an Intel host), and start only that emulator before running `shot:android`; `adb` must be on `PATH`. The ATD image has no system bars, so the shots have no safe-area insets.
- **WeChat:** install and sign in to WeChat DevTools, then enable Settings → Security → Service Port (设置 → 安全设置 → 服务端口). Set `WEFT_WECHAT_CLI` to the DevTools CLI if it is not at `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`. If the CLI rejects `touristappid`, add `{"appid": "<your AppID>"}` to the ignored `showcase/apps/wechat/project.private.config.json` using an AppID the signed-in account can access.
- **macOS:** run `shot:macos` in a graphical desktop session. Open the resulting window captures to check the page rendered.
- **Windows:** run `shot:windows` in an interactive Windows desktop. On the development Mac it calls `/tmp/weft-win.sh` with `/tmp/win-sync.ps1` to sync first, runs the tests in the guest's interactive session, and copies back the images. See the [Windows VM setup](PLAN.md#附录windows-虚拟机脚本).
- **Linux:** use the same Docker desktop and kernel setup as C-ui, then run `docker compose -f native/linux/docker/compose.yaml exec linux pnpm --filter showcase shot:linux`.

## Conventions

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/) (`fix(core): …`, `docs: …`). One commit does one thing; its body lists the changes.
- **Changesets**: every user-visible change to a published package comes with a changeset (`pnpm changeset`). All `@weft-ui/*` packages share one version. Before 1.0, a minor version may break compatibility.
- **Generated files** start with a "Generated from protocol/weft.protocol.json" header. Never edit them; change the schema and run `pnpm gen:protocol`.
- **Protocol changes** start in `protocol/SPEC.md` and `protocol/weft.protocol.json`, with cases in `protocol/corpus/`, before any implementation.
- **Docs** are written in English and Chinese; change both. The specs (`crates/parser/GRAMMAR.md`, `protocol/SPEC.md`) have `.zh-CN.md` counterparts.
- **Rust** follows the formatting and Clippy settings of the workspace; Clippy warnings fail CI.

## Releasing

Maintainers publish every `@weft-ui/*` package together, from master, through the Release workflow (`.github/workflows/release.yml`). It builds each prebuilt kernel on its own platform (macOS for Apple, Ubuntu 24.04 for Android and Linux x64 and arm64, Windows x64 and arm64), packs the packages with them, and stages the versions that are not on npm yet. Nothing goes live until a maintainer approves it.

1. Run `pnpm version-packages`, review the versions and changelogs, and merge the commit to master.
2. Run the Release workflow on master with **stage** checked. Leave it unchecked for a dry run: it builds, checks and packs, uploads the tarballs as the `packages` artifact, and runs `npm stage publish --dry-run`.
3. On npmjs.com, open **Staged Packages**, review the staged versions, and approve them with 2FA.

The workflow stages through [trusted publishing](https://docs.npmjs.com/trusted-publishers), with no npm token. Each package needs a trusted publisher for the `weft-ui` organization, the `weft-ui` repository and the `release.yml` workflow. A package that is not on npm yet has no settings page to add one: run the workflow as a dry run, download the `packages` artifact, stage that package's tarball locally with `npm stage publish --access public <tarball>` while logged in, approve it, and then add the trusted publisher.

## Reporting bugs and security issues

Open an issue with the bug report template. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
