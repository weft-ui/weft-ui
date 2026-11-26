# View protocol

[中文](SPEC.zh-CN.md)

This specification defines the contract between the JS logic layer (`@weft-ui/runtime/remote` and generated remote-mode logic modules) and the view layer (mini program WXML, native platforms, and the headless renderer).

The headless renderer in `@weft-ui/runtime/testing` is the reference implementation. It encodes and decodes each batch of ops, validates it against the layout, and applies it to an in-memory tree. The golden files in `tests/conformance/golden/` contain the op text recorded by this renderer.

## Layout

`ViewLayout` (`crates/transformer/src/view/mod.rs`) is derived from the entire application's Program. WASM exposes the JSON form through `compileApp(...).layout`; see `crates/transformer/tests/snapshots/TodoList/layout.json` for an example.

```json
{
  "hash": "a6bb96edf9a9ad2d",
  "safeArea": true,
  "templates": [
    {
      "label": "TodoList",
      "kind": "component",
      "roots": [0],
      "nodes": [{"element": "Column", "props": {}, "children": [1, 2]}, {"point": 0}],
      "values": [{"node": 1, "prop": "value", "type": "String"}],
      "events": [{"node": 1, "event": "onChange", "payload": "String", "controls": 0}],
      "points": [{"node": 2, "kind": "branch", "templates": [1]}]
    }
  ]
}
```

