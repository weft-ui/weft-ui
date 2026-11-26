//! Semantic analysis: module resolution, name resolution, type checking, and
//! lowering of component bodies to the view IR.

pub(crate) mod builtins;
mod lower;
pub(crate) mod record;
mod theme;

use std::cell::{Cell, OnceCell, RefCell};
use std::collections::{BTreeSet, HashMap, HashSet};

use weft_ui_ast as ast;
use weft_ui_ast::span::offset;
use weft_ui_ast::{Diagnostic, FileId, ParsedFile, ParsedProgram, SourceMap, Span};

use crate::deps;
use crate::elements::{self, LIFECYCLE as CALL_HOOKS};
use crate::ir::{
    Application, Component, ComponentId, Event, EventId, Expr, Field, Model, ModelId, Module,
    PageInfo, Param, ParamKind, Program, Type, type_display,
};
use lower::{Instance, Lowerer};
use record::{AliasSymbol, ProbeContext, RawCall, RawProbe, Recorder, StyleSymbol, Target};

/// Name of the slot parameter type.
const CHILDREN: &str = "Children";
const EVENT: &str = "Event";
const PRIMITIVES: [&str; 5] = ["Int", "Float", "Bool", "String", "Color"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DeclKind {
    Model(ModelId),
    Event(EventId),
    Component(ComponentId),
    TypeAlias(usize),
    Style(usize),
}

impl DeclKind {
    fn describe(self) -> &'static str {
        match self {
            DeclKind::Model(_) => "model",
            DeclKind::Event(_) => "event",
            DeclKind::Component(_) => "component",
            DeclKind::TypeAlias(_) => "type alias",
            DeclKind::Style(_) => "style",
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct Decl {
    kind: DeclKind,
    file: FileId,
    span: Span,
}

struct Alias<'a> {
    decl: &'a ast::TypeAlias,
    resolving: Cell<bool>,
    ty: OnceCell<Type>,
}

struct Style<'a> {
    declaration: &'a ast::StyleDecl,
    values: Vec<(Expr, bool)>,
}

/// Program-wide declarations shared by every component being checked.
pub(crate) struct Checker<'a> {
    sources: &'a SourceMap,
    decls: HashMap<String, Decl>,
    aliases: Vec<Alias<'a>>,
    styles: Vec<Style<'a>>,
    theme: Option<theme::Tokens<'a>>,
    /// Per file: the file itself plus its direct imports.
    visible: Vec<Vec<FileId>>,
    pub models: Vec<Model>,
    pub events: Vec<Event>,
    /// Component signatures; bodies are filled in after all are checked.
    pub components: Vec<Component>,
    /// Present when analyzing for editor tooling.
    recorder: Option<RefCell<Recorder>>,
}

