//! Open documents, request dispatch, diagnostics, hover, definition and
//! formatting.

use std::collections::HashMap;
use std::io;
use std::str::FromStr;

use lsp_server::{ErrorCode, Notification, Request, RequestId, Response};
use lsp_types::notification::{
    DidChangeTextDocument, DidCloseTextDocument, DidOpenTextDocument, DidSaveTextDocument,
    Notification as _, PublishDiagnostics,
};
use lsp_types::request::{Completion, Formatting, GotoDefinition, HoverRequest, Request as _};
use lsp_types::{
    DiagnosticRelatedInformation, DiagnosticSeverity, DidChangeTextDocumentParams,
    DidCloseTextDocumentParams, DidOpenTextDocumentParams, DocumentFormattingParams,
    GotoDefinitionParams, GotoDefinitionResponse, Hover, HoverContents, HoverParams, Location,
    MarkupContent, MarkupKind, PublishDiagnosticsParams, TextEdit, Uri,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use url::Url;
use weft_ui_ast::{Diagnostic, FileId, Severity, SourceMap, Span};
use weft_ui_formatter::{FormatError, Indent, Options};
use weft_ui_parser::SourceLoader;
use weft_ui_parser::loader::normalize;
use weft_ui_transformer::ide;

use crate::completion;
use crate::line_index::LineIndex;

pub(crate) struct Document {
    pub uri: Uri,
    pub text: String,
}

pub(crate) struct Server {
    /// Open documents by module path.
    docs: HashMap<String, Document>,
    /// Whether the client accepts snippet completions.
    pub snippets: bool,
}

impl Server {
    pub(crate) fn new(snippets: bool) -> Self {
        Self {
            docs: HashMap::new(),
            snippets,
        }
    }

    // ---- dispatch ------------------------------------------------------

    pub(crate) fn request(&mut self, request: Request) -> Response {
        let id = request.id.clone();
        match request.method.as_str() {
            HoverRequest::METHOD => respond(id, request, |p| self.hover(p)),
            GotoDefinition::METHOD => respond(id, request, |p| self.definition(p)),
            Completion::METHOD => respond(id, request, |p| completion::complete(self, p)),
            Formatting::METHOD => match parse::<DocumentFormattingParams>(request) {
                Ok(params) => match self.format(&params) {
                    Ok(edits) => Response::new_ok(id, edits),
                    Err(message) => Response::new_err(id, ErrorCode::RequestFailed as i32, message),
                },
                Err(message) => invalid_params(id, message),
            },
            _ => Response::new_err(
                id,
                ErrorCode::MethodNotFound as i32,
                format!("unsupported request `{}`", request.method),
            ),
        }
    }

    /// Handles a notification; returns the notifications to send back.
    pub(crate) fn notification(&mut self, notification: Notification) -> Vec<Notification> {
        match notification.method.as_str() {
            DidOpenTextDocument::METHOD => {
                if let Ok(params) =
                    notification.extract::<DidOpenTextDocumentParams>(DidOpenTextDocument::METHOD)
                {
                    let doc = params.text_document;
                    self.docs.insert(
                        module_path(&doc.uri),
                        Document {
                            uri: doc.uri,
                            text: doc.text,
                        },
                    );
                }
                self.diagnostics()
            }
            DidChangeTextDocument::METHOD => {
                if let Ok(params) = notification
                    .extract::<DidChangeTextDocumentParams>(DidChangeTextDocument::METHOD)
                    && let Some(doc) = self.docs.get_mut(&module_path(&params.text_document.uri))
                    && let Some(change) = params.content_changes.into_iter().last()
                {
                    // Full sync: the last change holds the whole text.
                    doc.text = change.text;
                }
                self.diagnostics()
            }
            DidCloseTextDocument::METHOD => {
                let Ok(params) = notification
                    .extract::<DidCloseTextDocumentParams>(DidCloseTextDocument::METHOD)
                else {
                    return Vec::new();
                };
                let uri = params.text_document.uri;
                self.docs.remove(&module_path(&uri));
                let mut out = self.diagnostics();
                out.push(publish(uri, Vec::new()));
                out
            }
            // Other open documents may import the saved file's new contents.
            DidSaveTextDocument::METHOD => self.diagnostics(),
            _ => Vec::new(),
        }
    }

    // ---- analysis ------------------------------------------------------

    pub(crate) fn doc(&self, uri: &Uri) -> Option<(String, &Document)> {
        let path = module_path(uri);
        let doc = self.docs.get(&path)?;
        Some((path, doc))
    }

    /// Analyzes the import closure of `path`, reading `path` from `text`
    /// instead of its open document when given.
    pub(crate) fn analyze(
        &self,
        path: &str,
        text: Option<&str>,
        probe: Option<&str>,
    ) -> ide::IdeAnalysis {
        let mut loader = Loader {
            docs: &self.docs,
            overlay: text.map(|text| (path, text)),
        };
        ide::analyze(weft_ui_parser::load(&[path], &mut loader), probe)
    }

    /// Re-checks every open document and publishes its diagnostics.
    fn diagnostics(&self) -> Vec<Notification> {
        self.docs
            .iter()
            .map(|(path, doc)| {
                let mut loader = Loader {
                    docs: &self.docs,
                    overlay: None,
                };
                let parsed = weft_ui_parser::load(&[path], &mut loader);
                let compilation = weft_ui_transformer::check(parsed);
                let entry = LineIndex::new(&doc.text);
                let diagnostics = compilation
                    .diagnostics
                    .iter()
                    .filter(|d| d.span.file == FileId(0))
                    .map(|d| to_lsp_diagnostic(d, &entry, &compilation.sources))
                    .collect();
                publish(doc.uri.clone(), diagnostics)
            })
            .collect()
    }

    // ---- requests ------------------------------------------------------

    fn hover(&self, params: HoverParams) -> Option<Hover> {
        let position = params.text_document_position_params;
        let (path, doc) = self.doc(&position.text_document.uri)?;
        let index = LineIndex::new(&doc.text);
        let offset = index.offset(position.position);
        let analysis = self.analyze(&path, None, None);
        let occurrence = analysis.index.occurrence_at(FileId(0), offset)?;
        Some(Hover {
            contents: HoverContents::Markup(MarkupContent {
                kind: MarkupKind::Markdown,
                value: format!("```weft\n{}\n```", occurrence.symbol.detail),
            }),
            range: Some(index.range(occurrence.span)),
        })
    }

    fn definition(&self, params: GotoDefinitionParams) -> Option<GotoDefinitionResponse> {
        let position = params.text_document_position_params;
        let (path, doc) = self.doc(&position.text_document.uri)?;
        let offset = LineIndex::new(&doc.text).offset(position.position);
        let analysis = self.analyze(&path, None, None);
        let def = analysis
            .index
            .occurrence_at(FileId(0), offset)?
            .symbol
            .def?;
        location(&analysis.sources, def).map(GotoDefinitionResponse::Scalar)
    }

    fn format(&self, params: &DocumentFormattingParams) -> Result<Option<Vec<TextEdit>>, String> {
        let Some((_, doc)) = self.doc(&params.text_document.uri) else {
            return Ok(None);
        };
        let indent = if params.options.insert_spaces {
            Indent::Spaces(u8::try_from(params.options.tab_size).unwrap_or(u8::MAX))
        } else {
            Indent::Tab
        };
        let options = Options {
            indent,
            ..Options::default()
        };
        match weft_ui_formatter::format(&doc.text, &options) {
            Ok(formatted) if formatted == doc.text => Ok(Some(Vec::new())),
            Ok(formatted) => Ok(Some(vec![TextEdit::new(
                LineIndex::new(&doc.text).full_range(),
                formatted,
            )])),
            // Syntax errors are already shown as diagnostics.
            Err(FormatError::Syntax(_)) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }
}

/// Reads open documents from memory and everything else from disk.
struct Loader<'a> {
    docs: &'a HashMap<String, Document>,
    overlay: Option<(&'a str, &'a str)>,
}

impl SourceLoader for Loader<'_> {
    fn load(&mut self, path: &str) -> io::Result<String> {
        if let Some((overlay, text)) = self.overlay
            && overlay == path
        {
            return Ok(text.to_owned());
        }
        if let Some(doc) = self.docs.get(path) {
            return Ok(doc.text.clone());
        }
        if path.contains("://") {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("no open document `{path}`"),
            ));
        }
        std::fs::read_to_string(path)
    }
}

