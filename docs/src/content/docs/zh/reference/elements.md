---
title: 内置元素
---
<!-- Generated from protocol/weft.elements.json by protocol/elements.ts; do not edit. -->

除非另有说明，所有平台都支持列出的元素、属性和事件。使用标为「不支持」的功能会导致编译错误；标为「忽略」的功能可以编译，但没有效果。

所有元素还接受 `onMount` 和 `onUnmount`，这两个事件都没有载荷。

## NavBar

描述页面导航栏；必须是页面的第一个顶层节点。

仅接受以下直接子元素： `BarButton`.

必须是页面的第一个顶层节点，不能放在条件或循环中。

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `title` | `String` | — | 导航栏标题。 | — |
| `hidden` | `Bool` | `false` | 隐藏导航栏。 | — |

## BarButton

无障碍导航栏操作；小程序忽略此元素。

**平台例外:** 忽略: `wechat`.

**子节点:** 无.

必须是以下元素之一的直接子元素： `NavBar`.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `icon` | `String` | — | 打包资源图标。 | — |
| `label` | `String` | 必填 | 操作的无障碍标签。 | — |
| `disabled` | `Bool` | — | 禁用此操作。 | — |

| 事件 | 载荷 | 说明 | 平台例外 |
| --- | --- | --- | --- |
| `onTap` | — | 激活时触发。 | — |

## Column

将子节点纵向排列。

**子节点:** 不限.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | 设置内容盒的宽度。 | — |
| `height` | `Int` | — | 设置内容盒的高度。 | — |
| `grow` | `Float` | `0` | 设置子元素在线性容器主轴上分得剩余空间的比例。 | — |
| `minWidth` | `Int` | — | 设置内容宽度的下限。 | — |
| `maxWidth` | `Int` | — | 设置内容宽度的上限。 | — |
| `minHeight` | `Int` | — | 设置内容高度的下限。 | — |
| `maxHeight` | `Int` | — | 设置内容高度的上限。 | — |
| `fill` | `Bool` | `false` | 在线性容器中撑满交叉轴，或在 Stack 中撑满两个轴。 | — |
| `aspectRatio` | `Float` | — | 在由一边推算另一边时指定宽高比。 | — |
| `margin` | `Int` | `0` | 设置四边的外边距。 | — |
| `marginX` | `Int` | `0` | 设置左右外边距。 | — |
| `marginY` | `Int` | `0` | 设置上下外边距。 | — |
| `marginTop` | `Int` | `0` | 设置上外边距。 | — |
| `marginBottom` | `Int` | `0` | 设置下外边距。 | — |
| `marginStart` | `Int` | `0` | 设置从左到右布局中的左外边距。 | — |
| `marginEnd` | `Int` | `0` | 设置从左到右布局中的右外边距。 | — |
| `opacity` | `Float` | `1` | 设置整个元素及其子元素的不透明度。 | — |
| `hidden` | `Bool` | `false` | 隐藏元素，使其不参与布局。 | — |
| `padding` | `Int` | `0` | 设置四边的内边距。 | — |
| `paddingX` | `Int` | `0` | 设置左右内边距。 | — |
| `paddingY` | `Int` | `0` | 设置上下内边距。 | — |
| `paddingTop` | `Int` | `0` | 设置上内边距。 | — |
| `paddingBottom` | `Int` | `0` | 设置下内边距。 | — |
| `paddingStart` | `Int` | `0` | 设置从左到右布局中的左内边距。 | — |
| `paddingEnd` | `Int` | `0` | 设置从左到右布局中的右内边距。 | — |
| `background` | `Color` | — | 为内边距盒填充背景色，边框下方也会着色。 | — |
| `radius` | `Int` | `0` | 为背景和边框设置圆角。 | — |
| `border` | `Int` | `0` | 在内边距盒外绘制指定宽度的实线边框。 | — |
| `borderColor` | `Color` | `"#0000001f"` | 设置边框颜色；深色模式默认使用 `#ffffff26`。 | — |
| `shadow` | `Shadow` | `"none"` | 在边框盒外绘制预设阴影。 | — |
| `clip` | `Bool` | `false` | 将溢出的内容裁剪到带圆角的内边距盒内。 | — |
| `gap` | `Int` | `0` | 设置相邻子节点之间的距离。 | — |
| `align` | `CrossAlign` | `"start"` | 设置子元素在水平交叉轴上的位置。 | — |
| `justify` | `Justify` | `"start"` | 分配纵向主轴上的剩余空间。 | — |

| 事件 | 载荷 | 说明 | 平台例外 |
| --- | --- | --- | --- |
| `onTap` | — | 元素被激活时触发；事件不携带数据，也不会冒泡。 | — |

## Row

将子节点横向排列。