- **Template numbering**: Component bodies come first, in Program order, so template `i` is the body of component `i`. Next come the `if` branches (one template per branch), `for` row bodies, and slot contents within each component, in order of appearance. `label` is for debugging only: `TodoList`, `TodoList:if8.0` (branch 0 of node 8), `TodoList:for7`, `Board:slot12`.
- **Nodes**: `nodes` is the template-local node table, and `roots` lists the top-level nodes. Element nodes have static `props` (unbound literals that the platform inlines directly into the template without allocating slots) and children. `{"point": n}` marks the position of mount point `n` in the tree.
- **Value slot** `values[i]`: A dynamic property of a node. `type` is the declared type of the element property: `Int` / `Float` / `Bool` / `String` / `Color` / `Strings`. A `Strings` slot holds an array of strings (wire tag 4). The value of a `Color` slot is a string parsed by the platform (see [Built-in elements and layout](../crates/parser/GRAMMAR.md#built-in-elements-and-layout) for the rules). Static colors are validated at compile time and written in `props` as normalized `#rrggbb` or `#rrggbbaa` values. Controlled properties such as `Input.value`, `Checkbox.checked`, and `Picker.selected` always use value slots, even when constant.
- **Event slot** `events[i]`: An event property of a node. `payload` specifies the payload type (`null` means no payload). Every controlled element has an `onChange` event slot. Its `controls` field is the index of the value slot it controls; for all other events, `controls` is `null`. JS handles lifecycle properties (`onMount` / `onUnmount`), which do not appear in the layout.
- **Mount point** `points[i]`: `branch` (`templates` lists branch templates in order), `list` (`template` is the row body), `instance` (`template` is the body of the instantiated component), or `slot` (the caller supplies the slot content, which may be any template of kind `slot`).
- **Page and lazy templates**: A page body has template `kind: "page"`. A lazy mount point has `{"node": n, "kind": "lazy", "templates": [row]}`, or `[header, row]` for sections.
- **App**: An application layout has a top-level `app`, either `{"start": template}` or `{"tabs": [{"page": template, "title": "…", "icon": "asset:…", "activeIcon": "asset:…"}]}`. It participates in the hash; routing remains in JS.
- **Theme**: When the app declares a theme, the top-level `theme` object maps color token names to `[light, dark]` pairs. Both colors use lowercase `#rrggbbaa`; a token with only one color repeats it. Numeric tokens are folded by the compiler and do not appear here. A token in a static `props` entry or a dynamic `Color` value slot uses the string `"@name"`; it is resolved according to the host's appearance.
- **Safe area**: The top-level `safeArea` boolean records whether the app requests safe-area padding. It defaults to `true` and is included in the layout hash.
- **Hash**: The 64-bit FNV-1a hash of the JSON with the `hash` field removed, represented as 16 hexadecimal digits. It is written into both the JS logic (as an `App` constructor argument) and the platform view. The sink compares the hashes at `open` and reports an error if they differ.

## Scope

At runtime, each template instance is a scope. JS allocates IDs per app, starting at 1 and increasing without reuse. Scope 0 is the virtual root and has only mount point 0. The root component instance is mounted with `attach 0 0 <id>`.

A scope is created by `create` and is not yet mounted in the tree. It is implicitly destroyed if it is replaced by `branch`, no longer appears in `rows`, or an ancestor is destroyed. Its descendants are destroyed with it. On `unmount`, the sink receives `close`, which invalidates all scopes at once.

Applications use page-root scopes referenced by `nav` instead of `attach`; a program uses only one root convention. Page roots are created and fully set in the same batch before `nav`. The first batch contains the complete navigation state; later `nav` ops are sent only on changes. Pages no longer referenced by the latest state (including host-reported navigation) and their descendants are destroyed, and JS sends no further ops for them.

A lazy point owns a flat sequence of item IDs, allocated from 1 without reuse within that point. Stable keys retain IDs until removed. `splice` replaces the changed middle after the common prefix and suffix; retained IDs keep their materialized scopes, removed IDs destroy theirs. `bind` associates an item with a created scope, or releases it when child is 0. Window requests materialize in-range items and release out-of-range scopes; initially up to 20 items are materialized. A created item scope and its initial values precede its `bind` in the same batch.

## Ops

| op       | Parameters               | Meaning |
| -------- | ------------------------ | ------- |
| `create` | scope, template          | Create an instance. |
| `set`    | scope, slot, value       | Write a value to a value slot. The value type matches the slot type. |
| `branch` | scope, point, child \| 0 | Switch a `branch` mount point to child (0 means no branch). The previous child scope is destroyed. |
| `rows`   | scope, point, [child…]   | Replace the full row order at a `list` mount point. Rows absent from the new list are destroyed. |
| `attach` | scope, point, child      | Mount child at an `instance` / `slot` mount point. This op is sent only once per mount point. |
| `splice` | scope, point, index, remove, items | Replace a range at a `lazy` point with `(item, template)` pairs. Template is an index into the point's `templates`. |
| `bind` | scope, point, item, child \| 0 | Materialize or release a lazy item. |
| `nav` | tab, tabs, stack, modal, style | Replace the complete navigation state; uncreated tabs and an absent modal are 0. |

Guarantees:

- One batch of ops corresponds to one flush. The sink applies the entire batch at `commit`.
- A new scope's `create` and the `set` ops for all of its value slots are in the same batch, before the op that mounts it. The platform always builds the subtree before inserting it.
- A new scope's `branch` mount points are empty and its `list` mount points have no rows. No op is sent when state is unchanged: no `rows` for an initially empty list, no repeat `rows` for an unchanged order, and no `set` for an unchanged value.
- A child at a mount point must be an instance of a template allowed by that mount point. A scope can be mounted at most once.

## Events

Only one message goes in the opposite direction: `Session.dispatch(scope, slot, payload) → boolean`. `slot` is the event slot index, and the event slot determines the type of `payload`. JS runs the handler and flushes synchronously, so the sink receives any ops caused by the event before the call returns. The return value indicates whether a controlled edit was accepted. It is `true` if the event slot has no `controls`, the scope has been destroyed, or the current value of the controlled value slot equals the payload. On `false`, the view restores the control to the current value of the controlled value slot (any value rewritten by the host has already arrived via `set`). Events for destroyed or unknown scopes are ignored and return `true`.

## Binary encoding (version 3)

A batch of ops is a byte sequence: the first byte is the version number `3`, followed by consecutive ops. All integers are little-endian u32 values.

| opcode | op       | Fields                             |
| ------ | -------- | ---------------------------------- |
| 1      | `create` | scope, template                    |
| 2      | `set`    | scope, slot, value                 |
| 3      | `branch` | scope, point, child                |
| 4      | `rows`   | scope, point, count, child × count |
| 5      | `attach` | scope, point, child                |
| 6      | `splice` | scope, point, index, remove, count, (item, template) × count |
| 7      | `bind` | scope, point, item, child |
| 8      | `nav` | tab, n, scope × n, m, scope × m, modal, style |

All listed fields are little-endian u32. `style` uses `modalStyles`: `sheet` = 0, `fullScreen` = 1; it is 0 when `modal` is 0.

Each value starts with a u8 tag: `0` for false, `1` for true, `2` for a number (little-endian f64, including values in `Int` slots), `3` for a string (u32 byte length followed by UTF-8), or `4` for an array of strings (u32 string count followed by that many strings, each with its own u32 byte length and UTF-8 bytes, without a tag). On the JS side, `OpWriter` (`src/ops.ts` in `@weft-ui/runtime`) reuses the same buffer. The bytes of a batch are valid only until the next write.

The version, opcodes, value tags and decoding error kinds, together with the platform names and the platform call modules, are defined once in [`protocol/weft.protocol.json`](weft.protocol.json). `pnpm gen:protocol` (`protocol/generate.ts`) generates the constants for TypeScript, Rust, C++, Swift, Kotlin and C# from it, and `pnpm test` fails when a generated file is out of date.

Built-in elements are defined separately in [`protocol/weft.elements.json`](weft.elements.json). The same command generates the Rust and TypeScript catalogs, native enums for built-in string unions, and the base stylesheet constants from [`protocol/weft.css`](weft.css). Keep members in order: a property's index feeds into its mini program data key. The catalogs share an ordered `CSS_PROPS` table of distinct CSS mappings, in first-use order.

## Decoding errors

Decoding a batch fails with exactly one of five errors. Every reader uses the same kind names:

| Kind        | Cause |
| ----------- | ----- |
| `truncated` | The batch is empty, or a length or count runs past the remaining bytes. |
| `version`   | The first byte is not a supported version. |
| `opcode`    | An op starts with an unknown opcode. |
| `tag`       | A value starts with an unknown tag. |
| `utf8`      | A string value is not well-formed UTF-8: overlong encodings, surrogates, code points above U+10FFFF, truncated multi-byte sequences, and lone continuation bytes are all rejected. |

- A batch that fails to decode is handled the way each platform shell already handles it, and none of its ops are applied.
- A reader checks the opcode before it reads any field of the op, so an unknown opcode is reported as `opcode` even when no bytes follow it.
- If the payload of an event fails to decode, the kernel logs the error and `weft_runtime_dispatch` returns `true`.

The shared corpus in [`protocol/corpus/`](corpus/) lists encoded batches with their decoded ops or error kinds, encoded values, and platform call frames. The readers, value encoders and frame codecs of every platform shell are tested against it.

## Versioning

At startup the kernel compares the shell's first `weft_host.protocol` field with its generated `weft::protocol::kVersion`, logs `weft: protocol mismatch: kernel speaks 3, shell speaks 2` and returns NULL on mismatch. Before checking the layout hash, `__weft.open` compares the bundle's protocol with the kernel's and throws `weft: protocol mismatch: bundle speaks 3, kernel speaks 2` on mismatch. The shell reports kernel logs unchanged on startup failure. This supplements the build-time check; web and mini programs need no negotiation because bundle and views are built together.

- The protocol version is the integer `version` of [`weft.protocol.json`](weft.protocol.json), written as the first byte of every batch. Any change that an existing reader or kernel would misread (new opcodes, value tags, field layouts, or changed semantics of an op or event) increments it. Additions that old readers never receive do not.
- Each native shell package (`@weft-ui/native-<target>`) records the protocol version it implements in `weft.protocol` of its `package.json`; `pnpm gen:protocol` writes it. Before a native build, `@weft-ui/vite` compares it with the protocol version of `@weft-ui/runtime`, which the compiled bundle speaks, and fails with both versions when they differ, so a mismatch never reaches a device.
- All `@weft-ui/*` packages are released together with one version. Before 1.0, a minor release may break compatibility, and every protocol version change comes with a new minor release; patch releases never change the protocol. Use the same version of every `@weft-ui/*` package.
- From 1.0 on, the range of compiler, runtime, kernel and shell versions that may be mixed within one major version is stated here (ROADMAP M6.6).

## Text form

Debug dumps and golden files use one op per line, with strings, string arrays and booleans written as JSON:

```
create 3 2
set 3 0 "milk"
rows 2 0 [3 4 5]
branch 1 0 0
attach 0 0 1
splice 2 0 0 0 [1/0 2/1 3/1]
bind 2 0 1 7
bind 2 0 3 0
nav 0 [4 0] [9 11] 13 sheet
nav 0 [4] [] 0
```

The headless renderer appends a template label or slot description after `#`, for example `create 1 0  # TodoList` or `set 1 0 ""  # Input.value`.

## Sink

`Sink` is the platform-side interface (`src/remote.ts`):

- `open(session)`: Called once at mount. `session` provides `hash`, `dispatch`, and `detach` (called when the platform view disappears before the app).
- `create` / `set` / `branch` / `rows` / `attach`: Record ops in the current batch.
- `commit()`: Apply the entire batch at the end of a flush.
- `close()`: On unmount, discard all scopes.

The mini program sink (`./wechat`) does not encode ops. It translates them directly into `setData` paths, using the data layout below. The headless renderer uses binary encoding. The native sink (`./native`) passes the buffer to `__weft.commit`; see the next section.

### Mini program data layout

WXML renders only `{{key}}`. The `setData` paths are paths in the block data tree (`N` is the node number in the IR):

| Key             | Contents |
| --------------- | -------- |
| `n{N}_{i}`      | Property value or text. |
| `e{N}_{k}`      | Handler ID (assigned by the sink) for the element's `k`-th event, zero-based. WXML binds `bind<type>="$e"` and `data-e<type>="{{e{N}_{k}}}"`, where `type` is the lowercase mini program event name. The `tap` type uses `catchtap` instead of `bindtap` so only the innermost handler runs. |
| `i{N}` / `b{N}` | Current `if` branch index / branch data. |
| `l{N}`          | Array of `for` rows. Each row carries `k` (the row's scope ID, used as `wx:key`). |
| `c{N}`          | Component instance data. |
| `y{N}`          | Data for the first `Children` parameter. |
| `y{N}_{p}`      | Data for another `Children` parameter, where `p` is its zero-based index in the full parameter list. |

Slot data holds `t`, the slot content template name. In the calling component, that name is `{Component}-s{N}` for the callee's first `Children` parameter and `{Component}-s{N}_{p}` for any other slot. Here `N` is the call node ID, rather than the slot node ID used in the receiving component's data key.

`$e` reads `currentTarget.dataset["e" + event.type]`. `tap` and `confirm` carry no payload; `input`, `change` and `changing` carry `detail.value`. `focus` and `blur` carry `true` and `false`, respectively, and both bindings use the same `onFocusChange` handler ID.

Each value slot in the generated view table is `[key]` for a raw value or `[key, cssIndex]` for a style. The sink converts a styled value into a complete declaration string with `CSS_PROPS[cssIndex]`. The template joins static and dynamic declarations in schema member order, so declarations for a more specific padding or margin edge follow and override broader ones.

Image `src` values stay as strings in the layout and ops. The mini program view table maps image slots with `[key, "src"]` (optionally followed by a metrics key); static `asset:` URLs come from its `a` field. The sink reads `assets.js` to resolve those URLs to the window's density. Load events set `m{N}` to the image's sizing declarations and clear any placeholder independently of the logic batch; `ws` identifies the scope receiving this event.

`view.wxss` always includes the base stylesheet. A themed app also defines token variables on `:host` and their dark media-query overrides. The generated view table lists the valid token names; dynamic `Color` values referencing them are written as `var(--weft-name)`. Unknown names render transparent.

`setData` rules:

- Each view calls `setData` only once per flush. The block's `set` compares old and new values with `===` and sends only changed leaves, using paths such as `r.b8.l7[2].n3_0`.
- For append-only list changes, send the new rows by index path (`l7[3]`). On deletion, movement, or insertion, send the full row array. Reused rows retain their handler IDs. Nothing is sent if the order is unchanged.
- Within a flush, discard paths covered by other paths because an entire ancestor is already being sent.

## Native kernel

On native platforms, the JS bundle runs in the kernel in `native/core`. The kernel embeds Hermes, executes `bundle.hbc`, and communicates with the platform shell through the C ABI ([`native/core/include/weft/runtime.h`](../native/core/include/weft/runtime.h)). The platform shell is WeftKit in `native/apple` for iOS / macOS, the Kotlin module in `native/android` for Android (loads `libweft.so` through JNI), Weft.WinUI in `native/windows` for Windows (loads `weft_core.dll` through P/Invoke), and the C++ library in `native/linux` for Linux (links against `libweft_core.so`). The kernel does not create threads. All functions are called on the UI thread and must not be called reentrantly from a `weft_host` callback.

The shell supplies initial launch options in `weft_host.launch`, a NUL-terminated UTF-8 JSON string copied during startup; NULL means `{}`. The shell calls `weft_runtime_window(rt, scope, point, start, end)` for a lazy point's half-open window, and `weft_runtime_signal(rt, name, json, len)` for a host event. Unknown signal names are ignored. Signals include `navigation` (`tab`, `stack`, `modal`), `lifecycle` (`state`), `memory` (`{}`), and `link` (`url`).

### The `__weft` global

The kernel installs this global before running the bundle. The native implementations of `@weft-ui/runtime/native` and `@weft-ui/platform` use it:

| Member                            | Meaning |
| --------------------------------- | ------- |
| `open(hash, dispatch, protocol, window)` | Opens the sink; `window` receives scope, point, start and end. Checks protocol before layout hash; throws on mismatch or if an app is already open. |
| `protocol`                        | The kernel's protocol version. |
| `launch`                          | Startup options as a JSON string; defaults to `{}`. |
| `on(name, callback)`              | Registers one signal callback per name, replacing the previous callback; receives a JSON string. |
| `commit(buffer, offset, length)`  | A batch of ops. The kernel passes this byte range directly to `weft_host.commit` without copying it. |
| `close()`                         | The sink's `close`. Subsequent events are ignored. |
| `supports(module)`                | Whether the platform shell implements the platform module `module`. |
| `call(module, method, args?)`     | A platform call returning `Promise<ArrayBuffer>`. `args` is a string (sent as UTF-8), an `ArrayBuffer`, or a view of one. If the module is unsupported, the promise immediately rejects with an `Error`. |
| `version`                         | The system version reported by the platform shell (`weft_host.version`). |
| `environment`                     | The current window environment as a JSON string. |
| `listen(callback)`                | Registers one environment callback with no arguments; another call replaces it. |

The kernel also injects `setTimeout` / `setInterval` / `clearTimeout` / `clearInterval`, `queueMicrotask`, and `console` (`debug` / `log` / `info` / `warn` / `error` map to levels 0–3 of `weft_host.log`; non-string arguments are output as JSON and error objects are output as their `stack`). Hermes provides `TextEncoder` / `TextDecoder`.

### Environment

The shell supplies the initial environment in `weft_host.environment` as a NUL-terminated UTF-8 JSON string (the kernel copies it during `weft_runtime_new`). A null pointer supplies `{}`. The object has this shape:

```json
{
  "colorScheme": "light",
  "screen": { "width": 390, "height": 844, "scale": 2 },
  "safeArea": { "top": 47, "bottom": 34, "start": 0, "end": 0 },
  "orientation": "portrait"
}
```

`colorScheme` is `light` or `dark`. `screen` gives the window content size in logical pixels and the physical pixel scale. `safeArea` gives the logical insets reserved for system UI on the respective edges (`start` is left and `end` is right); desktops report zero. `orientation` is `landscape` when width exceeds height, otherwise `portrait`.

When any field changes, the shell calls `weft_runtime_environment(rt, json, len)` on the UI thread with the complete updated object as UTF-8 bytes. It skips identical updates. The kernel replaces `__weft.environment` before invoking the registered callback, then drains microtasks before returning.

### Event loop

- `weft_runtime_new` executes the bundle, which mounts the app. Every entry point that executes JS (`new`, `tick`, `dispatch`, `resolve`, `environment`, `window`, `signal`) drains the microtask queue before returning. The first batch of ops has therefore been committed by the time `weft_runtime_new` returns.
- Timers run in order of expiration, with ties broken by the order in which they were set. The microtask queue is drained after each timer. Timers set during a `tick` are deferred to the next one. The kernel requests the next `tick` with `weft_host.schedule(delay)`. The platform shell may coalesce requests; early or redundant calls to `tick` are harmless.
- Uncaught exceptions in the bundle, timers, microtasks, event handlers, or the environment callback are reported as `WEFT_LOG_ERROR` without terminating the runtime. If the bundle itself throws (including on a layout hash mismatch), `weft_runtime_new` returns `NULL`.

### Event payloads

The `payload` in `weft_runtime_dispatch(rt, scope, slot, payload, len)` is a value in the [binary encoding](#binary-encoding-version-3) (tag byte followed by data). String arrays are only used for view values, never as event payloads. Pass an empty payload for an event with no payload. The return value is that of `Session.dispatch`.

For an `Input` or `TextArea` with `maxLength`, the host truncates a user edit to the limit in UTF-16 code units before dispatching `onChange`. The kernel receives the already truncated payload.

### Platform calls

`__weft.call` allocates a call ID and calls `weft_host.call(id, module, method, args)`. On asynchronous completion, the platform shell calls `weft_runtime_resolve(id, ok, result)` on the UI thread, exactly once per ID. If `ok` is true, the promise resolves with an `ArrayBuffer` copy of `result`. Otherwise, it rejects with an `Error` whose message is `result` (UTF-8). Each module defines how to interpret the bytes:

| Module    | Method                   | Arguments | Result |
| --------- | ------------------------ | --------- | ------ |
| `fetch`   | `request`                | Frame: `u32 header length (little-endian) \| header (UTF-8 JSON) \| body`. The header is `{"url", "method", "headers"}`. | Same frame format, with a `{"status"}` header followed by the response body. |
| `storage` | `get` / `set` / `remove` | JSON array: `[key]` or `[key, value]`. | `get`: a JSON string or `null`; otherwise empty. |

If `supports(api)` is false, `@weft-ui/platform` throws `PlatformError` without making the call.

### Row moves

Platform shells that move native rows themselves (WinUI, GTK) can use `weft_stable_rows(old, new, stable)`. It marks the rows that stay in place in the new order (the longest increasing subsequence of the old positions). Other rows must be moved or inserted. C++ platform shells can use `weft/ops.hpp` to decode ops without allocating memory. Strings and row lists point directly into the batch's bytes.
