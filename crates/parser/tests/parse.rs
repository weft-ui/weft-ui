//! M0: the Demo parses, and syntax errors are reported with positions.

use weft_ui_ast::{FileId, Item, NodeKind, SourceMap, diagnostic};
use weft_ui_parser::parse;

const DEMO: &str = include_str!("../../transformer/tests/fixtures/TodoList.weft");

#[test]
fn demo_parses_without_diagnostics() {
    let (file, diags) = parse(FileId(0), DEMO);
    assert!(diags.is_empty(), "{diags:#?}");
    let names: Vec<&str> = file
        .items
        .iter()
        .map(|i| i.name().expect("named fixture item").name.as_str())
        .collect();
    assert_eq!(
        names,
        ["Todo", "TodoListModel", "TextChanged", "Remove", "TodoList"]
    );

    let Some(Item::Component(list)) = file.items.last() else {
        panic!("last item is the TodoList component");
    };
    assert_eq!(
        list.params[0].name.name, "model",
        "`model` is usable as a parameter name"
    );
    assert_eq!(list.states[0].name.name, "expanded");
    let NodeKind::Element(column) = &list.body[0].kind else {
        panic!("root is an element");
    };
    let children = &column.children.as_ref().expect("Column has a block").nodes;
    assert!(matches!(children[2].kind, NodeKind::If(_)));
}

#[test]
fn pages_preserve_paths_and_recover_at_declarations() {
    let source = r#"page Detail(id: String) path "/notes/{id}" { state n = 1 let x = id Text(x) }
page About() {}
page Broken() path "${id}" {}
component Broken(
app Example { start = About }
page Recovered() {}"#;
    let (file, diagnostics) = parse(FileId(0), source);
    let Item::Page(detail) = &file.items[0] else {
        panic!("expected page")
    };
    let (path, span) = detail.path.as_ref().expect("explicit path");
    assert_eq!(path, "/notes/{id}");
    assert_eq!(
        &source[span.start as usize..span.end as usize],
        "\"/notes/{id}\""
    );
    assert_eq!(detail.component.states.len(), 1);
    assert_eq!(detail.component.lets.len(), 1);
    assert!(matches!(&file.items[1], Item::Page(page) if page.path.is_none()));
    assert!(
        diagnostics
            .iter()
            .any(|d| d.message.contains("page path cannot contain interpolation"))
    );
    assert!(
        file.items
            .iter()
            .any(|item| item.name().is_some_and(|name| name.name == "Recovered"))
    );
}

#[test]
fn app_preserves_start_page() {
    let (file, diagnostics) = parse(FileId(0), "app Notes { start = Home } page Home() {}");
    assert!(diagnostics.is_empty(), "{diagnostics:?}");
    let Item::App(app) = &file.items[0] else {
        panic!("expected app")
    };
    assert_eq!(app.name.name, "Notes");
    assert_eq!(app.start.name, "Home");
}

#[test]
fn named_slot_fill_has_a_label_and_child_block() {
    let input = r#"component Screen() { Card { header: { let title = "Hi" Text(title) } } }"#;
    let (file, diagnostics) = parse(FileId(0), input);
    assert!(diagnostics.is_empty(), "{diagnostics:#?}");
    let Item::Component(screen) = &file.items[0] else {
        panic!("expected Screen component");
    };
    let NodeKind::Element(card) = &screen.body[0].kind else {
        panic!("expected Card call");
    };
    let block = card.children.as_ref().expect("Card has a block");
    let NodeKind::SlotFill(header) = &block.nodes[0].kind else {
        panic!("expected named slot fill");
    };
    assert_eq!(header.name.name, "header");
    assert_eq!(header.span, block.nodes[0].span);
    assert_eq!(header.block.lets[0].name.name, "title");
    assert!(matches!(header.block.nodes[0].kind, NodeKind::Element(_)));
}

fn render(src: &str) -> String {
    let mut sources = SourceMap::new();
    let id = sources.add("broken.weft".into(), src.into());
    let (_, diags) = parse(id, src);
    diagnostic::render_all(&diags, &sources)
}

#[test]
fn syntax_errors_point_at_source_locations() {
    let src = "\
model Todo {
  id: Int
  name: String,
}

component List(items: Todo[]) {
  Column {
    Text(\"count: ${items.length\")
    Button(onClick = ) { Text(\"x\") }
  }
}
";
    let expected = "\
error: expected `,` or `}`, found identifier
 --> broken.weft:3:3
  |
3 |   name: String,
  |   ^^^^

error: unterminated string literal
 --> broken.weft:8:10
  |
8 |     Text(\"count: ${items.length\")
  |          ^ string starts here

error: expected `,` or `)`, found identifier
 --> broken.weft:9:5
  |
9 |     Button(onClick = ) { Text(\"x\") }
  |     ^^^^^^

error: expected `)`, found `}`
  --> broken.weft:10:3
   |
10 |   }
   |   ^
";
    assert_eq!(render(src), expected);
}

#[test]
fn recovery_reports_errors_in_later_items() {
    let src = "\
component A() {
  Button(onClick = ) { Text(\"x\") }
  state late = 1
}
event E(id: Int id2)
";
    let rendered = render(src);
    let locations: Vec<&str> = rendered
        .lines()
        .filter_map(|l| l.trim_start().strip_prefix("--> "))
        .collect();
    assert_eq!(
        locations,
        ["broken.weft:2:20", "broken.weft:3:3", "broken.weft:5:17"],
        "{rendered}"
    );
}
