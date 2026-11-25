use weft_ui_ast::{
    Arg, AssignOp, Block, ComponentDecl, Expr, ExprKind, Field, File, Ident, Item, Lambda,
    LambdaStmt, LetDecl, Node, NodeKind, Param, Span, StyleDecl, ThemeDecl, ThemeValue, TypeExpr,
    TypeExprKind, UnaryOp,
};
use weft_ui_parser::token::{Token, TokenKind};

use crate::layout::{Doc, Line};
use crate::{FormatError, Options, text_at};

pub(super) fn print(
    source: &str,
    tokens: &[Token],
    comments: &[Span],
    file: &File,
    options: &Options,
) -> Result<(String, Vec<usize>), FormatError> {
    let mut printer = Printer {
        source,
        tokens,
        comments,
        pos: 0,
        anchor: 0,
        doc: Doc::default(),
        elided: Vec::new(),
    };
    printer.file(file)?;
    Ok((printer.doc.render(options, source.len()), printer.elided))
}

#[derive(Clone, Copy)]
enum Gap {
    First,
    Preserve,
    Section,
}

type Printed = Result<(), FormatError>;

struct Printer<'src, 'tokens> {
    source: &'src str,
    tokens: &'tokens [Token],
    comments: &'tokens [Span],
    pos: usize,
    /// End of the previous item or comment; an optional separator isn't part of either.
    anchor: u32,
    doc: Doc<'src>,
    /// Optional empty parentheses and repeated wrappers, in input token order.
    elided: Vec<usize>,
}

