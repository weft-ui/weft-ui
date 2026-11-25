//! Converts source text into tokens.
//!
//! String literals are lexed as a single [`TokenKind::Str`] token covering the
//! quotes and any `${...}` interpolations; the parser decodes their contents.

use weft_ui_ast::span::offset;
use weft_ui_ast::{Diagnostic, FileId, Span};

use crate::token::{Token, TokenKind};

/// Lexes `text`, which starts at byte `base` of file `file`.
///
/// The returned tokens always end with [`TokenKind::Eof`].
pub fn lex(file: FileId, text: &str, base: u32, diags: &mut Vec<Diagnostic>) -> Vec<Token> {
    let mut lexer = Lexer::new(file, text, base, diags, None);
    lexer.tokens()
}

/// Like [`lex`], but also returns the spans of all comments (`//` comments
/// without the line break), in source order. Used by tools that must keep
/// comments, such as the formatter.
pub fn lex_with_comments(
    file: FileId,
    text: &str,
    base: u32,
    diags: &mut Vec<Diagnostic>,
) -> (Vec<Token>, Vec<Span>) {
    let mut comments = Vec::new();
    let mut lexer = Lexer::new(file, text, base, diags, Some(&mut comments));
    let tokens = lexer.tokens();
    (tokens, comments)
}

struct Lexer<'src, 'd> {
    file: FileId,
    bytes: &'src [u8],
    text: &'src str,
    base: u32,
    pos: usize,
    diags: &'d mut Vec<Diagnostic>,
    /// Collects comment spans when present.
    comments: Option<&'d mut Vec<Span>>,
}

impl<'src, 'd> Lexer<'src, 'd> {
    fn new(
        file: FileId,
        text: &'src str,
        base: u32,
        diags: &'d mut Vec<Diagnostic>,
        comments: Option<&'d mut Vec<Span>>,
    ) -> Self {
        Self {
            file,
            bytes: text.as_bytes(),
            text,
            base,
            pos: 0,
            diags,
            comments,
        }
    }

    fn tokens(&mut self) -> Vec<Token> {
        let mut tokens = Vec::new();
        loop {
            let token = self.next_token();
            tokens.push(token);
            if token.kind == TokenKind::Eof {
                return tokens;
            }
        }
    }

    fn comment(&mut self, start: usize, end: usize) {
        let span = self.span(start, end);
        if let Some(comments) = &mut self.comments {
            comments.push(span);
        }
    }

    fn span(&self, start: usize, end: usize) -> Span {
        Span::new(
            self.file,
            self.base + offset(start),
            self.base + offset(end),
        )
    }

    fn peek(&self, ahead: usize) -> u8 {
        self.bytes.get(self.pos + ahead).copied().unwrap_or(0)
    }

    fn skip_trivia(&mut self) {
        loop {
            match (self.peek(0), self.peek(1)) {
                (b' ' | b'\t' | b'\r' | b'\n', _) => self.pos += 1,
                (b'/', b'/') => {
                    let start = self.pos;
                    while self.pos < self.bytes.len() && self.bytes[self.pos] != b'\n' {
                        self.pos += 1;
                    }
                    // The `\r` of a CRLF line break is not part of the comment.
                    let text = self.text[start..self.pos].trim_end_matches('\r');
                    self.comment(start, start + text.len());
                }
                (b'/', b'*') => {
                    let start = self.pos;
                    match self.text[self.pos + 2..].find("*/") {
                        Some(i) => self.pos += i + 4,
                        None => {
                            self.pos = self.bytes.len();
                            self.diags.push(
                                Diagnostic::error(
                                    self.span(start, start + 2),
                                    "unterminated block comment",
                                )
                                .with_label("comment starts here"),
                            );
                        }
                    }
                    self.comment(start, self.pos);
                }
                _ => return,
            }
        }
    }

    fn next_token(&mut self) -> Token {
        self.skip_trivia();
        let start = self.pos;
        let kind = self.token_kind();
        Token {
            kind,
            span: self.span(start, self.pos),
        }
    }

