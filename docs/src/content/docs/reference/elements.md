---
title: Built-in elements
---
<!-- Generated from protocol/weft.elements.json by protocol/elements.ts; do not edit. -->

Elements, properties, and events are supported on all target platforms unless noted. Unsupported uses cause a compilation error; ignored uses are accepted but have no effect.

All elements also accept `onMount` and `onUnmount`, which have no payload.

## NavBar

Describes the page navigation bar; it must be the first top-level page node.

Only these direct child elements are accepted: `BarButton`.

Must be the first top-level node of a page, outside conditional and loop blocks.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `title` | `String` | — | The navigation bar title. | — |
| `hidden` | `Bool` | `false` | Hides the navigation bar. | — |

## BarButton

An accessible navigation bar action; ignored on WeChat.

**Platform exceptions:** Ignored: `wechat`.

**Children:** None.

Must be a direct child of: `NavBar`.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `icon` | `String` | — | A bundled asset icon. | — |
| `label` | `String` | Required | The accessible action label. | — |
| `disabled` | `Bool` | — | Disables the action. | — |

| Event | Payload | Description | Platform exceptions |
| --- | --- | --- | --- |
| `onTap` | — | Fires when activated. | — |

## Column

Stacks children vertically.

**Children:** Any.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `padding` | `Int` | `0` | Sets the inset on all four sides. | — |
| `paddingX` | `Int` | `0` | Sets the left and right insets. | — |
| `paddingY` | `Int` | `0` | Sets the top and bottom insets. | — |
| `paddingTop` | `Int` | `0` | Sets the top inset. | — |
| `paddingBottom` | `Int` | `0` | Sets the bottom inset. | — |
| `paddingStart` | `Int` | `0` | Sets the left inset in left-to-right layout. | — |
| `paddingEnd` | `Int` | `0` | Sets the right inset in left-to-right layout. | — |
| `background` | `Color` | — | Fills the padding box, including the area underneath the border. | — |
| `radius` | `Int` | `0` | Rounds the corners of the background and border. | — |
| `border` | `Int` | `0` | Draws a solid border of the given width outside the padding box. | — |
| `borderColor` | `Color` | `"#0000001f"` | Sets the border color; the dark-mode default is `#ffffff26`. | — |
| `shadow` | `Shadow` | `"none"` | Draws a preset shadow outside the border box. | — |
| `clip` | `Bool` | `false` | Clips overflowing content to the rounded padding box. | — |
| `gap` | `Int` | `0` | Adds space between neighboring children. | — |
| `align` | `CrossAlign` | `"start"` | Positions children on the horizontal cross axis. | — |
| `justify` | `Justify` | `"start"` | Distributes remaining space on the vertical main axis. | — |

| Event | Payload | Description | Platform exceptions |
| --- | --- | --- | --- |
| `onTap` | — | Runs when the element is activated; this event has no payload and does not bubble. | — |

## Row

Places children side by side.

**Children:** Any.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `padding` | `Int` | `0` | Sets the inset on all four sides. | — |
| `paddingX` | `Int` | `0` | Sets the left and right insets. | — |
| `paddingY` | `Int` | `0` | Sets the top and bottom insets. | — |
| `paddingTop` | `Int` | `0` | Sets the top inset. | — |
| `paddingBottom` | `Int` | `0` | Sets the bottom inset. | — |
| `paddingStart` | `Int` | `0` | Sets the left inset in left-to-right layout. | — |
| `paddingEnd` | `Int` | `0` | Sets the right inset in left-to-right layout. | — |
| `background` | `Color` | — | Fills the padding box, including the area underneath the border. | — |
| `radius` | `Int` | `0` | Rounds the corners of the background and border. | — |
| `border` | `Int` | `0` | Draws a solid border of the given width outside the padding box. | — |
| `borderColor` | `Color` | `"#0000001f"` | Sets the border color; the dark-mode default is `#ffffff26`. | — |
| `shadow` | `Shadow` | `"none"` | Draws a preset shadow outside the border box. | — |
| `clip` | `Bool` | `false` | Clips overflowing content to the rounded padding box. | — |
| `gap` | `Int` | `0` | Adds space between neighboring children. | — |
| `align` | `CrossAlign` | `"start"` | Positions children on the vertical cross axis. | — |
| `justify` | `Justify` | `"start"` | Distributes remaining space on the horizontal main axis. | — |

| Event | Payload | Description | Platform exceptions |
| --- | --- | --- | --- |
| `onTap` | — | Runs when the element is activated; this event has no payload and does not bubble. | — |

## Text

