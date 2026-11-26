# @weft-ui/native-android

## Unreleased

- Render application page stacks with native navigation, predictive back, and Material title bars.

## 0.2.0

### Minor Changes

- The native shells ship as npm packages with their prebuilt kernels: `@weft-ui/native-apple`, `@weft-ui/native-android`, `@weft-ui/native-windows` and `@weft-ui/native-linux`. Building a native app no longer needs this repository, Rust, CMake or the Hermes sources. Install the package of each native target next to `@weft-ui/vite`, for example `pnpm add -D @weft-ui/native-android`. `@weft-ui/vite` resolves the shell and the Hermes compiler from it, and stops a native build when the shell implements another protocol version than `@weft-ui/runtime`.

### Patch Changes

- `setInterval` with a zero delay keeps repeating instead of running once.