// ---- conversions -----------------------------------------------------------

/// Module path of a document: its normalized file system path with `/`
/// separators, or the normalized URI for documents that are not files.
pub(crate) fn module_path(uri: &Uri) -> String {
    let path = Url::parse(uri.as_str())
        .ok()
        .filter(|url| url.scheme() == "file")
        .and_then(|url| url.to_file_path().ok());
    match path {
        Some(path) => normalize(&path.to_string_lossy().replace('\\', "/")),
        None => normalize(uri.as_str()),
    }
}

fn file_uri(path: &str) -> Option<Uri> {
    let url = Url::from_file_path(path).ok()?;
    Uri::from_str(url.as_str()).ok()
}

fn location(sources: &SourceMap, span: Span) -> Option<Location> {
    let file = sources.get(span.file);
    let uri = file_uri(file.path()).or_else(|| Uri::from_str(file.path()).ok())?;
    Some(Location::new(uri, LineIndex::new(file.text()).range(span)))
}

fn to_lsp_diagnostic(
    diagnostic: &Diagnostic,
    entry: &LineIndex<'_>,
    sources: &SourceMap,
) -> lsp_types::Diagnostic {
    let mut message = diagnostic.message.clone();
    if !diagnostic.label.is_empty() {
        message.push_str(&format!(" ({})", diagnostic.label));
    }
    for note in &diagnostic.notes {
        message.push_str(&format!("\nnote: {note}"));
    }
    let related: Vec<DiagnosticRelatedInformation> = diagnostic
        .secondary
        .iter()
        .filter_map(|label| {
            Some(DiagnosticRelatedInformation {
                location: location(sources, label.span)?,
                message: label.message.clone(),
            })
        })
        .collect();
    lsp_types::Diagnostic {
        range: entry.range(diagnostic.span),
        severity: Some(match diagnostic.severity {
            Severity::Error => DiagnosticSeverity::ERROR,
            Severity::Warning => DiagnosticSeverity::WARNING,
        }),
        source: Some("weft".to_owned()),
        message,
        related_information: (!related.is_empty()).then_some(related),
        ..lsp_types::Diagnostic::default()
    }
}