impl Checker<'_> {
    pub(crate) fn recording(&self) -> bool {
        self.recorder.is_some()
    }

    /// Records that the name at `span` refers to `target`.
    pub(crate) fn record(&self, span: Span, target: impl FnOnce() -> Target) {
        if let Some(recorder) = &self.recorder {
            recorder.borrow_mut().refs.push((span, target()));
        }
    }

    pub(crate) fn record_call(&self, call: impl FnOnce() -> RawCall) {
        if let Some(recorder) = &self.recorder {
            recorder.borrow_mut().calls.push(call());
        }
    }

    /// Whether `name` is the probe and no probe was resolved yet.
    pub(crate) fn is_probe(&self, name: &str) -> bool {
        self.recorder
            .as_ref()
            .is_some_and(|r| r.borrow().is_probe(name))
    }

    pub(crate) fn set_probe(&self, context: ProbeContext, candidates: Vec<Target>) {
        if let Some(recorder) = &self.recorder {
            recorder.borrow_mut().probe = Some(RawProbe {
                context,
                candidates,
            });
        }
    }

    /// Declarations visible from `file` that `keep` accepts, in source order.
    pub(crate) fn visible_decls(
        &self,
        file: FileId,
        keep: impl Fn(DeclKind) -> bool,
    ) -> Vec<Target> {
        let visible = &self.visible[file.index()];
        let mut decls: Vec<&Decl> = self
            .decls
            .values()
            .filter(|d| visible.contains(&d.file) && keep(d.kind))
            .collect();
        decls.sort_by_key(|d| (d.span.file, d.span.start));
        decls.into_iter().map(|d| decl_target(d.kind)).collect()
    }

    /// Resolves a global name as seen from `file`.
    ///
    /// Returns `None` for unknown names without reporting. A name declared in a
    /// file that is not imported is reported here but still returned, so callers
    /// do not emit follow-up errors.
    pub(crate) fn global(
        &self,
        file: FileId,
        name: &str,
        span: Span,
        diags: &mut Vec<Diagnostic>,
    ) -> Option<DeclKind> {
        let decl = self.decls.get(name)?;
        self.record(span, || decl_target(decl.kind));
        if !self.visible[file.index()].contains(&decl.file) {
            let path = self.sources.get(decl.file).path();
            diags.push(
                Diagnostic::error(
                    span,
                    format!("`{name}` is declared in `{path}`, which is not imported here"),
                )
                .with_secondary(decl.span, format!("{} declared here", decl.kind.describe()))
                .with_note("imports are not transitive; import the declaring file directly"),
            );
        }
        Some(decl.kind)
    }

    pub(crate) fn type_name(&self, ty: &Type) -> String {
        type_display(ty, &self.models, "{error}").to_string()
    }

    /// Reports a type probe; `Children` and `Event` are offered for parameters.
    pub(crate) fn probe_type(&self, file: FileId, name: &str, parameter: bool) {
        if !self.is_probe(name) {
            return;
        }
        let builtins = PRIMITIVES
            .into_iter()
            .chain([CHILDREN, EVENT].into_iter().filter(|_| parameter))
            .map(|name| Target::Type(name.to_owned()));
        let types = self.visible_decls(file, |k| {
            matches!(k, DeclKind::Model(_) | DeclKind::TypeAlias(_))
        });
        self.set_probe(ProbeContext::Type, builtins.chain(types).collect());
    }

    fn alias_type(&self, id: usize, span: Span, diags: &mut Vec<Diagnostic>) -> &Type {
        let alias = &self.aliases[id];
        if alias.resolving.get() {
            diags.push(Diagnostic::error(
                span,
                format!("type alias `{}` refers to itself", alias.decl.name.name),
            ));
            return &Type::Error;
        }
        alias.ty.get_or_init(|| {
            alias.resolving.set(true);
            let ty = self.resolve_type(alias.decl.span.file, &alias.decl.ty, diags);
            alias.resolving.set(false);
            ty
        })
    }

    pub(crate) fn resolve_type(
        &self,
        file: FileId,
        ty: &ast::TypeExpr,
        diags: &mut Vec<Diagnostic>,
    ) -> Type {
        if let ast::TypeExprKind::Named { name, .. } = &ty.kind {
            self.probe_type(file, &name.name, false);
            if PRIMITIVES.contains(&name.name.as_str()) {
                self.record(name.span, || Target::Type(name.name.clone()));
            }
        }
        match &ty.kind {
            ast::TypeExprKind::Error => Type::Error,
            ast::TypeExprKind::Union(members) => check_union(members, diags),
            ast::TypeExprKind::Array(elem) => {
                Type::Array(Box::new(self.resolve_type(file, elem, diags)))
            }
            ast::TypeExprKind::Optional(inner) => match self.resolve_type(file, inner, diags) {
                Type::Optional(_) => {
                    diags.push(Diagnostic::error(ty.span, "nested optional type"));
                    Type::Error
                }
                inner => inner.optional(),
            },
            ast::TypeExprKind::Named { name, .. } if name.name == EVENT => {
                diags.push(Diagnostic::error(
                    name.span,
                    "`Event` is only allowed as a component parameter type",
                ));
                Type::Error
            }
            ast::TypeExprKind::Named { args, .. } if !args.is_empty() => {
                diags.push(Diagnostic::error(
                    ty.span,
                    "only `Event` takes a type argument",
                ));
                Type::Error
            }
            ast::TypeExprKind::Named { name, .. } => match name.name.as_str() {
                "Int" => Type::Int,
                "Float" => Type::Float,
                "Bool" => Type::Bool,
                "String" => Type::String,
                "Color" => Type::Color,
                CHILDREN => {
                    diags.push(Diagnostic::error(
                        name.span,
                        "`Children` can only be the type of a component parameter",
                    ));
                    Type::Error
                }
                other => match self.global(file, other, name.span, diags) {
                    Some(DeclKind::Model(id)) => Type::Model(id),
                    Some(DeclKind::TypeAlias(id)) => self.alias_type(id, name.span, diags).clone(),
                    Some(kind) => {
                        diags.push(Diagnostic::error(
                            name.span,
                            format!("`{other}` is {}, not a type", article(kind)),
                        ));
                        Type::Error
                    }
                    None => {
                        diags.push(Diagnostic::error(
                            name.span,
                            format!("unknown type `{other}`"),
                        ));
                        Type::Error
                    }
                },
            },
        }
    }

    fn fields(
        &self,
        file: FileId,
        fields: &[ast::Field],
        what: &str,
        diags: &mut Vec<Diagnostic>,
    ) -> Vec<Field> {
        let mut out: Vec<Field> = Vec::with_capacity(fields.len());
        for field in fields {
            if let Some(prev) = out.iter().find(|f| f.name == field.name.name) {
                diags.push(
                    Diagnostic::error(
                        field.name.span,
                        format!("duplicate {what} `{}`", field.name.name),
                    )
                    .with_secondary(prev.span, "first declared here"),
                );
                continue;
            }
            out.push(Field {
                name: field.name.name.clone(),
                ty: self.resolve_type(file, &field.ty, diags),
                span: field.name.span,
            });
        }
        out
    }
}

fn check_union(members: &[(String, Span)], diags: &mut Vec<Diagnostic>) -> Type {
    let mut seen = HashSet::with_capacity(members.len());
    for (member, span) in members {
        if !seen.insert(member.as_str()) {
            diags.push(Diagnostic::error(
                *span,
                format!("duplicate member `{member:?}` in union"),
            ));
        }
    }
    if seen.len() == members.len() {
        Type::Union(members.iter().map(|(member, _)| member.clone()).collect())
    } else {
        Type::Error
    }
}