    fn token_kind(&mut self) -> TokenKind {
        use TokenKind::*;
        let Some(&c) = self.bytes.get(self.pos) else {
            return Eof;
        };
        if c.is_ascii_alphabetic() || c == b'_' {
            let start = self.pos;
            while self.peek(0).is_ascii_alphanumeric() || self.peek(0) == b'_' {
                self.pos += 1;
            }
            return TokenKind::keyword(&self.text[start..self.pos]).unwrap_or(Ident);
        }
        if c.is_ascii_digit() {
            return self.number();
        }
        if c == b'"' {
            self.string();
            return Str;
        }

        let (kind, len) = match (c, self.peek(1)) {
            (b'?', b'.') => (QuestionDot, 2),
            (b'?', b'?') => (QuestionQuestion, 2),
            (b'+', b'=') => (PlusEq, 2),
            (b'-', b'=') => (MinusEq, 2),
            (b'-', b'>') => (Arrow, 2),
            (b'=', b'=') => (EqEq, 2),
            (b'!', b'=') => (BangEq, 2),
            (b'<', b'=') => (LtEq, 2),
            (b'>', b'=') => (GtEq, 2),
            (b'&', b'&') => (AndAnd, 2),
            (b'|', b'|') => (OrOr, 2),
            (b'|', _) => (Pipe, 1),
            (b'(', _) => (LParen, 1),
            (b')', _) => (RParen, 1),
            (b'{', _) => (LBrace, 1),
            (b'}', _) => (RBrace, 1),
            (b'[', _) => (LBracket, 1),
            (b']', _) => (RBracket, 1),
            (b',', _) => (Comma, 1),
            (b':', _) => (Colon, 1),
            (b';', _) => (Semi, 1),
            (b'.', _) => (Dot, 1),
            (b'?', _) => (Question, 1),
            (b'=', _) => (Eq, 1),
            (b'<', _) => (Lt, 1),
            (b'>', _) => (Gt, 1),
            (b'+', _) => (Plus, 1),
            (b'-', _) => (Minus, 1),
            (b'*', _) => (Star, 1),
            (b'/', _) => (Slash, 1),
            (b'%', _) => (Percent, 1),
            (b'!', _) => (Bang, 1),
            _ => {
                let ch = self.text[self.pos..]
                    .chars()
                    .next()
                    .expect("position is inside the text");
                let start = self.pos;
                self.pos += ch.len_utf8();
                self.diags.push(Diagnostic::error(
                    self.span(start, self.pos),
                    format!("unexpected character `{ch}`"),
                ));
                return Unknown;
            }
        };
        self.pos += len;
        kind
    }

    fn number(&mut self) -> TokenKind {
        let digits = |l: &mut Self| {
            while l.peek(0).is_ascii_digit() {
                l.pos += 1;
            }
        };
        digits(self);
        let mut kind = TokenKind::Int;
        if self.peek(0) == b'.' && self.peek(1).is_ascii_digit() {
            self.pos += 1;
            digits(self);
            kind = TokenKind::Float;
        }
        if matches!(self.peek(0), b'e' | b'E') {
            let sign = usize::from(matches!(self.peek(1), b'+' | b'-'));
            if self.peek(1 + sign).is_ascii_digit() {
                self.pos += 1 + sign;
                digits(self);
                kind = TokenKind::Float;
            }
        }
        kind
    }

    fn string(&mut self) {
        let start = self.pos;
        match scan_string_depth(self.bytes, self.pos, 0) {
            Ok(end) => self.pos = end,
            Err(ScanError::Unterminated(end)) => {
                self.pos = end;
                self.diags.push(
                    Diagnostic::error(self.span(start, start + 1), "unterminated string literal")
                        .with_label("string starts here"),
                );
            }
            Err(ScanError::NestingLimit(end)) => {
                self.pos = end;
                self.diags.push(Diagnostic::error(
                    self.span(start, start + 1),
                    "string interpolation nesting limit exceeded",
                ));
            }
        }
    }
}

/// Maximum nested `${...}` interpolation depth before stopping with a diagnostic.
const MAX_INTERPOLATION_DEPTH: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ScanError {
    Unterminated(usize),
    NestingLimit(usize),
}

fn skip_to_line_end(bytes: &[u8], mut i: usize) -> usize {
    while matches!(bytes.get(i), Some(&b) if b != b'\n') {
        i += 1;
    }
    i
}

