//! Untyped syntax tree, source locations, and diagnostics for Weft UI.
//!
//! Syntax nodes carry the [`Span`] they were parsed from. Parse errors are
//! represented by `Error` variants so later passes can walk incomplete trees.

pub mod diagnostic;
mod program;
pub mod span;

pub use diagnostic::{Diagnostic, Severity};
pub use program::{ParsedFile, ParsedProgram};
pub use span::{FileId, SourceMap, Span};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ident {
    pub name: String,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct File {
    pub imports: Vec<Import>,
    pub items: Vec<Item>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Import {
    /// Decoded path literal, exactly as written (relative to the importing file).
    pub path: String,
    pub path_span: Span,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Item {
    Model(ModelDecl),
    Event(EventDecl),
    Component(ComponentDecl),
    Page(Page),
    App(AppDecl),
    TypeAlias(TypeAlias),
    Style(StyleDecl),
    Theme(ThemeDecl),
}

impl Item {
    /// The declared name, if this item introduces one into the module namespace.
    #[must_use]
    pub fn name(&self) -> Option<&Ident> {
        Some(match self {
            Item::Model(m) => &m.name,
            Item::Event(e) => &e.name,
            Item::Component(c) => &c.name,
            Item::Page(page) => &page.component.name,
            Item::App(app) => &app.name,
            Item::TypeAlias(alias) => &alias.name,
            Item::Style(style) => &style.name,
            Item::Theme(_) => return None,
        })
    }
}

/// Top-level declaration of the application's theme tokens.
#[derive(Debug, Clone, PartialEq)]
pub struct ThemeDecl {
    pub entries: Vec<ThemeEntry>,
    pub span: Span,
}

/// `name = value` in a theme declaration.
#[derive(Debug, Clone, PartialEq)]
pub struct ThemeEntry {
    pub name: Ident,
    pub value: ThemeValue,
    pub span: Span,
}

/// A fixed number or a color with an optional dark appearance.
#[derive(Debug, Clone, PartialEq)]
pub enum ThemeValue {
    Color {
        light: (String, Span),
        dark: Option<(String, Span)>,
    },
    Int(i64),
    Float(f64),
}

/// A named set of default properties for built-in elements.
#[derive(Debug, Clone, PartialEq)]
pub struct StyleDecl {
    pub name: Ident,
    pub entries: Vec<StyleEntry>,
    pub span: Span,
}

/// `property = literal` in a style declaration.
#[derive(Debug, Clone, PartialEq)]
pub struct StyleEntry {
    pub name: Ident,
    pub value: Expr,
    pub span: Span,
}

/// A top-level `type Name = Type` declaration.
#[derive(Debug, Clone, PartialEq)]
pub struct TypeAlias {
    pub name: Ident,
    pub ty: TypeExpr,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModelDecl {
    pub name: Ident,
    pub fields: Vec<Field>,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EventDecl {
    pub name: Ident,
    pub params: Vec<Field>,
    pub span: Span,
}

/// `name: Type` in a model body or event parameter list.
#[derive(Debug, Clone, PartialEq)]
pub struct Field {
    pub name: Ident,
    pub ty: TypeExpr,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ComponentDecl {
    pub name: Ident,
    pub params: Vec<Param>,
    pub states: Vec<StateDecl>,
    pub lets: Vec<LetDecl>,
    pub body: Vec<Node>,
    pub span: Span,
}

/// Application declaration and its initial page.
#[derive(Debug, Clone, PartialEq)]
pub struct AppDecl {
    pub name: Ident,
    pub start: Ident,
    pub span: Span,
}

/// A page shares its body and parameters with a component and may declare a route path.
#[derive(Debug, Clone, PartialEq)]
pub struct Page {
    pub component: ComponentDecl,
    /// Decoded path and the span of its string literal, if explicitly declared.
    pub path: Option<(String, Span)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Param {
    pub name: Ident,
    pub ty: TypeExpr,
    pub default: Option<Expr>,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StateDecl {
    pub name: Ident,
    pub ty: Option<TypeExpr>,
    pub init: Expr,
    pub span: Span,
}

/// An immutable, optionally typed expression alias within a component or block.
#[derive(Debug, Clone, PartialEq)]
pub struct LetDecl {
    pub name: Ident,
    pub ty: Option<TypeExpr>,
    pub value: Expr,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TypeExpr {
    pub kind: TypeExprKind,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TypeExprKind {
    Named {
        name: Ident,
        args: Vec<TypeExpr>,
    },
    /// Decoded string literals and their source spans, in declaration order.
    Union(Vec<(String, Span)>),
    Array(Box<TypeExpr>),
    Optional(Box<TypeExpr>),
    Error,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Block {
    pub lets: Vec<LetDecl>,
    pub nodes: Vec<Node>,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    pub kind: NodeKind,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub enum NodeKind {
    Element(ElementNode),
    If(IfNode),
    For(ForNode),
    SlotFill(SlotFill),
    Error,
}

/// `name: { ... }` in a component call's child block.
#[derive(Debug, Clone, PartialEq)]
pub struct SlotFill {
    pub name: Ident,
    pub block: Block,
    pub span: Span,
}

/// `Path(args) { children }`; both the argument list and the block are optional.
#[derive(Debug, Clone, PartialEq)]
pub struct ElementNode {
    pub path: Vec<Ident>,
    pub args: Vec<Arg>,
    pub children: Option<Block>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct IfNode {
    /// `if` / `else if` arms in source order.
    pub branches: Vec<IfBranch>,
    pub else_block: Option<Block>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct IfBranch {
    pub cond: Expr,
    pub block: Block,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ForNode {
    pub var: Ident,
    pub iter: Expr,
    /// Required by the language; `None` is reported during semantic analysis.
    pub key: Option<Expr>,
    pub body: Block,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Arg {
    pub name: Option<Ident>,
    pub value: Expr,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Expr {
    pub kind: ExprKind,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ExprKind {
    Int(i64),
    Float(f64),
    Bool(bool),
    Null,
    Str(Vec<StrPart>),
    Ident(String),
    Field {
        base: Box<Expr>,
        name: Ident,
        /// `?.` instead of `.`.
        safe: bool,
    },
    /// Callee is always an [`ExprKind::Ident`] or [`ExprKind::Field`].
    Call {
        callee: Box<Expr>,
        args: Vec<Arg>,
    },
    Unary {
        op: UnaryOp,
        expr: Box<Expr>,
    },
    Binary {
        op: BinaryOp,
        lhs: Box<Expr>,
        rhs: Box<Expr>,
    },
    If {
        cond: Box<Expr>,
        then: Box<Expr>,
        else_: Box<Expr>,
    },
    Lambda(Lambda),
    Error,
}

#[derive(Debug, Clone, PartialEq)]
pub enum StrPart {
    Lit(String),
    Expr(Expr),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Lambda {
    pub param: Option<Ident>,
    pub body: Vec<LambdaStmt>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LambdaStmt {
    Assign(Assign),
    Call(CallStmt),
}

#[derive(Debug, Clone, PartialEq)]
pub struct CallStmt {
    pub callee: Ident,
    pub args: Vec<Arg>,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Assign {
    pub target: Ident,
    pub op: AssignOp,
    pub value: Expr,
    pub span: Span,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AssignOp {
    Set,
    Add,
    Sub,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum UnaryOp {
    Not,
    Neg,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BinaryOp {
    Coalesce,
    Or,
    And,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    Add,
    Sub,
    Mul,
    Div,
    Rem,
}

impl BinaryOp {
    #[must_use]
    pub fn symbol(self) -> &'static str {
        match self {
            BinaryOp::Coalesce => "??",
            BinaryOp::Or => "||",
            BinaryOp::And => "&&",
            BinaryOp::Eq => "==",
            BinaryOp::Ne => "!=",
            BinaryOp::Lt => "<",
            BinaryOp::Le => "<=",
            BinaryOp::Gt => ">",
            BinaryOp::Ge => ">=",
            BinaryOp::Add => "+",
            BinaryOp::Sub => "-",
            BinaryOp::Mul => "*",
            BinaryOp::Div => "/",
            BinaryOp::Rem => "%",
        }
    }
}
