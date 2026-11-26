//! M1: semantic analysis, dependency analysis and the view IR.

use weft_ui_parser::{MemoryLoader, load};
use weft_ui_transformer::ir::{
    BindingKind, EmitTarget, ExprKind, Handler, NodeKind, ParamId, PropValue, SlotRef, Stmt,
};
use weft_ui_transformer::{Compilation, check, dependency_report};

const DEMO: &str = include_str!("fixtures/TodoList.weft");

#[test]
fn pages_validate_routes_and_record_paths() {
    let compilation = compile(&[(
        "pages.weft",
        r#"
        model Note { title: String }
        type Source = "feed" | "search"
        page Detail(model: Note, id: String, from: Source = "feed", draft: Bool?) path "/notes/{id}" { }
        page UserProfile() { }
    "#,
    )]);
    assert!(
        compilation.diagnostics.is_empty(),
        "{:?}",
        compilation.diagnostics
    );
    let program = compilation.program.expect("valid pages produce a program");
    assert_eq!(
        program
            .component_named("Detail")
            .unwrap()
            .page
            .as_ref()
            .unwrap()
            .path,
        "/notes/{id}"
    );
    assert_eq!(
        program
            .component_named("UserProfile")
            .unwrap()
            .page
            .as_ref()
            .unwrap()
            .path,
        "/user-profile"
    );
}

#[test]
fn pages_reject_invalid_parameters_paths_calls_and_events() {
    let cases = [
        (
            "page Bad(x: Color) {}",
            "route parameter `x` must be Int, Float, Bool, String or a string literal union",
        ),
        (
            "page Bad(x: Children) {}",
            "route parameter `x` must be Int, Float, Bool, String or a string literal union",
        ),
        (
            "page Bad(x: Event) {}",
            "route parameter `x` must be Int, Float, Bool, String or a string literal union",
        ),
        (
            "model M {} page Bad(x: Int, model: M) {}",
            "the model parameter of page `Bad` must come first",
        ),
        ("page Bad() path \"bad\" {}", "invalid path segment `bad`"),
        ("page Bad() path \"/Bad\" {}", "invalid path segment `Bad`"),
        (
            "page Bad(id: String?) path \"/{id}\" {}",
            "`{id}` is not a required String, Int or union route parameter",
        ),
        (
            "page Bad(id: String) path \"/{id}/{id}\" {}",
            "`{id}` is not a required String, Int or union route parameter",
        ),
        (
            "page A(id: String) path \"/notes/{id}\" {} page B() path \"/notes/new\" {}",
            "paths of `A` and `B` overlap",
        ),
        (
            "page Detail() {} component Root() { Detail() }",
            "page `Detail` cannot be used as a component; open it with `navigation.push`",
        ),
        (
            "event Show() page Detail() { Button(onClick = Show) { Text(\"show\") } }",
            "event `Show` conflicts with the page method `onShow`",
        ),
    ];
    for (source, expected) in cases {
        let found = diagnostics(&[("pages.weft", source)]);
        assert!(
            found.iter().any(|d| d.contains(expected)),
            "{source}: {found:?}"
        );
    }
}

#[test]
fn apps_validate_start_pages_and_page_roots() {
    let cases = [
        (
            "app A { start = Home } app B { start = Home } page Home() {}",
            "duplicate app declaration",
        ),
        (
            "app A { start = Home } page Home(id: String) {}",
            "start page `Home` must not have required route parameters",
        ),
        (
            "app A { start = Home } component Home() {}",
            "start page `Home` must be a page",
        ),
        (
            "component Root() { NavBar() }",
            "`NavBar` must be the first top-level node of a page",
        ),
        (
            "page Home() { Text(\"a\") NavBar() }",
            "`NavBar` must be the first top-level node of a page",
        ),
        (
            "page Home() { if (true) { NavBar() } }",
            "`NavBar` must be the first top-level node of a page",
        ),
        (
            "page Home() { NavBar() NavBar() }",
            "`NavBar` must be the first top-level node of a page",
        ),
    ];
    for (source, expected) in cases {
        let found = diagnostics(&[("main.weft", source)]);
        assert!(
            found.iter().any(|d| d.contains(expected)),
            "{source}: {found:?}"
        );
    }
    let valid = compile(&[(
        "main.weft",
        "app A { start = Home } page Home() { NavBar(title = \"Home\") { BarButton(label = \"Back\") } }",
    )]);
    assert!(valid.diagnostics.is_empty(), "{:?}", valid.diagnostics);
    assert!(valid.program.expect("valid app").app.is_some());
}

#[test]
fn app_layout_and_platform_support() {
    use weft_ui_transformer::{compile_app, transform::Platform};
    let mut loader = MemoryLoader::new();
    loader.insert(
        "app.weft",
        "app Notes { start = Home } page Home() { NavBar(title = \"Home\") }",
    );
    let output = compile_app(
        load(&["app.weft"], &mut loader),
        Platform::Wechat,
        &Default::default(),
    );
    assert!(
        output.compilation.diagnostics.is_empty(),
        "{:?}",
        output.compilation.diagnostics
    );
    let layout = output.layout.expect("WeChat has a layout").to_json();
    assert!(layout.contains("\"app\": {\"start\": 0}"), "{layout}");
    let output = compile_app(
        load(&["app.weft"], &mut loader),
        Platform::Ios,
        &Default::default(),
    );
    assert!(
        output.compilation.diagnostics.is_empty(),
        "{:?}",
        output.compilation.diagnostics
    );
    let layout = output.layout.expect("iOS has a layout").to_json();
    assert!(layout.contains("\"app\": {\"start\": 0}"), "{layout}");
}

#[test]
fn app_start_can_be_in_a_transitive_import() {
    let compilation = compile(&[
        (
            "app.weft",
            "import \"middle.weft\" app Notes { start = Home }",
        ),
        ("middle.weft", "import \"home.weft\""),
        ("home.weft", "page Home() {}"),
    ]);
    assert!(
        compilation.diagnostics.is_empty(),
        "{:?}",
        compilation.diagnostics
    );
    assert!(compilation.program.expect("valid app").app.is_some());
}

