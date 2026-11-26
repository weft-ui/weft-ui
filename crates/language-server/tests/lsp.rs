//! Drives the server over an in-memory connection like an editor would.

use std::path::PathBuf;
use std::thread;

use lsp_server::{Connection, Message, Notification, Request, RequestId};
use serde_json::{Value, json};
use url::Url;

struct Client {
    connection: Connection,
    next_id: i32,
    notifications: Vec<Notification>,
}

impl Client {
    fn request(&mut self, method: &str, params: Value) -> Value {
        self.next_id += 1;
        let id = RequestId::from(self.next_id);
        self.connection
            .sender
            .send(Message::Request(Request::new(
                id.clone(),
                method.to_owned(),
                params,
            )))
            .expect("server is running");
        loop {
            match self.connection.receiver.recv().expect("server responds") {
                Message::Response(response) if response.id == id => {
                    return response
                        .response_result
                        .unwrap_or_else(|e| panic!("{method}: {}", e.message));
                }
                Message::Notification(n) => self.notifications.push(n),
                _ => {}
            }
        }
    }

    fn notify(&mut self, method: &str, params: Value) {
        self.connection
            .sender
            .send(Message::Notification(Notification::new(
                method.to_owned(),
                params,
            )))
            .expect("server is running");
    }

    /// Waits for the diagnostics published for `uri` after the last change.
    fn diagnostics(&mut self, uri: &str) -> Vec<Value> {
        // A request round trip guarantees earlier notifications have arrived.
        self.request("textDocument/hover", position(uri, 0, 0));
        let published = self
            .notifications
            .drain(..)
            .filter(|n| n.method == "textDocument/publishDiagnostics")
            .rfind(|n| n.params["uri"] == uri)
            .expect("diagnostics were published");
        published.params["diagnostics"]
            .as_array()
            .expect("array")
            .clone()
    }
}

fn position(uri: &str, line: u32, character: u32) -> Value {
    json!({ "textDocument": { "uri": uri }, "position": { "line": line, "character": character } })
}

/// Line and UTF-16 column of the end of the first `needle` in `text`.
fn after(text: &str, needle: &str) -> (u32, u32) {
    let end = text.find(needle).expect("needle") + needle.len();
    let line = text[..end].matches('\n').count();
    let column = text[..end]
        .rsplit('\n')
        .next()
        .expect("line")
        .encode_utf16()
        .count();
    (line as u32, column as u32)
}

fn labels(completion: &Value) -> Vec<String> {
    completion
        .as_array()
        .expect("completion list")
        .iter()
        .map(|item| item["label"].as_str().expect("label").to_owned())
        .collect()
}

const MODELS: &str =
    "model Todo {\n    id: Int,\n    name: String,\n}\n\nmodel Model {\n    todos: Todo[],\n}\n";