Displays plain text or a sequence of styled spans.

Only these direct child elements are accepted: `Span`.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `padding` | `Int` | `0` | Sets the inset on all four sides. | — |
| `paddingX` | `Int` | `0` | Sets the left and right insets. | — |
| `paddingY` | `Int` | `0` | Sets the top and bottom insets. | — |
| `paddingTop` | `Int` | `0` | Sets the top inset. | — |
| `paddingBottom` | `Int` | `0` | Sets the bottom inset. | — |
| `paddingStart` | `Int` | `0` | Sets the left inset in left-to-right layout. | — |
| `paddingEnd` | `Int` | `0` | Sets the right inset in left-to-right layout. | — |
| `background` | `Color` | — | Fills the padding box, including the area underneath the border. | — |
| `radius` | `Int` | `0` | Rounds the corners of the background and border. | — |
| `border` | `Int` | `0` | Draws a solid border of the given width outside the padding box. | — |
| `borderColor` | `Color` | `"#0000001f"` | Sets the border color; the dark-mode default is `#ffffff26`. | — |
| `shadow` | `Shadow` | `"none"` | Draws a preset shadow outside the border box. | — |
| `clip` | `Bool` | `false` | Clips overflowing content to the rounded padding box. | — |
| `color` | `Color` | — | Sets the text color. | — |
| `size` | `Int` | — | Sets the font size in logical pixels. | — |
| `weight` | `Weight` | `"regular"` | Sets the font weight. | — |
| `italic` | `Bool` | `false` | Sets the text in italics. | — |
| `decoration` | `Decoration` | `"none"` | Underlines or strikes through the text. | — |
| `font` | `String` | — | Selects a bundled font family by name; defaults to the inherited or system font. | — |
| `value` (positional) | `String` | — | The plain text to display; required unless `Span` children provide the content. | — |
| `align` | `TextAlign` | `"start"` | Aligns lines within the text box. | — |
| `maxLines` | `Int` | `0` | Truncates overflowing lines with an ellipsis; zero or less leaves the text unlimited. | — |
| `lineHeight` | `Int` | — | Sets the line height in logical pixels. | — |

| Event | Payload | Description | Platform exceptions |
| --- | --- | --- | --- |
| `onTap` | — | Runs when the element is activated; this event has no payload and does not bubble. | — |

## Span

Displays an inline run of text with its own styling.

**Children:** None.

Must be a direct child of: `Text`.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `color` | `Color` | — | Sets the text color. | — |
| `size` | `Int` | — | Sets the font size in logical pixels. | — |
| `weight` | `Weight` | `"regular"` | Sets the font weight. | — |
| `italic` | `Bool` | `false` | Sets the text in italics. | — |
| `decoration` | `Decoration` | `"none"` | Underlines or strikes through the text. | — |
| `font` | `String` | — | Selects a bundled font family by name; defaults to the inherited or system font. | — |
| `value` (positional) | `String` | Required | The text of this run. | — |

## Button

Renders a clickable control with child nodes for its content.

**Children:** Any.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `disabled` | `Bool` | — | Disables the button. | — |

| Event | Payload | Description | Platform exceptions |
| --- | --- | --- | --- |
| `onClick` | — | Fires when the button is clicked. | — |

## Input

Displays an editable text field.

**Children:** None.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `value` (positional) | `String` | Required | The current text. | — |
| `placeholder` | `String` | — | Shows a hint when the field is empty. | — |
| `disabled` | `Bool` | — | Disables the input field. | — |
| `type` | `InputType` | `"text"` | Chooses the kind of input field and its keyboard. | — |
| `returnKey` | `ReturnKey` | — | Hints what action the keyboard's return key should display. | Ignored: `macos`; Ignored: `windows`; Ignored: `linux` |
| `maxLength` | `Int` | — | Limits user edits to this many UTF-16 code units; omit for no limit. | — |
| `focused` | `Bool` | `false` | Requests focus when changed to true and releases it when changed to false. | — |

| Event | Payload | Description | Platform exceptions |
| --- | --- | --- | --- |
| `onChange` | `String` | Reports the new text after an edit. | — |
| `onSubmit` | — | Fires when the user submits with the keyboard's return key. | — |
| `onFocusChange` | `Bool` | Reports true when focus is gained and false when it is lost, without changing focused. | — |

## Checkbox

Displays a checkable control.

**Children:** None.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `checked` (positional) | `Bool` | Required | The current checked state. | — |
| `disabled` | `Bool` | — | Disables the checkbox. | — |

