# @weft-ui/native-linux

## Unreleased

- Add virtualized GTK List and Grid views, including grouped sections and estimated row heights. GTK 4.12 or newer is required.

## 0.2.0

### Minor Changes

- The native shells ship as npm packages with their prebuilt kernels: `@weft-ui/native-apple`, `@weft-ui/native-android`, `@weft-ui/native-windows` and `@weft-ui/native-linux`. Building a native app no longer needs this repository, Rust, CMake or the Hermes sources. Install the package of each native target next to `@weft-ui/vite`, for example `pnpm add -D @weft-ui/native-android`. `@weft-ui/vite` resolves the shell and the Hermes compiler from it, and stops a native build when the shell implements another protocol version than `@weft-ui/runtime`.

### Patch Changes

- `setInterval` with a zero delay keeps repeating instead of running once.
- The kernel no longer needs the system ICU: `localeCompare`, case conversion, `normalize` and `toLocaleString` use ICU4X with built-in locale data, so the prebuilt kernel loads whatever ICU version the distribution has. Image textures are cached up to 64 MiB, least recently used first out, instead of without bound.
- A batch of ops that fails to decode no longer applies the ops before the error: the whole batch is decoded first, as on Android and Windows.