/// Scans a string literal starting at the opening quote `bytes[start]`.
///
/// Returns the index just past the closing quote, or `Err` with the index where
/// scanning stopped (newline or end of input) if the literal is unterminated or
/// exceeds [`MAX_INTERPOLATION_DEPTH`].
fn scan_string_depth(bytes: &[u8], start: usize, depth: usize) -> Result<usize, ScanError> {
    debug_assert_eq!(bytes[start], b'"');
    let mut i = start + 1;
    loop {
        match bytes.get(i) {
            None | Some(b'\n') => return Err(ScanError::Unterminated(i)),
            Some(b'"') => return Ok(i + 1),
            Some(b'\\') => {
                i += if bytes.get(i + 1).is_some_and(|&b| b != b'\n') {
                    2
                } else {
                    1
                }
            }
            Some(b'$') if bytes.get(i + 1) == Some(&b'{') => {
                if depth >= MAX_INTERPOLATION_DEPTH {
                    return Err(ScanError::NestingLimit(skip_to_line_end(bytes, i + 2)));
                }
                i = scan_interpolation_depth(bytes, i + 2, depth + 1)?;
            }
            Some(_) => i += 1,
        }
    }
}

/// Scans the body of `${...}` starting just after the `{`.
///
/// Returns the index just past the matching `}`, or `Err` if a newline or the
/// end of input is reached first.
pub(crate) fn scan_interpolation(bytes: &[u8], start: usize) -> Result<usize, usize> {
    scan_interpolation_depth(bytes, start, 0).map_err(|err| match err {
        ScanError::Unterminated(end) | ScanError::NestingLimit(end) => end,
    })
}

fn scan_interpolation_depth(bytes: &[u8], start: usize, depth: usize) -> Result<usize, ScanError> {
    let mut braces = 0usize;
    let mut i = start;
    loop {
        match bytes.get(i) {
            None | Some(b'\n') => return Err(ScanError::Unterminated(i)),
            Some(b'"') => i = scan_string_depth(bytes, i, depth)?,
            Some(b'{') => {
                braces += 1;
                i += 1;
            }
            Some(b'}') if braces == 0 => return Ok(i + 1),
            Some(b'}') => {
                braces -= 1;
                i += 1;
            }
            Some(_) => i += 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(src: &str) -> (Vec<TokenKind>, Vec<Diagnostic>) {
        let mut diags = Vec::new();
        let tokens = lex(FileId(0), src, 0, &mut diags);
        (tokens.iter().map(|t| t.kind).collect(), diags)
    }

    #[test]
    fn numbers_and_member_access() {
        use TokenKind::*;
        let (k, d) = kinds("1 2.5 3e2 4.x a?.b ?? c");
        assert!(d.is_empty());
        assert_eq!(
            k,
            [
                Int,
                Float,
                Float,
                Int,
                Dot,
                Ident,
                Ident,
                QuestionDot,
                Ident,
                QuestionQuestion,
                Ident,
                Eof
            ]
        );
    }

    #[test]
    fn interpolated_string_is_one_token() {
        let (k, d) = kinds(r#""a ${ f("}") } b" x"#);
        assert!(d.is_empty(), "{d:?}");
        assert_eq!(k, [TokenKind::Str, TokenKind::Ident, TokenKind::Eof]);
    }

    #[test]
    fn collects_comments_outside_strings() {
        let src = "a // one\r\n\"// no\" /* two */ b /* open";
        let mut diags = Vec::new();
        let (tokens, comments) = lex_with_comments(FileId(0), src, 0, &mut diags);
        let texts: Vec<&str> = comments
            .iter()
            .map(|c| &src[c.start as usize..c.end as usize])
            .collect();
        assert_eq!(texts, ["// one", "/* two */", "/* open"]);
        assert_eq!(tokens.len(), 4);
        assert_eq!(diags.len(), 1, "unterminated block comment");
    }

    #[test]
    fn unterminated_string_stops_at_newline() {
        let (k, d) = kinds("\"abc\nx");
        assert_eq!(k, [TokenKind::Str, TokenKind::Ident, TokenKind::Eof]);
        assert_eq!(d.len(), 1);
    }

    #[test]
    fn deeply_nested_interpolation_hits_limit_without_overflow() {
        let depth = 500;
        let src = format!("{}\"x\"{}", "\"${".repeat(depth), "}\"".repeat(depth));
        let (k, d) = kinds(&src);
        assert_eq!(k.last(), Some(&TokenKind::Eof));
        assert!(
            d.iter()
                .any(|diag| diag.message.contains("nesting limit exceeded")),
            "{d:?}"
        );
    }
}
