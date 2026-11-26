//! Completion by probing: the identifier at the cursor is replaced with a
//! probe name, the file is re-analyzed, and the analysis reports which names
//! are valid where the probe was resolved.

use lsp_types::{
    CompletionItem, CompletionItemKind, CompletionParams, CompletionResponse, CompletionTextEdit,
    InsertTextFormat, TextEdit,
};
use weft_ui_ast::{FileId, Span};
use weft_ui_parser::lexer::lex_with_comments;
use weft_ui_parser::token::TokenKind;
use weft_ui_transformer::ide::{ProbeContext, Symbol, SymbolKind};

use crate::line_index::LineIndex;
use crate::server::Server;

/// Cannot clash with user code: `.weft` names don't start with `__weft`.
const PROBE: &str = "__weft_complete__";

const TOP_LEVEL_KEYWORDS: [&str; 8] = [
    "page",
    "import",
    "model",
    "event",
    "component",
    "type",
    "style",
    "theme",
];
const NODE_KEYWORDS: [&str; 4] = ["if", "for", "state", "let"];
const VALUE_KEYWORDS: [&str; 5] = ["true", "false", "null", "if", "theme"];

pub(crate) fn complete(server: &Server, params: CompletionParams) -> Option<CompletionResponse> {
    let position = params.text_document_position;
    let (path, doc) = server.doc(&position.text_document.uri)?;
    let text = doc.text.as_str();
    let index = LineIndex::new(text);
    let offset = index.offset(position.position) as usize;
    let surroundings = Surroundings::scan(text, offset)?;

    let (start, end) = word_at(text, offset);
    let range = index.range(Span::new(FileId(0), to_u32(start), to_u32(end)));
    let probed = format!("{}{PROBE}{}", &text[..start], &text[end..]);
    let analysis = server.analyze(&path, Some(&probed), Some(PROBE));

    let mut items = Vec::new();
    let item =
        |label: &str, kind, detail: Option<&str>, insert: String, snippet: bool| CompletionItem {
            label: label.to_owned(),
            kind: Some(kind),
            detail: detail.map(str::to_owned),
            text_edit: Some(CompletionTextEdit::Edit(TextEdit::new(range, insert))),
            insert_text_format: snippet.then_some(InsertTextFormat::SNIPPET),
            ..CompletionItem::default()
        };

    let probe = analysis.index.probe.as_ref();
    let positional = probe.is_none_or(|p| p.context == ProbeContext::Value);
    if surroundings.after_open_or_comma
        && positional
        && let Some(call) = analysis.index.call_at(FileId(0), to_u32(start + 1))
    {
        let names = call.params.iter().filter(|p| !call.given.contains(&p.name));
        for param in names {
            items.push(item(
                &param.name,
                CompletionItemKind::PROPERTY,
                Some(&param.detail),
                format!("{} = ", param.name),
                false,
            ));
        }
    }

    let keywords: &[&str] = match probe {
        Some(probe) => {
            for symbol in &probe.candidates {
                let (insert, snippet) = insert_text(symbol, server.snippets);
                items.push(item(
                    &symbol.name,
                    if probe.context == ProbeContext::SlotFill {
                        CompletionItemKind::PROPERTY
                    } else {
                        kind(symbol)
                    },
                    Some(&symbol.detail),
                    insert,
                    snippet,
                ));
            }
            match probe.context {
                ProbeContext::Node => &NODE_KEYWORDS,
                ProbeContext::Value if !surroundings.in_string => &VALUE_KEYWORDS,
                _ => &[],
            }
        }
        None if surroundings.depth == 0 && !surroundings.in_string => &TOP_LEVEL_KEYWORDS,
        None => &[],
    };
    for keyword in keywords {
        items.push(item(
            keyword,
            CompletionItemKind::KEYWORD,
            None,
            (*keyword).to_owned(),
            false,
        ));
    }

    for (i, item) in items.iter_mut().enumerate() {
        item.sort_text = Some(format!("{i:04}"));
        item.filter_text = Some(item.label.clone());
    }
    Some(CompletionResponse::Array(items))
}