| Event | Payload | Description | Platform exceptions |
| --- | --- | --- | --- |
| `onChange` | `Bool` | Reports the new checked state. | — |

## Image

Displays a bundled image or an image from a URL.

**Children:** None.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `background` | `Color` | — | Fills the padding box, including the area underneath the border. | — |
| `radius` | `Int` | `0` | Rounds the corners of the background and border. | — |
| `border` | `Int` | `0` | Draws a solid border of the given width outside the padding box. | — |
| `borderColor` | `Color` | `"#0000001f"` | Sets the border color; the dark-mode default is `#ffffff26`. | — |
| `shadow` | `Shadow` | `"none"` | Draws a preset shadow outside the border box. | — |
| `clip` | `Bool` | `false` | Clips overflowing content to the rounded padding box. | — |
| `src` (positional) | `String` | Required | The image URL or a bundled asset reference (`asset:name`). | — |
| `fit` | `ImageFit` | `"cover"` | Crops (`cover`), fits (`contain`), or stretches (`fill`) the image to its box. | — |
| `placeholder` | `Color` | — | Shows this background color while the image loads or if it fails. | — |

| Event | Payload | Description | Platform exceptions |
| --- | --- | --- | --- |
| `onTap` | — | Runs when the element is activated; this event has no payload and does not bubble. | — |

## Stack

Overlays children in declaration order.

**Children:** Any.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `padding` | `Int` | `0` | Sets the inset on all four sides. | — |
| `paddingX` | `Int` | `0` | Sets the left and right insets. | — |
| `paddingY` | `Int` | `0` | Sets the top and bottom insets. | — |
| `paddingTop` | `Int` | `0` | Sets the top inset. | — |
| `paddingBottom` | `Int` | `0` | Sets the bottom inset. | — |
| `paddingStart` | `Int` | `0` | Sets the left inset in left-to-right layout. | — |
| `paddingEnd` | `Int` | `0` | Sets the right inset in left-to-right layout. | — |
| `background` | `Color` | — | Fills the padding box, including the area underneath the border. | — |
| `radius` | `Int` | `0` | Rounds the corners of the background and border. | — |
| `border` | `Int` | `0` | Draws a solid border of the given width outside the padding box. | — |
| `borderColor` | `Color` | `"#0000001f"` | Sets the border color; the dark-mode default is `#ffffff26`. | — |
| `shadow` | `Shadow` | `"none"` | Draws a preset shadow outside the border box. | — |
| `clip` | `Bool` | `false` | Clips overflowing content to the rounded padding box. | — |
| `alignment` | `Alignment` | `"topStart"` | Positions children along both axes of the stack. | — |

| Event | Payload | Description | Platform exceptions |
| --- | --- | --- | --- |
| `onTap` | — | Runs when the element is activated; this event has no payload and does not bubble. | — |

## List

Displays a vertically scrolling lazy list.

**Platform exceptions:** Unsupported: `ios`; Unsupported: `macos`; Unsupported: `android`; Unsupported: `windows`; Unsupported: `linux`.

**Children:** Any.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `padding` | `Int` | `0` | Sets the inset on all four sides. | — |
| `paddingX` | `Int` | `0` | Sets the left and right insets. | — |
| `paddingY` | `Int` | `0` | Sets the top and bottom insets. | — |
| `paddingTop` | `Int` | `0` | Sets the top inset. | — |
| `paddingBottom` | `Int` | `0` | Sets the bottom inset. | — |
| `paddingStart` | `Int` | `0` | Sets the left inset in left-to-right layout. | — |
| `paddingEnd` | `Int` | `0` | Sets the right inset in left-to-right layout. | — |
| `background` | `Color` | — | Fills the padding box, including the area underneath the border. | — |
| `radius` | `Int` | `0` | Rounds the corners of the background and border. | — |
| `border` | `Int` | `0` | Draws a solid border of the given width outside the padding box. | — |
| `borderColor` | `Color` | `"#0000001f"` | Sets the border color; the dark-mode default is `#ffffff26`. | — |
| `shadow` | `Shadow` | `"none"` | Draws a preset shadow outside the border box. | — |
| `clip` | `Bool` | `false` | Clips overflowing content to the rounded padding box. | — |
| `gap` | `Int` | `0` | Space between items. | — |
| `stickyHeaders` | `Bool` | `false` | Keeps section headers at the top while scrolling. | Ignored: `wechat`; Ignored: `windows`; Ignored: `linux` |
| `indicators` | `Bool` | `true` | Controls whether scrollbars are shown. | — |
| `refreshing` | `Bool` | `false` | Keeps the refresh indicator visible. | Ignored: `macos`; Ignored: `windows`; Ignored: `linux` |
| `endThreshold` | `Int` | `5` | Number of items from the end at which the end event fires. | — |

