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

## 刷新与加载更多

将 `onRefresh` 设为事件，并把 `refreshing` 绑定到模型状态。在事件处理器中开始加载时设为 `true`，完成后设回 `false`；如果处理器从未将它设为 `true`，指示器会在处理返回后收起。Web 在粗指针设备上使用触摸下拉，小程序使用原生刷新控件。

将 `onEndReached` 设为事件以加载更多。`endThreshold` 是常量项数，默认为 5。每次窗口请求或数据变化后，非空列表的请求终点进入末尾阈值时，运行时触发事件。同一个项目数最多触发一次，项目数改变后可以再次触发；数据源有末尾时不要无限追加。

## 分组

`List` 的直接 `for` 块可以包含分组头节点，后跟恰好一个内层 `for`，且内层循环必须在最后。外层 key 标识分组，内层 key 标识组内行。在 Web 上，`stickyHeaders = true` 使分组头在该组滚动期间吸顶。微信小程序忽略 `stickyHeaders`：分段虚拟化无法可靠地保持分组头吸顶，因此分组头随列表正常滚动。

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

`Grid` 不支持分组。不要把 `List` 嵌套在纵向 `Scroll` 或另一个 `List` 中，否则无法惰性渲染。编译器会检查同一模板内静态可见的嵌套，但无法跨组件检查。Web 和微信小程序支持这些功能，但小程序不支持吸顶分组头；原生平台尚待实现。
