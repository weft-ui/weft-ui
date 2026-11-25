# AGENTS.md

- Use the `rust-best-practices` skill when writing Rust code.
- Test the Windows platform in Parallels Desktop or run `ssh win` to enter into the VM.
- Test the Linux platform in Docker + VNC.
- Generated protocol/element files start with a `"Generated from protocol/..."` header: never edit them by hand; edit `protocol/weft.protocol.json`, `protocol/weft.elements.json`, or `protocol/weft.css` and run `pnpm gen:protocol`.
- Docs (`docs/src/content/docs/` and `docs/src/content/docs/zh/`) and specs (`protocol/SPEC*.md`, `crates/parser/GRAMMAR*.md`) are maintained in English and Chinese; update both when changing documented behavior.
- Only run `WEFT_UPDATE_SNAPSHOTS=1` when intentionally changing generated code/snapshots, and review the diff.
- Standard verification commands (see `CONTRIBUTING.md`):
  - `C-rust`: `cargo fmt --all --check && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
  - `C-ts`: `pnpm build && pnpm typecheck && pnpm test`
  - `C-core`: `cmake -S native/core -B native/core/build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build native/core/build && ctest --test-dir native/core/build --output-on-failure`
  - `C-apple`: `swift test --package-path native/apple`
  - `C-android`: `WEFT_NATIVE=0 pnpm --filter example build:android && example/apps/android/gradlew -p example/apps/android :weft-android:testDebugUnitTest`