#[test]
fn editor_session() {
    let dir: PathBuf = std::env::temp_dir().join(format!("weft-lsp-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    // Only the importing file is opened; the imported one is read from disk.
    std::fs::write(dir.join("models.weft"), MODELS).expect("write models");
    let app_path = dir.join("app.weft");
    let uri = Url::from_file_path(&app_path)
        .expect("absolute path")
        .to_string();
    let models_uri = Url::from_file_path(dir.join("models.weft"))
        .expect("absolute path")
        .to_string();

    let (server, client) = Connection::memory();
    let handle =
        thread::spawn(move || weft_ui_language_server::serve(&server).expect("server runs"));
    let mut client = Client {
        connection: client,
        next_id: 0,
        notifications: Vec::new(),
    };
    let init = client.request(
        "initialize",
        json!({ "capabilities": { "textDocument": { "completion": { "completionItem": { "snippetSupport": true } } } } }),
    );
    assert_eq!(init["capabilities"]["documentFormattingProvider"], true);
    client.notify("initialized", json!({}));

    let broken =
        "import \"./models.weft\"\ncomponent App(model: Model) {\n    Text(model.count)\n}\n";
    client.notify(
        "textDocument/didOpen",
        json!({ "textDocument": { "uri": uri, "languageId": "weft", "version": 1, "text": broken } }),
    );
    let diagnostics = client.diagnostics(&uri);
    assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
    assert_eq!(
        diagnostics[0]["message"],
        "model `Model` has no field `count`"
    );
    assert_eq!(
        diagnostics[0]["range"]["start"],
        json!({ "line": 2, "character": 15 })
    );

    let app = "import \"./models.weft\"\ncomponent App(model: Model) {\n  state draft = \"\"\n  Column {\n    for (todo in model.todos; key = todo.id) { Text(todo.name, color = \"#fff\") }\n  }\n}\n";
    client.notify(
        "textDocument/didChange",
        json!({ "textDocument": { "uri": uri, "version": 2 }, "contentChanges": [{ "text": app }] }),
    );
    assert_eq!(client.diagnostics(&uri), Vec::<Value>::new());

    // Hover shows the field's signature.
    let (line, col) = after(app, "todo.na");
    let hover = client.request("textDocument/hover", position(&uri, line, col));
    assert_eq!(
        hover["contents"]["value"],
        "```weft\nTodo.name: String\n```"
    );

    // The model type is defined in the imported file.
    let (line, col) = after(app, "model: Mo");
    let definition = client.request("textDocument/definition", position(&uri, line, col));
    assert_eq!(definition["uri"], models_uri);
    assert_eq!(
        definition["range"]["start"],
        json!({ "line": 5, "character": 6 })
    );

    // Member completion after `.`, even though `todo.` alone does not parse.
    let typing = app.replace("Text(todo.name,", "Text(todo.,");
    client.notify(
        "textDocument/didChange",
        json!({ "textDocument": { "uri": uri, "version": 3 }, "contentChanges": [{ "text": typing }] }),
    );
    let (line, col) = after(&typing, "Text(todo.");
    let items = client.request("textDocument/completion", position(&uri, line, col));
    assert_eq!(labels(&items), ["id", "name"]);

    // Argument names not given yet, then values in scope.
    let typing = app.replace("Text(todo.name,", "Text(todo.name, s,");
    client.notify(
        "textDocument/didChange",
        json!({ "textDocument": { "uri": uri, "version": 4 }, "contentChanges": [{ "text": typing }] }),
    );
    let (line, col) = after(&typing, "Text(todo.name, s");
    let items = client.request("textDocument/completion", position(&uri, line, col));
    let labels = labels(&items);
    assert_eq!(
        labels,
        [
            "width",
            "height",
            "grow",
            "minWidth",
            "maxWidth",
            "minHeight",
            "maxHeight",
            "fill",
            "aspectRatio",
            "margin",
            "marginX",
            "marginY",
            "marginTop",
            "marginBottom",
            "marginStart",
            "marginEnd",
            "opacity",
            "hidden",
            "padding",
            "paddingX",
            "paddingY",
            "paddingTop",
            "paddingBottom",
            "paddingStart",
            "paddingEnd",
            "background",
            "radius",
            "border",
            "borderColor",
            "shadow",
            "clip",
            "size",
            "weight",
            "italic",
            "decoration",
            "font",
            "onTap",
            "align",
            "maxLines",
            "lineHeight",
            "onMount",
            "onUnmount",
        ]
    );
    let size = items
        .as_array()
        .expect("items")
        .iter()
        .find(|i| i["label"] == "size")
        .expect("size");
    assert_eq!(size["textEdit"]["newText"], "size = ");
    let start = json!({ "line": line, "character": col - 1 });
    assert_eq!(size["textEdit"]["range"]["start"], start);

    // Formatting replaces the whole document.
    client.notify(
        "textDocument/didChange",
        json!({ "textDocument": { "uri": uri, "version": 5 }, "contentChanges": [{ "text": app }] }),
    );
    let edits = client.request(
        "textDocument/formatting",
        json!({ "textDocument": { "uri": uri }, "options": { "tabSize": 4, "insertSpaces": true } }),
    );
    let formatted = edits[0]["newText"].as_str().expect("formatted text");
    assert_eq!(
        formatted,
        weft_ui_formatter::format(app, &weft_ui_formatter::Options::default()).expect("formats")
    );
    assert!(formatted.contains("\n        for (todo in model.todos; key = todo.id) {\n"));

    let callbacks =
        "component Choice(onSelect: Event<Int>) {\n  Button(onClick = onSelect(1)) {}\n}\n";
    client.notify(
        "textDocument/didChange",
        json!({ "textDocument": { "uri": uri, "version": 6 }, "contentChanges": [{ "text": callbacks }] }),
    );
    assert!(client.diagnostics(&uri).is_empty());

    let (line, col) = after(callbacks, "onSelect: Ev");
    let items = client.request("textDocument/completion", position(&uri, line, col));
    assert!(crate::labels(&items).iter().any(|label| label == "Event"));

    let (line, col) = after(callbacks, "onClick = onSel");
    let hover = client.request("textDocument/hover", position(&uri, line, col));
    assert_eq!(
        hover["contents"]["value"],
        "```weft\n(parameter) onSelect: Event<Int>\n```"
    );
    let definition = client.request("textDocument/definition", position(&uri, line, col));
    assert_eq!(
        definition["range"]["start"],
        json!({ "line": 0, "character": 17 })
    );
    let items = client.request("textDocument/completion", position(&uri, line, col));
    assert!(
        crate::labels(&items)
            .iter()
            .any(|label| label == "onSelect")
    );

    std::fs::write(
        dir.join("styles.weft"),
        "style Muted { color = \"#6b7280\", size = 12 }\n",
    )
    .expect("write imported style");
    let styles =
        "import \"styles.weft\"\ncomponent Screen() { Text(\"note\", style = Muted, size = 14) }\n";
    client.notify(
        "textDocument/didChange",
        json!({ "textDocument": { "uri": uri, "version": 7 }, "contentChanges": [{ "text": styles }] }),
    );
    assert!(client.diagnostics(&uri).is_empty());

    let (line, col) = after(styles, "style = Mu");
    let items = client.request("textDocument/completion", position(&uri, line, col));
    assert_eq!(crate::labels(&items), ["Muted"]);
    let hover = client.request("textDocument/hover", position(&uri, line, col));
    assert_eq!(
        hover["contents"]["value"],
        "```weft\nstyle Muted { color = \"#6b7280\", size = 12 }\n```"
    );
    let definition = client.request("textDocument/definition", position(&uri, line, col));
    let styles_uri = Url::from_file_path(dir.join("styles.weft")).expect("absolute path");
    assert_eq!(definition["uri"], styles_uri.as_str());
    assert_eq!(
        definition["range"]["start"],
        json!({ "line": 0, "character": 6 })
    );

    let pages = "page Detail(id: String) path \"/notes/{id}\" { Text(id) }\n";
    client.notify(
        "textDocument/didChange",
        json!({ "textDocument": { "uri": uri, "version": 8 }, "contentChanges": [{ "text": pages }] }),
    );
    assert!(client.diagnostics(&uri).is_empty());
    let (line, col) = after(pages, "Det");
    let hover = client.request("textDocument/hover", position(&uri, line, col));
    assert_eq!(
        hover["contents"]["value"],
        "```weft\npage Detail(id: String)\n```"
    );
    let definition = client.request("textDocument/definition", position(&uri, line, col));
    assert_eq!(
        definition["range"]["start"],
        json!({ "line": 0, "character": 5 })
    );

    client.request("shutdown", Value::Null);
    client.notify("exit", Value::Null);
    handle.join().expect("server thread");
    let _ = std::fs::remove_dir_all(&dir);
}
