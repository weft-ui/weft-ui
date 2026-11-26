---
title: Platform API
description: Start a Weft UI app, make HTTP requests, and store data with the same API on every target.
sidebar:
  order: 4
---

Import from `@weft-ui/platform` in your entry point and [logic layer](/guides/logic/). The package gives you one API for Web, WeChat, and native apps. The [TypeScript declarations](https://github.com/weft-ui/weft-ui/blob/master/packages/platform/src/index.d.ts) define what is portable.

## Start the app with `run`

`run(app: App): void` takes an instance of your generated root component or application. For apps with pages, see [Pages and navigation](/guides/navigation/). The package's `App` type describes the lifecycle of that instance: `mount(target: never): void` and `unmount(): void`. The host supplies the target, so don't call `mount` yourself when starting the app.

In the [todo example](/guides/logic/), the generated `App` comes from `App.weft`. Register any event handlers before calling `run`:

```ts
import { run } from "@weft-ui/platform";
import { App } from "./App.weft";

const app = new App({ clicked: false, draft: "", todos: [] });
run(app);
```

On Web, `run` mounts into the element with `id="app"` and throws an `Error` if that element is missing. On WeChat, it registers the generated views and lifecycle callbacks with the Mini Program's `App(...)`. On native targets, it mounts through the native runtime into the platform shell's views. See [Getting started](/guides/getting-started/) for the entry point and build setup.

## Make HTTP requests with `fetch`

The package exports `fetch` and its portable `RequestInit` and `Response` types:

```ts
export declare function fetch(url: string, init?: RequestInit): Promise<Response>;

export interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
}

export interface Response {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
```

- Omit `method` for `GET`. To send JSON, pass `JSON.stringify(data)` as the body and set `Content-Type: application/json` in `headers`. Prefer absolute HTTPS URLs for cross-platform requests; the host still controls which requests it allows.
- An HTTP error status isn't a rejected request. Check `ok` (true for status codes 200–299) or `status` before reading the body. Use `text()` for UTF-8 text, `json()` to parse JSON, or `arrayBuffer()` for raw bytes. Read each response with just one body reader for portability: the browser response body is single-use.
- The portable API has no response headers, streaming body, `FormData` request body, cancellation signal, or timeout option. There is no shared size limit specified by Weft UI; host limits still apply. Don't rely on browser-only Fetch options in shared code.

This helper loads starter todos from a JSON endpoint you supply. It leaves local todos alone when it can't load them. Check the returned data's shape before assigning it to your model: `json()` parses the body but does not validate it against your model type.

```ts
import { fetch, PlatformError } from "@weft-ui/platform";

async function loadStarterTodos(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      console.error(`Could not load starter todos: HTTP ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    if (error instanceof PlatformError && error.api === "fetch") {
      console.warn("Network requests are unavailable; keeping local todos.");
    } else {
      console.error("Could not request or decode starter todos", error);
    }
    return null;
  }
}
```

## Persist state with `storage`

Keys and values are strings. `get` resolves to `null` for a missing key, so an empty string is distinct from a missing value. To store an object, serialize it with `JSON.stringify` and parse it after reading. Use `remove` to clear a saved value instead of storing the string `"null"`.

```ts
export declare const storage: {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};
```

In the todo example's entry point, add these handlers before `run(app)` (or replace the existing mount and click handlers). They restore the `clicked` flag when the root mounts and save it after a click. The button still updates the view if storage is unavailable or a write fails.

```ts
import { isSupported, storage } from "@weft-ui/platform";

app.onMount(async (model) => {
  if (!isSupported("storage")) return;
  try {
    model.clicked = (await storage.get("clicked")) === "true";
  } catch (error) {
    console.warn("Could not restore the clicked state", error);
  }
});

app.onClick(async (model) => {
  model.clicked = true;
  if (!isSupported("storage")) return;
  try {
    await storage.set("clicked", "true");
  } catch (error) {
    console.warn("Could not save the clicked state", error);
  }
});
```

To forget the saved flag, use `await storage.remove("clicked")`. That removes the persistent value; it doesn't change the current model.

## Show dialogs, action sheets, and toasts with `ui`

```ts
import { ui } from "@weft-ui/platform";