fn decl_target(kind: DeclKind) -> Target {
    match kind {
        DeclKind::Model(id) => Target::Model(id),
        DeclKind::Event(id) => Target::Event(id),
        DeclKind::Component(id) => Target::Component(id),
        DeclKind::TypeAlias(id) => Target::TypeAlias(id),
        DeclKind::Style(id) => Target::Style(id),
    }
}

pub(crate) fn article(kind: DeclKind) -> &'static str {
    match kind {
        DeclKind::Model(_) => "a model",
        DeclKind::Event(_) => "an event",
        DeclKind::Component(_) => "a component",
        DeclKind::TypeAlias(_) => "a type alias",
        DeclKind::Style(_) => "a style",
    }
}

/// Result of analyzing an import closure.
pub(crate) struct Analysis {
    pub sources: SourceMap,
    pub diagnostics: Vec<Diagnostic>,
    /// Present only when no errors were reported and nothing was recorded.
    pub program: Option<Program>,
    /// When recording: the recorder and the program, even with errors.
    pub recording: Option<(Recorder, Program)>,
}

pub(crate) fn analyze(parsed: ParsedProgram) -> Analysis {
    analyze_recording(parsed, None)
}

pub(crate) fn analyze_recording(
    parsed: ParsedProgram,
    recorder: Option<RefCell<Recorder>>,
) -> Analysis {
    let ParsedProgram {
        sources,
        files,
        entries,
        diagnostics: mut diags,
    } = parsed;
    let (program, recorder) = check(&files, entries, &sources, &mut diags, recorder);
    diags.sort_by_key(|d| (d.span.file, d.span.start));
    let (program, recording) = match recorder {
        Some(recorder) => (None, Some((recorder.into_inner(), program))),
        None => (
            (!diags.iter().any(Diagnostic::is_error)).then_some(program),
            None,
        ),
    };
    Analysis {
        sources,
        diagnostics: diags,
        program,
        recording,
    }
}