**子节点:** 不限.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | 设置内容盒的宽度。 | — |
| `height` | `Int` | — | 设置内容盒的高度。 | — |
| `grow` | `Float` | `0` | 设置子元素在线性容器主轴上分得剩余空间的比例。 | — |
| `minWidth` | `Int` | — | 设置内容宽度的下限。 | — |
| `maxWidth` | `Int` | — | 设置内容宽度的上限。 | — |
| `minHeight` | `Int` | — | 设置内容高度的下限。 | — |
| `maxHeight` | `Int` | — | 设置内容高度的上限。 | — |
| `fill` | `Bool` | `false` | 在线性容器中撑满交叉轴，或在 Stack 中撑满两个轴。 | — |
| `aspectRatio` | `Float` | — | 在由一边推算另一边时指定宽高比。 | — |
| `margin` | `Int` | `0` | 设置四边的外边距。 | — |
| `marginX` | `Int` | `0` | 设置左右外边距。 | — |
| `marginY` | `Int` | `0` | 设置上下外边距。 | — |
| `marginTop` | `Int` | `0` | 设置上外边距。 | — |
| `marginBottom` | `Int` | `0` | 设置下外边距。 | — |
| `marginStart` | `Int` | `0` | 设置从左到右布局中的左外边距。 | — |
| `marginEnd` | `Int` | `0` | 设置从左到右布局中的右外边距。 | — |
| `opacity` | `Float` | `1` | 设置整个元素及其子元素的不透明度。 | — |
| `hidden` | `Bool` | `false` | 隐藏元素，使其不参与布局。 | — |
| `padding` | `Int` | `0` | 设置四边的内边距。 | — |
| `paddingX` | `Int` | `0` | 设置左右内边距。 | — |
| `paddingY` | `Int` | `0` | 设置上下内边距。 | — |
| `paddingTop` | `Int` | `0` | 设置上内边距。 | — |
| `paddingBottom` | `Int` | `0` | 设置下内边距。 | — |
| `paddingStart` | `Int` | `0` | 设置从左到右布局中的左内边距。 | — |
| `paddingEnd` | `Int` | `0` | 设置从左到右布局中的右内边距。 | — |
| `background` | `Color` | — | 为内边距盒填充背景色，边框下方也会着色。 | — |
| `radius` | `Int` | `0` | 为背景和边框设置圆角。 | — |
| `border` | `Int` | `0` | 在内边距盒外绘制指定宽度的实线边框。 | — |
| `borderColor` | `Color` | `"#0000001f"` | 设置边框颜色；深色模式默认使用 `#ffffff26`。 | — |
| `shadow` | `Shadow` | `"none"` | 在边框盒外绘制预设阴影。 | — |
| `clip` | `Bool` | `false` | 将溢出的内容裁剪到带圆角的内边距盒内。 | — |
| `gap` | `Int` | `0` | 设置相邻子节点之间的距离。 | — |
| `align` | `CrossAlign` | `"start"` | 设置子元素在纵向交叉轴上的位置。 | — |
| `justify` | `Justify` | `"start"` | 分配横向主轴上的剩余空间。 | — |

| 事件 | 载荷 | 说明 | 平台例外 |
| --- | --- | --- | --- |
| `onTap` | — | 元素被激活时触发；事件不携带数据，也不会冒泡。 | — |

## Text

显示纯文本或由多个行内片段组成的文本。

仅接受以下直接子元素： `Span`.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | 设置内容盒的宽度。 | — |
| `height` | `Int` | — | 设置内容盒的高度。 | — |
| `grow` | `Float` | `0` | 设置子元素在线性容器主轴上分得剩余空间的比例。 | — |
| `minWidth` | `Int` | — | 设置内容宽度的下限。 | — |
| `maxWidth` | `Int` | — | 设置内容宽度的上限。 | — |
| `minHeight` | `Int` | — | 设置内容高度的下限。 | — |
| `maxHeight` | `Int` | — | 设置内容高度的上限。 | — |
| `fill` | `Bool` | `false` | 在线性容器中撑满交叉轴，或在 Stack 中撑满两个轴。 | — |
| `aspectRatio` | `Float` | — | 在由一边推算另一边时指定宽高比。 | — |
| `margin` | `Int` | `0` | 设置四边的外边距。 | — |
| `marginX` | `Int` | `0` | 设置左右外边距。 | — |
| `marginY` | `Int` | `0` | 设置上下外边距。 | — |
| `marginTop` | `Int` | `0` | 设置上外边距。 | — |
| `marginBottom` | `Int` | `0` | 设置下外边距。 | — |
| `marginStart` | `Int` | `0` | 设置从左到右布局中的左外边距。 | — |
| `marginEnd` | `Int` | `0` | 设置从左到右布局中的右外边距。 | — |
| `opacity` | `Float` | `1` | 设置整个元素及其子元素的不透明度。 | — |
| `hidden` | `Bool` | `false` | 隐藏元素，使其不参与布局。 | — |
| `padding` | `Int` | `0` | 设置四边的内边距。 | — |
| `paddingX` | `Int` | `0` | 设置左右内边距。 | — |
| `paddingY` | `Int` | `0` | 设置上下内边距。 | — |
| `paddingTop` | `Int` | `0` | 设置上内边距。 | — |
| `paddingBottom` | `Int` | `0` | 设置下内边距。 | — |
| `paddingStart` | `Int` | `0` | 设置从左到右布局中的左内边距。 | — |
| `paddingEnd` | `Int` | `0` | 设置从左到右布局中的右内边距。 | — |
| `background` | `Color` | — | 为内边距盒填充背景色，边框下方也会着色。 | — |
| `radius` | `Int` | `0` | 为背景和边框设置圆角。 | — |
| `border` | `Int` | `0` | 在内边距盒外绘制指定宽度的实线边框。 | — |
| `borderColor` | `Color` | `"#0000001f"` | 设置边框颜色；深色模式默认使用 `#ffffff26`。 | — |
| `shadow` | `Shadow` | `"none"` | 在边框盒外绘制预设阴影。 | — |
| `clip` | `Bool` | `false` | 将溢出的内容裁剪到带圆角的内边距盒内。 | — |
| `color` | `Color` | — | 设置文字颜色。 | — |
| `size` | `Int` | — | 用逻辑像素设置字号。 | — |
| `weight` | `Weight` | `"regular"` | 设置字重。 | — |
| `italic` | `Bool` | `false` | 设置斜体。 | — |
| `decoration` | `Decoration` | `"none"` | 为文字添加下划线或删除线。 | — |
| `font` | `String` | — | 按族名选择打包字体；默认使用继承的字体或系统字体。 | — |
| `value` (位置参数) | `String` | — | 要显示的纯文本；没有 `Span` 子元素时必填。 | — |
| `align` | `TextAlign` | `"start"` | 设置各行文字在文本框中的对齐方式。 | — |
| `maxLines` | `Int` | `0` | 超出行数限制时在末尾显示省略号；小于或等于零表示不限行数。 | — |
| `lineHeight` | `Int` | — | 用逻辑像素设置行高。 | — |

