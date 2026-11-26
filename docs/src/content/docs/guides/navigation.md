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

## Titles, visibility, and back

`NavBar` is optional, but if present must be the first top-level node of the page and appear only once. `title` can be dynamic. `hidden = true` hides the bar without disabling back gestures or keys. Without a `NavBar`, the host displays an empty title. A `BarButton` belongs inside the bar and requires a `label` for accessibility; without an `icon`, the label is displayed as text. An icon is an `asset:` resource.

`onShow` runs when a page becomes current while the app is foregrounded; `onHide` runs when it stops being current or the app enters the background. The old page hides before the new one shows, synchronously after navigation state changes and before the same flush. The start page receives `onShow` on first mount. Removed pages are destroyed. `Show` and `Hide` are reserved page event names.

Back gestures, browser Back, and the mini program back button return to the preceding page. At the root, Back is left to the system. A hidden page remains in the stack until removed.

## Platform differences

- **Web:** navigation uses History API paths, not hash routes. Configure static hosting to serve `index.html` for unknown paths. Refreshing a page restores the start page and current route; browser Back uses saved history routes. Transitions respect `prefers-reduced-motion`.
- **WeChat:** each Weft page has its own mini program page. The platform page stack is limited to 10 pages; a push beyond the limit throws. When launched directly into a non-start page, that page is the only stack entry and the platform offers a return-home control. Dynamic titles update the native bar. `BarButton` is ignored, so put essential actions in page content too.
- **Native:** application navigation is being enabled per platform; consult the [element reference](/reference/elements/) for current support.