#[test]
fn app_page_closure_rejects_unrelated_entry_pages() {
    let mut loader = MemoryLoader::new();
    loader.insert("app.weft", "app A { start = Home } page Home() {}");
    loader.insert("other.weft", "page Other() {}");
    let compilation = check(load(&["app.weft", "other.weft"], &mut loader));
    assert!(compilation.diagnostics.iter().any(|d| {
        d.message
            .contains("page `Other` is not in the import closure of app `A`")
    }));
}

fn compile(files: &[(&str, &str)]) -> Compilation {
    let mut loader = MemoryLoader::new();
    for (path, text) in files {
        loader.insert(path, *text);
    }
    check(load(&[files[0].0], &mut loader))
}

/// `path:line:col: message` for every diagnostic.
fn diagnostics(files: &[(&str, &str)]) -> Vec<String> {
    let compilation = compile(files);
    compilation
        .diagnostics
        .iter()
        .map(|d| {
            let file = compilation.sources.get(d.span.file);
            format!(
                "{}:{}: {}",
                file.path(),
                file.line_col(d.span.start),
                d.message
            )
        })
        .collect()
}

#[test]
fn controls_require_string_options_and_a_constant_divider_orientation() {
    let source = r#"
component Bad(options: Int[], vertical: Bool) {
    Picker(0, options = options)
    Divider(vertical = vertical)
}
"#;
    let errors = diagnostics(&[("controls.weft", source)]);
    assert_eq!(errors.len(), 2, "{errors:?}");
    assert!(
        errors[0].contains("String[]") && errors[0].contains("Int[]"),
        "{errors:?}"
    );
    assert!(
        errors[1].ends_with("`Divider.vertical` must be a constant"),
        "{errors:?}"
    );
}

#[test]
fn themes_are_unique_and_theme_is_a_reserved_binding() {
    let source = r##"theme { accent = "#fff" }
theme {}
component Param(theme: Int) {}
component State() {
  state theme = 0
}
component Let() {
  let theme = 0
}
component Loop(values: Int[]) {
  for (theme in values; key = 0) {}
}
component Lambda() {
  Input("", onChange = { theme -> })
}
component Unknown() {
  Text("x", color = theme.missing)
}
style Invalid { color = theme.other }
"##;
    assert_eq!(
        diagnostics(&[("theme.weft", source)]),
        [
            "theme.weft:2:1: duplicate theme declaration",
            "theme.weft:3:17: `theme` is reserved",
            "theme.weft:5:9: `theme` is reserved",
            "theme.weft:8:7: `theme` is reserved",
            "theme.weft:11:8: `theme` is reserved",
            "theme.weft:14:26: `theme` is reserved",
            "theme.weft:17:27: unknown theme token `missing`",
            "theme.weft:19:31: unknown theme token `other`",
        ]
    );
}

#[test]
fn tokens_require_a_direct_import_and_styles_resolve_in_their_declaration() {
    let invalid = r#"import "styles.weft"
component Screen() { Text("x", color = theme.accent) }"#;
    let valid = r#"import "styles.weft"
component Screen() { Text("x", style = Accent) }"#;
    let styles = r#"import "palette.weft"
style Accent { color = theme.accent, size = theme.size }"#;
    let palette = r##"theme { accent = "#fff", size = -4 }"##;
    assert_eq!(
        diagnostics(&[
            ("app.weft", invalid),
            ("styles.weft", styles),
            ("palette.weft", palette)
        ]),
        ["app.weft:2:46: `theme.accent` is declared in `palette.weft`, which is not imported here"]
    );
    assert!(
        diagnostics(&[
            ("app.weft", valid),
            ("styles.weft", styles),
            ("palette.weft", palette)
        ])
        .is_empty()
    );
}

#[test]
fn color_is_a_distinct_scalar_with_validated_literals() {
    let source = r##"theme { accent = "#fff" }
component Example(tint: Color, input: String) {
  let literal: Color = "blue"
  let valid: Color = input
  Text(theme.accent)
  Text("${tint}")
  if (tint == theme.accent) {}
  Text("typed", color = if (true) "#fff" else "blue")
}"##;
    assert_eq!(
        diagnostics(&[("color.weft", source)]),
        [
            "color.weft:3:24: invalid color `blue`: expected `#RGB`, `#RRGGBB` or `#RRGGBBAA`",
            "color.weft:5:8: mismatched types: expected `String`, found `Color`",
            "color.weft:6:11: cannot interpolate a value of type `Color`",
            "color.weft:7:7: cannot apply `==` to `Color` and `Color`",
            "color.weft:8:47: invalid color `blue`: expected `#RGB`, `#RRGGBB` or `#RRGGBBAA`",
        ]
    );

    let source = r##"theme { accent = "#0a84ff" dark "#409cff" }
type Tint = Color
model Model { tint: Tint }
event Pick(tint: Color)
component ColorPicker(onPick: Event<Color>) {
  Button(onClick = { onPick(theme.accent) }) { Text("Pick") }
}
component Screen(model: Model) {
  state tint: Color = "#123"
  Text("custom", color = model.tint)
  ColorPicker(onPick = { value -> tint = value; Pick(tint) })
}"##;
    assert!(diagnostics(&[("color.weft", source)]).is_empty());
}

#[test]
fn theme_colors_are_validated_in_both_appearances() {
    assert_eq!(
        diagnostics(&[("colors.weft", "theme { accent = \"light\" dark \"dark\" }")]),
        [
            "colors.weft:1:18: invalid color `light`: expected `#RGB`, `#RRGGBB` or `#RRGGBBAA`",
            "colors.weft:1:31: invalid color `dark`: expected `#RGB`, `#RRGGBB` or `#RRGGBBAA`",
        ]
    );
}