| 事件 | 载荷 | 说明 | 平台例外 |
| --- | --- | --- | --- |
| `onTap` | — | 元素被激活时触发；事件不携带数据，也不会冒泡。 | — |

## Span

显示可单独设置样式的行内文本片段。

**子节点:** 无.

必须是以下元素之一的直接子元素： `Text`.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `color` | `Color` | — | 设置文字颜色。 | — |
| `size` | `Int` | — | 用逻辑像素设置字号。 | — |
| `weight` | `Weight` | `"regular"` | 设置字重。 | — |
| `italic` | `Bool` | `false` | 设置斜体。 | — |
| `decoration` | `Decoration` | `"none"` | 为文字添加下划线或删除线。 | — |
| `font` | `String` | — | 按族名选择打包字体；默认使用继承的字体或系统字体。 | — |
| `value` (位置参数) | `String` | 必填 | 此片段的文字。 | — |

## Button

显示可点击的控件，用子节点提供按钮内容。

**子节点:** 不限.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | 设置内容盒的宽度。 | — |
| `height` | `Int` | — | 设置内容盒的高度。 | — |
| `grow` | `Float` | `0` | 设置子元素在线性容器主轴上分得剩余空间的比例。 | — |
| `minWidth` | `Int` | — | 设置内容宽度的下限。 | — |
| `maxWidth` | `Int` | — | 设置内容宽度的上限。 | — |
| `minHeight` | `Int` | — | 设置内容高度的下限。 | — |
| `maxHeight` | `Int` | — | 设置内容高度的上限。 | — |
| `fill` | `Bool` | `false` | 在线性容器中撑满交叉轴，或在 Stack 中撑满两个轴。 | — |
| `aspectRatio` | `Float` | — | 在由一边推算另一边时指定宽高比。 | — |
| `margin` | `Int` | `0` | 设置四边的外边距。 | — |
| `marginX` | `Int` | `0` | 设置左右外边距。 | — |
| `marginY` | `Int` | `0` | 设置上下外边距。 | — |
| `marginTop` | `Int` | `0` | 设置上外边距。 | — |
| `marginBottom` | `Int` | `0` | 设置下外边距。 | — |
| `marginStart` | `Int` | `0` | 设置从左到右布局中的左外边距。 | — |
| `marginEnd` | `Int` | `0` | 设置从左到右布局中的右外边距。 | — |
| `opacity` | `Float` | `1` | 设置整个元素及其子元素的不透明度。 | — |
| `hidden` | `Bool` | `false` | 隐藏元素，使其不参与布局。 | — |
| `disabled` | `Bool` | — | 禁用按钮。 | — |

| 事件 | 载荷 | 说明 | 平台例外 |
| --- | --- | --- | --- |
| `onClick` | — | 按钮被点击时触发。 | — |

## Input

显示可编辑的文本框。

**子节点:** 无.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | 设置内容盒的宽度。 | — |
| `height` | `Int` | — | 设置内容盒的高度。 | — |
| `grow` | `Float` | `0` | 设置子元素在线性容器主轴上分得剩余空间的比例。 | — |
| `minWidth` | `Int` | — | 设置内容宽度的下限。 | — |
| `maxWidth` | `Int` | — | 设置内容宽度的上限。 | — |
| `minHeight` | `Int` | — | 设置内容高度的下限。 | — |
| `maxHeight` | `Int` | — | 设置内容高度的上限。 | — |
| `fill` | `Bool` | `false` | 在线性容器中撑满交叉轴，或在 Stack 中撑满两个轴。 | — |
| `aspectRatio` | `Float` | — | 在由一边推算另一边时指定宽高比。 | — |
| `margin` | `Int` | `0` | 设置四边的外边距。 | — |
| `marginX` | `Int` | `0` | 设置左右外边距。 | — |
| `marginY` | `Int` | `0` | 设置上下外边距。 | — |
| `marginTop` | `Int` | `0` | 设置上外边距。 | — |
| `marginBottom` | `Int` | `0` | 设置下外边距。 | — |
| `marginStart` | `Int` | `0` | 设置从左到右布局中的左外边距。 | — |
| `marginEnd` | `Int` | `0` | 设置从左到右布局中的右外边距。 | — |
| `opacity` | `Float` | `1` | 设置整个元素及其子元素的不透明度。 | — |
| `hidden` | `Bool` | `false` | 隐藏元素，使其不参与布局。 | — |
| `value` (位置参数) | `String` | 必填 | 当前输入的文本。 | — |
| `placeholder` | `String` | — | 输入框为空时显示提示文字。 | — |
| `disabled` | `Bool` | — | 禁用输入框。 | — |
| `type` | `InputType` | `"text"` | 选择输入框类型及对应的键盘。 | — |
| `returnKey` | `ReturnKey` | — | 提示键盘的回车键显示哪种操作。 | 忽略: `macos`; 忽略: `windows`; 忽略: `linux` |
| `maxLength` | `Int` | — | 限制用户编辑后的 UTF-16 码元个数；省略则不限。 | — |
| `focused` | `Bool` | `false` | 变为 true 时请求焦点，变为 false 时放弃焦点。 | — |

