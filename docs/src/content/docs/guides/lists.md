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

Avoid nesting a `List` inside a vertical `Scroll` or another `List`: it prevents lazy rendering. The compiler detects statically visible nesting within a template, but cannot detect it across component boundaries. Grid sections, pull-to-refresh, end-of-list callbacks, and sticky headers are not yet available. Web and WeChat support these elements; native platforms are pending.
