# Weft grammar

[中文](GRAMMAR.zh-CN.md)

This document defines the normative grammar of the `.weft` language. The parser (`weft_ui_parser::parse`) implements this grammar. For semantic rules (scope, types, and dependencies), see [Semantic constraints](#semantic-constraints).

## Lexical rules

- Source files are encoded in UTF-8. Newlines, like other whitespace, are insignificant except as token separators.
- Comments: `// line comment` and `/* block comment */`. Block comments do not nest.
- Identifiers: `[A-Za-z_][A-Za-z0-9_]*`.
- Reserved keywords: `if` `else` `for` `in` `true` `false` `null`.
- Contextual keywords (ordinary identifiers elsewhere, such as the `model` parameter in Demo):
  - `import` (followed by a string) and `model` / `event` / `component` / `page` / `app` / `type` / `style` (followed by an identifier) begin declarations only at the top level;
  - `theme` followed by `{` begins a top-level theme declaration; `dark` introduces its second color only in a theme entry;
  - `state` (followed by an identifier) begins a state declaration only in a component body;
  - `let` (followed by an identifier) begins a local declaration at the start of a component body or block;
  - `path` introduces a page's optional path after its parameter list; `start` names the entry page and `tabs` introduces tab pages inside an `app`;
  - `key` appears only in a `for` header.
- Integers: `[0-9]+`, within the range of `i64`. Floating-point numbers: `[0-9]+ "." [0-9]+ ([eE] [+-]? [0-9]+)?` or `[0-9]+ [eE] [+-]? [0-9]+`.
- Strings: `"..."`, with escapes `\n` `\r` `\t` `\0` `\\` `\"` `\$` `\u{XXXX}`.
  `${ expression }` interpolates an expression, which may itself contain strings. Strings cannot span multiple lines.
- Symbols: `( ) { } [ ] , : ; . ?. ? ?? = += -= == != < <= > >= + - * / % ! && | || ->`

## Grammar

EBNF notation: `X?` means optional, `X*` means zero or more occurrences, `X+` means one or more occurrences, and `"tok"` denotes a token.

```text
File        = Import* Item* EOF ;
Import      = "import" STRING ;               (* no interpolation *)
Item        = Model | Event | Component | Page | App | TypeAlias | Style | Theme ;
App         = "app" IDENT "{" AppEntry "}" ;
AppEntry    = "start" "=" IDENT | "tabs" "{" TabItem+ "}" ;
TabItem     = IDENT "(" ArgList? ")" ;
TypeAlias   = "type" IDENT "=" Type ;
Style       = "style" IDENT "{" ( StyleEntry ","? )* "}" ;
StyleEntry  = IDENT "=" ConstValue ;
Theme       = "theme" "{" ( ThemeEntry ","? )* "}" ;
ThemeEntry  = IDENT "=" ( COLOR_STRING ( "dark" COLOR_STRING )? | "-"? INT | "-"? FLOAT ) ;
ConstValue  = STRING | "-"? INT | "-"? FLOAT | "true" | "false" | "theme" "." IDENT ;
(* STRING in ConstValue and COLOR_STRING must not contain interpolation. *)

Model       = "model" IDENT "{" FieldList? "}" ;
Event       = "event" IDENT ( "(" FieldList? ")" )? ;
FieldList   = Field ( "," Field )* ","? ;
Field       = IDENT ":" Type ;

Component   = "component" IDENT "(" ParamList? ")" "{" StateDecl* LetDecl* Node* "}" ;
Page        = "page" IDENT "(" ParamList? ")" ( "path" STRING )? "{" StateDecl* LetDecl* Node* "}" ; (* path has no interpolation *)
ParamList   = Param ( "," Param )* ","? ;
Param       = IDENT ":" Type ( "=" Expr )? ;
StateDecl   = "state" IDENT ( ":" Type )? "=" Expr ;
LetDecl     = "let" IDENT ( ":" Type )? "=" Expr ;

Type        = UnionType | IDENT TypeArgs? TypeSuffix* ;
TypeArgs    = "<" Type ">" ;
UnionType   = STRING ( "|" STRING )+ ;       (* no interpolation *)
TypeSuffix  = "[" "]" | "?" ;

Block       = "{" LetDecl* Node* "}" ;
Node        = ElementNode | IfNode | ForNode | SlotFill ;
SlotFill    = IDENT ":" Block ;                  (* only directly in a component call's child block *)
ElementNode = Path ( "(" ArgList? ")" )? Block? ;
Path        = IDENT ( "." IDENT )* ;
IfNode      = "if" "(" Expr ")" Block ( "else" ( IfNode | Block ) )? ;
ForNode     = "for" "(" IDENT "in" Expr ( ";" "key" "=" Expr )? ")" Block ;

ArgList     = Arg ( "," Arg )* ","? ;
Arg         = ( IDENT "=" )? Expr ;              (* named arguments must follow positional arguments *)

Expr        = IfExpr | Binary ;
IfExpr      = "if" "(" Expr ")" Expr "else" Expr ;
Binary      = Unary ( BinOp Unary )* ;            (* grouped according to the precedence below *)
Unary       = ( "!" | "-" ) Unary | Postfix ;
Postfix     = Primary ( "." IDENT | "?." IDENT | "(" ArgList? ")" )* ;
Primary     = INT | FLOAT | STRING | "true" | "false" | "null"
            | IDENT | "(" Expr ")" | Lambda ;
Lambda      = "{" ( IDENT "->" )? ( Stmt ";"? )* "}" ;
Stmt        = Assign | Call ;
Assign      = IDENT ( "=" | "+=" | "-=" ) Expr ;
Call        = IDENT "(" ArgList? ")" ;
```

Binary operator precedence (lowest to highest; all operators are left-associative):

| Precedence | Operators           |
| ---------- | ------------------- |
| 1          | `??`                |
| 2          | `\|\|`              |
| 3          | `&&`                |
| 4          | `==` `!=`           |
| 5          | `<` `<=` `>` `>=`   |
| 6          | `+` `-`             |
| 7          | `*` `/` `%`         |

Notes:

- `state` declarations are allowed only at the top level of a component body, before any `let` declarations or nodes.
- `let` declarations precede the nodes of a component body, an `if` or `for` block, or a component call’s child block. Built-in elements do not accept `let` declarations directly in their child blocks.
- Nodes require no separators. An opening `(` or `{` immediately after `Name` belongs to that node, even if the `{` is on the next line.
- In node position, `if` renders conditionally and its branches are blocks of nodes. In expression position, `if` requires an `else` and its branches are expressions.
- Calls are allowed only after identifiers or member accesses: `Remove(todo.id)`, `name.trim()`.
- A lambda may only be used directly as the value of an element event or a component callback argument.
- A `for` header can omit `key` syntactically. Semantic analysis reports its absence to provide a more precise diagnostic.

## Error recovery

The parser continues after an error to report as many errors as possible:

- Top level: Skip to the next `import` / `model` / `event` / `component` / `page` / `app` / `type` / `style` / `theme`.
- Node blocks: Skip unrecognized tokens, skipping over matched delimiters as a unit, until the next token that can start a node or `}`.
- Argument and field lists: Skip to the next `,` or closing delimiter.
- Report only the first error at a given location.

Every AST node carries a source span (file and byte offsets). Diagnostics are located as `file:line:column` and include a source excerpt.

## Semantic constraints

### Scope and imports

- Each file can see its own declarations and those of files it directly imports with `import`. Imports are not transitive.
- Within the import closure, `model`, `event`, `component`, `page`, `type`, and `style` declarations share one namespace. Duplicate names and names that collide with built-in elements are errors.
- Host-side event registration methods are derived from event names (`onFooBar` / `on_foo_bar`). Two event names that differ only in case and underscores (such as `FooBar` and `foo_bar`) are therefore also an error.
- Import cycles and missing files are errors.
- `theme` is reserved for the token namespace: it cannot name a component parameter, state, `let`, `for` variable, or lambda parameter.
- Name lookup within a component proceeds in this order: lambda parameters → `let` bindings (innermost block first) → `for` variables → `state` → component parameters. Names may not shadow existing names within a component.
- `let` creates an immutable expression alias, visible after its declaration in the same block and in nested blocks and lambdas. Its type is inferred unless annotated. The compiler substitutes its expression at each use site, so dependencies are the same as if the expression had been written there directly.

### Pages

- A page has the same body syntax and scope as a component, but cannot be used as a component node. Its first parameter may be a model; remaining route parameters must be `Int`, `Float`, `Bool`, `String`, a string literal union, or an optional form of one of these. Route parameters may have constant defaults.
- An explicit path starts with `/` and consists of literal segments (`[a-z0-9._~-]+`) or `{name}` parameters. Each path parameter occurs at most once and names a required `String`, `Int`, or union route parameter. Other route parameters use the query string. Without a path, the page name becomes a kebab-case path, e.g. `/user-profile`.
- Paths overlap if they have the same number of segments and each pair is either the same literal or includes a parameter; overlapping paths are an error. Page events cannot be named `Show` or `Hide`, which are reserved for page methods.

### Applications

- A compilation unit has at most one `app`. Its `start` must name a page without required route parameters. The application contains all pages in the transitive import closure of the file declaring it; pages outside that closure are errors.
- Alternatively, `tabs` lists 2–5 distinct pages without required route parameters. Each item requires named string literal arguments `title` and `icon`, and may specify `activeIcon`; icons must use `asset:<name>`. An omitted `activeIcon` defaults to `icon`.
- An application is mounted with its generated application class and a factory for every page. Factories create page instances and register their handlers. Pages cannot be mounted directly. Programs without an `app` continue to mount a root component.
- A `NavBar` can appear at most once, as the first top-level node of a page, never inside `if` or `for`. `BarButton` may only appear inside `NavBar`; it requires an accessible `label`.

### Types

- Primitive types are `Int` `Float` `Bool` `String` `Color`. Other types are compound types `T[]` and `T?` and `model` names.
- A component can declare multiple `Children` parameters (slots). The component body uses each parameter name as a node. Slots have no default value and can be omitted.
- A caller fills slots in a trailing block: `name: { ... }` fills the corresponding `Children` parameter, and all other nodes go to the first `Children` parameter in declaration order. Named fills are only allowed directly in a component call's trailing block. Unknown slot names, filling a slot twice (including through both named and unnamed content), and passing a block to a component without slots are errors.
- `type` declares an alias for another type, such as `type Kind = "text" | "image"`. Aliases are expanded for type checking and cannot refer to themselves directly or indirectly. Use an alias to write a nullable union (`Kind?`) or an array of unions (`Kind[]`).
- A literal union must contain at least two distinct string literals, compared after decoding escapes. Its values are ordinary strings at runtime and become a string literal union in TypeScript declarations.
- Assignment compatibility: identical types; `Int` → `Float`; `null` → `T?`; `T` → `T?`. A string literal can be assigned to a union that contains it, but an arbitrary `String` value cannot. A union can be assigned to another union containing all its members or to `String`.
- Where a union is expected, both arms of an `if` expression and the fallback of `??` are checked against that union. When a union is compared with a string literal using `==` or `!=`, the literal must be a member.
- Arithmetic: `Int op Int → Int` (integer division); the result is `Float` if either operand is `Float`. `String + String → String`.
- Comparisons `< <= > >=` apply only to numbers or strings. `== !=` apply to scalar types other than `Color` and their nullable forms.
- `a ?? b` requires `a: T?`. `a?.f` requires a nullable receiver and produces a nullable result. Using `?.` on a non-nullable value emits a warning.
- String interpolation accepts only `Int`, `Float`, `Bool`, `String`, and string literal unions.
- A `model` cannot refer directly to itself except through an array or a nullable type.

### Built-in members

| Receiver         | Members                                                      |
| ---------------- | ------------------------------------------------------------ |
| `String`         | `length: Int` `isEmpty: Bool` `trim()` `uppercase()` `lowercase()` `contains(String): Bool` |
| `T[]`            | `length: Int` `isEmpty: Bool` `contains(T): Bool` (`T` is a scalar other than `Color`) |
| `Int` `Bool`     | `toString(): String`                                         |
| `Float`          | `toString(): String` `toFixed(Int): String`                  |

`length` / `isEmpty` are properties; the rest are methods. A string literal union has the same members as `String`.

### Event arguments

Element event arguments have payload types (`onClick` has no payload; `Input.onChange` carries a `String`). Accepted values:

- `Event`: Use the event name as a function. Its parameter count must match the payload count (0 or 1). The payload, if any, supplies the sole parameter.
- `Event(args)`: Construct the event instance directly. Arguments are bound at render time, and the payload is ignored.
- `{ stmts }` / `{ v -> stmts }`: An inline lambda. It can assign to `state` and call events or callbacks; `v` receives the payload. Statements execute in source order.
- A callback name or `callback(args)`: Forward the payload to a callback or bind its argument at render time, respectively.
- `onMount` / `onUnmount` accept only declared events, not callbacks or lambdas.

### Callback parameters

A component parameter of type `Event` takes no payload; `Event<T>` takes a single `Int`, `Float`, `Bool`, `String`, `Color`, or string literal union payload. These types are only allowed directly on component parameters. Callback parameters are optional and cannot declare a default value. The caller supplies any of the event argument forms above; when forwarding a payload by name, its type must be assignable to the receiver's payload type. An omitted callback can be invoked safely and does nothing.

For example, a `Rating(value: Int, onSelect: Event<Int>)` component can use `Button(onClick = onSelect(1))`. Its caller can pass `Rating(score, onSelect = Rated)` to send a host event, or `Rating(score, onSelect = { v -> score = v; Rated(score) })` to set local state before sending the event. A host event passed through a callback still belongs to the component that supplies it.

### Views

- An `if` condition must be `Bool`.
- A `for` must have a `key` of type `Int`, `String`, or a string literal union. The value being iterated must be an array.
- Custom components cannot be instantiated recursively except through an `if` / `for`.

### Styles

- A top-level `style Muted { color = "#6b7280", size = 12 }` groups defaults for named value properties declared by built-in elements. A style accepts literals and `theme.name` references. It cannot set positional properties or events, refer to other styles, or contain computed values.
- Apply a single visible style with `Text("note", style = Muted, size = 14)`. Every property in the style must be accepted by the element. Explicit arguments override the defaults (here, `size` is `14`), and the remaining values are checked as ordinary element arguments. Style values that fail type checking are reported at the `style = Muted` argument.
- `style` is only available on built-in elements, not on component calls.

### Themes

- At most one `theme` declaration is allowed in the import closure. Tokens have unique names within it. A `theme.name` expression must appear in the declaring file or in a file that directly imports it. Style values are resolved in the file that declares the style.
- A color token has a light color and an optional `dark` color. When omitted, the light color is also used in dark mode. The host updates the rendered colors when the system appearance changes. Integer and floating-point tokens have no appearance variants and are substituted as literals at compile time.
- `Color` is a distinct type usable in annotations, including model fields and `Event<Color>` callback parameters. A `String` can be used where a `Color` is expected; literals must be hexadecimal colors and other values are parsed at runtime. A `Color` is not assignable to `String` and cannot be compared or interpolated. In TypeScript declarations it is represented as `string`.
- All target platforms support theme declarations and references.

### Built-in elements and layout

The compiler rejects elements, properties, and events marked unsupported for the target platform. Those marked ignored are accepted but have no effect. Layout semantics are shared where supported; appearance follows each platform's native style.

<!-- elements:begin -->
<!-- Generated from protocol/weft.elements.json by protocol/elements.ts; do not edit. -->

| Element | Positional property | Events | Children |
| --- | --- | --- | --- |
| `NavBar` | — | — | `BarButton` |
| `BarButton` | — | `onTap` | None |
| `Column` | — | `onTap` | Any |
| `Row` | — | `onTap` | Any |
| `Text` | `value` | `onTap` | `Span` |
| `Span` | `value` | — | None |
| `Button` | — | `onClick` | Any |
| `Input` | `value` | `onChange(String)`, `onSubmit`, `onFocusChange(Bool)` | None |
| `Checkbox` | `checked` | `onChange(Bool)` | None |
| `Image` | `src` | `onTap` | None |
| `Stack` | — | `onTap` | Any |
| `Scroll` | — | — | Any |
| `Spacer` | — | — | None |
| `Switch` | `checked` | `onChange(Bool)` | None |
| `TextArea` | `value` | `onChange(String)`, `onFocusChange(Bool)` | None |
| `Spinner` | — | — | None |
| `Progress` | `value` | — | None |
| `Divider` | — | — | None |
| `Slider` | `value` | `onChange(Int)` | None |
| `Picker` | `selected` | `onChange(Int)` | None |

See the [element reference](https://weftui.mioyi.net/reference/elements/) for full properties, events, and platform support.
<!-- elements:end -->

All elements also have `onMount` / `onUnmount`.

- **Controlled values**: `Input`, `TextArea`, `Checkbox`, `Switch`, `Slider`, and `Picker` display their bound values. Their `onChange` handlers receive the proposed value; if the binding does not accept it, the host restores the bound value.
- **`Picker` / `Slider`**: `Picker.options` is a required named `String[]`. Its `selected` value and change payload are zero-based indices; an out-of-range index displays the placeholder. `Slider` uses integers for its value, bounds, step, and change payload.
- **`Progress` / `Divider`**: `Progress` takes a fraction between 0 and 1. `Divider` is horizontal by default; `vertical` must be a compile-time constant.

- **Lengths**: `Int`, measured in logical pixels: pt on iOS / macOS, dp on Android, DIP on Windows, and CSS px on the web. Mini programs use `px`, not `rpx`.
- **Box model**: `width`, `height`, and their `min*` / `max*` limits apply to the content box. Padding, any border, and margin surround it, in that order. `padding` sets all four edges, `paddingX` sets left and right, `paddingY` sets top and bottom, and a single-edge value overrides both. `margin` follows the same precedence. `Start` and `End` mean left and right, respectively, for edge properties.
- **Appearance**: `background` paints the padding box and extends under the border. `border` adds a solid border of that width, and `radius` rounds the border box, background, and border. `shadow` (`"none"`, `"small"`, `"medium"`, or `"large"`) paints outside the border box. `clip = true` clips child content to the rounded padding box. `opacity` applies to the element and its descendants as a group; `hidden = true` removes it from rendering and layout.
- **`Column` / `Row`**: Children are laid out in order along the main axis (vertical for `Column`, horizontal for `Row`). `gap` separates adjacent children in addition to their margins. `justify` distributes leftover main-axis space; `align` positions children across it. Both default to `"start"`. `align = "stretch"` stretches children with no fixed cross-axis dimension within the container's content box.
- **`grow`**: In a `Column`, `Row`, or `Scroll`, children with positive `grow` share the remaining main-axis space in proportion to their weights, without counting their natural sizes on that axis. In an unbounded main axis they are measured at their natural size. Other parents ignore `grow`.
- **`fill`**: Stretches a child along the cross axis in a `Column`, `Row`, or `Scroll`, along both axes in a `Stack`, or to the available window width at the root. A child's fixed `width` or `height` takes precedence on that axis. Use `grow`, not `fill`, for leftover main-axis space in linear layouts.
- **`aspectRatio`**: If width is determined by a fixed width, `fill`, stretch, or horizontal growth, and height is not fixed, height is width divided by the ratio. Otherwise, if only height is determined, width is height multiplied by the ratio. If both dimensions are fixed, the ratio is ignored.
- **`Spacer`**: A direct child of `Column`, `Row`, or `Scroll` only. It occupies `size` on the main axis when specified, otherwise it acts like `grow = 1`. Its cross-axis size is zero.
- **`Stack`**: Children overlap in order, with later children above earlier ones. The content size is the maximum size of children without `fill`, including their margins, unless fixed dimensions specify otherwise. `alignment` positions the children in the content box. Children with `fill` stretch along both axes without contributing to the stack's natural size.
- **`Scroll`**: Lays out content like a `Column` or `Row` with `gap` and `align`. `direction` is a constant and defaults to `"vertical"`. Content can overflow and scroll only along that axis. Unless set explicitly, `grow` is `1` and `fill` is `true`. `indicators = false` hides the scrollbars.
- **Root and overflow**: Top-level nodes are arranged like children of a `Column` whose content box is the window minus its safe area by default. Set `safeArea: false` in the Vite plugin to use the full window instead. The root does not scroll; use `Scroll` for scrollable content. When natural child sizes exceed available space on a main axis that does not scroll, platforms may compress the children or let them overflow; don't rely on either behavior.
- **Colors**: A `Color` property accepts a `Color` value such as `theme.accent`, or `#RGB`, `#RRGGBB`, or `#RRGGBBAA` (case-insensitive hexadecimal). Literals are validated at compile time and stored as RGBA in the view layout. Invalid dynamic colors and unknown runtime tokens are transparent, with a warning in development builds.
- **`Text` / `Span`**: `Text` takes either a string value or one or more direct `Span` children, never both. A `Span` takes a string and has no children. `Text` wraps to the available width; `align` (`"start"`, `"center"`, or `"end"`) positions the lines within it. A positive `maxLines` truncates overflow with an ellipsis; zero or less leaves the line count unlimited. `lineHeight` sets the height of each line in logical pixels.
- **`Image`**: `src` is an image URL. On platforms without a built-in control for remote images, the core downloads the image.

### Dependency analysis

- A dependency consists of a root and a field path. The root is a component parameter, `state`, or a `for` variable, as in `model.user.name`, `expanded`, or `todo.name`.
  The path traverses only non-nullable `model` fields and stops at an array, a nullable type, a primitive type, or a built-in member such as `length`.
- Dirty bits: Component parameters and `state` are expanded to leaves by the rules above, with one bit per leaf. Each `for` also has a separate set of per-item dirty bits expanded according to the element type.
  A dependency covers every leaf for which it is a prefix. For example, passing `model.user` to a child component depends on every bit under `model.user`.
- Binding sites: Element properties, component arguments, `if` conditions (the union of the conditions across the `if / else if` chain), the `for` list and key, and event constructions with arguments (arguments are bound at render time).
  Values with no dependencies are static and do not generate bindings. Lambdas are evaluated when triggered and do not generate bindings either.