| 事件 | 载荷 | 说明 | 平台例外 |
| --- | --- | --- | --- |
| `onChange` | `String` | 编辑后提供修改后的文本。 | — |
| `onSubmit` | — | 用户通过键盘回车键提交时触发。 | — |
| `onFocusChange` | `Bool` | 获得焦点时提供 true，失去焦点时提供 false，不会改写 focused。 | — |

## Checkbox

显示可勾选的控件。

**子节点:** 无.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | 设置内容盒的宽度。 | — |
| `height` | `Int` | — | 设置内容盒的高度。 | — |
| `grow` | `Float` | `0` | 设置子元素在线性容器主轴上分得剩余空间的比例。 | — |
| `minWidth` | `Int` | — | 设置内容宽度的下限。 | — |
| `maxWidth` | `Int` | — | 设置内容宽度的上限。 | — |
| `minHeight` | `Int` | — | 设置内容高度的下限。 | — |
| `maxHeight` | `Int` | — | 设置内容高度的上限。 | — |
| `fill` | `Bool` | `false` | 在线性容器中撑满交叉轴，或在 Stack 中撑满两个轴。 | — |
| `aspectRatio` | `Float` | — | 在由一边推算另一边时指定宽高比。 | — |
| `margin` | `Int` | `0` | 设置四边的外边距。 | — |
| `marginX` | `Int` | `0` | 设置左右外边距。 | — |
| `marginY` | `Int` | `0` | 设置上下外边距。 | — |
| `marginTop` | `Int` | `0` | 设置上外边距。 | — |
| `marginBottom` | `Int` | `0` | 设置下外边距。 | — |
| `marginStart` | `Int` | `0` | 设置从左到右布局中的左外边距。 | — |
| `marginEnd` | `Int` | `0` | 设置从左到右布局中的右外边距。 | — |
| `opacity` | `Float` | `1` | 设置整个元素及其子元素的不透明度。 | — |
| `hidden` | `Bool` | `false` | 隐藏元素，使其不参与布局。 | — |
| `checked` (位置参数) | `Bool` | 必填 | 当前的选中状态。 | — |
| `disabled` | `Bool` | — | 禁用复选框。 | — |

| 事件 | 载荷 | 说明 | 平台例外 |
| --- | --- | --- | --- |
| `onChange` | `Bool` | 提供修改后的选中状态。 | — |

## Image

显示打包图片或指定 URL 的图片。

**子节点:** 无.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | 设置内容盒的宽度。 | — |
| `height` | `Int` | — | 设置内容盒的高度。 | — |
| `grow` | `Float` | `0` | 设置子元素在线性容器主轴上分得剩余空间的比例。 | — |
| `minWidth` | `Int` | — | 设置内容宽度的下限。 | — |
| `maxWidth` | `Int` | — | 设置内容宽度的上限。 | — |
| `minHeight` | `Int` | — | 设置内容高度的下限。 | — |
| `maxHeight` | `Int` | — | 设置内容高度的上限。 | — |
| `fill` | `Bool` | `false` | 在线性容器中撑满交叉轴，或在 Stack 中撑满两个轴。 | — |
| `aspectRatio` | `Float` | — | 在由一边推算另一边时指定宽高比。 | — |
| `margin` | `Int` | `0` | 设置四边的外边距。 | — |
| `marginX` | `Int` | `0` | 设置左右外边距。 | — |
| `marginY` | `Int` | `0` | 设置上下外边距。 | — |
| `marginTop` | `Int` | `0` | 设置上外边距。 | — |
| `marginBottom` | `Int` | `0` | 设置下外边距。 | — |
| `marginStart` | `Int` | `0` | 设置从左到右布局中的左外边距。 | — |
| `marginEnd` | `Int` | `0` | 设置从左到右布局中的右外边距。 | — |
| `opacity` | `Float` | `1` | 设置整个元素及其子元素的不透明度。 | — |
| `hidden` | `Bool` | `false` | 隐藏元素，使其不参与布局。 | — |
| `background` | `Color` | — | 为内边距盒填充背景色，边框下方也会着色。 | — |
| `radius` | `Int` | `0` | 为背景和边框设置圆角。 | — |
| `border` | `Int` | `0` | 在内边距盒外绘制指定宽度的实线边框。 | — |
| `borderColor` | `Color` | `"#0000001f"` | 设置边框颜色；深色模式默认使用 `#ffffff26`。 | — |
| `shadow` | `Shadow` | `"none"` | 在边框盒外绘制预设阴影。 | — |
| `clip` | `Bool` | `false` | 将溢出的内容裁剪到带圆角的内边距盒内。 | — |
| `src` (位置参数) | `String` | 必填 | 图片的 URL 或打包资源引用（`asset:name`）。 | — |
| `fit` | `ImageFit` | `"cover"` | 在盒内裁剪（`cover`）、完整显示（`contain`）或拉伸（`fill`）图片。 | — |
| `placeholder` | `Color` | — | 图片加载中或加载失败时显示此背景色。 | — |