| Event | Payload | Description | Platform exceptions |
| --- | --- | --- | --- |
| `onRefresh` | — | Fires when the user pulls to refresh. | Ignored: `macos`; Ignored: `windows`; Ignored: `linux` |
| `onEndReached` | — | Fires when the visible window approaches the end. | — |

## Grid

Displays a vertically scrolling lazy grid.

**Platform exceptions:** Unsupported: `ios`; Unsupported: `macos`; Unsupported: `android`; Unsupported: `windows`; Unsupported: `linux`.

**Children:** Any.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `padding` | `Int` | `0` | Sets the inset on all four sides. | — |
| `paddingX` | `Int` | `0` | Sets the left and right insets. | — |
| `paddingY` | `Int` | `0` | Sets the top and bottom insets. | — |
| `paddingTop` | `Int` | `0` | Sets the top inset. | — |
| `paddingBottom` | `Int` | `0` | Sets the bottom inset. | — |
| `paddingStart` | `Int` | `0` | Sets the left inset in left-to-right layout. | — |
| `paddingEnd` | `Int` | `0` | Sets the right inset in left-to-right layout. | — |
| `background` | `Color` | — | Fills the padding box, including the area underneath the border. | — |
| `radius` | `Int` | `0` | Rounds the corners of the background and border. | — |
| `border` | `Int` | `0` | Draws a solid border of the given width outside the padding box. | — |
| `borderColor` | `Color` | `"#0000001f"` | Sets the border color; the dark-mode default is `#ffffff26`. | — |
| `shadow` | `Shadow` | `"none"` | Draws a preset shadow outside the border box. | — |
| `clip` | `Bool` | `false` | Clips overflowing content to the rounded padding box. | — |
| `columns` | `Int` | Required | Number of equal-width columns, at least one. | — |
| `gap` | `Int` | `0` | Space between rows and columns. | — |
| `indicators` | `Bool` | `true` | Controls whether scrollbars are shown. | — |
| `refreshing` | `Bool` | `false` | Keeps the refresh indicator visible. | Ignored: `macos`; Ignored: `windows`; Ignored: `linux` |
| `endThreshold` | `Int` | `5` | Number of items from the end at which the end event fires. | — |

| Event | Payload | Description | Platform exceptions |
| --- | --- | --- | --- |
| `onRefresh` | — | Fires when the user pulls to refresh. | Ignored: `macos`; Ignored: `windows`; Ignored: `linux` |
| `onEndReached` | — | Fires when the visible window approaches the end. | — |

## Scroll

Lays out children linearly and scrolls along its main axis.

**Children:** Any.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `padding` | `Int` | `0` | Sets the inset on all four sides. | — |
| `paddingX` | `Int` | `0` | Sets the left and right insets. | — |
| `paddingY` | `Int` | `0` | Sets the top and bottom insets. | — |
| `paddingTop` | `Int` | `0` | Sets the top inset. | — |
| `paddingBottom` | `Int` | `0` | Sets the bottom inset. | — |
| `paddingStart` | `Int` | `0` | Sets the left inset in left-to-right layout. | — |
| `paddingEnd` | `Int` | `0` | Sets the right inset in left-to-right layout. | — |
| `background` | `Color` | — | Fills the padding box, including the area underneath the border. | — |
| `radius` | `Int` | `0` | Rounds the corners of the background and border. | — |
| `border` | `Int` | `0` | Draws a solid border of the given width outside the padding box. | — |
| `borderColor` | `Color` | `"#0000001f"` | Sets the border color; the dark-mode default is `#ffffff26`. | — |
| `shadow` | `Shadow` | `"none"` | Draws a preset shadow outside the border box. | — |
| `clip` | `Bool` | `false` | Clips overflowing content to the rounded padding box. | — |
| `direction` | `Axis` | `"vertical"` | Selects the scrolling axis at compile time. | — |
| `gap` | `Int` | `0` | Adds space between neighboring children. | — |
| `align` | `CrossAlign` | `"start"` | Positions children on the non-scrolling cross axis. | — |
| `indicators` | `Bool` | `true` | Controls whether scrollbars are shown. | — |

## Spacer

Occupies space on its parent's main axis without rendering content.

**Children:** None.

Must be a direct child of: `Column`, `Row`, `Scroll`.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `size` | `Int` | — | Reserves a fixed length; if omitted, shares the remaining space. | — |

