//! Error-recovering recursive-descent parser. See `crates/parser/GRAMMAR.md`.

use weft_ui_ast::span::offset;
use weft_ui_ast::{
    Arg, Assign, AssignOp, BinaryOp, Block, CallStmt, ComponentDecl, Diagnostic, ElementNode,
    EventDecl, Expr, ExprKind, Field, File, FileId, ForNode, Ident, IfBranch, IfNode, Import, Item,
    Lambda, LambdaStmt, LetDecl, ModelDecl, Node, NodeKind, Param, SlotFill, Span, StateDecl,
    StrPart, StyleDecl, StyleEntry, ThemeDecl, ThemeEntry, ThemeValue, TypeAlias, TypeExpr,
    TypeExprKind, UnaryOp,
};

use crate::lexer::{lex, scan_interpolation};
use crate::token::{Token, TokenKind};

/// Parses one source file. Always returns a tree; errors are reported in the
/// returned diagnostics and represented by `Error` nodes.
pub fn parse(file: FileId, text: &str) -> (File, Vec<Diagnostic>) {
    let mut diags = Vec::new();
    let tokens = lex(file, text, 0, &mut diags);
    let mut parser = Parser::new(file, text, tokens, diags);
    let tree = parser.file();
    let mut diags = parser.diags;
    diags.sort_by_key(|d| d.span.start);
    (tree, diags)
}

/// Binding power of binary operators; higher binds tighter.
fn binary_op(kind: TokenKind) -> Option<(BinaryOp, u8)> {
    use TokenKind as T;
    Some(match kind {
        T::QuestionQuestion => (BinaryOp::Coalesce, 1),
        T::OrOr => (BinaryOp::Or, 2),
        T::AndAnd => (BinaryOp::And, 3),
        T::EqEq => (BinaryOp::Eq, 4),
        T::BangEq => (BinaryOp::Ne, 4),
        T::Lt => (BinaryOp::Lt, 5),
        T::LtEq => (BinaryOp::Le, 5),
        T::Gt => (BinaryOp::Gt, 5),
        T::GtEq => (BinaryOp::Ge, 5),
        T::Plus => (BinaryOp::Add, 6),
        T::Minus => (BinaryOp::Sub, 6),
        T::Star => (BinaryOp::Mul, 7),
        T::Slash => (BinaryOp::Div, 7),
        T::Percent => (BinaryOp::Rem, 7),
        _ => return None,
    })
}

/// Maximum AST nesting depth before stopping with a diagnostic.
const MAX_RECURSION_DEPTH: u16 = 128;

/// Contextual keyword that starts a top-level item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ItemKeyword {
    Import,
    Model,
    Event,
    Component,
    TypeAlias,
    Style,
    Theme,
}

struct Parser<'src> {
    file: FileId,
    /// Full text of the file; token spans index into it.
    text: &'src str,
    tokens: Vec<Token>,
    pos: usize,
    diags: Vec<Diagnostic>,
    last_error_at: Option<u32>,
    /// Parsing the tokens of one `${...}` interpolation.
    in_interpolation: bool,
    depth: u16,
    depth_exceeded: bool,
}

impl<'src> Parser<'src> {
    fn new(file: FileId, text: &'src str, tokens: Vec<Token>, diags: Vec<Diagnostic>) -> Self {
        Self {
            file,
            text,
            tokens,
            pos: 0,
            diags,
            last_error_at: None,
            in_interpolation: false,
            depth: 0,
            depth_exceeded: false,
        }
    }

    fn with_depth<T>(&mut self, span: Span, f: impl FnOnce(&mut Self) -> T) -> Option<T> {
        if self.depth >= MAX_RECURSION_DEPTH {
            if !self.depth_exceeded {
                self.depth_exceeded = true;
                self.error(span, "nesting limit exceeded");
            }
            return None;
        }
        self.depth += 1;
        let out = f(self);
        self.depth -= 1;
        Some(out)
    }

    // ---- token helpers -------------------------------------------------

    fn token(&self) -> Token {
        self.tokens[self.pos]
    }

    fn peek(&self) -> TokenKind {
        self.tokens[self.pos].kind
    }

    fn peek_at(&self, ahead: usize) -> TokenKind {
        self.tokens
            .get(self.pos + ahead)
            .map_or(TokenKind::Eof, |t| t.kind)
    }

    fn at(&self, kind: TokenKind) -> bool {
        self.peek() == kind
    }

    fn bump(&mut self) -> Token {
        let token = self.token();
        if token.kind != TokenKind::Eof {
            self.pos += 1;
        }
        token
    }

    fn eat(&mut self, kind: TokenKind) -> bool {
        if self.at(kind) {
            self.bump();
            true
        } else {
            false
        }
    }