| 事件 | 载荷 | 说明 | 平台例外 |
| --- | --- | --- | --- |
| `onTap` | — | 元素被激活时触发；事件不携带数据，也不会冒泡。 | — |

## Stack

按声明顺序叠放子元素。

**子节点:** 不限.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | 设置内容盒的宽度。 | — |
| `height` | `Int` | — | 设置内容盒的高度。 | — |
| `grow` | `Float` | `0` | 设置子元素在线性容器主轴上分得剩余空间的比例。 | — |
| `minWidth` | `Int` | — | 设置内容宽度的下限。 | — |
| `maxWidth` | `Int` | — | 设置内容宽度的上限。 | — |
| `minHeight` | `Int` | — | 设置内容高度的下限。 | — |
| `maxHeight` | `Int` | — | 设置内容高度的上限。 | — |
| `fill` | `Bool` | `false` | 在线性容器中撑满交叉轴，或在 Stack 中撑满两个轴。 | — |
| `aspectRatio` | `Float` | — | 在由一边推算另一边时指定宽高比。 | — |
| `margin` | `Int` | `0` | 设置四边的外边距。 | — |
| `marginX` | `Int` | `0` | 设置左右外边距。 | — |
| `marginY` | `Int` | `0` | 设置上下外边距。 | — |
| `marginTop` | `Int` | `0` | 设置上外边距。 | — |
| `marginBottom` | `Int` | `0` | 设置下外边距。 | — |
| `marginStart` | `Int` | `0` | 设置从左到右布局中的左外边距。 | — |
| `marginEnd` | `Int` | `0` | 设置从左到右布局中的右外边距。 | — |
| `opacity` | `Float` | `1` | 设置整个元素及其子元素的不透明度。 | — |
| `hidden` | `Bool` | `false` | 隐藏元素，使其不参与布局。 | — |
| `padding` | `Int` | `0` | 设置四边的内边距。 | — |
| `paddingX` | `Int` | `0` | 设置左右内边距。 | — |
| `paddingY` | `Int` | `0` | 设置上下内边距。 | — |
| `paddingTop` | `Int` | `0` | 设置上内边距。 | — |
| `paddingBottom` | `Int` | `0` | 设置下内边距。 | — |
| `paddingStart` | `Int` | `0` | 设置从左到右布局中的左内边距。 | — |
| `paddingEnd` | `Int` | `0` | 设置从左到右布局中的右内边距。 | — |
| `background` | `Color` | — | 为内边距盒填充背景色，边框下方也会着色。 | — |
| `radius` | `Int` | `0` | 为背景和边框设置圆角。 | — |
| `border` | `Int` | `0` | 在内边距盒外绘制指定宽度的实线边框。 | — |
| `borderColor` | `Color` | `"#0000001f"` | 设置边框颜色；深色模式默认使用 `#ffffff26`。 | — |
| `shadow` | `Shadow` | `"none"` | 在边框盒外绘制预设阴影。 | — |
| `clip` | `Bool` | `false` | 将溢出的内容裁剪到带圆角的内边距盒内。 | — |
| `alignment` | `Alignment` | `"topStart"` | 设置子元素在堆叠容器两个轴上的位置。 | — |

| 事件 | 载荷 | 说明 | 平台例外 |
| --- | --- | --- | --- |
| `onTap` | — | 元素被激活时触发；事件不携带数据，也不会冒泡。 | — |

## Scroll

线性排列子元素，并可沿主轴滚动。