fn check(
    files: &[ParsedFile],
    entries: Vec<FileId>,
    sources: &SourceMap,
    diags: &mut Vec<Diagnostic>,
    recorder: Option<RefCell<Recorder>>,
) -> (Program, Option<RefCell<Recorder>>) {
    report_import_cycles(files, sources, diags);

    // Declarations: one namespace for the whole import closure.
    let mut cx = Checker {
        sources,
        decls: HashMap::new(),
        aliases: Vec::new(),
        styles: Vec::new(),
        theme: None,
        visible: files
            .iter()
            .enumerate()
            .map(|(i, f)| {
                std::iter::once(FileId(offset(i)))
                    .chain(f.imports.iter().map(|&(id, _)| id))
                    .collect()
            })
            .collect(),
        models: Vec::new(),
        events: Vec::new(),
        components: Vec::new(),
        recorder,
    };
    let mut item_ids: Vec<Vec<Option<DeclKind>>> = Vec::with_capacity(files.len());
    for (index, file) in files.iter().enumerate() {
        let file_id = FileId(offset(index));
        let ids = file
            .ast
            .items
            .iter()
            .map(|item| declare(&mut cx, file_id, item, diags))
            .collect();
        item_ids.push(ids);
    }
    // Resolve style constants in their declaring modules, not where the styles are applied.
    let style_values: Vec<_> = cx
        .styles
        .iter()
        .map(|style| {
            style
                .declaration
                .entries
                .iter()
                .map(|entry| {
                    let mut lowerer = Lowerer::new(&cx, diags, entry.span.file, None, &[]);
                    let value = lowerer.style_value(&entry.value);
                    (value, lowerer.uses_theme)
                })
                .collect()
        })
        .collect();
    for (style, values) in cx.styles.iter_mut().zip(style_values) {
        style.values = values;
    }

    report_handler_name_clashes(&cx.events, diags);
    // Check even unused aliases, once each, in their declaring files.
    for (id, alias) in cx.aliases.iter().enumerate() {
        cx.alias_type(id, alias.decl.name.span, diags);
    }

    let items = || {
        files.iter().enumerate().flat_map(|(fi, f)| {
            f.ast
                .items
                .iter()
                .zip(&item_ids[fi])
                .filter_map(move |(item, id)| id.map(|id| (FileId(offset(fi)), item, id)))
        })
    };

    // Model fields and event parameters.
    for (file, item, id) in items() {
        match (item, id) {
            (ast::Item::Model(m), DeclKind::Model(id)) => {
                let fields = cx.fields(file, &m.fields, "field", diags);
                for (index, field) in fields.iter().enumerate() {
                    cx.record(field.span, || Target::Field(id, index));
                }
                cx.models[id.index()].fields = fields;
            }
            (ast::Item::Event(e), DeclKind::Event(id)) => {
                let params = cx.fields(file, &e.params, "parameter", diags);
                for (index, param) in params.iter().enumerate() {
                    cx.record(param.span, || Target::EventParam(id, index));
                }
                cx.events[id.index()].params = params;
            }
            _ => {}
        }
    }
    report_model_cycles(&cx.models, diags);

    // Component signatures, then bodies.
    let mut bodies = Vec::new();
    for (file, item, id) in items() {
        let (c, id, page) = match (item, id) {
            (ast::Item::Component(c), DeclKind::Component(id)) => (c, id, None),
            (ast::Item::Page(page), DeclKind::Component(id)) => (&page.component, id, Some(page)),
            _ => continue,
        };
        let (params, uses_theme) = signature(&cx, file, c, diags);
        if let Some(page) = page {
            check_page(page, &params, diags);
        }
        for (index, param) in params.iter().enumerate() {
            cx.record(param.span, || Target::ComponentParam(id, index));
        }
        cx.components[id.index()].params = params;
        cx.components[id.index()].uses_theme = uses_theme;
        bodies.push((file, c, id));
    }
    let app = check_app(files, &cx, diags);
    report_page_overlaps(&cx.components, diags);
    let mut instances: Vec<Vec<Instance>> = vec![Vec::new(); cx.components.len()];
    let mut lowered = Vec::with_capacity(bodies.len());
    for &(file, decl, id) in &bodies {
        let params = &cx.components[id.index()].params;
        let body = Lowerer::new(&cx, diags, file, Some(id), params).component(decl);
        lowered.push((id, body));
    }
    for (id, body) in lowered {
        let component = &mut cx.components[id.index()];
        component.states = body.states;
        component.nodes = body.nodes;
        component.roots = body.roots;
        component.loops = body.loops;
        component.bindings = body.bindings;
        component.emits = body.emits;
        component.uses_theme |= body.uses_theme;
        for (index, node) in component.nodes.iter().enumerate() {
            if let crate::ir::NodeKind::Element { element, .. } = &node.kind
                && element.spec().page_root
                && (component.page.is_none()
                    || component.roots.first() != Some(&crate::ir::NodeId(offset(index))))
            {
                diags.push(Diagnostic::error(
                    node.span,
                    format!(
                        "`{}` must be the first top-level node of a page",
                        element.name()
                    ),
                ));
            }
        }
        instances[id.index()] = body.instances;
    }

    report_unguarded_recursion(&cx.components, &instances, diags);
    let reachable = reachable_events(&cx.components, &instances);
    for (component, events) in cx.components.iter_mut().zip(reachable) {
        if component.page.is_some() {
            for &event in &events {
                let event = &cx.events[event.index()];
                if matches!(event.name.as_str(), "Show" | "Hide") {
                    diags.push(Diagnostic::error(
                        event.span,
                        format!(
                            "event `{}` conflicts with the page method `on{}`",
                            event.name, event.name
                        ),
                    ));
                }
            }
        }
        component.reachable_events = events;
        deps::layout(component, &cx.models);
    }

    let modules = files
        .iter()
        .enumerate()
        .map(|(i, f)| {
            let file = FileId(offset(i));
            let mut module = Module {
                file,
                path: sources.get(file).path().to_owned(),
                imports: f.imports.iter().map(|&(id, _)| id).collect(),
                models: Vec::new(),
                events: Vec::new(),
                components: Vec::new(),
            };
            for id in item_ids[i].iter().flatten() {
                match *id {
                    DeclKind::Model(m) => module.models.push(m),
                    DeclKind::Event(e) => module.events.push(e),
                    DeclKind::Component(c) => module.components.push(c),
                    DeclKind::TypeAlias(_) | DeclKind::Style(_) => {}
                }
            }
            module
        })
        .collect();

    let program = Program {
        entries,
        modules,
        models: cx.models,
        events: cx.events,
        components: cx.components,
        app,
        theme: cx.theme.map(|theme| theme.output),
    };
    if let Some(recorder) = &cx.recorder {
        let mut recorder = recorder.borrow_mut();
        recorder.styles = cx
            .styles
            .iter()
            .map(|style| StyleSymbol {
                def: style.declaration.name.span,
                declaration: style.declaration.span,
            })
            .collect();
        recorder.aliases = cx
            .aliases
            .into_iter()
            .map(|alias| AliasSymbol {
                name: alias.decl.name.name.clone(),
                def: alias.decl.name.span,
                ty: alias
                    .ty
                    .into_inner()
                    .expect("all type aliases were resolved"),
            })
            .collect();
    }
    (program, cx.recorder)
}

