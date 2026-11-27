---
title: Lazy lists and grids
description: Render long collections efficiently with List and Grid.
---

Use `List` for a vertically scrolling collection and `Grid` for equal-width columns. Both materialize only a window of items near the viewport, so long collections do not create a view for every item at once.

```weft
model Item {
  id: Int,
  title: String,
}
model Feed {
  items: Item[],
}
component FeedView(model: Feed) {
  List(gap = 8) {
    Text("Recent items", size = 20)
    for (item in model.items; key = item.id) {
      Text(item.title)
    }
    Text("End of list")
  }
}
```

Each `List` or `Grid` must contain exactly one direct `for`. Nodes before and after it are a header and footer: they always render and scroll with the items. Use a stable, unique key for each item. Reusing a key for a different item can preserve the wrong state; duplicate keys are an error.

For a grid, replace `List` with `Grid(columns = 3, gap = 8)`. `columns` is a constant integer of at least one; columns share the available width equally and each row is as tall as its tallest item. `gap` separates neighboring items, including the header and footer. Set `indicators = false` to hide scroll indicators. Like a vertical `Scroll`, lists fill available space by default; set explicit layout properties to change that.

## Refresh and loading more

Set `onRefresh` to an event and bind `refreshing` to model state. Set it to `true` in the event handler while loading, then back to `false` when finished. If the handler never sets it to `true`, the indicator closes when the handler returns. Pull-to-refresh uses touch on Web (coarse pointers) and the native refresher on WeChat.

Set `onEndReached` to an event to load more items. `endThreshold` is a constant number of items (default 5). After a window request or data change, the runtime fires the event when the requested end is within that threshold of a nonempty list. It fires at most once for a given item count; changing the count allows it to fire again. Avoid appending without a limit if your data source can run out.

## Sections

A `List` can group rows by putting header nodes followed by exactly one inner `for` in its direct `for`. The inner loop must be last. The outer key identifies the section; the inner key identifies a row within it. On Web, `stickyHeaders = true` pins each header while its section scrolls. WeChat ignores `stickyHeaders`: segmented virtualization cannot reliably keep a header pinned, so headers scroll normally.

```weft
model Section { title: String, items: Item[] }
component Grouped(sections: Section[]) {
  List(stickyHeaders = true) {
    for (section in sections; key = section.title) {
      Text(section.title)
      for (item in section.items; key = item.id) {
        Text(item.title)
      }
    }
  }
}
```

Sections are not supported by `Grid`. Avoid nesting a `List` inside a vertical `Scroll` or another `List`: it prevents lazy rendering. The compiler detects statically visible nesting within a template, but cannot detect it across component boundaries. Web and WeChat support these features except for sticky headers on WeChat; native implementations are pending.