**子节点:** 不限.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | 设置内容盒的宽度。 | — |
| `height` | `Int` | — | 设置内容盒的高度。 | — |
| `grow` | `Float` | `0` | 设置子元素在线性容器主轴上分得剩余空间的比例。 | — |
| `minWidth` | `Int` | — | 设置内容宽度的下限。 | — |
| `maxWidth` | `Int` | — | 设置内容宽度的上限。 | — |
| `minHeight` | `Int` | — | 设置内容高度的下限。 | — |
| `maxHeight` | `Int` | — | 设置内容高度的上限。 | — |
| `fill` | `Bool` | `false` | 在线性容器中撑满交叉轴，或在 Stack 中撑满两个轴。 | — |
| `aspectRatio` | `Float` | — | 在由一边推算另一边时指定宽高比。 | — |
| `margin` | `Int` | `0` | 设置四边的外边距。 | — |
| `marginX` | `Int` | `0` | 设置左右外边距。 | — |
| `marginY` | `Int` | `0` | 设置上下外边距。 | — |
| `marginTop` | `Int` | `0` | 设置上外边距。 | — |
| `marginBottom` | `Int` | `0` | 设置下外边距。 | — |
| `marginStart` | `Int` | `0` | 设置从左到右布局中的左外边距。 | — |
| `marginEnd` | `Int` | `0` | 设置从左到右布局中的右外边距。 | — |
| `opacity` | `Float` | `1` | 设置整个元素及其子元素的不透明度。 | — |
| `hidden` | `Bool` | `false` | 隐藏元素，使其不参与布局。 | — |
| `padding` | `Int` | `0` | 设置四边的内边距。 | — |
| `paddingX` | `Int` | `0` | 设置左右内边距。 | — |
| `paddingY` | `Int` | `0` | 设置上下内边距。 | — |
| `paddingTop` | `Int` | `0` | 设置上内边距。 | — |
| `paddingBottom` | `Int` | `0` | 设置下内边距。 | — |
| `paddingStart` | `Int` | `0` | 设置从左到右布局中的左内边距。 | — |
| `paddingEnd` | `Int` | `0` | 设置从左到右布局中的右内边距。 | — |
| `background` | `Color` | — | 为内边距盒填充背景色，边框下方也会着色。 | — |
| `radius` | `Int` | `0` | 为背景和边框设置圆角。 | — |
| `border` | `Int` | `0` | 在内边距盒外绘制指定宽度的实线边框。 | — |
| `borderColor` | `Color` | `"#0000001f"` | 设置边框颜色；深色模式默认使用 `#ffffff26`。 | — |
| `shadow` | `Shadow` | `"none"` | 在边框盒外绘制预设阴影。 | — |
| `clip` | `Bool` | `false` | 将溢出的内容裁剪到带圆角的内边距盒内。 | — |
| `direction` | `Axis` | `"vertical"` | 在编译时选择滚动轴。 | — |
| `gap` | `Int` | `0` | 设置相邻子节点之间的距离。 | — |
| `align` | `CrossAlign` | `"start"` | 设置子元素在非滚动交叉轴上的位置。 | — |
| `indicators` | `Bool` | `true` | 控制是否显示滚动条。 | — |

## Spacer

占用父容器主轴空间，不绘制内容。

**子节点:** 无.

必须是以下元素之一的直接子元素： `Column`, `Row`, `Scroll`.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `size` | `Int` | — | 占用固定长度；未设置时，参与分配剩余空间。 | — |

## Switch

打开或关闭一项设置。

**子节点:** 无.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | 设置内容盒的宽度。 | — |
| `height` | `Int` | — | 设置内容盒的高度。 | — |
| `grow` | `Float` | `0` | 设置子元素在线性容器主轴上分得剩余空间的比例。 | — |
| `minWidth` | `Int` | — | 设置内容宽度的下限。 | — |
| `maxWidth` | `Int` | — | 设置内容宽度的上限。 | — |
| `minHeight` | `Int` | — | 设置内容高度的下限。 | — |
| `maxHeight` | `Int` | — | 设置内容高度的上限。 | — |
| `fill` | `Bool` | `false` | 在线性容器中撑满交叉轴，或在 Stack 中撑满两个轴。 | — |
| `aspectRatio` | `Float` | — | 在由一边推算另一边时指定宽高比。 | — |
| `margin` | `Int` | `0` | 设置四边的外边距。 | — |
| `marginX` | `Int` | `0` | 设置左右外边距。 | — |
| `marginY` | `Int` | `0` | 设置上下外边距。 | — |
| `marginTop` | `Int` | `0` | 设置上外边距。 | — |
| `marginBottom` | `Int` | `0` | 设置下外边距。 | — |
| `marginStart` | `Int` | `0` | 设置从左到右布局中的左外边距。 | — |
| `marginEnd` | `Int` | `0` | 设置从左到右布局中的右外边距。 | — |
| `opacity` | `Float` | `1` | 设置整个元素及其子元素的不透明度。 | — |
| `hidden` | `Bool` | `false` | 隐藏元素，使其不参与布局。 | — |
| `checked` (位置参数) | `Bool` | 必填 | 当前的开关状态。 | — |
| `disabled` | `Bool` | — | 禁止切换开关。 | — |

| 事件 | 载荷 | 说明 | 平台例外 |
| --- | --- | --- | --- |
| `onChange` | `Bool` | 提供用户切换后的开关状态。 | — |

## TextArea

编辑多行文本。

**子节点:** 无.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | 设置内容盒的宽度。 | — |
| `height` | `Int` | — | 设置内容盒的高度。 | — |
| `grow` | `Float` | `0` | 设置子元素在线性容器主轴上分得剩余空间的比例。 | — |
| `minWidth` | `Int` | — | 设置内容宽度的下限。 | — |
| `maxWidth` | `Int` | — | 设置内容宽度的上限。 | — |
| `minHeight` | `Int` | — | 设置内容高度的下限。 | — |
| `maxHeight` | `Int` | — | 设置内容高度的上限。 | — |
| `fill` | `Bool` | `false` | 在线性容器中撑满交叉轴，或在 Stack 中撑满两个轴。 | — |
| `aspectRatio` | `Float` | — | 在由一边推算另一边时指定宽高比。 | — |
| `margin` | `Int` | `0` | 设置四边的外边距。 | — |
| `marginX` | `Int` | `0` | 设置左右外边距。 | — |
| `marginY` | `Int` | `0` | 设置上下外边距。 | — |
| `marginTop` | `Int` | `0` | 设置上外边距。 | — |
| `marginBottom` | `Int` | `0` | 设置下外边距。 | — |
| `marginStart` | `Int` | `0` | 设置从左到右布局中的左外边距。 | — |
| `marginEnd` | `Int` | `0` | 设置从左到右布局中的右外边距。 | — |
| `opacity` | `Float` | `1` | 设置整个元素及其子元素的不透明度。 | — |
| `hidden` | `Bool` | `false` | 隐藏元素，使其不参与布局。 | — |
| `value` (位置参数) | `String` | 必填 | 当前文本。 | — |
| `placeholder` | `String` | — | 文本为空时显示提示。 | — |
| `disabled` | `Bool` | — | 禁止编辑文本。 | — |
| `maxLength` | `Int` | — | 限制用户编辑后的 UTF-16 码元个数；省略则不限。 | — |
| `focused` | `Bool` | `false` | 变为 true 时请求焦点，变为 false 时放弃焦点。 | — |

