---
title: Write Weft UI views
description: Build .weft views with typed parameters, layout, keyed lists, local state, and reusable components.
sidebar:
  order: 2
---

A `.weft` file describes what to render and which events to send. Use typed parameters to receive data from the logic layer and local `state` for details that belong to a single view. See the [example pages](https://github.com/weft-ui/weft-ui/tree/master/example/src/pages) for complete `.weft` views.

## Declare models, events, and components

Put any `import "./File.weft"` lines first. Then declare your data shapes with `model`, the messages your logic can handle with `event`, and renderable views with `component`. A component body contains nodes, with no separators between them.

Save this reusable row as `Todo.weft`:

```weft
model Todo {
  id: Int,
  name: String,
  done: Bool,
}

event Toggle(id: Int)
event Remove(id: Int)

component TodoRow(todo: Todo, showRemove: Bool = true) {
  Row(gap = 8) {
    Checkbox(todo.done, onChange = Toggle(todo.id))
    Text(todo.name)
    if (showRemove) {
      Button(onClick = Remove(todo.id)) {
        Text("Remove")
      }
    }
  }
}
```

`Int`, `Float`, `Bool`, and `String` are the primitive types. A model name such as `Todo` is a type too, with fields you read as `todo.name`. `Todo[]` is an array of todos; `Todo?` is a todo or `null`. An `Int` can be used where a `Float` is expected, and a `T` or `null` can be used where `T?` is expected.

Call a component by name. Positional arguments follow parameter declaration order, and named arguments come after any positional ones. `TodoRow(todo)` uses the default `true` for `showRemove`; `TodoRow(todo, showRemove = false)` overrides it. Supply each value parameter that has no default, even if its type is nullable.

## Build a layout

Use `Column` to arrange children vertically and `Row` to arrange them horizontally. Use `justify` to distribute leftover space along that main axis and `align` to position children across it. Both default to `"start"`. `gap` adds space between neighboring children; each child's `margin` adds to that gap.

Give a child `grow = 1` to share the remaining main-axis space, or `fill = true` to stretch it across the other axis. A `Spacer()` takes a share like `grow = 1`; `Spacer(size = 8)` leaves a fixed gap instead. Place spacers directly inside a `Column`, `Row`, or `Scroll`.

```weft
Column(width = 240, padding = 12, gap = 8) {
  Row(fill = true, align = "center") {
    Text("Tasks", size = 20, weight = "bold")
    Spacer()
    Text("3 open")
  }
  Scroll(height = 64, grow = 0, gap = 8) {
    Text("Pick up keys")
    Text("Send drawings")
    Text("Pack samples")
  }
}
```

`width` and `height` size the content box; `padding` adds space inside the element around that box, and `margin` adds space outside. A side-specific value such as `paddingTop` overrides `paddingY` and `padding`. Use `minWidth`, `maxWidth`, `minHeight`, and `maxHeight` to set bounds. `aspectRatio` derives one dimension from the other; two fixed dimensions take precedence.

For overlapping children, use `Stack`: later children appear on top, and `alignment` places them within the stack. A child with `fill = true` covers both axes without determining the stack's natural size. The root doesn't scroll. Use `Scroll` for a scrolling region; it defaults to vertical, and `direction = "horizontal"` changes the axis.

The layout features are available on every target platform. See the [built-in element reference](/reference/elements/) for the support status of each element and property.

You can supply the value for `Text`, `Input`, `Checkbox`, or `Image` as the first positional argument. Lengths, including text `size`, are `Int` values in logical pixels, with no unit suffix. These map to pt on iOS and macOS, dp on Android, DIP on Windows, CSS px on the web, and `px` (not `rpx`) in mini programs. Layout semantics are shared where supported, but controls can look different across platforms.

Colors such as `Text.color` or `Row.background` are strings in `#RGB`, `#RRGGBB`, or `#RRGGBBAA` form. Invalid literals are compile errors. Invalid dynamic colors render as transparent and warn in development builds.

## Set appearance and visibility

On every target platform, layout containers, `Text`, and `Image` can take `background`, `radius`, `border`, `borderColor`, `shadow`, and `clip`. `border` is a width in logical pixels. If you omit `borderColor`, it defaults to `#0000001f` in light mode and `#ffffff26` in dark mode.

```weft
Column(padding = 12, background = "#ffffff", radius = 12, border = 1, shadow = "medium", clip = true) {
  Text("Preview")
}
```

The border adds to the element's outer size, not to its content size. The background extends under the border, and `radius` rounds both. Use `clip = true` to keep children inside the rounded padding box. An `Image` with `radius` always rounds its picture. The `"small"`, `"medium"`, and `"large"` shadows paint outside the border box; the default is `"none"`.

`opacity` fades the whole element, including its children, without changing its size. Use `hidden = true` to hide an element and remove its space in the layout. See the [built-in element reference](/reference/elements/) for the available properties on each element.

## Style text and inline spans

Set `weight` to `"light"`, `"regular"`, `"medium"`, `"semibold"`, or `"bold"`. Set `italic = true`, or use `decoration = "underline"` or `"lineThrough"`. Use `weight = "bold"` for new code; `weight = "bold"` still works. Weights the system font lacks render with the nearest available face; for example, Windows' default font draws `"medium"` like `"regular"`.

`Text` wraps within its available width. Use `align = "start"`, `"center"`, or `"end"` to align the lines, `lineHeight` to set their height in logical pixels, and `maxLines = 2` to show at most two lines and mark omitted text with an ellipsis. A nonpositive `maxLines` leaves text unlimited. On iOS and macOS, `lineHeight` only adds space between lines, so a value below the font's natural line height has no effect.

```weft
Text(width = 200, lineHeight = 22) {
  Span("New: ", weight = "semibold")
  Span("read the release notes", decoration = "underline")
}
```

Give `Text` either a string value or one or more direct `Span` children, not both. Each `Span` takes a string and can override the text styling for that run. Include any spaces needed between spans in their strings. Use a string expression inside a `Span` for dynamic text rather than placing an `if`, `for`, component call, or slot directly inside `Text`.

## Form controls and progress

Use `Switch` for on/off settings, `TextArea` for multiline text, `Slider` to choose an integer, and `Picker` to choose from a list. These controls are controlled: `onChange` proposes a new value, and the displayed value follows the bound property. If the handler leaves that property unchanged, the control returns to its previous value. Use `disabled = true` when the user should not be able to propose an edit at all.

`Picker` requires named `options` of type `String[]`. The selection and its change event use zero-based indices. An out-of-range index (such as `-1`) shows the placeholder instead. `Slider` defaults to a range of 0–100 with a step of 1.

`Spinner` indicates activity without a known fraction, while `Progress` takes a fraction from 0 to 1. Use `Divider()` for a horizontal line or `Divider(vertical = true)` for a vertical line. The orientation must be a compile-time constant. Check the [element reference](/reference/elements/) for platform support.

```weft
component Preferences(choices: String[]) {
  state locked = false
  state choice = -1
  Column(gap = 8, width = 240) {
    Switch(locked, onChange = { value -> locked = value })
    Picker(choice, options = choices, placeholder = "Choose a location",
      onChange = { value -> choice = if (locked) choice else value })
    Divider()
    Progress(0.3)
  }
}
```

## Text entry

`Input` edits one line. Set `type` to `text`, `password`, `number`, `email`, or `phone` to choose the field and keyboard; the value is still a string. `returnKey` hints the keyboard action (`done`, `go`, `next`, `search`, or `send`), and `onSubmit` handles submission. WeChat uses the numeric keyboard for `phone` and the default keyboard for `email`. macOS, Windows, and Linux have no on-screen keyboard: they ignore `returnKey`, and macOS distinguishes only `password` among the types. See the [element reference](/reference/elements/#input) for platform support.

Both `Input` and `TextArea` can limit user edits with `maxLength`. The limit counts UTF-16 code units (the same as `String.length`), and `onChange` receives the truncated text. Changing `focused` to `true` requests focus; changing it back to `false` releases it. The request is not repeated while the value stays the same. Use `onFocusChange` to observe actual focus without writing back to `focused`.

```weft
component SearchBox() {
  state query = ""
  state requestFocus = false
  Column(gap = 8) {
    Input(query, returnKey = "search", maxLength = 20, focused = requestFocus,
      onChange = { value -> query = value }, onSubmit = { query = "" })
    Text("${query.length}/20")
    Button(onClick = { requestFocus = !requestFocus }) { Text("Toggle focus request") }
  }
}
```

## Keyboard avoidance

On Web and WeChat, the content area shrinks above the soft keyboard, keeping a bottom input row visible. A focused `Input` or `TextArea` inside a `Scroll` is scrolled into view with 16 logical pixels of clearance. Scrolling is not restored when the keyboard closes. On Web, include `interactive-widget=resizes-content` in the viewport meta tag. Keyboard avoidance has no effect on macOS, Windows, or Linux; iOS and Android support is forthcoming.

## Make an element tappable

Add `onTap` to a `Column`, `Row`, `Stack`, `Text`, or `Image` to make it act as a button. While pressed, the whole element is drawn at 60% of its usual opacity. On the Web, Tab focuses the element and Enter or Space activates it. `onTap` takes no arguments.

```weft
component TapRow() {
  state tapCount = 0
  Row(padding = 12, gap = 8, onTap = { tapCount = tapCount + 1 }) {
    Text("Taps: ${tapCount}")
    Text("›")
  }
}
```

When a tappable element contains another tappable element or a `Button` with an `onClick` handler, only the inner handler runs for that click. See the [element reference](/reference/elements/#row) for platform support.

## Reuse element styles

Declare a `style` at the top level and pass its name to a built-in element:

```weft
style Muted { color = "#6b7280", size = 12 }

component Notes() {
  Column {
    Text("Hint", style = Muted)
    Text("Note", style = Muted, size = 14)
  }
}
```

Both labels use the same color, but the second is larger because explicit arguments override style defaults. Every property in the style must be a named value property accepted by the element. Use literals, not expressions or interpolated strings. An element can apply one style; component calls cannot apply styles.

## Compute property values

Use expressions directly in arguments. Numeric arithmetic supports `+`, `-`, `*`, `/`, and `%`; division between two `Int` values is integer division. `+` also joins two strings. Use `==` and `!=` for scalar equality, `<`, `<=`, `>`, and `>=` to order numbers or strings, and `!`, `&&`, and `||` for Boolean logic.

```weft
component Estimate(title: String, note: String? = null, hours: Float = 0.0) {
  Column(gap = 4) {
    Text(title.trim())
    Text(note?.trim() ?? "No note")
    Text(if (hours > 0.0) "Estimate: ${hours.toFixed(1)} h" else "Not estimated")
  }
}
```

Use `${...}` to interpolate an `Int`, `Float`, `Bool`, or `String` inside a string. An `if` expression returns one value: the test must be `Bool`, `else` is required, and the two values must have compatible types. Use `?.` to access a member on a nullable value, and `??` to supply a fallback when the left side is `null`. `length` and `isEmpty` are properties of strings and arrays, so they need no parentheses; `trim()` and `toFixed(1)` are method calls.

## Render conditions and lists

An `if` node chooses which block of nodes to render, rather than returning a value. Its test must still be `Bool`, but `else` is optional, and you can chain tests with `else if`. A `for` node iterates an array and requires `; key = ...` in its header. Use a stable, unique `Int` or `String` for each item, such as a todo ID, so reordering the array preserves the identity of each row.

Save this as `TodoList.weft` next to `Todo.weft`:

```weft
import "./Todo.weft"

component TodoList(todos: Todo[]) {
  Column(gap = 8) {
    if (todos.isEmpty) {
      Text("No tasks yet")
    } else {
      for (todo in todos; key = todo.id) {
        TodoRow(todo)
      }
      Text("${todos.length} tasks")
    }
  }
}
```

## State

Declare component-private `state` at the top of the component body, before any nodes. Each component instance has its own state. The initializer can supply the type, or you can write it explicitly, as in `state draft: String = ""`. If the initializer is `null`, give it a nullable type explicitly.

```weft
component DraftPreview() {
  state draft: String = ""
  state preview = false

  Column(gap = 8) {
    Input(draft, placeholder = "New todo", onChange = { value -> draft = value })
    Button(onClick = { preview = !preview }) {
      Text(if (preview) "Hide preview" else "Show preview")
    }
    if (preview && !draft.trim().isEmpty) {
      Text(draft.trim())
    }
  }
}
```

An inline handler can assign to `state`, but not to component parameters, model fields, or loop variables. When `draft` or `preview` changes, the parts of the view that read it update. To change app data rather than local presentation, send an event to the [logic layer](/guides/logic/).

## Connect events

Choose the handler form based on which data you want to use:

- **Event name:** `onChange = DraftChanged` passes the `Input` payload to an event declared as `event DraftChanged(value: String)`. The event must take a single compatible argument if the element provides a payload, or no arguments if it does not. A button's `onClick` has no payload; a checkbox's `onChange` provides a `Bool`.
- **Event with arguments:** `onChange = Toggle(todo.id)` binds the row ID at render time and ignores the checkbox payload. Use `EventName()` if you want to ignore a payload and send an event with no arguments.
- **Inline lambda:** `{ value -> draft = value }` receives the payload and writes local state when triggered. Use `{ preview = !preview }` for a handler that takes no payload parameter. Lambdas can only appear directly as event argument values.

`onMount` and `onUnmount` are available on built-in elements and component calls. They fire when that element or component mounts or unmounts, provide no payload, and accept only declared events, with or without explicit arguments, not lambdas.

```weft
event DraftChanged(value: String)
event DraftMounted
event DraftUnmounted

component DraftField(value: String) {
  Input(value, onChange = DraftChanged, onMount = DraftMounted, onUnmount = DraftUnmounted)
}
```

## Compose components across files

A component can declare multiple `Children` parameters as slots. Use each parameter name as a node where its content should appear. In the call's trailing block, `name: { ... }` fills that named slot, and nodes outside named blocks fill the first `Children` parameter. You can omit any slot, but you can't fill the same slot twice.

Save this `App.weft` beside the two todo files:

```weft
import "./Todo.weft"
import "./TodoList.weft"

component Panel(title: String, content: Children, footer: Children) {
  Column(padding = 16, gap = 12) {
    Text(title, size = 20, weight = "bold")
    content
    footer
  }
}

component App(todos: Todo[]) {
  Panel("My tasks") {
    TodoList(todos)
    footer: { Text("End of list") }
  }
}
```

Import paths are relative to the file that imports them. Imports are not transitive: `App.weft` imports `TodoList.weft` to use `TodoList`, and it imports `Todo.weft` directly to name the `Todo` type. Use distinct names for models, events, and components across the connected files, and avoid names of built-in elements.

For the complete syntax and type rules, see the [Weft UI grammar specification](https://github.com/weft-ui/weft-ui/blob/master/crates/parser/GRAMMAR.md).