fn check_app(
    files: &[ParsedFile],
    cx: &Checker<'_>,
    diags: &mut Vec<Diagnostic>,
) -> Option<Application> {
    let mut apps = files
        .iter()
        .flat_map(|f| f.ast.items.iter())
        .filter_map(|item| {
            if let ast::Item::App(app) = item {
                Some(app)
            } else {
                None
            }
        });
    let app = apps.next()?;
    if let Some(previous) = cx.decls.get(&app.name.name) {
        diags.push(
            Diagnostic::error(
                app.name.span,
                format!("`{}` is declared more than once", app.name.name),
            )
            .with_secondary(previous.span, "first declared here"),
        );
    }
    if elements::element(&app.name.name).is_some()
        || PRIMITIVES.contains(&app.name.name.as_str())
        || matches!(app.name.name.as_str(), CHILDREN | EVENT)
    {
        diags.push(Diagnostic::error(
            app.name.span,
            format!("`{}` is built in and cannot be redeclared", app.name.name),
        ));
    }
    for duplicate in apps {
        diags.push(
            Diagnostic::error(duplicate.span, "duplicate app declaration")
                .with_secondary(app.span, "first declared here"),
        );
    }
    let mut closure = HashSet::new();
    let mut pending = vec![app.span.file];
    while let Some(file) = pending.pop() {
        if closure.insert(file) {
            pending.extend(files[file.index()].imports.iter().map(|&(id, _)| id));
        }
    }
    for component in &cx.components {
        if component.page.is_some() && !closure.contains(&component.file) {
            diags.push(Diagnostic::error(
                component.span,
                format!(
                    "page `{}` is not in the import closure of app `{}`",
                    component.name, app.name.name
                ),
            ));
        }
    }
    let resolve_page = |name: &ast::Ident, role: &str, diags: &mut Vec<Diagnostic>| {
        let page = cx.decls.get(&name.name).and_then(|decl| match decl.kind {
            DeclKind::Component(id)
                if cx.components[id.index()].page.is_some() && closure.contains(&decl.file) =>
            {
                Some(id)
            }
            _ => None,
        });
        if let Some(id) = page {
            if cx.components[id.index()].params.iter().any(|param| matches!(&param.kind, ParamKind::Value(ty) if !matches!(ty, Type::Model(_) | Type::Optional(_))) && param.default.is_none()) {
                diags.push(Diagnostic::error(name.span, format!("{role} page `{}` must not have required route parameters", name.name)));
            }
        } else {
            diags.push(Diagnostic::error(
                name.span,
                format!(
                    "{role} page `{}` must be a page in the app import closure",
                    name.name
                ),
            ));
        }
        page
    };
    let (start, tabs) = match &app.entry {
        ast::AppEntry::Start(name) => (resolve_page(name, "start", diags)?, None),
        ast::AppEntry::Tabs(items) => {
            if !(2..=5).contains(&items.len()) {
                diags.push(Diagnostic::error(app.span, "an app has 2 to 5 tabs"));
            }
            let mut seen_pages = HashSet::new();
            let mut tabs = Vec::new();
            for item in items {
                if !seen_pages.insert(&item.page.name) {
                    diags.push(Diagnostic::error(
                        item.page.span,
                        format!("duplicate tab page `{}`", item.page.name),
                    ));
                }
                let page = resolve_page(&item.page, "tab", diags);
                let mut title = None;
                let mut icon = None;
                let mut active_icon = None;
                let mut seen_args = HashSet::new();
                for arg in &item.args {
                    let Some(name) = &arg.name else {
                        diags.push(Diagnostic::error(arg.span, "tab arguments must be named"));
                        continue;
                    };
                    if !seen_args.insert(name.name.as_str()) {
                        diags.push(Diagnostic::error(
                            name.span,
                            format!("duplicate tab argument `{}`", name.name),
                        ));
                        continue;
                    }
                    let target = match name.name.as_str() {
                        "title" => &mut title,
                        "icon" => &mut icon,
                        "activeIcon" => &mut active_icon,
                        _ => {
                            diags.push(Diagnostic::error(
                                name.span,
                                format!("unknown tab argument `{}`", name.name),
                            ));
                            continue;
                        }
                    };
                    let value = match &arg.value.kind {
                        ast::ExprKind::Str(parts)
                            if parts
                                .iter()
                                .all(|part| matches!(part, ast::StrPart::Lit(_))) =>
                        {
                            Some(
                                parts
                                    .iter()
                                    .filter_map(|part| match part {
                                        ast::StrPart::Lit(s) => Some(s.as_str()),
                                        _ => None,
                                    })
                                    .collect::<String>(),
                            )
                        }
                        _ => None,
                    };
                    if let Some(value) = value {
                        if name.name != "title"
                            && !value
                                .strip_prefix("asset:")
                                .is_some_and(|name| !name.is_empty())
                        {
                            diags.push(Diagnostic::error(
                                arg.value.span,
                                format!("tab `{}` must be an asset:<name> string", name.name),
                            ));
                        }
                        *target = Some(value);
                    } else {
                        diags.push(Diagnostic::error(
                            arg.value.span,
                            format!("tab `{}` must be a string literal", name.name),
                        ));
                    }
                }
                if !seen_args.contains("title") {
                    diags.push(Diagnostic::error(item.page.span, "tab requires `title`"));
                }
                if !seen_args.contains("icon") {
                    diags.push(Diagnostic::error(item.page.span, "tab requires `icon`"));
                }
                if let (Some(page), Some(title), Some(icon)) = (page, title, icon) {
                    let active_icon = active_icon.unwrap_or_else(|| icon.clone());
                    tabs.push(crate::ir::Tab {
                        page,
                        title,
                        icon,
                        active_icon,
                    });
                }
            }
            (tabs.first()?.page, Some(tabs))
        }
    };
    Some(Application {
        name: app.name.name.clone(),
        span: app.span,
        start,
        tabs,
    })
}