impl<'src> Printer<'src, '_> {
    fn current(&self) -> Token {
        self.tokens[self.pos]
    }

    fn at(&self, kind: TokenKind) -> bool {
        self.current().kind == kind
    }

    fn consume(&mut self, kind: TokenKind) -> Result<Token, FormatError> {
        let token = self.current();
        if token.kind != kind {
            return Err(FormatError::Internal(format!(
                "expected {kind} at byte {}, got {}",
                token.span.start, token.kind,
            )));
        }
        if let Some(comment) = self.comment_before(token.span.start) {
            return Err(FormatError::Internal(format!(
                "cannot place comment at byte {} before {kind}",
                comment.start,
            )));
        }
        if kind != TokenKind::Eof {
            self.pos += 1;
            self.anchor = token.span.end;
        }
        Ok(token)
    }

    fn token(&mut self, kind: TokenKind) -> Printed {
        let token = self.consume(kind)?;
        self.doc.text(text_at(self.source, token.span));
        Ok(())
    }

    fn spanned_token(&mut self, kind: TokenKind, span: Span) -> Printed {
        if self.current().span != span {
            return Err(FormatError::Internal(format!(
                "expected {kind} at byte {}, got a token at byte {}",
                span.start,
                self.current().span.start,
            )));
        }
        self.token(kind)
    }

    fn ident(&mut self, ident: &Ident) -> Printed {
        self.spanned_token(TokenKind::Ident, ident.span)
    }

    fn elide(&mut self, kind: TokenKind) -> Printed {
        let index = self.pos;
        self.consume(kind)?;
        self.elided.push(index);
        Ok(())
    }

    fn optional_separator(&mut self, kind: TokenKind) {
        if self.at(kind) {
            self.pos += 1;
        }
    }

    fn comment_before(&self, offset: u32) -> Option<Span> {
        self.comments.first().copied().filter(|c| c.start < offset)
    }

    fn blank_before(&self, offset: u32) -> bool {
        let gap = &self.source[self.anchor as usize..offset as usize];
        let mut lines = gap.split('\n');
        lines.next(); // remainder of the preceding item's line
        lines.next_back(); // indentation on the following item's line
        lines.any(|line| line.trim().is_empty())
    }

    fn take_comment(&mut self, span: Span) -> &'src str {
        self.comments = &self.comments[1..];
        self.anchor = span.end;
        text_at(self.source, span)
    }

    fn comment(&mut self, span: Span) {
        let text = self.take_comment(span);
        self.doc.comment(text);
    }

    fn operator_gap(&mut self) {
        let token_start = self.current().span.start;
        let mut comment = self.comment_before(token_start);
        if comment.is_none() {
            self.doc.text(" ");
            return;
        }
        loop {
            let next = comment.map_or(token_start, |span| span.start);
            let gap = &self.source[self.anchor as usize..next as usize];
            if gap.contains('\n') {
                self.doc.line(Line::Hard, self.blank_before(next));
            } else {
                self.doc.text(" ");
            }
            let Some(span) = comment else { break };
            let text = self.take_comment(span);
            // Only a single-line block comment can be part of a flat group.
            if text.starts_with("/*") && !text.contains('\n') {
                self.doc.text(text);
            } else {
                self.doc.comment(text);
            }
            comment = self.comment_before(token_start);
        }
    }

    fn boundary(&mut self, mut line: Line, mut gap: Gap) {
        let next = self.current();
        while let Some(comment) = self.comment_before(next.span.start) {
            let blank = match gap {
                Gap::First => false,
                Gap::Preserve => self.blank_before(comment.start),
                Gap::Section => true,
            };
            self.doc.line(Line::Hard, blank);
            self.comment(comment);
            gap = Gap::Preserve;
            line = Line::Hard;
        }
        let closing = matches!(
            next.kind,
            TokenKind::RBrace | TokenKind::RParen | TokenKind::Eof
        );
        let blank = match gap {
            Gap::First => false,
            Gap::Preserve => !closing && self.blank_before(next.span.start),
            Gap::Section => true,
        };
        self.doc.line(line, blank);
    }

    fn trailing_comments(&mut self) {
        let next = self.current().span.start;
        while let Some(comment) = self.comment_before(next) {
            if self.source[self.anchor as usize..comment.start as usize].contains('\n') {
                break;
            }
            self.doc.text(" ");
            self.comment(comment);
        }
    }

    fn empty_pair_at(&self, index: usize) -> bool {
        matches!(
            self.tokens.get(index..index + 2),
            Some([open, close])
                if open.kind == TokenKind::LParen && close.kind == TokenKind::RParen
        )
    }

    fn lead_with_empty_pair_comments(&mut self, open: usize) {
        // With no items there is no place for these comments after eliding the
        // optional list. Move them together to just before its declaration/node.
        let open_span = self.tokens[open].span;
        let close_span = self.tokens[open + 1].span;
        let anchor = self.anchor;
        while let Some(comment) = self.comment_before(close_span.start) {
            if comment.start < open_span.end {
                break;
            }
            self.comment(comment);
            let blank = self
                .comment_before(close_span.start)
                .is_some_and(|next| self.blank_before(next.start));
            self.doc.line(Line::Hard, blank);
        }
        self.anchor = anchor;
    }

    fn file(&mut self, file: &File) -> Printed {
        let mut gap = Gap::First;
        for import in &file.imports {
            self.boundary(Line::Hard, gap);
            self.token(TokenKind::Ident)?;
            self.doc.text(" ");
            self.spanned_token(TokenKind::Str, import.path_span)?;
            self.trailing_comments();
            gap = Gap::Preserve;
        }
        if !file.imports.is_empty() {
            gap = Gap::Section;
        }
        let mut previous_event = true;
        for item in &file.items {
            let event = matches!(item, Item::Event(_));
            if !matches!(gap, Gap::First) && !(previous_event && event) {
                gap = Gap::Section;
            }
            self.boundary(Line::Hard, gap);
            self.item(item)?;
            self.trailing_comments();
            gap = Gap::Preserve;
            previous_event = event;
        }
        self.boundary(Line::Hard, gap);
        self.consume(TokenKind::Eof)?;
        Ok(())
    }

    fn item(&mut self, item: &Item) -> Printed {
        match item {
            Item::Model(model) => {
                self.token(TokenKind::Ident)?;
                self.doc.text(" ");
                self.ident(&model.name)?;
                self.doc.text(" ");
                self.token(TokenKind::LBrace)?;
                self.comma_items(&model.fields, TokenKind::RBrace, Line::Hard, Self::field)
            }
            Item::Event(event) => {
                let open = self.pos + 2;
                let empty_pair = event.params.is_empty() && self.empty_pair_at(open);
                if empty_pair {
                    self.lead_with_empty_pair_comments(open);
                }
                self.token(TokenKind::Ident)?;
                self.doc.text(" ");
                self.ident(&event.name)?;
                if empty_pair {
                    self.elide(TokenKind::LParen)?;
                    self.elide(TokenKind::RParen)
                } else if event.params.is_empty() {
                    Ok(())
                } else {
                    self.comma_group(&event.params, Self::field)
                }
            }
            Item::Component(component) => self.component(component),
            Item::TypeAlias(alias) => {
                self.token(TokenKind::Ident)?;
                self.operator_gap();
                self.ident(&alias.name)?;
                self.operator_gap();
                self.token(TokenKind::Eq)?;
                self.operator_gap();
                self.ty(&alias.ty)
            }
            Item::Style(style) => self.style_decl(style),
            Item::Theme(theme) => self.theme_decl(theme),
        }
    }

    fn style_decl(&mut self, style: &StyleDecl) -> Printed {
        self.token(TokenKind::Ident)?;
        self.doc.text(" ");
        self.ident(&style.name)?;
        self.constant_entries(&style.entries, |printer, entry| {
            printer.entry_name(&entry.name)?;
            printer.expr(&entry.value)
        })
    }

    fn theme_decl(&mut self, theme: &ThemeDecl) -> Printed {
        self.token(TokenKind::Ident)?;
        self.constant_entries(&theme.entries, |printer, entry| {
            printer.entry_name(&entry.name)?;
            match &entry.value {
                ThemeValue::Color { dark, .. } => {
                    printer.token(TokenKind::Str)?;
                    if dark.is_some() {
                        printer.operator_gap();
                        printer.token(TokenKind::Ident)?;
                        printer.operator_gap();
                        printer.token(TokenKind::Str)?;
                    }
                    Ok(())
                }
                ThemeValue::Int(_) | ThemeValue::Float(_) => {
                    if printer.at(TokenKind::Minus) {
                        printer.token(TokenKind::Minus)?;
                    }
                    printer.token(match entry.value {
                        ThemeValue::Int(_) => TokenKind::Int,
                        _ => TokenKind::Float,
                    })
                }
            }
        })
    }

    fn entry_name(&mut self, name: &Ident) -> Printed {
        self.ident(name)?;
        self.operator_gap();
        self.token(TokenKind::Eq)?;
        self.operator_gap();
        Ok(())
    }

    fn constant_entries<T>(
        &mut self,
        entries: &[T],
        print: impl Fn(&mut Self, &T) -> Printed,
    ) -> Printed {
        self.doc.text(" ");
        self.token(TokenKind::LBrace)?;
        if entries.is_empty() && self.comment_before(self.current().span.start).is_none() {
            return self.token(TokenKind::RBrace);
        }
        self.doc.indent();
        let mut gap = Gap::First;
        for entry in entries {
            self.boundary(Line::Hard, gap);
            print(self, entry)?;
            // Entries may be adjacent without a comma. Preserve the choice.
            if self.at(TokenKind::Comma) {
                self.optional_separator(TokenKind::Comma);
                self.doc.text(",");
            }
            self.trailing_comments();
            gap = Gap::Preserve;
        }
        self.close(TokenKind::RBrace, Line::Hard, gap)
    }

    fn component(&mut self, component: &ComponentDecl) -> Printed {
        self.token(TokenKind::Ident)?;
        self.doc.text(" ");
        self.ident(&component.name)?;
        self.comma_group(&component.params, Self::param)?;
        self.doc.text(" ");
        self.token(TokenKind::LBrace)?;
        self.doc.indent();
        let mut gap = Gap::First;
        for state in &component.states {
            self.boundary(Line::Hard, gap);
            self.value_decl(&state.name, state.ty.as_ref(), &state.init)?;
            self.trailing_comments();
            gap = Gap::Preserve;
        }
        if !component.states.is_empty() && !component.lets.is_empty() {
            gap = Gap::Section;
        }
        self.block_contents(&component.lets, &component.body, gap)
    }

    fn value_decl(&mut self, name: &Ident, ty: Option<&TypeExpr>, value: &Expr) -> Printed {
        self.token(TokenKind::Ident)?;
        self.doc.text(" ");
        if let Some(ty) = ty {
            self.typed_name(name, ty)?;
        } else {
            self.ident(name)?;
        }
        self.doc.text(" ");
        self.token(TokenKind::Eq)?;
        self.doc.text(" ");
        self.expr(value)
    }

    fn comma_group<T>(&mut self, items: &[T], item: fn(&mut Self, &T) -> Printed) -> Printed {
        let group = self.doc.begin_group();
        self.token(TokenKind::LParen)?;
        self.comma_items(items, TokenKind::RParen, Line::Soft, item)?;
        self.doc.end_group(group);
        Ok(())
    }

    fn comma_items<T>(
        &mut self,
        items: &[T],
        close: TokenKind,
        line: Line,
        item: fn(&mut Self, &T) -> Printed,
    ) -> Printed {
        if items.is_empty() && self.comment_before(self.current().span.start).is_none() {
            return self.token(close);
        }
        self.doc.indent();
        let mut gap = Gap::First;
        let mut split = line;
        for (index, entry) in items.iter().enumerate() {
            self.boundary(split, gap);
            item(self, entry)?;
            self.optional_separator(TokenKind::Comma);
            if index + 1 < items.len() || matches!(line, Line::Hard) {
                self.doc.text(",");
            } else {
                self.doc.if_broken(",");
            }
            self.trailing_comments();
            gap = Gap::Preserve;
            if !matches!(line, Line::Hard) {
                split = Line::Space;
            }
        }
        self.close(close, line, gap)
    }

    fn close(&mut self, close: TokenKind, line: Line, gap: Gap) -> Printed {
        self.boundary(line, gap);
        self.doc.dedent();
        self.token(close)
    }

    fn field(&mut self, field: &Field) -> Printed {
        self.typed_name(&field.name, &field.ty)
    }

    fn param(&mut self, param: &Param) -> Printed {
        self.typed_name(&param.name, &param.ty)?;
        if let Some(default) = &param.default {
            self.doc.text(" ");
            self.token(TokenKind::Eq)?;
            self.doc.text(" ");
            self.expr(default)?;
        }
        Ok(())
    }

    fn typed_name(&mut self, name: &Ident, ty: &TypeExpr) -> Printed {
        self.ident(name)?;
        self.token(TokenKind::Colon)?;
        self.doc.text(" ");
        self.ty(ty)
    }

    fn ty(&mut self, ty: &TypeExpr) -> Printed {
        match &ty.kind {
            TypeExprKind::Named { name, args } => {
                self.ident(name)?;
                if let [payload] = args.as_slice() {
                    self.token(TokenKind::Lt)?;
                    self.ty(payload)?;
                    self.token(TokenKind::Gt)?;
                }
                Ok(())
            }
            TypeExprKind::Union(members) => {
                for (index, (_, span)) in members.iter().enumerate() {
                    if index != 0 {
                        self.operator_gap();
                        self.token(TokenKind::Pipe)?;
                        self.operator_gap();
                    }
                    self.spanned_token(TokenKind::Str, *span)?;
                }
                Ok(())
            }
            TypeExprKind::Array(inner) => {
                self.ty(inner)?;
                self.token(TokenKind::LBracket)?;
                self.token(TokenKind::RBracket)
            }
            TypeExprKind::Optional(inner) => {
                self.ty(inner)?;
                // Adjacent question marks would lex as the coalescing operator.
                if matches!(inner.kind, TypeExprKind::Optional(_)) {
                    self.doc.text(" ");
                }
                self.token(TokenKind::Question)
            }
            TypeExprKind::Error => Err(FormatError::Internal("cannot print invalid type".into())),
        }
    }

    fn block(&mut self, block: &Block) -> Printed {
        self.doc.text(" ");
        self.token(TokenKind::LBrace)?;
        self.doc.indent();
        self.block_contents(&block.lets, &block.nodes, Gap::First)
    }

    fn block_contents(&mut self, lets: &[LetDecl], nodes: &[Node], mut gap: Gap) -> Printed {
        if lets.is_empty()
            && nodes.is_empty()
            && matches!(gap, Gap::First)
            && self.comment_before(self.current().span.start).is_none()
        {
            self.doc.dedent();
            return self.token(TokenKind::RBrace);
        }
        for decl in lets {
            self.boundary(Line::Hard, gap);
            self.value_decl(&decl.name, decl.ty.as_ref(), &decl.value)?;
            self.trailing_comments();
            gap = Gap::Preserve;
        }
        if !matches!(gap, Gap::First) && !nodes.is_empty() {
            gap = Gap::Section;
        }
        for node in nodes {
            self.boundary(Line::Hard, gap);
            self.node(node)?;
            self.trailing_comments();
            gap = Gap::Preserve;
        }
        self.close(TokenKind::RBrace, Line::Hard, gap)
    }

    fn node(&mut self, node: &Node) -> Printed {
        match &node.kind {
            NodeKind::Element(element) => {
                let open = self.pos + 2 * element.path.len() - 1;
                let elide_pair = self.empty_pair_at(open)
                    && !(element.path.len() == 1
                        && matches!(
                            element.path[0].name.as_str(),
                            "let" | "state" | "model" | "event" | "component"
                        )
                        && self.tokens[open + 2].kind == TokenKind::Ident);
                if elide_pair {
                    self.lead_with_empty_pair_comments(open);
                }
                for (index, part) in element.path.iter().enumerate() {
                    if index > 0 {
                        self.token(TokenKind::Dot)?;
                    }
                    self.ident(part)?;
                }
                if elide_pair {
                    self.elide(TokenKind::LParen)?;
                    self.elide(TokenKind::RParen)?;
                } else if self.at(TokenKind::LParen) {
                    self.comma_group(&element.args, Self::arg)?;
                }
                if let Some(children) = &element.children {
                    self.block(children)?;
                }
            }
            NodeKind::If(node) => {
                for (index, branch) in node.branches.iter().enumerate() {
                    if index > 0 {
                        self.doc.text(" ");
                        self.token(TokenKind::Else)?;
                        self.doc.text(" ");
                    }
                    self.if_condition(&branch.cond)?;
                    self.block(&branch.block)?;
                }
                if let Some(block) = &node.else_block {
                    self.doc.text(" ");
                    self.token(TokenKind::Else)?;
                    self.block(block)?;
                }
            }
            NodeKind::For(node) => {
                self.token(TokenKind::For)?;
                self.doc.text(" ");
                self.token(TokenKind::LParen)?;
                self.ident(&node.var)?;
                self.doc.text(" ");
                self.token(TokenKind::In)?;
                self.doc.text(" ");
                self.expr(&node.iter)?;
                if let Some(key) = &node.key {
                    self.token(TokenKind::Semi)?;
                    self.doc.text(" ");
                    self.token(TokenKind::Ident)?;
                    self.doc.text(" ");
                    self.token(TokenKind::Eq)?;
                    self.doc.text(" ");
                    self.expr(key)?;
                }
                self.token(TokenKind::RParen)?;
                self.block(&node.body)?;
            }
            NodeKind::SlotFill(fill) => {
                self.ident(&fill.name)?;
                self.token(TokenKind::Colon)?;
                self.block(&fill.block)?;
            }
            NodeKind::Error => {
                return Err(FormatError::Internal("cannot print invalid node".into()));
            }
        }
        Ok(())
    }

    fn if_condition(&mut self, cond: &Expr) -> Printed {
        self.token(TokenKind::If)?;
        self.doc.text(" ");
        self.token(TokenKind::LParen)?;
        self.expr(cond)?;
        self.token(TokenKind::RParen)
    }

    fn arg(&mut self, arg: &Arg) -> Printed {
        if let Some(name) = &arg.name {
            self.ident(name)?;
            self.doc.text(" ");
            self.token(TokenKind::Eq)?;
            self.doc.text(" ");
        }
        self.expr(&arg.value)
    }

    fn expr(&mut self, expr: &Expr) -> Printed {
        // For binary/postfix nodes, a leading '(' may belong to the left child.
        // All other kinds begin with a non-parenthesis token in their own right.
        let child_start = match &expr.kind {
            ExprKind::Binary { lhs, .. }
            | ExprKind::Field { base: lhs, .. }
            | ExprKind::Call { callee: lhs, .. } => Some(lhs.span.start),
            _ => None,
        };
        let mut wrappers = 0;
        while self.at(TokenKind::LParen)
            && child_start.is_none_or(|start| self.current().span.start < start)
        {
            if wrappers == 0 {
                self.token(TokenKind::LParen)?;
            } else {
                self.elide(TokenKind::LParen)?;
            }
            wrappers += 1;
        }
        match &expr.kind {
            ExprKind::Int(_) => self.token(TokenKind::Int)?,
            ExprKind::Float(_) => self.token(TokenKind::Float)?,
            ExprKind::Str(_) => self.token(TokenKind::Str)?,
            ExprKind::Bool(true) => self.token(TokenKind::True)?,
            ExprKind::Bool(false) => self.token(TokenKind::False)?,
            ExprKind::Null => self.token(TokenKind::Null)?,
            ExprKind::Ident(_) => self.token(TokenKind::Ident)?,
            ExprKind::Field { base, name, safe } => {
                self.expr(base)?;
                self.token(if *safe {
                    TokenKind::QuestionDot
                } else {
                    TokenKind::Dot
                })?;
                self.ident(name)?;
            }
            ExprKind::Call { callee, args } => {
                self.expr(callee)?;
                self.comma_group(args, Self::arg)?;
            }
            ExprKind::Unary { op, expr } => {
                self.token(match op {
                    UnaryOp::Not => TokenKind::Bang,
                    UnaryOp::Neg => TokenKind::Minus,
                })?;
                self.expr(expr)?;
            }
            ExprKind::Binary { op, lhs, rhs } => {
                self.expr(lhs)?;
                self.operator_gap();
                let token = self.current();
                if text_at(self.source, token.span) != op.symbol() {
                    return Err(FormatError::Internal(format!(
                        "expected operator `{}` at byte {}",
                        op.symbol(),
                        token.span.start,
                    )));
                }
                self.token(token.kind)?;
                self.operator_gap();
                self.expr(rhs)?;
            }
            ExprKind::If { cond, then, else_ } => {
                self.if_condition(cond)?;
                self.doc.text(" ");
                self.expr(then)?;
                self.doc.text(" ");
                self.token(TokenKind::Else)?;
                self.doc.text(" ");
                self.expr(else_)?;
            }
            ExprKind::Lambda(lambda) => self.lambda(lambda)?,
            ExprKind::Error => {
                return Err(FormatError::Internal(
                    "cannot print invalid expression".into(),
                ));
            }
        }
        for _ in 1..wrappers {
            self.elide(TokenKind::RParen)?;
        }
        if wrappers > 0 {
            self.token(TokenKind::RParen)?;
        }
        Ok(())
    }

    fn lambda(&mut self, lambda: &Lambda) -> Printed {
        let group = self.doc.begin_group();
        self.token(TokenKind::LBrace)?;
        if let Some(param) = &lambda.param {
            self.doc.text(" ");
            self.ident(param)?;
            self.doc.text(" ");
            self.token(TokenKind::Arrow)?;
        }
        if lambda.param.is_some()
            || !lambda.body.is_empty()
            || self.comment_before(self.current().span.start).is_some()
        {
            self.doc.indent();
            let mut gap = Gap::First;
            for (index, stmt) in lambda.body.iter().enumerate() {
                self.boundary(Line::Space, gap);
                match stmt {
                    LambdaStmt::Assign(assign) => {
                        self.ident(&assign.target)?;
                        self.doc.text(" ");
                        self.token(match assign.op {
                            AssignOp::Set => TokenKind::Eq,
                            AssignOp::Add => TokenKind::PlusEq,
                            AssignOp::Sub => TokenKind::MinusEq,
                        })?;
                        self.doc.text(" ");
                        self.expr(&assign.value)?;
                    }
                    LambdaStmt::Call(call) => {
                        self.ident(&call.callee)?;
                        self.comma_group(&call.args, Self::arg)?;
                    }
                }
                self.optional_separator(TokenKind::Semi);
                if index + 1 < lambda.body.len() {
                    self.doc.if_flat(";");
                }
                self.trailing_comments();
                gap = Gap::Preserve;
            }
            self.close(TokenKind::RBrace, Line::Space, gap)?;
        } else {
            self.token(TokenKind::RBrace)?;
        }
        self.doc.end_group(group);
        Ok(())
    }
}