## Switch

Toggles a setting on or off.

**Children:** None.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `checked` (positional) | `Bool` | Required | The current switch state. | — |
| `disabled` | `Bool` | — | Prevents changes to the switch. | — |

| Event | Payload | Description | Platform exceptions |
| --- | --- | --- | --- |
| `onChange` | `Bool` | Reports the proposed switch state. | — |

## TextArea

Edits multiple lines of text.

**Children:** None.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `value` (positional) | `String` | Required | The current text. | — |
| `placeholder` | `String` | — | Shows a hint when the text is empty. | — |
| `disabled` | `Bool` | — | Prevents editing the text. | — |
| `maxLength` | `Int` | — | Limits user edits to this many UTF-16 code units; omit for no limit. | — |
| `focused` | `Bool` | `false` | Requests focus when changed to true and releases it when changed to false. | — |

| Event | Payload | Description | Platform exceptions |
| --- | --- | --- | --- |
| `onChange` | `String` | Reports the proposed text after an edit. | — |
| `onFocusChange` | `Bool` | Reports true when focus is gained and false when it is lost, without changing focused. | — |

## Spinner

Indicates that work is in progress without showing an amount.

**Children:** None.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `color` | `Color` | — | Sets the color of the spinning ring. | — |

## Progress

Displays the completed fraction of a task.

**Children:** None.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `value` (positional) | `Float` | Required | The fraction complete, from zero to one. | — |
| `color` | `Color` | `"#007aff"` | Sets the color of the filled bar. | — |

## Divider

Separates adjacent content with a line.

**Children:** None.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `vertical` | `Bool` | `false` | Selects a vertical instead of a horizontal line; must be constant. | — |
| `color` | `Color` | `"#0000001f"` | Sets the line color; the dark-mode default is `#ffffff26`. | — |

## Slider

Selects an integer within a range.

**Children:** None.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `value` (positional) | `Int` | Required | The current slider value. | — |
| `min` | `Int` | `0` | Sets the lower bound. | — |
| `max` | `Int` | `100` | Sets the upper bound. | — |
| `step` | `Int` | `1` | Sets the increment between values. | — |
| `disabled` | `Bool` | — | Prevents changes to the slider. | — |

| Event | Payload | Description | Platform exceptions |
| --- | --- | --- | --- |
| `onChange` | `Int` | Reports the proposed value as the slider moves. | — |

## Picker

Selects one option from a list of strings.

**Children:** None.

| Property | Type | Default | Description | Platform exceptions |
| --- | --- | --- | --- | --- |
| `width` | `Int` | — | Sets the width of the content box. | — |
| `height` | `Int` | — | Sets the height of the content box. | — |
| `grow` | `Float` | `0` | Sets the share of remaining main-axis space for a child in a linear container. | — |
| `minWidth` | `Int` | — | Sets the minimum content width. | — |
| `maxWidth` | `Int` | — | Sets the maximum content width. | — |
| `minHeight` | `Int` | — | Sets the minimum content height. | — |
| `maxHeight` | `Int` | — | Sets the maximum content height. | — |
| `fill` | `Bool` | `false` | Fills the cross axis in a linear container or both axes in a Stack. | — |
| `aspectRatio` | `Float` | — | Sets width divided by height when one dimension determines the other. | — |
| `margin` | `Int` | `0` | Sets the outer spacing on all four sides. | — |
| `marginX` | `Int` | `0` | Sets the outer spacing on the left and right. | — |
| `marginY` | `Int` | `0` | Sets the outer spacing on the top and bottom. | — |
| `marginTop` | `Int` | `0` | Sets the top margin. | — |
| `marginBottom` | `Int` | `0` | Sets the bottom margin. | — |
| `marginStart` | `Int` | `0` | Sets the left margin in left-to-right layout. | — |
| `marginEnd` | `Int` | `0` | Sets the right margin in left-to-right layout. | — |
| `opacity` | `Float` | `1` | Sets the opacity of the element and its children. | — |
| `hidden` | `Bool` | `false` | Hides the element and removes it from layout. | — |
| `selected` (positional) | `Int` | Required | The zero-based index; an out-of-range index means there is no selection. | — |
| `options` | `Strings` | Required | The list of option labels, in display order. | — |
| `placeholder` | `String` | — | Shows a hint when there is no selection. | — |
| `disabled` | `Bool` | — | Prevents selecting another option. | — |

| Event | Payload | Description | Platform exceptions |
| --- | --- | --- | --- |
| `onChange` | `Int` | Reports the zero-based index of the proposed option. | — |