fn declare<'a>(
    cx: &mut Checker<'a>,
    file: FileId,
    item: &'a ast::Item,
    diags: &mut Vec<Diagnostic>,
) -> Option<DeclKind> {
    if matches!(item, ast::Item::App(_)) {
        return None;
    }
    if let ast::Item::Theme(decl) = item {
        if let Some(previous) = &cx.theme {
            diags.push(
                Diagnostic::error(decl.span, "duplicate theme declaration")
                    .with_secondary(previous.output.span, "first declared here"),
            );
        } else {
            cx.theme = Some(theme::Tokens::check(cx, decl, diags));
        }
        return None;
    }
    let name = item.name()?;
    let reserved = if elements::element(&name.name).is_some() {
        Some("a built-in element")
    } else if PRIMITIVES.contains(&name.name.as_str())
        || matches!(name.name.as_str(), CHILDREN | EVENT)
    {
        Some("a built-in type")
    } else {
        None
    };
    if let Some(what) = reserved {
        diags.push(Diagnostic::error(
            name.span,
            format!("`{}` is {what} and cannot be redeclared", name.name),
        ));
        return None;
    }
    if let Some(prev) = cx.decls.get(&name.name) {
        diags.push(
            Diagnostic::error(
                name.span,
                format!("`{}` is declared more than once", name.name),
            )
            .with_label("redeclared here")
            .with_secondary(prev.span, "first declared here")
            .with_note(
                "models, events, components, type aliases and styles share one namespace across all imported files",
            ),
        );
        return None;
    }
    let kind = match item {
        ast::Item::Model(_) => {
            cx.models.push(Model {
                name: name.name.clone(),
                file,
                fields: Vec::new(),
                span: name.span,
            });
            DeclKind::Model(ModelId(offset(cx.models.len() - 1)))
        }
        ast::Item::Event(_) => {
            cx.events.push(Event {
                name: name.name.clone(),
                file,
                params: Vec::new(),
                span: name.span,
            });
            DeclKind::Event(EventId(offset(cx.events.len() - 1)))
        }
        ast::Item::Component(_) | ast::Item::Page(_) => {
            let page = match item {
                ast::Item::Page(page) => Some(PageInfo {
                    path: page
                        .path
                        .as_ref()
                        .map_or_else(|| default_page_path(&name.name), |(path, _)| path.clone()),
                }),
                _ => None,
            };
            cx.components.push(Component {
                page,
                name: name.name.clone(),
                file,
                span: name.span,
                params: Vec::new(),
                states: Vec::new(),
                nodes: Vec::new(),
                roots: Vec::new(),
                loops: Vec::new(),
                bindings: Vec::new(),
                slots: Vec::new(),
                emits: Vec::new(),
                reachable_events: Vec::new(),
                uses_theme: false,
            });
            DeclKind::Component(ComponentId(offset(cx.components.len() - 1)))
        }
        ast::Item::TypeAlias(decl) => {
            let id = cx.aliases.len();
            cx.aliases.push(Alias {
                decl,
                resolving: Cell::new(false),
                ty: OnceCell::new(),
            });
            DeclKind::TypeAlias(id)
        }
        ast::Item::Style(decl) => {
            for entry in &decl.entries {
                let name = &entry.name.name;
                if !elements::is_style_property(name) {
                    diags.push(Diagnostic::error(
                        entry.name.span,
                        format!("unknown style property `{name}`"),
                    ));
                }
            }
            let id = cx.styles.len();
            cx.styles.push(Style {
                declaration: decl,
                values: Vec::new(),
            });
            DeclKind::Style(id)
        }
        ast::Item::Theme(_) | ast::Item::App(_) => {
            unreachable!("special declarations are checked separately")
        }
    };
    cx.record(name.span, || decl_target(kind));
    cx.decls.insert(
        name.name.clone(),
        Decl {
            kind,
            file,
            span: name.span,
        },
    );
    Some(kind)
}

/// Hosts derive registration methods from event names (`onFooBar`,
/// `on_foo_bar`), so names differing only in case or underscores would clash.
fn report_handler_name_clashes(events: &[Event], diags: &mut Vec<Diagnostic>) {
    let mut seen: HashMap<String, &Event> = HashMap::new();
    for event in events {
        let key: String = event
            .name
            .chars()
            .filter(|&c| c != '_')
            .map(|c| c.to_ascii_lowercase())
            .collect();
        if let Some(prev) = seen.get(&key) {
            diags.push(
                Diagnostic::error(
                    event.span,
                    format!(
                        "event `{}` clashes with event `{}` in host bindings",
                        event.name, prev.name
                    ),
                )
                .with_secondary(prev.span, "other event declared here")
                .with_note(
                    "handler registration names ignore case and underscores, e.g. `onFooBar` / `on_foo_bar`",
                ),
            );
        } else {
            seen.insert(key, event);
        }
    }
}