#[test]
fn styles_require_named_value_properties_and_built_in_elements() {
    let source = r#"style Bad { bogus = 7, value = "text", onClick = true }
style Card { gap = 8 }
component Custom() {}
component Screen() {
  Text("x", style = "Card")
  Text("x", style = Missing)
  Text("x", style = (Card))
  Text("x", style = Card)
  Custom(style = Card)
}"#;
    assert_eq!(
        diagnostics(&[("styles.weft", source)]),
        [
            "styles.weft:1:13: unknown style property `bogus`",
            "styles.weft:1:24: unknown style property `value`",
            "styles.weft:1:40: unknown style property `onClick`",
            "styles.weft:5:21: `style` expects a style name",
            "styles.weft:6:21: `style` expects a style name",
            "styles.weft:7:21: `style` expects a style name",
            "styles.weft:8:13: style `Card` sets `gap`, which `Text` does not accept",
            "styles.weft:9:10: `style` only applies to built-in elements",
        ]
    );
}

#[test]
fn style_values_must_be_literal() {
    let source = r#"style Invalid {
  size = 1 + 2
  color = "${name}"
  color = Other
  size = -(4)
}"#;
    assert_eq!(
        diagnostics(&[("styles.weft", source)]),
        [
            "styles.weft:2:10: style values must be literals or theme tokens",
            "styles.weft:3:11: style values must be literals or theme tokens",
            "styles.weft:4:11: style values must be literals or theme tokens",
            "styles.weft:5:10: style values must be literals or theme tokens",
        ]
    );
}

#[test]
fn remaining_style_values_are_checked_at_the_element_argument() {
    let app = r#"import "styles.weft"
component Screen() {
  Text("override", style = WrongType, size = 14)
  Text("wrong type", style = WrongType)
  Text("invalid color", style = WrongColor)
}"#;
    let styles = r#"style WrongType { size = false }
style WrongColor { color = "not a color" }"#;
    assert_eq!(
        diagnostics(&[("screen.weft", app), ("styles.weft", styles)]),
        [
            "screen.weft:4:22: mismatched types: expected `Int`, found `Bool`",
            "screen.weft:5:25: invalid color `not a color`: expected `#RGB`, `#RRGGBB` or `#RRGGBBAA`",
        ]
    );
}

#[test]
fn signed_style_values_lower_to_literals_without_bindings() {
    let source = "style Tight { gap = -3 }\ncomponent Screen() { Row(style = Tight) }";
    let compilation = compile(&[("style.weft", source)]);
    let program = compilation
        .program
        .as_ref()
        .unwrap_or_else(|| panic!("{}", compilation.render_diagnostics()));
    let screen = program.component_named("Screen").expect("Screen component");
    let NodeKind::Element { props, .. } = &screen.node(screen.roots[0]).kind else {
        panic!("expected a built-in element");
    };
    let [gap] = props.as_slice() else {
        panic!("expected only gap in the lowered properties");
    };
    assert_eq!(gap.name, "gap");
    assert!(gap.binding.is_none());
    let PropValue::Expr(value) = &gap.value else {
        panic!("expected a value property");
    };
    assert!(matches!(value.kind, ExprKind::Int(-3)));
}

#[test]
fn invalid_slot_fills_report_unknown_duplicate_and_misplaced_labels() {
    let source = r#"component Card(body: Children, title: String, header: Children) {
  Column { header Text(title) body }
}
component Label() { Text("label") }
component Screen() {
  Card("a") { title: {} }
  Card("b") { header: {} header: {} }
  Card("c") { body: {} Text("implicit body") }
  Card("d") { if (true) { header: {} } }
  Column { body: {} }
  Label { Text("body") }
}"#;
    assert_eq!(
        diagnostics(&[("slots.weft", source)]),
        [
            "slots.weft:6:15: `Card` has no slot `title`",
            "slots.weft:7:26: slot `header` is filled twice",
            "slots.weft:8:15: slot `body` is filled twice",
            "slots.weft:9:27: slot fill `header:` is only allowed directly inside a component call",
            "slots.weft:10:12: slot fill `body:` is only allowed directly inside a component call",
            "slots.weft:11:9: component `Label` does not accept children",
        ]
    );
}

#[test]
fn named_slots_keep_signature_indices_and_empty_fills() {
    let source = r#"component Card(body: Children, title: String, header: Children) {
  Column { header Text(title) body }
}
component Screen() {
  Card("a") {
    let shared = "shared"
    header: { let local = shared Text(local) }
    Text(shared)
    Text("second body node")
  }
  Card("b") { header: {} }
  Card("c") { body: {} }
}"#;
    let compilation = compile(&[("slots.weft", source)]);
    let program = compilation
        .program
        .as_ref()
        .unwrap_or_else(|| panic!("{}", compilation.render_diagnostics()));
    let screen = program.component_named("Screen").expect("Screen component");
    let slots = |i: usize| match &screen.node(screen.roots[i]).kind {
        NodeKind::Component { slots, .. } => slots.as_slice(),
        _ => panic!("expected a component call"),
    };
    let first = slots(0);
    assert_eq!(first.len(), 2);
    assert_eq!((first[0].param, first[0].children.len()), (ParamId(0), 2));
    assert_eq!((first[1].param, first[1].children.len()), (ParamId(2), 1));
    for (i, param) in [(1, ParamId(2)), (2, ParamId(0))] {
        assert_eq!(slots(i).len(), 1);
        assert_eq!(slots(i)[0].param, param);
        assert!(slots(i)[0].children.is_empty());
    }
}

