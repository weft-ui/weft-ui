//! Compiler diagnostics and their plain-text rendering.

use std::fmt::Write;

use crate::{SourceMap, Span};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Severity {
    Warning,
    Error,
}

/// A secondary location attached to a diagnostic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Label {
    pub span: Span,
    pub message: String,
}

/// One error or warning with a primary location.
#[derive(Debug, Clone, PartialEq, Eq)]
#[must_use]
pub struct Diagnostic {
    pub severity: Severity,
    pub message: String,
    pub span: Span,
    /// Text printed under the primary span; may be empty.
    pub label: String,
    pub secondary: Vec<Label>,
    pub notes: Vec<String>,
}

impl Diagnostic {
    pub fn error(span: Span, message: impl Into<String>) -> Self {
        Self::new(Severity::Error, span, message.into())
    }

    pub fn warning(span: Span, message: impl Into<String>) -> Self {
        Self::new(Severity::Warning, span, message.into())
    }

    fn new(severity: Severity, span: Span, message: String) -> Self {
        Self {
            severity,
            message,
            span,
            label: String::new(),
            secondary: Vec::new(),
            notes: Vec::new(),
        }
    }

    pub fn with_label(mut self, label: impl Into<String>) -> Self {
        self.label = label.into();
        self
    }

    pub fn with_secondary(mut self, span: Span, message: impl Into<String>) -> Self {
        self.secondary.push(Label {
            span,
            message: message.into(),
        });
        self
    }

    pub fn with_note(mut self, note: impl Into<String>) -> Self {
        self.notes.push(note.into());
        self
    }

    #[must_use]
    pub fn is_error(&self) -> bool {
        self.severity == Severity::Error
    }

    /// Renders the diagnostic in a rustc-like layout with source snippets.
    #[must_use]
    pub fn render(&self, sources: &SourceMap) -> String {
        let all_spans = std::iter::once(self.span).chain(self.secondary.iter().map(|l| l.span));
        let gutter = all_spans
            .map(|s| sources.get(s.file).line_col(s.start).line)
            .max()
            .unwrap_or(1)
            .to_string()
            .len();
        let pad = " ".repeat(gutter);

        let kind = match self.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
        };
        let mut out = format!("{kind}: {}\n", self.message);
        render_snippet(&mut out, sources, self.span, &self.label, '^', &pad, "-->");
        for label in &self.secondary {
            render_snippet(
                &mut out,
                sources,
                label.span,
                &label.message,
                '-',
                &pad,
                ":::",
            );
        }
        for note in &self.notes {
            let _ = writeln!(out, "{pad} = note: {note}");
        }
        out
    }
}

fn render_snippet(
    out: &mut String,
    sources: &SourceMap,
    span: Span,
    label: &str,
    marker: char,
    pad: &str,
    arrow: &str,
) {
    let file = sources.get(span.file);
    let pos = file.line_col(span.start);
    let line = file.line_index(span.start);
    let text = file.line_text(line);
    let line_start = file.line_start(line) as usize;

    // Underline at least one column, and never past the end of the first line.
    let start = (span.start as usize)
        .saturating_sub(line_start)
        .min(text.len());
    let end = (span.end as usize)
        .saturating_sub(line_start)
        .min(text.len())
        .max(start);
    let lead = text[..start].chars().count();
    let width = text[start..end].chars().count().max(1);

    let _ = writeln!(out, "{pad}{arrow} {}:{pos}", file.path());
    let _ = writeln!(out, "{pad} |");
    let _ = writeln!(out, "{:>w$} | {text}", pos.line, w = pad.len());
    let underline = marker.to_string().repeat(width);
    let sep = if label.is_empty() { "" } else { " " };
    let _ = writeln!(out, "{pad} | {}{underline}{sep}{label}", " ".repeat(lead));
}

/// Renders every diagnostic, separated by blank lines.
#[must_use]
pub fn render_all(diagnostics: &[Diagnostic], sources: &SourceMap) -> String {
    diagnostics
        .iter()
        .map(|d| d.render(sources))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_handles_eof_span_after_bare_cr() {
        let mut sources = SourceMap::new();
        let file = sources.add("cr.weft".into(), "component C()\r".into());
        let eof = sources.get(file).text().len() as u32;
        let rendered =
            Diagnostic::error(Span::new(file, eof, eof), "unexpected end").render(&sources);
        assert!(rendered.contains("cr.weft:1:15"), "{rendered}");
    }
}