fn signature(
    cx: &Checker<'_>,
    file: FileId,
    decl: &ast::ComponentDecl,
    diags: &mut Vec<Diagnostic>,
) -> (Vec<Param>, bool) {
    let mut params: Vec<Param> = Vec::with_capacity(decl.params.len());
    let mut uses_theme = false;
    for param in &decl.params {
        let name = &param.name;
        if theme::reserved(&name.name, name.span, diags) {
            continue;
        }
        if let Some(prev) = params.iter().find(|p| p.name == name.name) {
            diags.push(
                Diagnostic::error(name.span, format!("duplicate parameter `{}`", name.name))
                    .with_secondary(prev.span, "first declared here"),
            );
            continue;
        }
        if CALL_HOOKS.iter().any(|p| p.name == name.name) {
            diags.push(Diagnostic::error(
                name.span,
                format!("`{}` is reserved for lifecycle events", name.name),
            ));
            continue;
        }
        let named = match &param.ty.kind {
            ast::TypeExprKind::Named { name, args } => {
                cx.probe_type(file, &name.name, true);
                Some((name, args.as_slice()))
            }
            _ => None,
        };
        let kind = if let Some((ty_name, args)) = named.filter(|(n, _)| n.name == EVENT) {
            cx.record(ty_name.span, || Target::Type(EVENT.to_owned()));
            if let Some(default) = &param.default {
                diags.push(Diagnostic::error(
                    default.span,
                    format!(
                        "callback parameter `{}` cannot have a default value",
                        name.name
                    ),
                ));
            }
            let payload = args.first().map(|arg| {
                let ty = cx.resolve_type(file, arg, diags);
                if ty.is_scalar() || ty.has_error() {
                    ty
                } else {
                    diags.push(Diagnostic::error(
                        arg.span,
                        "callback payload must be a scalar type",
                    ));
                    Type::Error
                }
            });
            ParamKind::Callback { payload }
        } else if let Some((ty_name, [])) = named.filter(|(n, _)| n.name == CHILDREN) {
            cx.record(ty_name.span, || Target::Type(CHILDREN.to_owned()));
            if let Some(default) = &param.default {
                diags.push(Diagnostic::error(
                    default.span,
                    "a `Children` parameter cannot have a default value",
                ));
            }
            ParamKind::Children
        } else {
            ParamKind::Value(cx.resolve_type(file, &param.ty, diags))
        };
        let default = match (&kind, &param.default) {
            (ParamKind::Value(ty), Some(default)) => {
                let mut lowerer = Lowerer::new(cx, diags, file, None, &[]);
                let value = lowerer.expr_as(default, ty);
                uses_theme |= lowerer.uses_theme;
                Some(value)
            }
            _ => None,
        };
        params.push(Param {
            name: name.name.clone(),
            kind,
            default,
            span: name.span,
        });
    }
    (params, uses_theme)
}

fn default_page_path(name: &str) -> String {
    let chars: Vec<char> = name.chars().collect();
    let mut path = String::from("/");
    for (i, &ch) in chars.iter().enumerate() {
        if i > 0
            && ch.is_ascii_uppercase()
            && (chars[i - 1].is_ascii_lowercase()
                || chars[i - 1].is_ascii_digit()
                || (chars[i - 1].is_ascii_uppercase()
                    && chars.get(i + 1).is_some_and(char::is_ascii_lowercase)))
        {
            path.push('-');
        }
        path.push(ch.to_ascii_lowercase());
    }
    path
}

fn check_page(page: &ast::Page, params: &[Param], diags: &mut Vec<Diagnostic>) {
    for (index, param) in params.iter().enumerate() {
        match &param.kind {
            ParamKind::Value(Type::Model(_)) if index == 0 => {}
            ParamKind::Value(Type::Model(_)) => diags.push(Diagnostic::error(
                param.span,
                format!("the model parameter of page `{}` must come first", page.component.name.name),
            )),
            ParamKind::Value(ty) if route_type(ty) || ty.has_error() => {}
            _ => diags.push(Diagnostic::error(
                param.span,
                format!("route parameter `{}` must be Int, Float, Bool, String or a string literal union", param.name),
            )),
        }
        if let Some(default) = &param.default
            && lower::expr::constant_kind(default.kind.clone()).is_none()
            && !default.ty.has_error()
        {
            diags.push(Diagnostic::error(
                default.span,
                "route parameter default must be constant",
            ));
        }
    }
    let Some((path, span)) = &page.path else {
        return;
    };
    if !path.starts_with('/') {
        diags.push(Diagnostic::error(
            *span,
            format!("invalid path segment `{path}`"),
        ));
        return;
    }
    let mut seen = HashSet::new();
    for segment in path[1..].split('/') {
        if path == "/" {
            break;
        }
        if let Some(name) = segment.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
            let valid = params.iter().any(|p| {
                p.name == name
                    && p.default.is_none()
                    && matches!(
                        &p.kind,
                        ParamKind::Value(Type::String | Type::Int | Type::Union(_))
                    )
            });
            if !valid || !seen.insert(name) {
                diags.push(Diagnostic::error(
                    *span,
                    format!("`{{{name}}}` is not a required String, Int or union route parameter"),
                ));
            }
        } else if segment.is_empty()
            || !segment.bytes().all(|c| {
                c.is_ascii_lowercase()
                    || c.is_ascii_digit()
                    || matches!(c, b'.' | b'_' | b'~' | b'-')
            })
        {
            diags.push(Diagnostic::error(
                *span,
                format!("invalid path segment `{segment}`"),
            ));
        }
    }
}

fn route_type(ty: &Type) -> bool {
    match ty {
        Type::Int | Type::Float | Type::Bool | Type::String | Type::Union(_) => true,
        Type::Optional(inner) => route_type(inner),
        _ => false,
    }
}

