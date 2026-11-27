---
title: 惰性列表与网格
description: 用 List 和 Grid 高效渲染长集合。
---

`List` 用于纵向滚动的集合，`Grid` 用于等宽多列。两者只物化视口附近的一段项目，不会为长集合中的每一项同时创建视图。

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
    Text("最近项目", size = 20)
    for (item in model.items; key = item.id) {
      Text(item.title)
    }
    Text("列表末尾")
  }
}
```

每个 `List` 或 `Grid` 必须恰好包含一个直接子 `for`。它之前和之后的节点分别是列表头和列表尾，始终渲染并随项目滚动。每个项目都要使用稳定且唯一的 key：将同一个 key 用于不同项目可能保留错误状态，重复 key 会报错。

把 `List` 换成 `Grid(columns = 3, gap = 8)` 即可显示网格。`columns` 是不小于 1 的整数常量；列平分可用宽度，每行高度由该行最高的项目决定。`gap` 设置相邻项目（包括列表头尾）之间的间距。`indicators = false` 隐藏滚动条。与纵向 `Scroll` 一样，列表默认占满可用空间；可用布局属性显式调整。

不要把 `List` 嵌套在纵向 `Scroll` 或另一个 `List` 中，否则无法惰性渲染。编译器会检查同一模板内静态可见的嵌套，但无法跨组件检查。网格分组、下拉刷新、触底回调和吸顶头目前尚不可用。Web 和微信小程序支持这些元素，原生平台尚待实现。
