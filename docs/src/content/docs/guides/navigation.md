---
title: Pages and navigation
description: Declare pages, open them from logic, and handle page visibility.
sidebar:
  order: 4
---

Navigation is controlled by the logic layer. A page emits an event; its handler calls `navigation`. A page is not a component and cannot be used as a view node or mounted directly.

## Declare an app and its pages

Save this as `Notes.weft`:

```weft
event OpenDetail
event BackHome

page Home() {
    NavBar(title = "Notes")
    Button(onClick = OpenDetail) { Text("Open note") }
}

page Detail(id: String) path "/notes/{id}" {
    NavBar(title = "Note ${id}") {
        BarButton(label = "Home", onTap = BackHome)
    }
    Text("Note ${id}")
}

app Notes { start = Home }
```

An app has one start page, which cannot require route parameters. It includes all pages in the declaring file's transitive import closure; each page needs a factory, including pages not reachable by a button. At most one `app` is allowed per program. Programs without an `app` can still mount a root component as described in [Logic and events](/guides/logic/).

A page body has the same `state`, `let`, and nodes as a component. Its optional first parameter can be a model; the other parameters are route parameters. They accept `Int`, `Float`, `Bool`, `String`, string literal unions, and their nullable forms. Nullable parameters and parameters with constant defaults are optional. Paths start with `/` and can contain literal segments and `{name}` segments for required `String`, `Int`, or union parameters. Other parameters go in the query string. Without `path`, the page name becomes a kebab-case path such as `/user-profile`. Paths must not overlap. See the [grammar](https://github.com/weft-ui/weft-ui/blob/master/crates/parser/GRAMMAR.md#pages) for the precise rules.

## Create pages and navigate

In `index.ts`, supply a factory for each page and register handlers on each new instance:

```ts
import { run, navigation } from "@weft-ui/platform";
import { Notes, Home, Detail } from "./Notes.weft";

run(new Notes({
  Home: () => {
    const page = new Home({});
    page.onOpenDetail(() => navigation.push(Detail, { id: "42" }));
    return page;
  },
  Detail: (params) => {
    const page = new Detail(params);
    page.onBackHome(() => navigation.popToRoot());
    page.onShow(() => console.log("Detail shown"));
    page.onHide(() => console.log("Detail hidden"));
    return page;
  },
}));
```

A page with a model takes the model first and its route parameters second. The generated `PageParams` type describes its route parameters, and `page.params` is read-only. A factory is called whenever a new page instance is needed; attach instance-specific handlers inside it, not once globally.

- `navigation.push(Page, params)` creates a page above the current page.
- `navigation.replace(Page, params)` replaces the top page; it cannot replace the root.
- `navigation.pop(count)` goes back by that many pages, defaulting to one. It stops at the root if the count exceeds the stack depth; a count below one throws `RangeError`.
- `navigation.popToRoot()` removes all pages above the root.
- `navigation.stack` is the read-only route list from root to top. Each route has a page name and read-only parameters. `navigation.onChange(listener)` subscribes to changes and returns an unsubscribe function.

Call navigation after the app is mounted. The same functions cannot be used by a program with no `app` declaration.

## Routes and deep links

Use `navigation.url` to create a link and `navigation.open` to open one after the app is mounted:

```ts
const url = navigation.url(Detail, { id: "42" });
const opened = navigation.open(url); // false if no route matches
const unsubscribe = navigation.onOpen((route, originalURL) => {
  console.log(route.page, route.params, originalURL);
  return false; // let navigation handle the link
});
// Call unsubscribe() when the handler is no longer needed.
```

`open` accepts a route path such as `/notes/42`, a configured custom scheme such as `notes://notes/42` (the host becomes the first path segment), or an HTTPS URL on a configured host. On WeChat it also accepts a mini program page path such as `weft/pages/detail/index?id=42`. Matching handlers run in registration order; returning `true` handles the link and stops further handling. Otherwise, a tab route switches tabs; another route closes any modal and pushes the page. An unmatched link returns `false` and logs a warning.

Route URLs encode path parameters and query values as UTF-8. Query parameters follow declaration order; null values and values equal to their defaults are omitted. Integers must be safe integers in decimal notation, floats finite numbers, booleans `true` or `false`, and union values declared members. Invalid decoding or parameter values prevent a match; extra query keys are ignored.

On Web, `url` includes Vite's `base`; on WeChat it returns the mini program page path and query, suitable for sharing. Configure schemes and hosts in the [platform guide](/guides/platforms/#configure-vite).

At cold start, `lifecycle.launch.url` contains the opening URL or `null`. A matching route opens without a transition: a tab is selected, or the target is placed above the start page. On WeChat, a directly opened page is the only page in the initial stack. Web uses the current location at startup; ordinary HTML links are not intercepted.

## Tabs

Instead of `start`, declare two to five distinct tab pages without required route parameters:

```weft
app Notes {
    tabs {
        Home(title = "Home", icon = "asset:tab_home")
        Settings(title = "Settings", icon = "asset:tab_settings", activeIcon = "asset:tab_settings_active")
    }
}
```

Each tab needs a literal title and an `asset:` icon. `activeIcon` defaults to `icon`. On WeChat, tab icons must be PNG or JPEG. Supply factories for all pages as above: a tab root is created when first selected and retained thereafter.

Use `navigation.switchTab(Settings)` to select a tab and clear the pushed stack. `navigation.tab` gives the selected page name, or `null` without tabs. `navigation.setBadge(Settings, "3")` displays a badge; pass `""` for a dot or `null` to remove it. On macOS, tabs appear in the toolbar's segmented picker without icons; badges appear in the tab title. On Linux, GTK displays all badges, including text badges, as dots. Pushed pages cover the tab bar. On the Web, switching tabs returns to the root history entry and replaces it with the selected tab's URL.

## Modal pages

Present a page over the current navigation stack with `navigation.present(Detail, { id: "42" })`. The default style is `sheet`; use `navigation.present(Detail, { id: "42" }, { style: "fullScreen" })` for a full-screen page. The page needs a factory just like any other page. `navigation.modal` exposes its route, or `null` when none is open; `navigation.dismiss()` closes it and does nothing if no modal is open.

Only one modal can be presented at a time. While it is open, `push` and `replace` throw; use conditional content inside the modal for multi-step flows. Back closes the modal first, counting it as one page for `pop(count)`; `popToRoot()` and `switchTab()` close it as well. The underlying page remains in the stack and becomes current again when the modal closes.

On the web, Escape, browser Back, the close button, and (for a sheet) the backdrop dismiss the modal. Focus stays inside the dialog while it is open. On WeChat, the modal is a page container with its own title row; a sheet can also be dismissed by swiping down.

## Titles, visibility, and back

`NavBar` is optional, but if present must be the first top-level node of the page and appear only once. `title` can be dynamic. `hidden = true` hides the bar without disabling back gestures or keys. Without a `NavBar`, the host displays an empty title. A `BarButton` belongs inside the bar and requires a `label` for accessibility; without an `icon`, the label is displayed as text. An icon is an `asset:` resource.

`onShow` runs when a page becomes current while the app is foregrounded; `onHide` runs when it stops being current or the app enters the background. The old page hides before the new one shows, synchronously after navigation state changes and before the same flush. The start page receives `onShow` on first mount. Removed pages are destroyed. `Show` and `Hide` are reserved page event names.

Back gestures, browser Back, and the mini program back button return to the preceding page. At the root, Back is left to the system. A hidden page remains in the stack until removed.

## Platform differences

- **Web:** navigation uses History API paths, not hash routes. Configure static hosting to serve `index.html` for unknown paths. Refreshing a page restores the start page and current route; browser Back uses saved history routes. Transitions respect `prefers-reduced-motion`.
- **WeChat:** each Weft page has its own mini program page. The platform page stack is limited to 10 pages; a push beyond the limit throws. When launched directly into a non-start page, that page is the only stack entry and the platform offers a return-home control. Dynamic titles update the native bar. `BarButton` is ignored, so put essential actions in page content too.
- **iOS:** a SwiftUI `NavigationStack` with an inline title; swipe from the leading edge goes back. `BarButton`s appear as primary toolbar actions.
- **macOS:** the window toolbar shows the title, a back button, and `BarButton`s; ⌘[ also goes back, even when the bar is hidden.
- **Android:** a Navigation 3 back stack with a Material top app bar. System Back and predictive back return to the preceding page.
- **Windows:** a title row with a back button, the title, and `BarButton`s as app bar buttons; Alt+Left and the mouse back button also go back.
- **Linux:** a GTK header with a back button, the title, and `BarButton`s; Alt+Left and the mouse back button also go back.