    fn text_of(&self, span: Span) -> &'src str {
        &self.text[span.start as usize..span.end as usize]
    }

    /// Recognizes `import "..."` and declaration keywords followed by a name.
    ///
    /// The keywords are contextual, so `model.draft` is still an expression.
    fn item_keyword(&self) -> Option<ItemKeyword> {
        let token = self.token();
        if token.kind != TokenKind::Ident {
            return None;
        }
        let keyword = match self.text_of(token.span) {
            "import" => ItemKeyword::Import,
            "model" => ItemKeyword::Model,
            "event" => ItemKeyword::Event,
            "component" => ItemKeyword::Component,
            "type" => ItemKeyword::TypeAlias,
            "style" => ItemKeyword::Style,
            "theme" => ItemKeyword::Theme,
            _ => return None,
        };
        let next = match keyword {
            ItemKeyword::Import => TokenKind::Str,
            ItemKeyword::Theme => TokenKind::LBrace,
            _ => TokenKind::Ident,
        };
        (self.peek_at(1) == next).then_some(keyword)
    }

    fn at_item_start(&self) -> bool {
        match self.item_keyword() {
            // A bare node named `type` followed by another node is not an alias.
            Some(ItemKeyword::TypeAlias) => self.peek_at(2) == TokenKind::Eq,
            // A node named `style` can precede a node with children. An
            // assignment inside the braces distinguishes a style declaration.
            Some(ItemKeyword::Style) => {
                self.peek_at(2) == TokenKind::LBrace
                    && self.peek_at(3) == TokenKind::Ident
                    && self.peek_at(4) == TokenKind::Eq
            }
            Some(ItemKeyword::Theme) => {
                self.peek_at(2) == TokenKind::Ident && self.peek_at(3) == TokenKind::Eq
            }
            Some(_) => true,
            None => false,
        }
    }

    /// Recognizes a contextual declaration keyword followed by a name.
    fn at_binding(&self, keyword: &str) -> bool {
        let token = self.token();
        token.kind == TokenKind::Ident
            && self.text_of(token.span) == keyword
            && self.peek_at(1) == TokenKind::Ident
    }

    /// Span from the start of `start` to the end of the last consumed token.
    fn span_from(&self, start: Span) -> Span {
        let end = if self.pos == 0 {
            start.start
        } else {
            self.tokens[self.pos - 1].span.end.max(start.start)
        };
        Span::new(self.file, start.start, end)
    }

    fn error(&mut self, span: Span, message: impl Into<String>) {
        if self.last_error_at == Some(span.start) {
            return;
        }
        self.last_error_at = Some(span.start);
        self.diags.push(Diagnostic::error(span, message));
    }

    fn error_expected(&mut self, what: &str) {
        let token = self.token();
        // Inside `${...}` the end of the token stream is the closing brace.
        let found = if token.kind == TokenKind::Eof && self.in_interpolation {
            TokenKind::RBrace.describe()
        } else {
            token.kind.describe()
        };
        self.error(token.span, format!("expected {what}, found {found}"));
    }

    fn expect(&mut self, kind: TokenKind) -> Option<Token> {
        if self.at(kind) {
            Some(self.bump())
        } else {
            self.error_expected(kind.describe());
            None
        }
    }

    fn ident(&mut self, what: &str) -> Option<Ident> {
        if self.at(TokenKind::Ident) {
            let token = self.bump();
            Some(Ident {
                name: self.text_of(token.span).to_owned(),
                span: token.span,
            })
        } else {
            self.error_expected(what);
            None
        }
    }

    /// Skips one token, or a whole bracketed group if positioned on an opener.
    fn skip_balanced(&mut self) {
        let mut depth = 0usize;
        loop {
            match self.peek() {
                TokenKind::Eof => return,
                TokenKind::LParen | TokenKind::LBrace | TokenKind::LBracket => depth += 1,
                TokenKind::RParen | TokenKind::RBrace | TokenKind::RBracket => {
                    depth = depth.saturating_sub(1);
                }
                _ => {}
            }
            self.bump();
            if depth == 0 {
                return;
            }
        }
    }

    /// Skips to the next `,` or unmatched closing bracket of a list.
    fn recover_list(&mut self) {
        loop {
            match self.peek() {
                TokenKind::Eof
                | TokenKind::Comma
                | TokenKind::RParen
                | TokenKind::RBrace
                | TokenKind::RBracket => return,
                _ if self.at_item_start() => return,
                _ => self.skip_balanced(),
            }
        }
    }

    /// Parses `item ("," item)* ","? close`, consuming `close`.
    fn comma_list<T>(
        &mut self,
        close: TokenKind,
        mut item: impl FnMut(&mut Self) -> Option<T>,
    ) -> Vec<T> {
        let mut items = Vec::new();
        // Any closing bracket ends the list: an unmatched one belongs to an
        // enclosing construct and is reported once by `expect(close)` below.
        while !matches!(
            self.peek(),
            TokenKind::RParen | TokenKind::RBrace | TokenKind::RBracket | TokenKind::Eof
        ) && !self.at_item_start()
        {
            let before = self.pos;
            match item(self) {
                Some(value) => items.push(value),
                None => self.recover_list(),
            }
            if self.eat(TokenKind::Comma) {
                continue;
            }
            if self.at(close) {
                break;
            }
            self.error_expected(&format!("`,` or {}", close.describe()));
            self.recover_list();
            if !self.eat(TokenKind::Comma) && self.pos == before {
                break;
            }
        }
        self.expect(close);
        items
    }

    // ---- items ---------------------------------------------------------

    fn file(&mut self) -> File {
        let mut imports = Vec::new();
        let mut items = Vec::new();
        loop {
            match self.item_keyword() {
                Some(ItemKeyword::Import) => {
                    let start = self.token().span;
                    let import = self.import();
                    if !items.is_empty() {
                        self.error(start, "`import` must come before all declarations");
                    }
                    imports.extend(import);
                }
                Some(ItemKeyword::Model) => items.extend(self.model().map(Item::Model)),
                Some(ItemKeyword::Event) => items.extend(self.event().map(Item::Event)),
                Some(ItemKeyword::Component) => {
                    items.extend(self.component().map(Item::Component));
                }
                Some(ItemKeyword::TypeAlias) => {
                    items.extend(self.type_alias().map(Item::TypeAlias));
                }
                Some(ItemKeyword::Style) => items.extend(self.style().map(Item::Style)),
                Some(ItemKeyword::Theme) => items.push(Item::Theme(self.theme())),
                None if self.at(TokenKind::Eof) => break,
                None => {
                    self.error_expected(
                        "`model`, `event`, `component`, `type`, `style`, `theme` or `import`",
                    );
                    while self.item_keyword().is_none() && !self.at(TokenKind::Eof) {
                        self.skip_balanced();
                    }
                }
            }
        }
        File { imports, items }
    }

    fn import(&mut self) -> Option<Import> {
        let start = self.bump().span;
        if !self.at(TokenKind::Str) {
            self.error_expected("import path string");
            return None;
        }
        let token = self.bump();
        let path = self.literal_string(token.span, "import path cannot contain interpolation")?;
        Some(Import {
            path,
            path_span: token.span,
            span: self.span_from(start),
        })
    }

    fn model(&mut self) -> Option<ModelDecl> {
        let start = self.bump().span;
        let name = self.ident("model name")?;
        let fields = if self.expect(TokenKind::LBrace).is_some() {
            self.comma_list(TokenKind::RBrace, Self::field)
        } else {
            Vec::new()
        };
        Some(ModelDecl {
            name,
            fields,
            span: self.span_from(start),
        })
    }

    fn event(&mut self) -> Option<EventDecl> {
        let start = self.bump().span;
        let name = self.ident("event name")?;
        let params = if self.eat(TokenKind::LParen) {
            self.comma_list(TokenKind::RParen, Self::field)
        } else {
            Vec::new()
        };
        Some(EventDecl {
            name,
            params,
            span: self.span_from(start),
        })
    }

    fn style(&mut self) -> Option<StyleDecl> {
        let start = self.bump().span;
        let name = self.ident("style name")?;
        self.expect(TokenKind::LBrace)?;
        let entries = self.constant_entries(Self::style_entry);
        Some(StyleDecl {
            name,
            entries,
            span: self.span_from(start),
        })
    }

    fn theme(&mut self) -> ThemeDecl {
        let start = self.bump().span;
        self.bump(); // `item_keyword` checked for `{`.
        let entries = self.constant_entries(Self::theme_entry);
        ThemeDecl {
            entries,
            span: self.span_from(start),
        }
    }

    fn constant_entries<T>(&mut self, entry: fn(&mut Self) -> Option<T>) -> Vec<T> {
        let mut entries = Vec::new();
        while !matches!(self.peek(), TokenKind::RBrace | TokenKind::Eof) && !self.at_item_start() {
            if let Some(entry) = entry(self) {
                entries.push(entry);
            } else {
                loop {
                    match self.peek() {
                        TokenKind::Comma | TokenKind::RBrace | TokenKind::Eof => break,
                        TokenKind::Ident if self.peek_at(1) == TokenKind::Eq => break,
                        _ if self.at_item_start() => break,
                        _ => self.skip_balanced(),
                    }
                }
            }
            self.eat(TokenKind::Comma);
        }
        self.expect(TokenKind::RBrace);
        entries
    }

    fn theme_entry(&mut self) -> Option<ThemeEntry> {
        let name = self.ident("theme token name")?;
        self.expect(TokenKind::Eq)?;
        let value = if let Some(light) = self.at(TokenKind::Str).then(|| self.bump()) {
            let literal = |parser: &mut Self, token: Token| {
                let text = parser
                    .literal_string(token.span, "theme colors cannot contain interpolation")?;
                Some((text, token.span))
            };
            let light = literal(self, light)?;
            let dark = if self.at(TokenKind::Ident)
                && self.text_of(self.token().span) == "dark"
                && self.peek_at(1) != TokenKind::Eq
            {
                self.bump();
                let token = self.expect(TokenKind::Str)?;
                Some(literal(self, token)?)
            } else {
                None
            };
            ThemeValue::Color { light, dark }
        } else {
            let start = self.token().span;
            let negative = self.eat(TokenKind::Minus);
            let token = self.token();
            match token.kind {
                TokenKind::Int => {
                    self.bump();
                    let text = self.text_of(token.span);
                    let number = if negative {
                        text.parse::<i128>()
                            .ok()
                            .and_then(|magnitude| i64::try_from(-magnitude).ok())
                    } else {
                        text.parse::<i64>().ok()
                    };
                    let Some(number) = number else {
                        self.error(
                            self.span_from(start),
                            "integer literal is out of range for `Int`",
                        );
                        return None;
                    };
                    ThemeValue::Int(number)
                }
                TokenKind::Float => {
                    self.bump();
                    let number = self.parse_float(token.span)?;
                    ThemeValue::Float(if negative { -number } else { number })
                }
                _ => {
                    self.error_expected("theme color or number");
                    return None;
                }
            }
        };
        Some(ThemeEntry {
            span: self.span_from(name.span),
            name,
            value,
        })
    }

    fn style_entry(&mut self) -> Option<StyleEntry> {
        const EXPECT_LITERAL: &str = "style values must be literals or theme tokens";
        let name = self.ident("style property name")?;
        self.expect(TokenKind::Eq)?;
        let start = self.token();
        // Leave a following entry intact if this entry is missing its value.
        if self.at_item_start() || (self.at(TokenKind::Ident) && self.peek_at(1) == TokenKind::Eq) {
            self.error(start.span, EXPECT_LITERAL);
            return None;
        }
        use TokenKind as T;
        let head = (start.kind, self.peek_at(1));
        if !matches!(
            head,
            (T::Str | T::Int | T::Float | T::True | T::False, _) | (T::Minus, T::Int | T::Float)
        ) && !(head == (T::Ident, T::Dot) && self.text_of(start.span) == "theme")
        {
            self.error(start.span, EXPECT_LITERAL);
            return None;
        }
        let value = self.expr();
        let literal = match &value.kind {
            ExprKind::Int(_) | ExprKind::Float(_) | ExprKind::Bool(_) => true,
            ExprKind::Str(parts) => matches!(parts.as_slice(), [] | [StrPart::Lit(_)]),
            ExprKind::Field {
                base, safe: false, ..
            } => {
                matches!(&base.kind, ExprKind::Ident(name) if name == "theme")
            }
            ExprKind::Unary {
                op: UnaryOp::Neg,
                expr,
            } => match expr.kind {
                ExprKind::Int(_) | ExprKind::Float(_) => true,
                ExprKind::Error => return None,
                _ => false,
            },
            ExprKind::Error => return None,
            _ => false,
        };
        if !literal {
            self.error(value.span, EXPECT_LITERAL);
            return None;
        }
        Some(StyleEntry {
            span: self.span_from(name.span),
            name,
            value,
        })
    }

    fn field(&mut self) -> Option<Field> {
        let name = self.ident("field name")?;
        self.expect(TokenKind::Colon)?;
        let ty = self.type_expr();
        Some(Field {
            span: self.span_from(name.span),
            name,
            ty,
        })
    }

    fn component(&mut self) -> Option<ComponentDecl> {
        let start = self.bump().span;
        let name = self.ident("component name")?;
        let params = if self.expect(TokenKind::LParen).is_some() {
            self.comma_list(TokenKind::RParen, Self::param)
        } else {
            Vec::new()
        };
        let mut states = Vec::new();
        let mut lets = Vec::new();
        let mut body = Vec::new();
        if self.expect(TokenKind::LBrace).is_some() {
            while !self.at(TokenKind::RBrace) && !self.at(TokenKind::Eof) {
                if self.at_item_start() {
                    break;
                }
                if self.at_binding("state") {
                    let state_span = self.token().span;
                    let state = self.state_decl();
                    if !body.is_empty() {
                        self.error(state_span, "`state` must be declared before any node");
                    } else if !lets.is_empty() {
                        self.error(state_span, "`state` must be declared before any `let`");
                    }
                    states.extend(state);
                } else if body.is_empty() && self.at_binding("let") {
                    lets.extend(self.let_decl());
                } else {
                    body.extend(self.node());
                }
            }
            self.expect(TokenKind::RBrace);
        }
        Some(ComponentDecl {
            name,
            params,
            states,
            lets,
            body,
            span: self.span_from(start),
        })
    }

    fn param(&mut self) -> Option<Param> {
        let name = self.ident("parameter name")?;
        self.expect(TokenKind::Colon)?;
        let ty = self.type_expr();
        let default = self.eat(TokenKind::Eq).then(|| self.expr());
        Some(Param {
            span: self.span_from(name.span),
            name,
            ty,
            default,
        })
    }

    fn state_decl(&mut self) -> Option<StateDecl> {
        let start = self.bump().span;
        let name = self.ident("state name")?;
        let (ty, init) = self.binding_value();
        Some(StateDecl {
            name,
            ty,
            init,
            span: self.span_from(start),
        })
    }

    fn let_decl(&mut self) -> Option<LetDecl> {
        let start = self.bump().span;
        let name = self.ident("let name")?;
        let (ty, value) = self.binding_value();
        Some(LetDecl {
            name,
            ty,
            value,
            span: self.span_from(start),
        })
    }

    fn binding_value(&mut self) -> (Option<TypeExpr>, Expr) {
        let ty = self.eat(TokenKind::Colon).then(|| self.type_expr());
        let value = if self.expect(TokenKind::Eq).is_some() {
            self.expr()
        } else {
            Expr {
                kind: ExprKind::Error,
                span: self.token().span,
            }
        };
        (ty, value)
    }

    fn type_alias(&mut self) -> Option<TypeAlias> {
        let start = self.bump().span;
        let name = self.ident("type alias name")?;
        self.expect(TokenKind::Eq)?;
        let ty = self.type_expr();
        Some(TypeAlias {
            name,
            ty,
            span: self.span_from(start),
        })
    }

    fn type_expr(&mut self) -> TypeExpr {
        let start = self.token().span;
        let Some(ty) = self.with_depth(start, |p| {
            if p.at(TokenKind::Str) {
                let kind = p
                    .union_members()
                    .map_or(TypeExprKind::Error, TypeExprKind::Union);
                return TypeExpr {
                    kind,
                    span: p.span_from(start),
                };
            }
            let Some(name) = p.ident("type") else {
                return TypeExpr {
                    kind: TypeExprKind::Error,
                    span: start,
                };
            };
            let args = if p.eat(TokenKind::Lt) {
                let payload = p.type_expr();
                p.expect(TokenKind::Gt);
                vec![payload]
            } else {
                Vec::new()
            };
            let mut ty = TypeExpr {
                span: p.span_from(start),
                kind: TypeExprKind::Named { name, args },
            };
            loop {
                if p.at(TokenKind::LBracket) {
                    p.bump();
                    p.expect(TokenKind::RBracket);
                    ty = TypeExpr {
                        kind: TypeExprKind::Array(Box::new(ty)),
                        span: p.span_from(start),
                    };
                } else if p.eat(TokenKind::Question) {
                    ty = TypeExpr {
                        kind: TypeExprKind::Optional(Box::new(ty)),
                        span: p.span_from(start),
                    };
                } else {
                    return ty;
                }
            }
        }) else {
            let mut angles = 0usize;
            while !matches!(
                self.peek(),
                TokenKind::Eof | TokenKind::Comma | TokenKind::RParen | TokenKind::RBrace
            ) {
                match self.peek() {
                    TokenKind::Lt => {
                        angles += 1;
                        self.bump();
                    }
                    TokenKind::Gt if angles > 0 => {
                        angles -= 1;
                        self.bump();
                    }
                    TokenKind::Gt => break,
                    _ => self.skip_balanced(),
                }
            }
            return TypeExpr {
                kind: TypeExprKind::Error,
                span: start,
            };
        };
        ty
    }

    fn union_members(&mut self) -> Option<Vec<(String, Span)>> {
        let mut members = Vec::new();
        let mut valid = true;
        let mut first = true;
        loop {
            let span = self.expect(TokenKind::Str)?.span;
            match self.literal_string(span, "union members cannot contain interpolation") {
                Some(value) => members.push((value, span)),
                None => valid = false,
            }
            if first {
                self.expect(TokenKind::Pipe)?;
                first = false;
            } else if !self.eat(TokenKind::Pipe) {
                return valid.then_some(members);
            }
        }
    }

    // ---- nodes ---------------------------------------------------------

    fn block(&mut self) -> Block {
        let start = self.token().span;
        if !self.at(TokenKind::LBrace) {
            self.expect(TokenKind::LBrace);
            return Block {
                lets: Vec::new(),
                nodes: Vec::new(),
                span: self.span_from(start),
            };
        }
        let Some(block) = self.with_depth(start, |p| {
            let mut lets = Vec::new();
            let mut nodes = Vec::new();
            p.bump(); // `{`
            while p.at_binding("let") {
                lets.extend(p.let_decl());
            }
            while !p.at(TokenKind::RBrace) && !p.at(TokenKind::Eof) {
                if p.at_item_start() {
                    break;
                }
                nodes.extend(p.node());
            }
            p.expect(TokenKind::RBrace);
            Block {
                lets,
                nodes,
                span: p.span_from(start),
            }
        }) else {
            self.skip_balanced();
            return Block {
                lets: Vec::new(),
                nodes: Vec::new(),
                span: self.span_from(start),
            };
        };
        block
    }

    /// Parses one node; on garbage, reports and skips it, returning `None`.
    fn node(&mut self) -> Option<Node> {
        let start = self.token().span;
        let kind = match self.peek() {
            TokenKind::Ident if self.at_binding("state") => {
                self.error(
                    start,
                    "`state` can only be declared at the top level of a component",
                );
                self.state_decl();
                return None;
            }
            TokenKind::Ident
                if self.at_binding("let")
                    && matches!(self.peek_at(2), TokenKind::Colon | TokenKind::Eq) =>
            {
                self.error(start, "`let` must be declared before any node");
                self.let_decl();
                return None;
            }
            TokenKind::Ident if self.peek_at(1) == TokenKind::Colon => {
                let name = self.ident("slot name")?;
                self.bump(); // `:`
                let block = self.block();
                NodeKind::SlotFill(SlotFill {
                    name,
                    block,
                    span: self.span_from(start),
                })
            }
            TokenKind::Ident => NodeKind::Element(self.element()),
            TokenKind::If => NodeKind::If(self.if_node()),
            TokenKind::For => NodeKind::For(self.for_node()?),
            _ => {
                self.error_expected("a node (element, `if` or `for`)");
                self.skip_balanced();
                return None;
            }
        };
        Some(Node {
            kind,
            span: self.span_from(start),
        })
    }

    fn element(&mut self) -> ElementNode {
        let mut path = Vec::new();
        path.extend(self.ident("element name"));
        while self.at(TokenKind::Dot) && self.peek_at(1) == TokenKind::Ident {
            self.bump();
            path.extend(self.ident("element name"));
        }
        let args = if self.eat(TokenKind::LParen) {
            self.comma_list(TokenKind::RParen, |p| Some(p.arg()))
        } else {
            Vec::new()
        };
        let children = self.at(TokenKind::LBrace).then(|| self.block());
        ElementNode {
            path,
            args,
            children,
        }
    }

    fn if_node(&mut self) -> IfNode {
        let mut branches = Vec::new();
        let mut else_block = None;
        loop {
            self.bump(); // `if`
            let cond = self.paren_expr();
            let block = self.block();
            branches.push(IfBranch { cond, block });
            if !self.eat(TokenKind::Else) {
                break;
            }
            if !self.at(TokenKind::If) {
                else_block = Some(self.block());
                break;
            }
        }
        IfNode {
            branches,
            else_block,
        }
    }

    fn for_node(&mut self) -> Option<ForNode> {
        self.bump(); // `for`
        self.expect(TokenKind::LParen)?;
        let var = self.ident("loop variable")?;
        self.expect(TokenKind::In)?;
        let iter = self.expr();
        let mut key = None;
        if self.eat(TokenKind::Semi) {
            let token = self.token();
            if token.kind == TokenKind::Ident && self.text_of(token.span) == "key" {
                self.bump();
                if self.expect(TokenKind::Eq).is_some() {
                    key = Some(self.expr());
                }
            } else {
                self.error_expected("`key`");
            }
        }
        if self.expect(TokenKind::RParen).is_none() {
            while !matches!(
                self.peek(),
                TokenKind::RParen | TokenKind::LBrace | TokenKind::RBrace | TokenKind::Eof
            ) {
                self.skip_balanced();
            }
            self.eat(TokenKind::RParen);
        }
        let body = self.block();
        Some(ForNode {
            var,
            iter,
            key,
            body,
        })
    }

    fn arg(&mut self) -> Arg {
        let start = self.token().span;
        let name = if self.at(TokenKind::Ident) && self.peek_at(1) == TokenKind::Eq {
            let name = self.ident("argument name");
            self.bump(); // `=`
            name
        } else {
            None
        };
        let value = self.expr();
        Arg {
            name,
            value,
            span: self.span_from(start),
        }
    }

    // ---- expressions ---------------------------------------------------

    fn error_expr(&self) -> Expr {
        Expr {
            kind: ExprKind::Error,
            span: self.token().span,
        }
    }

    fn paren_expr(&mut self) -> Expr {
        if self.expect(TokenKind::LParen).is_none() {
            return self.error_expr();
        }
        let expr = self.expr();
        self.expect(TokenKind::RParen);
        expr
    }

    fn expr(&mut self) -> Expr {
        self.binary(0)
    }

    fn binary(&mut self, min_power: u8) -> Expr {
        let mut lhs = self.unary();
        while let Some((op, power)) = binary_op(self.peek()) {
            if power < min_power {
                break;
            }
            self.bump();
            let rhs = self.binary(power + 1);
            lhs = Expr {
                span: lhs.span.to(rhs.span),
                kind: ExprKind::Binary {
                    op,
                    lhs: Box::new(lhs),
                    rhs: Box::new(rhs),
                },
            };
        }
        lhs
    }

    fn unary(&mut self) -> Expr {
        let op = match self.peek() {
            TokenKind::Bang => UnaryOp::Not,
            TokenKind::Minus => UnaryOp::Neg,
            _ => return self.postfix(),
        };
        let start = self.token().span;
        let Some(expr) = self.with_depth(start, |p| {
            p.bump();
            p.unary()
        }) else {
            while matches!(self.peek(), TokenKind::Bang | TokenKind::Minus) {
                self.bump();
            }
            return self.error_expr();
        };
        Expr {
            span: start.to(expr.span),
            kind: ExprKind::Unary {
                op,
                expr: Box::new(expr),
            },
        }
    }

    fn postfix(&mut self) -> Expr {
        let mut expr = self.primary();
        loop {
            match self.peek() {
                TokenKind::Dot | TokenKind::QuestionDot => {
                    let safe = self.bump().kind == TokenKind::QuestionDot;
                    let Some(name) = self.ident("field name") else {
                        return expr;
                    };
                    expr = Expr {
                        span: expr.span.to(name.span),
                        kind: ExprKind::Field {
                            base: Box::new(expr),
                            name,
                            safe,
                        },
                    };
                }
                TokenKind::LParen
                    if matches!(expr.kind, ExprKind::Ident(_) | ExprKind::Field { .. }) =>
                {
                    self.bump();
                    let args = self.comma_list(TokenKind::RParen, |p| Some(p.arg()));
                    expr = Expr {
                        span: self.span_from(expr.span),
                        kind: ExprKind::Call {
                            callee: Box::new(expr),
                            args,
                        },
                    };
                }
                _ => return expr,
            }
        }
    }

    fn primary(&mut self) -> Expr {
        let token = self.token();
        let kind = match token.kind {
            TokenKind::Int => {
                self.bump();
                match self.text_of(token.span).parse::<i64>() {
                    Ok(value) => ExprKind::Int(value),
                    Err(_) => {
                        self.error(token.span, "integer literal is out of range for `Int`");
                        ExprKind::Error
                    }
                }
            }
            TokenKind::Float => {
                self.bump();
                self.parse_float(token.span)
                    .map_or(ExprKind::Error, ExprKind::Float)
            }
            TokenKind::Str => {
                self.bump();
                ExprKind::Str(self.string_parts(token.span))
            }
            TokenKind::True | TokenKind::False => {
                self.bump();
                ExprKind::Bool(token.kind == TokenKind::True)
            }
            TokenKind::Null => {
                self.bump();
                ExprKind::Null
            }
            TokenKind::Ident => {
                self.bump();
                ExprKind::Ident(self.text_of(token.span).to_owned())
            }
            TokenKind::LParen => {
                let Some(inner) = self.with_depth(token.span, |p| {
                    p.bump();
                    let inner = p.expr();
                    p.expect(TokenKind::RParen);
                    inner
                }) else {
                    self.skip_balanced();
                    return self.error_expr();
                };
                return Expr {
                    kind: inner.kind,
                    span: self.span_from(token.span),
                };
            }
            TokenKind::If => return self.if_expr(),
            TokenKind::LBrace => ExprKind::Lambda(self.lambda()),
            _ => {
                self.error_expected("expression");
                return self.error_expr();
            }
        };
        Expr {
            kind,
            span: self.span_from(token.span),
        }
    }

    fn parse_float(&mut self, span: Span) -> Option<f64> {
        let value = self
            .text_of(span)
            .parse::<f64>()
            .expect("lexer only produces valid float literals");
        if value.is_finite() {
            Some(value)
        } else {
            self.error(span, "floating-point literal is out of range for `Float`");
            None
        }
    }

    fn if_expr(&mut self) -> Expr {
        let start = self.token().span;
        let Some(expr) = self.with_depth(start, |p| {
            p.bump(); // `if`
            let cond = p.paren_expr();
            let then = p.expr();
            let else_ = if p.expect(TokenKind::Else).is_some() {
                p.expr()
            } else {
                p.error_expr()
            };
            Expr {
                kind: ExprKind::If {
                    cond: Box::new(cond),
                    then: Box::new(then),
                    else_: Box::new(else_),
                },
                span: p.span_from(start),
            }
        }) else {
            self.bump(); // `if`
            if self.at(TokenKind::LParen) {
                self.skip_balanced();
            }
            return self.error_expr();
        };
        expr
    }

    fn lambda(&mut self) -> Lambda {
        let start = self.token().span;
        let Some(lambda) = self.with_depth(start, |p| {
            p.bump(); // `{`
            let param = if p.at(TokenKind::Ident) && p.peek_at(1) == TokenKind::Arrow {
                let param = p.ident("lambda parameter");
                p.bump(); // `->`
                param
            } else {
                None
            };
            let mut body = Vec::new();
            while !p.at(TokenKind::RBrace) && !p.at(TokenKind::Eof) {
                match p.lambda_stmt() {
                    Some(stmt) => body.push(stmt),
                    None => {
                        while !matches!(
                            p.peek(),
                            TokenKind::Semi | TokenKind::RBrace | TokenKind::Eof
                        ) {
                            p.skip_balanced();
                        }
                    }
                }
                p.eat(TokenKind::Semi);
            }
            p.expect(TokenKind::RBrace);
            Lambda { param, body }
        }) else {
            self.skip_balanced();
            return Lambda {
                param: None,
                body: Vec::new(),
            };
        };
        lambda
    }

    fn lambda_stmt(&mut self) -> Option<LambdaStmt> {
        let target = self.ident("assignment to a `state` or event call")?;
        if self.eat(TokenKind::LParen) {
            let args = self.comma_list(TokenKind::RParen, |p| Some(p.arg()));
            return Some(LambdaStmt::Call(CallStmt {
                span: self.span_from(target.span),
                callee: target,
                args,
            }));
        }
        let op = match self.peek() {
            TokenKind::Eq => AssignOp::Set,
            TokenKind::PlusEq => AssignOp::Add,
            TokenKind::MinusEq => AssignOp::Sub,
            _ => {
                self.error_expected("`=`, `+=` or `-=`");
                return None;
            }
        };
        self.bump();
        let value = self.expr();
        Some(LambdaStmt::Assign(Assign {
            span: self.span_from(target.span),
            target,
            op,
            value,
        }))
    }

    // ---- strings -------------------------------------------------------

    fn literal_string(&mut self, span: Span, interpolation_error: &str) -> Option<String> {
        let mut parts = self.string_parts(span).into_iter();
        match (parts.next(), parts.next()) {
            (None, None) => Some(String::new()),
            (Some(StrPart::Lit(text)), None) => Some(text),
            _ => {
                self.error(span, interpolation_error);
                None
            }
        }
    }

    /// Decodes a string token into literal and interpolated parts.
    fn string_parts(&mut self, span: Span) -> Vec<StrPart> {
        let base = span.start as usize;
        let raw = self.text_of(span);
        let bytes = raw.as_bytes();
        let mut parts = Vec::new();
        let mut lit = String::new();
        let mut i = 1; // skip the opening quote
        while i < bytes.len() {
            match bytes[i] {
                b'"' => break,
                b'\\' => {
                    let (decoded, len) = self.escape(raw, i, base);
                    lit.extend(decoded);
                    i += len;
                }
                b'$' if bytes.get(i + 1) == Some(&b'{') => {
                    let Ok(end) = scan_interpolation(bytes, i + 2) else {
                        break; // unterminated; reported by the lexer
                    };
                    if !lit.is_empty() {
                        parts.push(StrPart::Lit(std::mem::take(&mut lit)));
                    }
                    let inner = Span::new(self.file, offset(base + i + 2), offset(base + end - 1));
                    parts.push(StrPart::Expr(self.interpolation(inner)));
                    i = end;
                }
                _ => {
                    let ch = raw[i..].chars().next().expect("index is a char boundary");
                    lit.push(ch);
                    i += ch.len_utf8();
                }
            }
        }
        if !lit.is_empty() {
            parts.push(StrPart::Lit(lit));
        }
        parts
    }

    /// Decodes the escape starting at `raw[i] == '\\'`; returns the char and byte length.
    fn escape(&mut self, raw: &str, i: usize, base: usize) -> (Option<char>, usize) {
        let span = |len: usize| Span::new(self.file, offset(base + i), offset(base + i + len));
        let Some(next) = raw[i + 1..].chars().next() else {
            return (None, 1);
        };
        let simple = match next {
            'n' => Some('\n'),
            'r' => Some('\r'),
            't' => Some('\t'),
            '0' => Some('\0'),
            '\\' => Some('\\'),
            '"' => Some('"'),
            '$' => Some('$'),
            _ => None,
        };
        if simple.is_some() {
            return (simple, 2);
        }
        if next == 'u' {
            let rest = &raw[i + 2..];
            if let Some(body) = rest.strip_prefix('{')
                && let Some(close) = body.find('}')
            {
                let len = 2 + 1 + close + 1;
                let decoded = u32::from_str_radix(&body[..close], 16)
                    .ok()
                    .and_then(char::from_u32);
                if decoded.is_none() {
                    self.error(span(len), "invalid unicode escape");
                }
                return (decoded, len);
            }
            self.error(span(2), "unicode escape must have the form `\\u{XXXX}`");
            return (None, 2);
        }
        let len = 1 + next.len_utf8();
        self.error(span(len), format!("unknown escape sequence `\\{next}`"));
        (None, len)
    }

    fn interpolation(&mut self, inner: Span) -> Expr {
        let text = self.text_of(inner);
        if text.trim().is_empty() {
            self.error(inner, "empty interpolation");
            return Expr {
                kind: ExprKind::Error,
                span: inner,
            };
        }
        let mut diags = Vec::new();
        let tokens = lex(self.file, text, inner.start, &mut diags);
        let mut sub = Parser::new(self.file, self.text, tokens, diags);
        sub.in_interpolation = true;
        sub.depth = self.depth.saturating_add(1);
        let Some(expr) = sub.with_depth(inner, |p| {
            let expr = p.expr();
            if !p.at(TokenKind::Eof) {
                p.error_expected("`}` to end the interpolation");
            }
            expr
        }) else {
            self.diags.append(&mut sub.diags);
            return Expr {
                kind: ExprKind::Error,
                span: inner,
            };
        };
        self.diags.append(&mut sub.diags);
        expr
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_ok(src: &str) -> File {
        let (file, diags) = parse(FileId(0), src);
        assert!(diags.is_empty(), "unexpected diagnostics: {diags:#?}");
        file
    }

    fn first_expr(src: &str) -> Expr {
        let file = parse_ok(&format!("component C() {{ Text({src}) }}"));
        let Item::Component(c) = &file.items[0] else {
            panic!("expected component");
        };
        let NodeKind::Element(e) = &c.body[0].kind else {
            panic!("expected element");
        };
        e.args[0].value.clone()
    }

    #[test]
    fn precedence_and_associativity() {
        let ExprKind::Binary { op, lhs, rhs } = first_expr("a || b && c == 1 + 2 * 3").kind else {
            panic!("expected binary");
        };
        assert_eq!(op, BinaryOp::Or);
        assert_eq!(lhs.kind, ExprKind::Ident("a".into()));
        let ExprKind::Binary {
            op: BinaryOp::And,
            rhs,
            ..
        } = rhs.kind
        else {
            panic!("`&&` binds tighter than `||`");
        };
        let ExprKind::Binary {
            op: BinaryOp::Eq,
            rhs,
            ..
        } = rhs.kind
        else {
            panic!("`==` binds tighter than `&&`");
        };
        let ExprKind::Binary {
            op: BinaryOp::Add,
            rhs,
            ..
        } = rhs.kind
        else {
            panic!("`+` binds tighter than `==`");
        };
        assert!(matches!(
            rhs.kind,
            ExprKind::Binary {
                op: BinaryOp::Mul,
                ..
            }
        ));

        let ExprKind::Binary {
            op: BinaryOp::Sub,
            lhs,
            ..
        } = first_expr("a - b - c").kind
        else {
            panic!("expected subtraction");
        };
        assert!(
            matches!(
                lhs.kind,
                ExprKind::Binary {
                    op: BinaryOp::Sub,
                    ..
                }
            ),
            "`-` is left-associative"
        );
    }

    #[test]
    fn interpolation_parts_and_spans() {
        let src = r#"component C() { Text("n = ${a.b + 1}!\n") }"#;
        let file = parse_ok(src);
        let Item::Component(c) = &file.items[0] else {
            panic!("expected component");
        };
        let NodeKind::Element(e) = &c.body[0].kind else {
            panic!("expected element");
        };
        let ExprKind::Str(parts) = &e.args[0].value.kind else {
            panic!("expected string");
        };
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], StrPart::Lit("n = ".into()));
        let StrPart::Expr(inner) = &parts[1] else {
            panic!("expected interpolation");
        };
        assert_eq!(
            &src[inner.span.start as usize..inner.span.end as usize],
            "a.b + 1"
        );
        assert_eq!(parts[2], StrPart::Lit("!\n".into()));
    }

    #[test]
    fn element_trailing_block_and_lambda() {
        let file = parse_ok(
            "component C() { state n = 0\n Button(onClick = { v -> n += 1; n = n * 2 }) { Text(\"x\") } }",
        );
        let Item::Component(c) = &file.items[0] else {
            panic!("expected component");
        };
        assert_eq!(c.states.len(), 1);
        let NodeKind::Element(button) = &c.body[0].kind else {
            panic!("expected element");
        };
        assert_eq!(button.children.as_ref().map(|b| b.nodes.len()), Some(1));
        let ExprKind::Lambda(lambda) = &button.args[0].value.kind else {
            panic!("expected lambda");
        };
        assert_eq!(lambda.param.as_ref().map(|p| p.name.as_str()), Some("v"));
        assert_eq!(lambda.body.len(), 2);
        let LambdaStmt::Assign(assign) = &lambda.body[0] else {
            panic!("expected assignment");
        };
        assert_eq!(assign.op, AssignOp::Add);
    }

    #[test]
    fn recovers_and_reports_every_broken_item() {
        let src =
            "model A { x: Int y: Int }\nevent E(\ncomponent C() { Text(1 +) }\nmodel B { z: }";
        let (file, diags) = parse(FileId(0), src);
        let names: Vec<_> = file
            .items
            .iter()
            .map(|i| i.name().expect("named fixture item").name.as_str())
            .collect();
        assert_eq!(names, ["A", "E", "C", "B"]);
        assert_eq!(diags.len(), 4, "{diags:#?}");
    }

    #[test]
    fn rejects_overflowing_float_literals() {
        let (_, diags) = parse(FileId(0), "component C() { state x = 1e999 }");
        assert!(
            diags
                .iter()
                .any(|d| d.message.contains("out of range for `Float`")),
            "{diags:#?}"
        );
        let (_, theme_diags) = parse(FileId(0), "theme { big = 1e999 }");
        assert!(
            theme_diags
                .iter()
                .any(|d| d.message.contains("out of range for `Float`")),
            "{theme_diags:#?}"
        );
    }

    #[test]
    fn nesting_limit_prevents_stack_overflow() {
        let parens = format!(
            "component C() {{ Text({}1{}) }}",
            "(".repeat(500),
            ")".repeat(500)
        );
        let unary = format!("component C() {{ Text({}true) }}", "!".repeat(500));
        let blocks = format!(
            "component C() {{ {}Text(\"hi\"){} }}",
            "Column { ".repeat(500),
            " }".repeat(500)
        );
        let types = format!("event E(x: {}Int{})", "Event<".repeat(500), ">".repeat(500));
        for src in [parens, unary, blocks, types] {
            let (_, diags) = parse(FileId(0), &src);
            assert!(
                diags
                    .iter()
                    .any(|d| d.message.contains("nesting limit exceeded")),
                "{diags:#?}"
            );
        }
    }
}