fn publish(uri: Uri, diagnostics: Vec<lsp_types::Diagnostic>) -> Notification {
    Notification::new(
        PublishDiagnostics::METHOD.to_owned(),
        PublishDiagnosticsParams::new(uri, diagnostics, None),
    )
}

// ---- responses -------------------------------------------------------------

fn parse<P: DeserializeOwned>(request: Request) -> Result<P, String> {
    serde_json::from_value(request.params).map_err(|e| e.to_string())
}

fn invalid_params(id: RequestId, message: String) -> Response {
    Response::new_err(id, ErrorCode::InvalidParams as i32, message)
}

fn respond<P: DeserializeOwned, R: Serialize>(
    id: RequestId,
    request: Request,
    handler: impl FnOnce(P) -> R,
) -> Response {
    match parse::<P>(request) {
        Ok(params) => Response::new_ok(id, handler(params)),
        Err(message) => invalid_params(id, message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_non_file_uris_with_relative_imports() {
        let mut server = Server::new(false);
        let model_uri = Uri::from_str("inmemory:///app/models.weft").expect("valid uri");
        let app_uri = Uri::from_str("inmemory:///app/ui/App.weft").expect("valid uri");
        server.notification(Notification::new(
            DidOpenTextDocument::METHOD.to_owned(),
            DidOpenTextDocumentParams {
                text_document: lsp_types::TextDocumentItem {
                    uri: model_uri,
                    language_id: "weft".to_owned(),
                    version: 1,
                    text: "model Item { name: String }".to_owned(),
                },
            },
        ));
        let diags = server.notification(Notification::new(
            DidOpenTextDocument::METHOD.to_owned(),
            DidOpenTextDocumentParams {
                text_document: lsp_types::TextDocumentItem {
                    uri: app_uri.clone(),
                    language_id: "weft".to_owned(),
                    version: 1,
                    text:
                        "import \"../models.weft\"\ncomponent App(item: Item) { Text(item.name) }"
                            .to_owned(),
                },
            },
        ));
        assert!(diags.iter().all(|n| {
            serde_json::from_value::<PublishDiagnosticsParams>(n.params.clone())
                .expect("publish diagnostics params")
                .diagnostics
                .is_empty()
        }));

        let vfs_uri = Uri::from_str("vscode-vfs://github/org/repo/App.weft").expect("valid uri");
        assert_eq!(
            module_path(&vfs_uri),
            "vscode-vfs://github/org/repo/App.weft"
        );
        let mut loader = Loader {
            docs: &server.docs,
            overlay: None,
        };
        let err = loader
            .load("vscode-vfs://github/org/repo/Missing.weft")
            .expect_err("unopened virtual URI returns NotFound");
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }
}