| 事件 | 载荷 | 说明 | 平台例外 |
| --- | --- | --- | --- |
| `onChange` | `String` | 提供用户编辑后的文本。 | — |
| `onFocusChange` | `Bool` | 获得焦点时提供 true，失去焦点时提供 false，不会改写 focused。 | — |

## Spinner

表示操作正在进行，不显示具体进度。

**子节点:** 无.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | 设置内容盒的宽度。 | — |
| `height` | `Int` | — | 设置内容盒的高度。 | — |
| `grow` | `Float` | `0` | 设置子元素在线性容器主轴上分得剩余空间的比例。 | — |
| `minWidth` | `Int` | — | 设置内容宽度的下限。 | — |
| `maxWidth` | `Int` | — | 设置内容宽度的上限。 | — |
| `minHeight` | `Int` | — | 设置内容高度的下限。 | — |
| `maxHeight` | `Int` | — | 设置内容高度的上限。 | — |
| `fill` | `Bool` | `false` | 在线性容器中撑满交叉轴，或在 Stack 中撑满两个轴。 | — |
| `aspectRatio` | `Float` | — | 在由一边推算另一边时指定宽高比。 | — |
| `margin` | `Int` | `0` | 设置四边的外边距。 | — |
| `marginX` | `Int` | `0` | 设置左右外边距。 | — |
| `marginY` | `Int` | `0` | 设置上下外边距。 | — |
| `marginTop` | `Int` | `0` | 设置上外边距。 | — |
| `marginBottom` | `Int` | `0` | 设置下外边距。 | — |
| `marginStart` | `Int` | `0` | 设置从左到右布局中的左外边距。 | — |
| `marginEnd` | `Int` | `0` | 设置从左到右布局中的右外边距。 | — |
| `opacity` | `Float` | `1` | 设置整个元素及其子元素的不透明度。 | — |
| `hidden` | `Bool` | `false` | 隐藏元素，使其不参与布局。 | — |
| `color` | `Color` | — | 设置旋转圆环的颜色。 | — |

## Progress

显示任务已完成的比例。

**子节点:** 无.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | 设置内容盒的宽度。 | — |
| `height` | `Int` | — | 设置内容盒的高度。 | — |
| `grow` | `Float` | `0` | 设置子元素在线性容器主轴上分得剩余空间的比例。 | — |
| `minWidth` | `Int` | — | 设置内容宽度的下限。 | — |
| `maxWidth` | `Int` | — | 设置内容宽度的上限。 | — |
| `minHeight` | `Int` | — | 设置内容高度的下限。 | — |
| `maxHeight` | `Int` | — | 设置内容高度的上限。 | — |
| `fill` | `Bool` | `false` | 在线性容器中撑满交叉轴，或在 Stack 中撑满两个轴。 | — |
| `aspectRatio` | `Float` | — | 在由一边推算另一边时指定宽高比。 | — |
| `margin` | `Int` | `0` | 设置四边的外边距。 | — |
| `marginX` | `Int` | `0` | 设置左右外边距。 | — |
| `marginY` | `Int` | `0` | 设置上下外边距。 | — |
| `marginTop` | `Int` | `0` | 设置上外边距。 | — |
| `marginBottom` | `Int` | `0` | 设置下外边距。 | — |
| `marginStart` | `Int` | `0` | 设置从左到右布局中的左外边距。 | — |
| `marginEnd` | `Int` | `0` | 设置从左到右布局中的右外边距。 | — |
| `opacity` | `Float` | `1` | 设置整个元素及其子元素的不透明度。 | — |
| `hidden` | `Bool` | `false` | 隐藏元素，使其不参与布局。 | — |
| `value` (位置参数) | `Float` | 必填 | 已完成的比例，取值从 0 到 1。 | — |
| `color` | `Color` | `"#007aff"` | 设置进度条已填充部分的颜色。 | — |

## Divider

用线条分隔相邻内容。