fn report_page_overlaps(components: &[Component], diags: &mut Vec<Diagnostic>) {
    for (i, a) in components.iter().enumerate() {
        let Some(a_page) = &a.page else { continue };
        for b in &components[..i] {
            let Some(b_page) = &b.page else { continue };
            let a_segments: Vec<_> = a_page.path.trim_start_matches('/').split('/').collect();
            let b_segments: Vec<_> = b_page.path.trim_start_matches('/').split('/').collect();
            if a_segments.len() == b_segments.len()
                && a_segments.iter().zip(&b_segments).all(|(a, b)| {
                    a == b
                        || (a.starts_with('{') && a.ends_with('}'))
                        || (b.starts_with('{') && b.ends_with('}'))
                })
            {
                diags.push(
                    Diagnostic::error(
                        a.span,
                        format!("paths of `{}` and `{}` overlap", b.name, a.name),
                    )
                    .with_secondary(b.span, "other page declared here"),
                );
            }
        }
    }
}

/// Finds cycles in a directed graph given as adjacency lists of `(target, edge span)`.
///
/// Each returned cycle lists the nodes from the re-entered node back to itself,
/// together with the span of the edge that closes it.
fn find_cycles(edges: &[Vec<(usize, Span)>]) -> Vec<(Vec<usize>, Span)> {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Mark {
        New,
        Active,
        Done,
    }

    fn visit(
        node: usize,
        edges: &[Vec<(usize, Span)>],
        marks: &mut [Mark],
        stack: &mut Vec<usize>,
        out: &mut Vec<(Vec<usize>, Span)>,
    ) {
        marks[node] = Mark::Active;
        stack.push(node);
        for &(next, span) in &edges[node] {
            match marks[next] {
                Mark::New => visit(next, edges, marks, stack, out),
                Mark::Active => {
                    let start = stack
                        .iter()
                        .position(|&n| n == next)
                        .expect("active nodes are on the stack");
                    let mut cycle = stack[start..].to_vec();
                    cycle.push(next);
                    out.push((cycle, span));
                }
                Mark::Done => {}
            }
        }
        stack.pop();
        marks[node] = Mark::Done;
    }

    let mut marks = vec![Mark::New; edges.len()];
    let mut out = Vec::new();
    for node in 0..edges.len() {
        if marks[node] == Mark::New {
            visit(node, edges, &mut marks, &mut Vec::new(), &mut out);
        }
    }
    out
}

fn report_import_cycles(files: &[ParsedFile], sources: &SourceMap, diags: &mut Vec<Diagnostic>) {
    let edges: Vec<Vec<(usize, Span)>> = files
        .iter()
        .map(|f| {
            f.imports
                .iter()
                .map(|&(id, span)| (id.index(), span))
                .collect()
        })
        .collect();
    for (cycle, span) in find_cycles(&edges) {
        let chain = cycle
            .iter()
            .map(|&i| sources.get(FileId(offset(i))).path())
            .collect::<Vec<_>>()
            .join(" -> ");
        diags.push(
            Diagnostic::error(span, "import cycle")
                .with_label("this import closes the cycle")
                .with_note(chain),
        );
    }
}

fn report_model_cycles(models: &[Model], diags: &mut Vec<Diagnostic>) {
    let edges: Vec<Vec<(usize, Span)>> = models
        .iter()
        .map(|m| {
            m.fields
                .iter()
                .filter_map(|f| match f.ty {
                    Type::Model(id) => Some((id.index(), f.span)),
                    _ => None,
                })
                .collect()
        })
        .collect();
    for (cycle, span) in find_cycles(&edges) {
        let chain = cycle
            .iter()
            .map(|&i| models[i].name.as_str())
            .collect::<Vec<_>>()
            .join(" -> ");
        diags.push(
            Diagnostic::error(span, format!("recursive model has infinite size: {chain}"))
                .with_note("make the field optional (`T?`) or a list (`T[]`)"),
        );
    }
}

fn report_unguarded_recursion(
    components: &[Component],
    instances: &[Vec<Instance>],
    diags: &mut Vec<Diagnostic>,
) {
    let edges: Vec<Vec<(usize, Span)>> = instances
        .iter()
        .map(|list| {
            list.iter()
                .filter(|i| !i.guarded)
                .map(|i| (i.component.index(), i.span))
                .collect()
        })
        .collect();
    for (cycle, span) in find_cycles(&edges) {
        let chain = cycle
            .iter()
            .map(|&i| components[i].name.as_str())
            .collect::<Vec<_>>()
            .join(" -> ");
        diags.push(
            Diagnostic::error(
                span,
                format!("component renders itself unconditionally: {chain}"),
            )
            .with_note("recursive components must be instantiated inside `if` or `for`"),
        );
    }
}

fn reachable_events(components: &[Component], instances: &[Vec<Instance>]) -> Vec<Vec<EventId>> {
    (0..components.len())
        .map(|start| {
            let mut seen = vec![false; components.len()];
            let mut stack = vec![start];
            let mut events = BTreeSet::new();
            seen[start] = true;
            while let Some(c) = stack.pop() {
                events.extend(components[c].emits.iter().copied());
                for instance in &instances[c] {
                    let next = instance.component.index();
                    if !seen[next] {
                        seen[next] = true;
                        stack.push(next);
                    }
                }
            }
            events.into_iter().collect()
        })
        .collect()
}
