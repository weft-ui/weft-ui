//! Mappings and diagnostics of `transform`, in the positions TypeScript reads.

use weft_ui_content_mapper::{PositionEncoding, SpanMapKind, SpanMapping, Transform, transform};
use weft_ui_parser::MemoryLoader;

/// Non-ASCII text ahead of every declaration shifts UTF-16 positions away
/// from byte offsets.
const MODELS: &str = "// 待办事项 😀
model Todo {
  id: Int,
  name: String,
}

event Remove(id: Int)
";

const APP: &str = "// 列表 😀
import \"./models.weft\"

model TodoCollection {
  todos: Todo[],
}

event Click

component App(list: TodoCollection, title: String = \"清单\") {
  Column {
    Text(title)
    Button(onClick = Click) { Text(\"+\") }
    for (todo in list.todos; key = todo.id) {
      Button(onClick = Remove(todo.id)) { Text(todo.name) }
    }
  }
}
";

fn utf16_slice(text: &str, start: u32, length: u32) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16(&units[start as usize..(start + length) as usize])
        .expect("mapping ends on character boundaries")
}

fn map(path: &str, content: &str) -> Transform {
    let mut loader = MemoryLoader::new();
    loader.insert("/src/models.weft", MODELS);
    loader.insert("/src/App.weft", APP);
    transform(path, content, &mut loader, PositionEncoding::Utf16)
}

/// `(virtual text, original text, kind)` of every mapping.
fn mapped<'a>(result: &'a Transform, original: &'a str) -> Vec<(String, String, SpanMapKind)> {
    result
        .mappings
        .iter()
        .map(|m: &SpanMapping| {
            (
                utf16_slice(&result.text, m.virtual_start, m.virtual_length),
                utf16_slice(original, m.original_start, m.original_length),
                m.kind,
            )
        })
        .collect()
}

#[test]
fn declaration_names_map_to_their_utf16_spans() {
    let result = map("/src/App.weft", APP);
    assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
    let mapped = mapped(&result, APP);
    for (virtual_text, original, kind) in &mapped {
        if *kind == SpanMapKind::Verbatim {
            assert_eq!(
                virtual_text, original,
                "verbatim mapping in\n{}",
                result.text
            );
        }
    }
    let pairs: Vec<(&str, &str, SpanMapKind)> = mapped
        .iter()
        .map(|(v, o, k)| (v.as_str(), o.as_str(), *k))
        .collect();
    assert_eq!(
        pairs,
        [
            ("TodoCollection", "TodoCollection", SpanMapKind::Verbatim),
            ("todos", "todos", SpanMapKind::Verbatim),
            ("Click", "Click", SpanMapKind::Verbatim),
            ("App", "App", SpanMapKind::Verbatim),
            ("list", "list", SpanMapKind::Verbatim),
            ("title", "title", SpanMapKind::Verbatim),
            // `Remove` is declared in models.weft, so its handler is unmapped.
            ("onClick", "Click", SpanMapKind::Atom),
        ],
        "{}",
        result.text
    );
    let starts: Vec<u32> = result.mappings.iter().map(|m| m.virtual_start).collect();
    assert!(starts.is_sorted(), "mappings are ordered: {starts:?}");
}

#[test]
fn imports_are_reexported_and_their_types_imported() {
    let result = map("/src/App.weft", APP);
    assert!(
        result.text.starts_with(
            "import type { Todo, Remove } from \"./models.weft\";\nexport * from \"./models.weft\";\n"
        ),
        "{}",
        result.text
    );
}

#[test]
fn errors_become_diagnostics_and_keep_the_imports() {
    let broken = APP.replace("todos: Todo[]", "todos: Missing[]");
    let result = map("/src/App.weft", &broken);
    assert_eq!(
        result.text,
        "export * from \"./models.weft\";\nexport {};\n"
    );
    assert!(result.mappings.is_empty());
    let [diagnostic] = result.diagnostics.as_slice() else {
        panic!("one diagnostic expected: {:?}", result.diagnostics);
    };
    assert_eq!(
        utf16_slice(&broken, diagnostic.start, diagnostic.length),
        "Missing",
        "{}",
        diagnostic.message
    );
}

#[test]
fn errors_of_imported_files_are_left_to_their_own_transform() {
    let mut loader = MemoryLoader::new();
    loader.insert(
        "/src/models.weft",
        MODELS.replace("name: String", "name: Strin"),
    );
    let result = transform("/src/App.weft", APP, &mut loader, PositionEncoding::Utf16);
    assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
    assert_eq!(
        result.text,
        "export * from \"./models.weft\";\nexport {};\n"
    );
}

#[test]
fn utf8_positions_are_byte_offsets() {
    let mut loader = MemoryLoader::new();
    loader.insert("/src/models.weft", MODELS);
    let result = transform("/src/App.weft", APP, &mut loader, PositionEncoding::Utf8);
    let todos = &result.mappings[1];
    let start = todos.original_start as usize;
    assert_eq!(&APP[start..start + todos.original_length as usize], "todos");
}