fn kind(symbol: &Symbol) -> CompletionItemKind {
    match symbol.kind {
        SymbolKind::Model => CompletionItemKind::STRUCT,
        SymbolKind::Event => CompletionItemKind::EVENT,
        SymbolKind::Style | SymbolKind::ThemeToken => CompletionItemKind::CONSTANT,
        SymbolKind::Component | SymbolKind::Element => CompletionItemKind::CLASS,
        SymbolKind::Field => CompletionItemKind::FIELD,
        SymbolKind::Param
        | SymbolKind::State
        | SymbolKind::Let
        | SymbolKind::LoopVar
        | SymbolKind::LambdaParam => CompletionItemKind::VARIABLE,
        SymbolKind::Prop => CompletionItemKind::PROPERTY,
        SymbolKind::Member if is_method(symbol) => CompletionItemKind::METHOD,
        SymbolKind::Member => CompletionItemKind::PROPERTY,
        SymbolKind::Type => CompletionItemKind::TYPE_PARAMETER,
    }
}

fn is_method(symbol: &Symbol) -> bool {
    symbol.detail[symbol.name.len()..].starts_with('(')
}

/// Text inserted for `symbol` and whether it is a snippet; methods get
/// their parentheses.
fn insert_text(symbol: &Symbol, snippets: bool) -> (String, bool) {
    if symbol.kind != SymbolKind::Member || !is_method(symbol) {
        return (symbol.name.clone(), false);
    }
    let takes_args = !symbol.detail[symbol.name.len()..].starts_with("()");
    match (takes_args, snippets) {
        (false, _) => (format!("{}()", symbol.name), false),
        (true, true) => (format!("{}($0)", symbol.name), true),
        (true, false) => (format!("{}(", symbol.name), false),
    }
}

/// Byte range of the identifier touching `offset`.
fn word_at(text: &str, offset: usize) -> (usize, usize) {
    let is_word = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    let bytes = text.as_bytes();
    let mut start = offset;
    while start > 0 && is_word(bytes[start - 1]) {
        start -= 1;
    }
    let mut end = offset;
    while end < bytes.len() && is_word(bytes[end]) {
        end += 1;
    }
    (start, end)
}

/// Lexical facts about the cursor position in the original text.
struct Surroundings {
    /// Number of unclosed `{` before the cursor.
    depth: usize,
    /// Inside a string literal, where only interpolations can be completed.
    in_string: bool,
    /// The identifier at the cursor follows `(` or `,`, so it may be an
    /// argument name.
    after_open_or_comma: bool,
}

impl Surroundings {
    /// `None` inside a comment, where nothing is completed.
    fn scan(text: &str, offset: usize) -> Option<Self> {
        let (tokens, comments) = lex_with_comments(FileId(0), text, 0, &mut Vec::new());
        let offset = to_u32(offset);
        let in_comment = comments.iter().any(|c| {
            let line_comment = text[c.start as usize..].starts_with("//");
            c.start < offset && (offset < c.end || (line_comment && offset == c.end))
        });
        if in_comment {
            return None;
        }
        let mut depth = 0usize;
        let mut in_string = false;
        for token in &tokens {
            if token.span.start >= offset {
                break;
            }
            match token.kind {
                TokenKind::LBrace => depth += 1,
                TokenKind::RBrace => depth = depth.saturating_sub(1),
                TokenKind::Str if offset < token.span.end => in_string = true,
                _ => {}
            }
        }
        let (start, _) = word_at(text, offset as usize);
        let before = text[..start].trim_end();
        Some(Self {
            depth,
            in_string,
            after_open_or_comma: !in_string && (before.ends_with('(') || before.ends_with(',')),
        })
    }
}

fn to_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}