await ui.alert({ title: "Saved", message: "Your changes are saved." });
const confirmed = await ui.confirm({ message: "Delete this item?", destructive: true });
const selected = await ui.actionSheet({ title: "Choose an action", options: ["Edit", "Delete"], destructiveIndex: 1 });
ui.toast("Saved", { icon: "success", duration: "short" });
```

`alert` accepts optional `title`, `message`, and `confirmText` and resolves with no value. `confirm` also accepts `cancelText` and `destructive`, and resolves to a boolean. Button labels default to `OK` and `Cancel`. `actionSheet` accepts an optional `title`, required `options`, an optional zero-based `destructiveIndex`, and optional `cancelText`; it resolves to the selected zero-based index or `null` on dismissal. It rejects immediately with `RangeError` unless there are 1–6 options. WeChat cannot color an individual action sheet option, so `destructiveIndex` has no visual effect there.

Only one dialog or action sheet is shown at a time; later calls queue in FIFO order. System dismissal (such as Back, Escape, or tapping the backdrop) resolves `confirm` to `false` and `actionSheet` to `null`. Toasts do not queue: a new toast replaces the previous one. Toast icons are `none`, `success`, or `error`; duration is `short` (1.5 seconds, the default) or `long` (3 seconds).

All five native shells implement `ui` with their platform's dialogs: SwiftUI alerts and confirmation dialogs (an action sheet appears as a dialog on macOS), Material dialogs and a bottom sheet on Android, `ContentDialog` on Windows, and `GtkAlertDialog` on Linux, which cannot color a destructive option. A host without `ui` reports `isSupported("ui")` as false; there, dialog and action sheet calls reject with `PlatformError`, while `toast` throws it synchronously.

## Check the host and its capabilities

Use `platform.os` and `platform.version` to identify the current host. `os` is one of `web`, `wechat`, `ios`, `macos`, `android`, `windows`, or `linux`. `version` is a host-specific string, not the Weft UI package version. Don't assume a common format across platforms. For example, on Web it is the full user agent string; on native targets it is empty if the kernel isn't present or the shell supplies no version.

`isSupported(api: "fetch" | "storage" | "ui" | "navigation"): boolean` checks whether the current host exposes a capability without performing an operation. `navigation` reports whether the host shows tab badges set with `navigation.setBadge`. Use it to choose a fallback. A `true` result does not guarantee an individual operation will succeed.

| Target | `fetch` | `storage` | `platform.version` |
| --- | --- | --- | --- |
| Web | `globalThis.fetch`, if present | Browser `localStorage`, if accessible | `navigator.userAgent` |
| WeChat | `wx.request`, if present | Requires `wx.getStorage`, `wx.setStorage`, and `wx.removeStorage` | `wx.getAppBaseInfo().version` |
| iOS and macOS | `URLSession` | `UserDefaults.standard` | OS major, minor, and patch versions |
| Android | `HttpURLConnection` | App `SharedPreferences` | `Build.VERSION.RELEASE` |
| Windows | `HttpClient` | `storage.json` in the app's local application data directory | `Environment.OSVersion.Version` as a string |
| Linux | libsoup | `storage.json` in the app's XDG user data directory | Distribution version ID, or kernel release if unavailable |

All five native shells supplied by Weft UI implement both capabilities. The native implementation asks the running shell what it supports. See [Platforms](/guides/platforms/) for host setup or the [view protocol spec](https://github.com/weft-ui/weft-ui/blob/master/protocol/SPEC.md#platform-calls) for the native call format.

## Read the window environment

- `platform.colorScheme` is `"light"` or `"dark"`. WeChat reports the system appearance when you enable `"darkmode": true` in `app.json`; Linux uses the desktop settings portal. The fallback is `"light"`.
- `platform.screen` gives the window content's `width` and `height` in logical pixels and the physical pixel `scale`. A native host can report provisional screen dimensions before the window is laid out.
- `platform.safeArea` gives the window insets reserved for system UI, in logical pixels. The `start` and `end` fields mean left and right. Desktop native targets report zero for all four insets.
- `platform.orientation` is `"landscape"` if the window is wider than it is tall and `"portrait"` otherwise.

Read these fields whenever you need them, or subscribe to changes. `onChange` does not call the listener immediately. It calls listeners after the new values are available and returns a function to remove the listener.

```ts
import { platform } from "@weft-ui/platform";

function reportEnvironment() {
  console.log(platform.colorScheme, platform.screen, platform.safeArea);
}

reportEnvironment();
const stop = platform.onChange(reportEnvironment);
// Call stop() when you no longer need updates.
```

## Handle unavailable APIs with `PlatformError`

`fetch` and the three `storage` methods reject with `PlatformError` when their capability is unavailable. `PlatformError` extends `Error`; its constructor takes `(api, os)`, where `api` is `"fetch"`, `"storage"`, or `"ui"` and `os` is a platform name from the list above. The error has `name` set to `"PlatformError"`, a read-only `api` field, and a `message` such as `fetch is not supported on web`. There is no separate `code` or `os` field. For error handling, use `instanceof PlatformError` and `error.api` rather than matching the message.

Network, storage, and JSON parsing failures can still reject with other errors. `PlatformError` only signals an unavailable capability.

## How the implementation is selected

Keep the same `@weft-ui/platform` import on every target. The [package exports](https://github.com/weft-ui/weft-ui/blob/master/packages/platform/package.json) provide a shared `types` entry and three runtime conditions: `weft-web` for Web, `weft-wechat` for WeChat, and `weft-native` for iOS, macOS, Android, Windows, and Linux. There is no `default` runtime export condition.

The [`@weft-ui/vite` plugin](https://github.com/weft-ui/weft-ui/blob/master/packages/vite/src/index.ts) adds `weft-<platform>` to each Vite build environment's resolution conditions, plus `weft-native` for native targets. It also defines the build-time constant `__WEFT_PLATFORM__` with that target name. The dev server uses the Web implementation. Select a target at build time (for example, `WEFT_PLATFORM=android vite build`) instead of branching imports at runtime. See [Platforms](/guides/platforms/#configure-vite) for build configuration.