#[test]
fn let_bindings_are_immutable_and_cannot_shadow_or_escape_their_scope() {
    let src = r#"component Shadow() {
  state name = "original"
  if (true) {
    let name = "shadow"
    Text(name)
  }
}
component Assignment() {
  let name = "fixed"
  Button(onClick = { name = "changed" }) { Text(name) }
}
component Scope() {
  if (true) {
    let name = "inner"
    Text(name)
  } else {
    Text(name)
  }
  Text(name)
}"#;
    assert_eq!(
        diagnostics(&[("let.weft", src)]),
        [
            "let.weft:4:9: `name` is already defined in this component",
            "let.weft:10:22: cannot assign to `name`: only `state` can be assigned",
            "let.weft:17:10: unknown name `name`",
            "let.weft:19:8: unknown name `name`",
        ]
    );
}

#[test]
fn let_types_and_order_are_checked_at_the_declaration() {
    let src = r#"type Kind = "text" | "image"
component Invalid() {
  let title: Kind = "invalid"
  let forward = later
  let later = "ok"
  Text(later)
}
component AfterState() {
  let title = "title"
  state count = 0
}
component AfterNode() {
  Text("first")
  let title = "too late"
}
component BuiltIn() {
  Column { let title = "title" Text(title) }
}"#;
    assert_eq!(
        diagnostics(&[("let.weft", src)]),
        [
            r#"let.weft:3:21: `"invalid"` is not a member of `"text" | "image"`"#,
            "let.weft:4:17: unknown name `later`",
            "let.weft:10:3: `state` must be declared before any `let`",
            "let.weft:14:3: `let` must be declared before any node",
            "let.weft:17:12: `let` cannot be declared directly inside a built-in element",
        ]
    );
}

#[test]
fn let_aliases_preserve_the_dependencies_of_inlined_expressions() {
    let src = r#"model Item { id: Int, name: String }
model Model { name: String, items: Item[] }
component Card(body: Children) { body }
component App(model: Model) {
  state selected = ""
  let title = "${model.name} (${model.items.length})"
  for (item in model.items; key = item.id) {
    let label: String = item.name.uppercase()
    Card {
      let caption = "${title}: ${label}"
      if (true) {
        let buttonText = "${caption} [${selected}]"
        Button(onClick = { selected = label }) { Text(buttonText) }
      }
    }
  }
}"#;
    let inlined = r#"model Item { id: Int, name: String }
model Model { name: String, items: Item[] }
component Card(body: Children) { body }
component App(model: Model) {
  state selected = ""
  for (item in model.items; key = item.id) {
    Card {
      if (true) {
        Button(onClick = { selected = item.name.uppercase() }) {
          Text("${"${model.name} (${model.items.length})"}: ${item.name.uppercase()} [${selected}]")
        }
      }
    }
  }
}"#;
    let report = |source| {
        let compilation = compile(&[("let.weft", source)]);
        let program = compilation
            .program
            .as_ref()
            .unwrap_or_else(|| panic!("{}", compilation.render_diagnostics()));
        dependency_report(program)
    };
    assert_eq!(report(src), report(inlined));
}