**子节点:** 无.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | 设置内容盒的宽度。 | — |
| `height` | `Int` | — | 设置内容盒的高度。 | — |
| `grow` | `Float` | `0` | 设置子元素在线性容器主轴上分得剩余空间的比例。 | — |
| `minWidth` | `Int` | — | 设置内容宽度的下限。 | — |
| `maxWidth` | `Int` | — | 设置内容宽度的上限。 | — |
| `minHeight` | `Int` | — | 设置内容高度的下限。 | — |
| `maxHeight` | `Int` | — | 设置内容高度的上限。 | — |
| `fill` | `Bool` | `false` | 在线性容器中撑满交叉轴，或在 Stack 中撑满两个轴。 | — |
| `aspectRatio` | `Float` | — | 在由一边推算另一边时指定宽高比。 | — |
| `margin` | `Int` | `0` | 设置四边的外边距。 | — |
| `marginX` | `Int` | `0` | 设置左右外边距。 | — |
| `marginY` | `Int` | `0` | 设置上下外边距。 | — |
| `marginTop` | `Int` | `0` | 设置上外边距。 | — |
| `marginBottom` | `Int` | `0` | 设置下外边距。 | — |
| `marginStart` | `Int` | `0` | 设置从左到右布局中的左外边距。 | — |
| `marginEnd` | `Int` | `0` | 设置从左到右布局中的右外边距。 | — |
| `opacity` | `Float` | `1` | 设置整个元素及其子元素的不透明度。 | — |
| `hidden` | `Bool` | `false` | 隐藏元素，使其不参与布局。 | — |
| `vertical` | `Bool` | `false` | 改为绘制竖线；必须是常量。 | — |
| `color` | `Color` | `"#0000001f"` | 设置分隔线颜色；深色模式默认使用 `#ffffff26`。 | — |

## Slider

在指定范围内选择整数。

**子节点:** 无.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | 设置内容盒的宽度。 | — |
| `height` | `Int` | — | 设置内容盒的高度。 | — |
| `grow` | `Float` | `0` | 设置子元素在线性容器主轴上分得剩余空间的比例。 | — |
| `minWidth` | `Int` | — | 设置内容宽度的下限。 | — |
| `maxWidth` | `Int` | — | 设置内容宽度的上限。 | — |
| `minHeight` | `Int` | — | 设置内容高度的下限。 | — |
| `maxHeight` | `Int` | — | 设置内容高度的上限。 | — |
| `fill` | `Bool` | `false` | 在线性容器中撑满交叉轴，或在 Stack 中撑满两个轴。 | — |
| `aspectRatio` | `Float` | — | 在由一边推算另一边时指定宽高比。 | — |
| `margin` | `Int` | `0` | 设置四边的外边距。 | — |
| `marginX` | `Int` | `0` | 设置左右外边距。 | — |
| `marginY` | `Int` | `0` | 设置上下外边距。 | — |
| `marginTop` | `Int` | `0` | 设置上外边距。 | — |
| `marginBottom` | `Int` | `0` | 设置下外边距。 | — |
| `marginStart` | `Int` | `0` | 设置从左到右布局中的左外边距。 | — |
| `marginEnd` | `Int` | `0` | 设置从左到右布局中的右外边距。 | — |
| `opacity` | `Float` | `1` | 设置整个元素及其子元素的不透明度。 | — |
| `hidden` | `Bool` | `false` | 隐藏元素，使其不参与布局。 | — |
| `value` (位置参数) | `Int` | 必填 | 滑块当前的值。 | — |
| `min` | `Int` | `0` | 设置最小值。 | — |
| `max` | `Int` | `100` | 设置最大值。 | — |
| `step` | `Int` | `1` | 设置相邻可选值的间隔。 | — |
| `disabled` | `Bool` | — | 禁止移动滑块。 | — |

| 事件 | 载荷 | 说明 | 平台例外 |
| --- | --- | --- | --- |
| `onChange` | `Int` | 提供拖动滑块时选中的值。 | — |

## Picker

从字符串列表中选择一项。

**子节点:** 无.

| 属性 | 类型 | 默认值 | 说明 | 平台例外 |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | 设置内容盒的宽度。 | — |
| `height` | `Int` | — | 设置内容盒的高度。 | — |
| `grow` | `Float` | `0` | 设置子元素在线性容器主轴上分得剩余空间的比例。 | — |
| `minWidth` | `Int` | — | 设置内容宽度的下限。 | — |
| `maxWidth` | `Int` | — | 设置内容宽度的上限。 | — |
| `minHeight` | `Int` | — | 设置内容高度的下限。 | — |
| `maxHeight` | `Int` | — | 设置内容高度的上限。 | — |
| `fill` | `Bool` | `false` | 在线性容器中撑满交叉轴，或在 Stack 中撑满两个轴。 | — |
| `aspectRatio` | `Float` | — | 在由一边推算另一边时指定宽高比。 | — |
| `margin` | `Int` | `0` | 设置四边的外边距。 | — |
| `marginX` | `Int` | `0` | 设置左右外边距。 | — |
| `marginY` | `Int` | `0` | 设置上下外边距。 | — |
| `marginTop` | `Int` | `0` | 设置上外边距。 | — |
| `marginBottom` | `Int` | `0` | 设置下外边距。 | — |
| `marginStart` | `Int` | `0` | 设置从左到右布局中的左外边距。 | — |
| `marginEnd` | `Int` | `0` | 设置从左到右布局中的右外边距。 | — |
| `opacity` | `Float` | `1` | 设置整个元素及其子元素的不透明度。 | — |
| `hidden` | `Bool` | `false` | 隐藏元素，使其不参与布局。 | — |
| `selected` (位置参数) | `Int` | 必填 | 从 0 开始的索引；超出范围表示未选择。 | — |
| `options` | `Strings` | 必填 | 按显示顺序排列的选项标签列表。 | — |
| `placeholder` | `String` | — | 未选择时显示提示。 | — |
| `disabled` | `Bool` | — | 禁止更改选项。 | — |

| 事件 | 载荷 | 说明 | 平台例外 |
| --- | --- | --- | --- |
| `onChange` | `Int` | 提供用户选择的选项索引（从 0 开始）。 | — |