#[test]
fn unions_require_multiple_distinct_string_literals() {
    assert_eq!(
        diagnostics(&[("c.weft", r#"type Single = "a""#)]),
        ["c.weft:1:18: expected `|`, found end of file"]
    );
    assert_eq!(
        diagnostics(&[("c.weft", r#"type Kind = "text" | "\u{74}ext""#)]),
        [r#"c.weft:1:22: duplicate member `"text"` in union"#]
    );
    assert_eq!(
        diagnostics(&[("c.weft", r#"type Kind = "${value}" | "text""#)]),
        ["c.weft:1:13: union members cannot contain interpolation"]
    );
}

#[test]
fn unions_check_literals_in_assignments_branches_fallbacks_and_equality() {
    let src = r#"type Kind = "text" | "image"
component C(value: Kind, fallback: Kind?, plain: String) {
  state invalid: Kind = "other"
  state branches: Kind = if (true) "unknown" else "missing"
  state defaulted: Kind = fallback ?? "unknown"
  state converted: Kind = plain
  Text(if ("unknown" != value) "yes" else "no")
  Text(if (value == "missing") "yes" else "no")
}"#;
    assert_eq!(
        diagnostics(&[("c.weft", src)]),
        [
            r#"c.weft:3:25: `"other"` is not a member of `"text" | "image"`"#,
            r#"c.weft:4:36: `"unknown"` is not a member of `"text" | "image"`"#,
            r#"c.weft:4:51: `"missing"` is not a member of `"text" | "image"`"#,
            r#"c.weft:5:39: `"unknown"` is not a member of `"text" | "image"`"#,
            r#"c.weft:6:27: mismatched types: expected `"text" | "image"`, found `String`"#,
            r#"c.weft:7:12: `"unknown"` is not a member of `"text" | "image"`"#,
            r#"c.weft:8:21: `"missing"` is not a member of `"text" | "image"`"#,
        ]
    );
}

#[test]
fn union_assignment_is_directional_and_aliases_expand_across_files() {
    let library = r#"type Short = "image" | "text"
type Wide = "text" | "video" | "image"
type OptionalKind = Short?
type Name = String"#;
    let valid = r#"import "./library.weft"
component C(short: Short, fallback: OptionalKind, text: Name) {
  state wide: Wide = if (short == "text") short else fallback ?? "video"
  state narrow: Short = if (true || false) "text" else "image"
  Text(wide)
  Text(text + "${narrow}")
}"#;
    assert!(diagnostics(&[("c.weft", valid), ("library.weft", library)]).is_empty());

    let invalid = r#"import "./library.weft"
component C(wide: Wide) {
  state short: Short = wide
}"#;
    assert_eq!(
        diagnostics(&[("c.weft", invalid), ("library.weft", library)]),
        [
            r#"c.weft:3:24: mismatched types: expected `"image" | "text"`, found `"text" | "video" | "image"`"#
        ]
    );
}

#[test]
fn type_alias_cycles_report_the_reference_that_closes_the_cycle() {
    let src = "type First = Second[]\ntype Second = First?\ntype Self = Self";
    assert_eq!(
        diagnostics(&[("c.weft", src)]),
        [
            "c.weft:2:15: type alias `First` refers to itself",
            "c.weft:3:13: type alias `Self` refers to itself",
        ]
    );
}

#[test]
fn layout_reports_misplaced_spacers_and_invalid_property_values() {
    let src = r#"model M { x: "vertical" | "horizontal" }
component C(model: M) {
  Scroll(direction = model.x)
  Text("x") { Spacer() }
  Stack { Spacer() }
  Row(align = "middle")
}"#;
    assert_eq!(
        diagnostics(&[("layout.weft", src)]),
        [
            "layout.weft:3:22: `Scroll.direction` must be a constant",
            "layout.weft:4:8: `Text` takes either `value` or children, not both",
            "layout.weft:4:15: `Text` only accepts `Span` as children",
            "layout.weft:5:11: `Spacer` must be a direct child of `Column`, `Row` or `Scroll`",
            r#"layout.weft:6:15: `"middle"` is not a member of `"start" | "center" | "end" | "stretch"`"#,
        ]
    );
}

#[test]
fn text_requires_a_value_or_direct_spans() {
    let src = r#"component Label() { Text("label") }
component C(slot: Children, labels: String[]) {
  Text { Text("x") }
  Text("a") { Span("b") }
  Column { Span("x") }
  Text()
  Text {}
  Text { if (true) { Span("x") } }
  Text { for (label in labels; key = label) { Span(label) } }
  Text { Label() }
  Text { slot }
  Text("valid")
  Text { Span("also valid") }
}"#;
    assert_eq!(
        diagnostics(&[("typography.weft", src)]),
        [
            "typography.weft:3:10: `Text` only accepts `Span` as children",
            "typography.weft:4:8: `Text` takes either `value` or children, not both",
            "typography.weft:5:12: `Span` must be a direct child of `Text`",
            "typography.weft:6:3: missing argument `value` for `Text`",
            "typography.weft:7:3: missing argument `value` for `Text`",
            "typography.weft:8:10: `Text` only accepts `Span` as children",
            "typography.weft:9:10: `Text` only accepts `Span` as children",
            "typography.weft:10:10: `Text` only accepts `Span` as children",
            "typography.weft:11:10: `Text` only accepts `Span` as children",
        ]
    );
}

#[test]
fn layout_constant_and_parent_checks_do_not_cross_dynamic_blocks() {
    let src = r#"type Axis = "vertical" | "horizontal"
component Wrapper(content: Children) { Row { content } }
component C(axis: Axis, axes: Axis[]) {
  state local: Axis = "vertical"
  let aliased = axis
  Spacer()
  Scroll(direction = aliased)
  Scroll(direction = local)
  Column {
    if (true) { Spacer() }
    for (item in axes; key = item) {
      Spacer()
      Scroll(direction = item)
    }
    Wrapper { Spacer() }
  }
}"#;
    let compilation = compile(&[("layout.weft", src)]);
    let actual: Vec<_> = compilation
        .diagnostics
        .iter()
        .map(|d| d.message.as_str())
        .collect();
    let parent = "`Spacer` must be a direct child of `Column`, `Row` or `Scroll`";
    let constant = "`Scroll.direction` must be a constant";
    assert_eq!(
        actual,
        [parent, constant, constant, parent, parent, constant, parent]
    );
}

#[test]
fn layout_stores_float_and_union_properties_in_their_wire_types() {
    use weft_ui_transformer::view::{Constant, ValueType, ViewLayout, ViewNodeKind};

    let src = r#"type Axis = "vertical" | "horizontal"
component C(amount: Float, align: "center" | "end") {
  let unset: Axis? = null
  let axis: Axis = if (!false) "horizontal" else "vertical"
  Scroll(direction = unset ?? axis) {
    Row(grow = amount, align = align) {
      Text("int", grow = 2)
      Text("float", aspectRatio = 1.5)
      Text("negative", grow = -0.5)
      Spacer()
    }
  }
}"#;
    let compilation = compile(&[("layout.weft", src)]);
    assert!(
        compilation.diagnostics.is_empty(),
        "{}",
        compilation.render_diagnostics()
    );
    let layout = ViewLayout::new(compilation.program.as_ref().expect("layout props compile"));
    let template = &layout.templates()[0];
    let slots: Vec<_> = template
        .values
        .iter()
        .map(|slot| (slot.prop, slot.ty))
        .collect();
    assert_eq!(
        slots,
        [("grow", ValueType::Float), ("align", ValueType::String)]
    );
    let constants: Vec<_> = template
        .nodes
        .iter()
        .filter_map(|node| match &node.kind {
            ViewNodeKind::Element { props, .. } => Some(props),
            ViewNodeKind::Point(_) => None,
        })
        .flatten()
        .filter(|prop| prop.name != "value")
        .map(|prop| (prop.name, &prop.value))
        .collect();
    assert_eq!(
        constants,
        [
            ("direction", &Constant::String("horizontal".into())),
            ("grow", &Constant::Float(2.0)),
            ("aspectRatio", &Constant::Float(1.5)),
            ("grow", &Constant::Float(-0.5)),
        ]
    );
    let json = layout.to_json();
    assert!(json.contains("\"type\": \"Float\""));
    assert!(json.contains("\"grow\": 2.0"));
    assert!(json.contains("\"aspectRatio\": 1.5"));
    assert!(json.contains("\"direction\": \"horizontal\""));
}

#[test]
fn layout_rejects_nonfinite_float_literals_before_serializing() {
    let src = "component C() { Row(grow = -1e999) }";
    assert_eq!(
        diagnostics(&[("layout.weft", src)]),
        ["layout.weft:1:29: floating-point literal is out of range for `Float`"]
    );
}

#[test]
fn color_literals_accept_hex_formats() {
    let src = r##"
component C() {
  Column(background = "#aBc") {
    Row(background = "#AABBCCdd") {
      Text("x", color = "#012345")
    }
  }
}
"##;
    assert_eq!(diagnostics(&[("c.weft", src)]), Vec::<String>::new());
}

#[test]
fn invalid_color_literals_report_the_value_span() {
    let src = r#"component C() {
  Column(background = "red") {
    Text("x", color = "gray")
  }
}"#;
    assert_eq!(
        diagnostics(&[("c.weft", src)]),
        [
            "c.weft:2:23: invalid color `red`: expected `#RGB`, `#RRGGBB` or `#RRGGBBAA`",
            "c.weft:3:23: invalid color `gray`: expected `#RGB`, `#RRGGBB` or `#RRGGBBAA`",
        ]
    );
}

#[test]
fn dynamic_colors_accept_strings_without_literal_validation() {
    let src = r#"
component C(color: String) {
  Column(background = color) { Text("x", color = color) }
}
"#;
    assert_eq!(diagnostics(&[("c.weft", src)]), Vec::<String>::new());
}

#[test]
fn layout_preserves_color_property_types_and_normalizes_constants() {
    use weft_ui_transformer::color::Color;
    use weft_ui_transformer::view::{Constant, ValueType, ViewLayout, ViewNodeKind};

    let src = r##"
component C(color: String) {
  Column(background = "#AbC") {
    Text("x", color = color)
    Text("y", color = "#AABBCC80")
  }
}
"##;
    let compilation = compile(&[("c.weft", src)]);
    let program = compilation
        .program
        .as_ref()
        .expect("valid color props compile");
    let layout = ViewLayout::new(program);
    let template = &layout.templates()[0];
    assert_eq!(template.values.len(), 1);
    assert_eq!(template.values[0].prop, "color");
    assert_eq!(template.values[0].ty, ValueType::Color);
    let constants: Vec<&Constant> = template
        .nodes
        .iter()
        .filter_map(|node| match &node.kind {
            ViewNodeKind::Element { props, .. } => Some(props),
            ViewNodeKind::Point(_) => None,
        })
        .flatten()
        .filter(|prop| matches!(prop.name, "background" | "color"))
        .map(|prop| &prop.value)
        .collect();
    assert_eq!(
        constants,
        [
            &Constant::Color(Color {
                r: 170,
                g: 187,
                b: 204,
                a: 255
            }),
            &Constant::Color(Color {
                r: 170,
                g: 187,
                b: 204,
                a: 128
            }),
        ]
    );
    assert_eq!(constants[0].to_string(), "\"#aabbcc\"");
    assert_eq!(constants[1].to_string(), "\"#aabbcc80\"");
    assert!(layout.to_json().contains("\"type\": \"Color\""));
}

#[test]
fn color_properties_reject_numbers_and_booleans() {
    let src = r#"component C() {
  Column(background = 1) {
    Text("x", color = false)
  }
}"#;
    assert_eq!(
        diagnostics(&[("c.weft", src)]),
        [
            "c.weft:2:23: mismatched types: expected `Color`, found `Int`",
            "c.weft:3:23: mismatched types: expected `Color`, found `Bool`",
        ]
    );
}

#[test]
fn demo_dependency_report() {
    let compilation = compile(&[("ui/TodoList.weft", DEMO)]);
    let program = compilation
        .program
        .as_ref()
        .unwrap_or_else(|| panic!("{}", compilation.render_diagnostics()));
    let expected = "\
component TodoList(model: TodoListModel)
  slots:
    #0     model.todos
    #1     model.draft
    #2     expanded
  loop todo: Todo
    todo#0 todo.id
    todo#1 todo.name
  bindings:
    b0   Column > Input                         value      model.draft  #1
    b1   Column > Button > Text                 value      expanded     #2
    b2   Column > if                            condition  expanded     #2
    b3   Column > if > for todo                 list       model.todos  #0
    b4   Column > if > for todo                 key        todo.id      todo#0
    b5   Column > if > for todo > Row > Text    value      todo.name    todo#1
    b6   Column > if > for todo > Row > Button  onClick    todo.id      todo#0
  emits: TextChanged, Remove
";
    assert_eq!(dependency_report(program), expected);
}

#[test]
fn demo_handlers_lower_to_emits_and_state_writes() {
    let compilation = compile(&[("TodoList.weft", DEMO)]);
    let program = compilation.program.expect("demo compiles");
    let list = program
        .component_named("TodoList")
        .expect("component exists");
    let handlers: Vec<&Handler> = list
        .nodes
        .iter()
        .filter_map(|n| match &n.kind {
            NodeKind::Element { props, .. } => Some(props),
            _ => None,
        })
        .flatten()
        .filter_map(|p| match &p.value {
            PropValue::Handler(h) => Some(h),
            PropValue::Expr(_) => None,
        })
        .collect();
    let summary: Vec<String> = handlers
        .iter()
        .map(|h| match h {
            Handler::Emit {
                target: EmitTarget::Event(event),
                args,
            } => {
                format!("emit {} ({} args)", program.event(*event).name, args.len())
            }
            Handler::Emit {
                target: EmitTarget::Callback(_),
                ..
            } => {
                panic!("demo does not declare callbacks");
            }
            Handler::Lambda { body, .. } => {
                let states: Vec<&str> = body
                    .iter()
                    .map(|stmt| match stmt {
                        Stmt::Assign(a) => list.states[a.state.index()].name.as_str(),
                        Stmt::Emit { .. } => panic!("demo lambda only assigns state"),
                    })
                    .collect();
                format!("set {}", states.join(","))
            }
        })
        .collect();
    assert_eq!(
        summary,
        [
            "emit TextChanged (1 args)",
            "set expanded",
            "emit Remove (1 args)"
        ]
    );
}

#[test]
fn nested_model_paths_get_their_own_bits() {
    let src = "
model User { name: String, age: Int }
model Page { user: User, title: String }

component Badge(user: User) { Text(user.name) }

component Profile(page: Page) {
  Column {
    Text(page.user.name)
    Text(\"${page.title} (${page.user.age})\")
    Badge(page.user)
  }
}
";
    let compilation = compile(&[("profile.weft", src)]);
    let program = compilation
        .program
        .as_ref()
        .unwrap_or_else(|| panic!("{}", compilation.render_diagnostics()));
    let profile = program
        .component_named("Profile")
        .expect("component exists");
    let bits: Vec<(BindingKind, Vec<SlotRef>)> = profile
        .bindings
        .iter()
        .map(|b| (b.kind, b.bits.clone()))
        .collect();
    // Slots: #0 page.user.name, #1 page.user.age, #2 page.title.
    assert_eq!(
        bits,
        [
            (BindingKind::Prop("value"), vec![SlotRef::Component(0)]),
            (
                BindingKind::Prop("value"),
                vec![SlotRef::Component(1), SlotRef::Component(2)]
            ),
            (
                BindingKind::Arg(ParamId(0)),
                vec![SlotRef::Component(0), SlotRef::Component(1)]
            ),
        ]
    );
}

#[test]
fn view_cannot_assign_model_or_skip_keys() {
    let src = "
model M { items: String[], count: Int }
component C(model: M) {
  state open = false
  Column {
    Button(onClick = { model = model; open = 1 }) { Text(\"x\") }
    for (item in model.items) { Text(item) }
    Text(model.count)
  }
}
";
    assert_eq!(
        diagnostics(&[("c.weft", src)]),
        [
            "c.weft:6:24: cannot assign to parameter `model`",
            "c.weft:6:46: mismatched types: expected `Bool`, found `Int`",
            "c.weft:7:5: `for` requires a key",
            "c.weft:8:10: mismatched types: expected `String`, found `Int`",
        ]
    );
}

#[test]
fn event_handler_shapes_are_checked() {
    let src = "
event Remove(id: Int)
event Loaded
component C() {
  Column(onMount = Loaded) {
    Button(onClick = Remove) { Text(\"a\") }
    Input(\"\", onChange = Remove)
    Input(\"\", onChange = { v -> v = \"\" })
    Button(onClick = Remove(\"x\")) { Text(\"b\") }
    Text(\"c\", onUnmount = { })
  }
}
";
    assert_eq!(
        diagnostics(&[("c.weft", src)]),
        [
            "c.weft:6:22: event `Remove` takes 1 argument, but `onClick` provides no value",
            "c.weft:7:26: `onChange` provides a `String`, but event `Remove` expects `Int`",
            "c.weft:8:33: cannot assign to lambda parameter `v`",
            "c.weft:9:29: mismatched types: expected `Int`, found `String`",
            "c.weft:10:27: `onUnmount` only accepts an event, not a lambda",
        ]
    );
}

#[test]
fn callback_parameter_types_and_payloads_are_checked() {
    let src = r#"
model M { callback: Event }
event Wrong(value: String)
component Choice(onSelect: Event<Int>) {}
component C(onClose: Event = null, onChoose: Event<Int>) {
  Choice(onSelect = Wrong)
  Input("", onChange = onChoose)
}
"#;
    assert_eq!(
        diagnostics(&[("c.weft", src)]),
        [
            "c.weft:2:21: `Event` is only allowed as a component parameter type",
            "c.weft:5:30: callback parameter `onClose` cannot have a default value",
            "c.weft:6:21: `onSelect` provides a `Int`, but event `Wrong` expects `String`",
            "c.weft:7:24: `onChange` provides a `String`, but callback `onChoose` expects `Int`",
        ]
    );
}

#[test]
fn callbacks_have_no_dirty_slots_but_their_bound_arguments_do() {
    let src = r#"
event Selected(value: Int)
component Choice(onSelect: Event<Int>, value: Int) {
  Button(onClick = onSelect(value)) {}
}
component C(value: Int) {
  Choice(onSelect = Selected(value), value = 1)
}
"#;
    let compilation = compile(&[("c.weft", src)]);
    let program = compilation
        .program
        .as_ref()
        .unwrap_or_else(|| panic!("{}", compilation.render_diagnostics()));
    let choice = program
        .component_named("Choice")
        .expect("choice component exists");
    assert_eq!(choice.slots.len(), 1);
    assert_eq!(choice.bindings[0].bits, [SlotRef::Component(0)]);
    assert!(choice.emits.is_empty());
    let caller = program
        .component_named("C")
        .expect("caller component exists");
    assert_eq!(caller.bindings[0].kind, BindingKind::Arg(ParamId(0)));
    assert_eq!(caller.bindings[0].bits, [SlotRef::Component(0)]);
    assert_eq!(caller.emits.len(), 1);
    assert_eq!(program.event(caller.emits[0]).name, "Selected");
}

#[test]
fn imports_are_scoped_and_share_one_namespace() {
    let app = "
import \"./widgets/button.weft\"
component App(user: User) { Fancy() }
";
    let button = "
import \"../models.weft\"
component Fancy() { Text(\"hi\") }
model Todo { id: Int }
";
    let models = "
model User { name: String }
model Todo { id: Int }
";
    assert_eq!(
        diagnostics(&[
            ("ui/app.weft", app),
            ("ui/widgets/button.weft", button),
            ("ui/models.weft", models),
        ]),
        [
            "ui/app.weft:3:21: `User` is declared in `ui/models.weft`, which is not imported here",
            "ui/models.weft:3:7: `Todo` is declared more than once",
        ]
    );
}

#[test]
fn events_with_clashing_handler_names_are_rejected() {
    let src = "
event FooBar
event foo_bar(id: Int)
event Other
";
    assert_eq!(
        diagnostics(&[("app.weft", src)]),
        ["app.weft:3:7: event `foo_bar` clashes with event `FooBar` in host bindings"]
    );
}

#[test]
fn import_cycles_and_missing_modules_are_reported() {
    let a = "import \"b.weft\"\nimport \"missing.weft\"\n";
    let b = "import \"a.weft\"\n";
    assert_eq!(
        diagnostics(&[("a.weft", a), ("b.weft", b)]),
        [
            "a.weft:2:8: cannot load module `missing.weft`: no such module `missing.weft`",
            "b.weft:1:1: import cycle",
        ]
    );
}

#[test]
fn unguarded_recursion_and_recursive_models_are_rejected() {
    let src = "
model Node { label: String, next: Node, children: Node[] }
model Tree { root: Node?, children: Tree[] }
component Loop(n: Int) { Loop(n) }
component Ok(tree: Tree) {
  for (child in tree.children; key = child.children.length) { Ok(child) }
}
";
    assert_eq!(
        diagnostics(&[("r.weft", src)]),
        [
            "r.weft:2:29: recursive model has infinite size: Node -> Node",
            "r.weft:4:26: component renders itself unconditionally: Loop -> Loop",
        ]
    );
}

#[test]
fn expressions_are_type_checked() {
    let src = "
model U { name: String?, score: Float, tags: String[] }
component C(u: U) {
  state n: Int? = null
  Column {
    Text(u.name ?? \"anon\")
    Text(u.name.length.toString())
    Text(\"${u.score + 1} ${u.tags.contains(\"a\")} ${n ?? 0}\")
    Text(u.tags)
    Text(if (u.tags.isEmpty) \"none\" else u.tags.length)
    Text(u.name?.trim() ?? u.tags.length)
  }
}
";
    assert_eq!(
        diagnostics(&[("c.weft", src)]),
        [
            "c.weft:7:17: value of type `String?` may be null; use `?.length`",
            "c.weft:9:10: mismatched types: expected `String`, found `String[]`",
            "c.weft:10:10: `if` branches have different types: `String` and `Int`",
            "c.weft:11:28: mismatched types: expected `String`, found `Int`",
        ]
    );
}

#[test]
fn app_programs_share_imports_and_names() {
    let mut loader = MemoryLoader::new();
    loader.insert("m.weft", "model M { name: String }");
    loader.insert(
        "a.weft",
        "import \"./m.weft\"\ncomponent A(m: M) { Text(m.name) }",
    );
    loader.insert(
        "b.weft",
        "import \"./m.weft\"\ncomponent B(m: M) { Text(m.name) }",
    );
    loader.insert("c.weft", "component A() { Text(\"c\") }");

    let app = check(load(&["a.weft", "b.weft", "./a.weft"], &mut loader));
    let program = app
        .program
        .as_ref()
        .unwrap_or_else(|| panic!("{}", app.render_diagnostics()));
    let paths: Vec<&str> = program.modules.iter().map(|m| m.path.as_str()).collect();
    assert_eq!(paths, ["a.weft", "b.weft", "m.weft"]);
    let entries: Vec<&str> = program
        .entries
        .iter()
        .map(|&file| program.module(file).path.as_str())
        .collect();
    assert_eq!(entries, ["a.weft", "b.weft"]);

    let clash = check(load(&["a.weft", "c.weft"], &mut loader));
    assert!(clash.program.is_none());
    let messages: Vec<&str> = clash
        .diagnostics
        .iter()
        .map(|d| d.message.as_str())
        .collect();
    assert_eq!(messages, ["`A` is declared more than once"]);
}

#[test]
fn cyclic_models_in_params_state_and_loops_do_not_overflow() {
    let src = r#"
model SelfRef { next: SelfRef }
model A { b: B }
model B { a: A }
component C(p: SelfRef, items: A[]) {
    state s: B = p
    for (item in items; key = item) {
        Text("ok")
    }
}
"#;
    let diags = diagnostics(&[("cycle.weft", src)]);
    assert!(
        diags
            .iter()
            .any(|d| d.contains("recursive model has infinite size")),
        "{diags:#?}"
    );
}

#[test]
fn null_coalesce_and_component_style_param_compile() {
    let src = r#"
component Card(style: String) {
    Text(style)
}
component App() {
    let s = null ?? "x"
    let n = null ?? 42
    let opt: String? = null ?? null
    Column {
        Text(s)
        Text("${n}")
        Text(opt ?? "empty")
        Card(style = "custom")
    }
}
"#;
    assert_eq!(diagnostics(&[("ok.weft", src)]), Vec::<String>::new());

    let err = r#"
component Plain(title: String) { Text(title) }
component App() { Plain("hi", style = "x") }
"#;
    assert!(
        diagnostics(&[("err.weft", err)])
            .iter()
            .any(|d| d.contains("`style` only applies to built-in elements"))
    );
}

#[test]
fn model_and_param_names_avoid_generated_host_collisions() {
    use weft_ui_transformer::AppOptions;
    use weft_ui_transformer::transform::Platform;

    let src = r#"
model v { value: String, toJSON: String }
model p0 { item: v }
component App(m: p0) {
    Text(m.item.value)
}
"#;
    let mut loader = MemoryLoader::new();
    loader.insert("host.weft", src);
    let output = weft_ui_transformer::compile_app(
        load(&["host.weft"], &mut loader),
        Platform::Web,
        &AppOptions::default(),
    );
    assert!(
        !output.compilation.has_errors(),
        "{}",
        output.compilation.render_diagnostics()
    );
    let js = &output.logic[0].code;
    assert!(
        js.contains("static from($v) { return $v instanceof v ? $v : new v($v); }"),
        "{js}"
    );
    assert!(
        js.contains("constructor($p0) { super(App$c, [p0.from($p0)]); }"),
        "{js}"
    );
    let (v_class, p0_class) = js.split_once("export class p0").expect("p0 class");
    assert!(!v_class.contains("\n  toJSON() {"), "{v_class}");
    assert!(p0_class.contains("\n  toJSON() {"), "{p0_class}");
}
