//! Semantic queries for editor tooling.
//!
//! [`analyze`] runs the same analysis as [`crate::check`] and records an
//! [`Index`] on the way: every resolved name occurrence (for hover and go to
//! definition), the argument lists of calls (for argument name completion)
//! and, when asked to, what is valid at a *probe*: an identifier the editor
//! puts at the cursor to learn which names can be completed there.
//!
//! Recording works on broken code: analysis continues after errors, and the
//! index holds whatever was resolved.

use std::cell::RefCell;
use std::fmt;

use weft_ui_ast::{Diagnostic, FileId, ParsedProgram, SourceMap, Span};

use crate::elements::{Children, ElementSpec, PropKind, PropSpec};
use crate::ir::{ComponentId, ParamKind, Program, Type, type_display};
use crate::sema;
use crate::sema::builtins::{MemberKind, MemberSig};
use crate::sema::record::{AliasSymbol, LocalBinding, Recorder, StyleSymbol, Target};

pub use crate::sema::record::ProbeContext;

/// Outcome of [`analyze`].
#[derive(Debug, Clone)]
pub struct IdeAnalysis {
    pub sources: SourceMap,
    /// Errors and warnings, ordered by file and position.
    pub diagnostics: Vec<Diagnostic>,
    pub index: Index,
}

/// Analyzes a parsed import closure like [`crate::check`] and records an
/// [`Index`].
///
/// With `probe`, the index also describes the first place where an
/// identifier with exactly that name is resolved (see [`Probe`]). Pick a name
/// that cannot clash with user code; diagnostics about it are not meaningful.
#[must_use]
pub fn analyze(parsed: ParsedProgram, probe: Option<&str>) -> IdeAnalysis {
    let recorder = Recorder {
        probe_name: probe.map(str::to_owned),
        ..Recorder::default()
    };
    let analysis = sema::analyze_recording(parsed, Some(RefCell::new(recorder)));
    let (recorder, program) = analysis
        .recording
        .expect("analysis returns the recorder it was given");
    let resolve = Resolver {
        program: &program,
        sources: &analysis.sources,
        aliases: &recorder.aliases,
        styles: &recorder.styles,
    };
    let index = Index {
        occurrences: recorder
            .refs
            .into_iter()
            .map(|(span, target)| Occurrence {
                span,
                symbol: resolve.symbol(target),
            })
            .collect(),
        calls: recorder
            .calls
            .into_iter()
            .map(|call| {
                let params: Vec<Symbol> =
                    call.params.into_iter().map(|t| resolve.symbol(t)).collect();
                let given = params
                    .iter()
                    .zip(call.given)
                    .filter(|(_, given)| *given)
                    .map(|(p, _)| p.name.clone())
                    .collect();
                CallSite {
                    args: call.args,
                    params,
                    given,
                }
            })
            .collect(),
        probe: recorder.probe.map(|probe| Probe {
            context: probe.context,
            candidates: probe
                .candidates
                .into_iter()
                .map(|t| resolve.symbol(t))
                .collect(),
        }),
    };
    IdeAnalysis {
        sources: analysis.sources,
        diagnostics: analysis.diagnostics,
        index,
    }
}

/// What the analysis learned about names in the analyzed files.
#[derive(Debug, Clone, Default)]
pub struct Index {
    /// Every resolved name, at its declaration and at each use, unordered.
    pub occurrences: Vec<Occurrence>,
    /// Argument lists of element, component and event constructor calls.
    pub calls: Vec<CallSite>,
    /// Present when the probe name was resolved somewhere.
    pub probe: Option<Probe>,
}

impl Index {
    /// The innermost occurrence whose span contains `offset` in `file`; a
    /// cursor right after a name still counts as on it.
    #[must_use]
    pub fn occurrence_at(&self, file: FileId, offset: u32) -> Option<&Occurrence> {
        self.occurrences
            .iter()
            .filter(|o| o.span.file == file && o.span.start <= offset && offset <= o.span.end)
            .min_by_key(|o| o.span.end - o.span.start)
    }

    /// The innermost call whose argument list contains `offset` in `file`.
    #[must_use]
    pub fn call_at(&self, file: FileId, offset: u32) -> Option<&CallSite> {
        self.calls
            .iter()
            .filter(|c| c.args.file == file && c.args.start < offset && offset < c.args.end)
            .min_by_key(|c| c.args.end - c.args.start)
    }

    /// All occurrences of the symbol defined at `def`.
    pub fn references(&self, def: Span) -> impl Iterator<Item = &Occurrence> {
        self.occurrences
            .iter()
            .filter(move |o| o.symbol.def == Some(def))
    }
}

/// A name in the source and the symbol it resolves to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Occurrence {
    pub span: Span,
    pub symbol: Symbol,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Symbol {
    pub kind: SymbolKind,
    pub name: String,
    /// Signature in Weft-like syntax, e.g. `state count: Int` or
    /// `Todo.name: String`.
    pub detail: String,
    /// Span of the declaring name; `None` for built-ins.
    pub def: Option<Span>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SymbolKind {
    Model,
    Event,
    Component,
    /// Model field or event parameter.
    Field,
    /// Component parameter.
    Param,
    State,
    Let,
    LoopVar,
    LambdaParam,
    /// Built-in element.
    Element,
    /// Built-in element property, including `onMount` / `onUnmount`.
    Prop,
    /// Built-in member such as `length` or `trim()`.
    Member,
    /// A built-in type or a user-declared type alias.
    Type,
    /// A compile-time style declaration.
    Style,
    /// A color or numeric token declared in `theme`.
    ThemeToken,
}

/// An argument list; `args` spans from the callee name to the end of the
/// call, excluding a trailing children block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallSite {
    pub args: Span,
    /// Parameters that can be passed by name, in declaration order.
    pub params: Vec<Symbol>,
    /// Names of the parameters already given an argument.
    pub given: Vec<String>,
}

/// Names valid where the probe identifier was resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Probe {
    pub context: ProbeContext,
    /// Names that can replace the probe, in a stable order.
    pub candidates: Vec<Symbol>,
}

// ---- built-in symbols ----------------------------------------------------

fn type_symbol(name: String) -> Symbol {
    Symbol {
        kind: SymbolKind::Type,
        detail: name.clone(),
        name,
        def: None,
    }
}

fn prop_signature(prop: &PropSpec) -> String {
    match prop.kind {
        PropKind::Value(ty) => format!(
            "{}: {}",
            prop.name,
            type_display(&ty.to_type(), &[], "unknown")
        ),
        PropKind::Handler { payload: None } | PropKind::Lifecycle => {
            format!("{}: event", prop.name)
        }
        PropKind::Handler { payload: Some(ty) } => {
            format!(
                "{}: event({})",
                prop.name,
                type_display(&ty.to_type(), &[], "unknown")
            )
        }
    }
}

fn prop_symbol(element: Option<&ElementSpec>, prop: &PropSpec) -> Symbol {
    let signature = prop_signature(prop);
    Symbol {
        kind: SymbolKind::Prop,
        name: prop.name.to_owned(),
        detail: match element {
            Some(element) => format!("{}.{signature}", element.name),
            None => signature,
        },
        def: None,
    }
}

fn element_symbol(spec: &ElementSpec) -> Symbol {
    let props: Vec<String> = spec
        .props
        .iter()
        .filter(|prop| prop.positional)
        .chain(spec.props.iter().filter(|prop| !prop.positional))
        .map(prop_signature)
        .collect();
    let children = if spec.children == Children::None {
        ""
    } else {
        " { … }"
    };
    Symbol {
        kind: SymbolKind::Element,
        name: spec.name.to_owned(),
        detail: format!("{}({}){children}", spec.name, props.join(", ")),
        def: None,
    }
}

// ---- resolution ----------------------------------------------------------

struct Resolver<'a> {
    program: &'a Program,
    sources: &'a SourceMap,
    aliases: &'a [AliasSymbol],
    styles: &'a [StyleSymbol],
}

impl Resolver<'_> {
    fn ty<'a>(&'a self, ty: &'a Type) -> impl fmt::Display + 'a {
        type_display(ty, &self.program.models, "unknown")
    }

    fn member_symbol(&self, name: String, sig: MemberSig) -> Symbol {
        let detail = match sig.kind {
            MemberKind::Property => format!("{name}: {}", self.ty(&sig.ret)),
            MemberKind::Method => {
                let params = fmt::from_fn(|out| {
                    for (index, ty) in sig.params.iter().enumerate() {
                        if index != 0 {
                            out.write_str(", ")?;
                        }
                        write!(out, "{}", self.ty(ty))?;
                    }
                    Ok(())
                });
                format!("{name}({params}): {}", self.ty(&sig.ret))
            }
        };
        Symbol {
            kind: SymbolKind::Member,
            name,
            detail,
            def: None,
        }
    }

    fn symbol(&self, target: Target) -> Symbol {
        let program = self.program;
        match target {
            Target::Element(spec) => element_symbol(spec),
            Target::Prop { owner, prop } => prop_symbol(owner, prop),
            Target::Member { name, signature } => self.member_symbol(name, signature),
            Target::Type(name) => type_symbol(name),
            Target::TypeAlias(id) => {
                let alias = &self.aliases[id];
                Symbol {
                    kind: SymbolKind::Type,
                    name: alias.name.clone(),
                    detail: format!("type {} = {}", alias.name, self.ty(&alias.ty)),
                    def: Some(alias.def),
                }
            }
            Target::Style(id) => {
                let style = &self.styles[id];
                Symbol {
                    kind: SymbolKind::Style,
                    name: self.sources.snippet(style.def).to_owned(),
                    detail: self.sources.snippet(style.declaration).to_owned(),
                    def: Some(style.def),
                }
            }
            Target::ThemeToken {
                ty,
                def,
                declaration,
            } => Symbol {
                kind: SymbolKind::ThemeToken,
                name: self.sources.snippet(def).to_owned(),
                detail: format!("{}: {}", self.sources.snippet(declaration), self.ty(&ty)),
                def: Some(def),
            },
            Target::Local {
                binding,
                name,
                ty,
                def,
            } => {
                let (kind, prefix) = match binding {
                    LocalBinding::Param => (SymbolKind::Param, "(parameter) "),
                    LocalBinding::State => (SymbolKind::State, "state "),
                    LocalBinding::Let => (SymbolKind::Let, "let "),
                    LocalBinding::LoopItem => (SymbolKind::LoopVar, "(loop variable) "),
                    LocalBinding::LambdaParam => (SymbolKind::LambdaParam, "(lambda parameter) "),
                };
                Symbol {
                    kind,
                    detail: format!("{prefix}{name}: {}", self.ty(&ty)),
                    name,
                    def: Some(def),
                }
            }
            Target::Model(id) => {
                let model = program.model(id);
                let fields: String = model
                    .fields
                    .iter()
                    .map(|f| format!("\n    {}: {},", f.name, self.ty(&f.ty)))
                    .collect();
                let body = if fields.is_empty() {
                    "{}".to_owned()
                } else {
                    format!("{{{fields}\n}}")
                };
                Symbol {
                    kind: SymbolKind::Model,
                    name: model.name.clone(),
                    detail: format!("model {} {body}", model.name),
                    def: Some(model.span),
                }
            }
            Target::Event(id) => {
                let event = program.event(id);
                let params = if event.params.is_empty() {
                    String::new()
                } else {
                    let list: Vec<String> = event
                        .params
                        .iter()
                        .map(|p| format!("{}: {}", p.name, self.ty(&p.ty)))
                        .collect();
                    format!("({})", list.join(", "))
                };
                Symbol {
                    kind: SymbolKind::Event,
                    name: event.name.clone(),
                    detail: format!("event {}{params}", event.name),
                    def: Some(event.span),
                }
            }
            Target::Component(id) => {
                let component = program.component(id);
                let params: Vec<String> = (0..component.params.len())
                    .map(|i| self.component_param(id, i))
                    .collect();
                Symbol {
                    kind: SymbolKind::Component,
                    name: component.name.clone(),
                    detail: format!(
                        "{} {}({})",
                        if component.page.is_some() {
                            "page"
                        } else {
                            "component"
                        },
                        component.name,
                        params.join(", ")
                    ),
                    def: Some(component.span),
                }
            }
            Target::Field(id, index) => {
                let model = program.model(id);
                let field = &model.fields[index];
                Symbol {
                    kind: SymbolKind::Field,
                    name: field.name.clone(),
                    detail: format!("{}.{}: {}", model.name, field.name, self.ty(&field.ty)),
                    def: Some(field.span),
                }
            }
            Target::EventParam(id, index) => {
                let event = program.event(id);
                let param = &event.params[index];
                Symbol {
                    kind: SymbolKind::Field,
                    name: param.name.clone(),
                    detail: format!("{}.{}: {}", event.name, param.name, self.ty(&param.ty)),
                    def: Some(param.span),
                }
            }
            Target::ComponentParam(id, index) => {
                let param = &program.component(id).params[index];
                Symbol {
                    kind: SymbolKind::Param,
                    name: param.name.clone(),
                    detail: format!("(parameter) {}", self.component_param(id, index)),
                    def: Some(param.span),
                }
            }
        }
    }

    /// `name: Type` with ` = default` as written in the source.
    fn component_param(&self, id: ComponentId, index: usize) -> String {
        let param = &self.program.component(id).params[index];
        let ty = fmt::from_fn(|out| match &param.kind {
            ParamKind::Value(ty) => write!(out, "{}", self.ty(ty)),
            ParamKind::Children => out.write_str("Children"),
            ParamKind::Callback { payload: None } => out.write_str("Event"),
            ParamKind::Callback { payload: Some(ty) } => write!(out, "Event<{}>", self.ty(ty)),
        });
        match &param.default {
            Some(default) => format!(
                "{}: {ty} = {}",
                param.name,
                self.sources.snippet(default.span)
            ),
            None => format!("{}: {ty}", param.name),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use weft_ui_parser::MemoryLoader;

    const MODELS: &str = "model Todo { id: Int, name: String }\n\
                          model Model { todos: Todo[], draft: String? }\n\
                          event Remove(id: Int)\n";

    fn analyze_app(app: &str, probe: Option<&str>) -> IdeAnalysis {
        let mut loader = MemoryLoader::new();
        loader.insert("models.weft", MODELS);
        loader.insert("app.weft", app);
        analyze(weft_ui_parser::load(&["app.weft"], &mut loader), probe)
    }

    fn at<'a>(analysis: &'a IdeAnalysis, app: &str, needle: &str) -> &'a Symbol {
        let offset = app.find(needle).expect("needle in source") as u32;
        &analysis
            .index
            .occurrence_at(FileId(0), offset)
            .unwrap_or_else(|| panic!("no occurrence at `{needle}`"))
            .symbol
    }

    const APP: &str = r##"import "./models.weft"
component Card(title: String, body: Children, footer: String = "end") {
  Column { Text(title) body }
}
component App(model: Model) {
  state count = 0
  Column(gap = 4) {
    for (todo in model.todos; key = todo.id) {
      Text(todo.name.trim(), color = "#fff")
      Button(onClick = Remove(id = todo.id)) { Text("x") }
    }
    Button(onClick = { v -> count += 1 }) { Text("${count}") }
    Card(title = "t") { Text(model.draft ?? "") }
  }
}
"##;

    #[test]
    fn resolves_theme_tokens_and_completes_in_declaration_order() {
        let app = r##"theme { accent = "#fff" dark "#000", gap = 8 }
style Accent { color = theme.accent }
component App() { Text("accent", style = Accent) }"##;
        let analysis = analyze_app(app, None);
        let token = at(&analysis, app, "accent }");
        assert_eq!(token.kind, SymbolKind::ThemeToken);
        assert_eq!(token.detail, "accent = \"#fff\" dark \"#000\": Color");
        assert_eq!(
            analysis
                .sources
                .snippet(token.def.expect("token definition")),
            "accent"
        );

        let analysis = analyze_app(&app.replace("theme.accent", "theme.PROBE"), Some("PROBE"));
        let probe = analysis.index.probe.expect("a theme member probe");
        assert_eq!(probe.context, ProbeContext::Member);
        assert_eq!(
            probe
                .candidates
                .iter()
                .map(|token| token.name.as_str())
                .collect::<Vec<_>>(),
            ["accent", "gap"]
        );
    }

    #[test]
    fn page_declaration_has_a_page_signature_and_definition() {
        let app = "page Detail(id: String) path \"/notes/{id}\" { Text(id) }";
        let analysis = analyze_app(app, None);
        let page = at(&analysis, app, "Detail(");
        assert_eq!(page.detail, "page Detail(id: String)");
        assert_eq!(
            analysis.sources.snippet(page.def.expect("page definition")),
            "Detail"
        );
        assert_eq!(at(&analysis, app, "id)").detail, "(parameter) id: String");
    }

    #[test]
    fn resolves_names_to_signatures_and_definitions() {
        let analysis = analyze_app(APP, None);
        let todo = at(&analysis, APP, "todo in");
        assert_eq!(todo.detail, "(loop variable) todo: Todo");
        assert_eq!(todo.kind, SymbolKind::LoopVar);

        let use_site = at(&analysis, APP, "todo.name");
        assert_eq!(use_site.def, todo.def);

        let name = at(&analysis, APP, "name.trim");
        assert_eq!(name.detail, "Todo.name: String");
        let models = analysis.sources.files()[1].text();
        assert_eq!(
            name.def.map(|d| d.start as usize),
            models.find("name: String")
        );

        assert_eq!(at(&analysis, APP, "trim()").detail, "trim(): String");
        assert_eq!(at(&analysis, APP, "count +=").detail, "state count: Int");
        assert_eq!(at(&analysis, APP, "gap").detail, "Column.gap: Int");
        assert_eq!(at(&analysis, APP, "id = todo").detail, "Remove.id: Int");
        assert_eq!(
            at(&analysis, APP, "Card(title").detail,
            r#"component Card(title: String, body: Children, footer: String = "end")"#
        );
        assert_eq!(
            at(&analysis, APP, "title = ").detail,
            "(parameter) title: String"
        );
        assert_eq!(
            at(&analysis, APP, "Model)").detail,
            "model Model {\n    todos: Todo[],\n    draft: String?,\n}"
        );
        assert_eq!(at(&analysis, APP, "Remove(").kind, SymbolKind::Event);
        assert!(
            at(&analysis, APP, "Text(todo")
                .detail
                .starts_with("Text(value: String")
        );
    }

    #[test]
    fn slot_labels_resolve_to_the_callee_and_offer_unfilled_siblings() {
        let app = r#"component Card(body: Children, title: String, header: Children, footer: Children) {
  Column { header Text(title) body footer }
}
component App() {
  Card("card") { Text("body") header: {} footer: {} }
}"#;
        let analysis = analyze_app(app, None);
        let header = at(&analysis, app, "header: {}");
        assert_eq!(header.detail, "(parameter) header: Children");
        assert_eq!(header.def, at(&analysis, app, "header: Children").def);

        let probe = probe(&app.replace("header: {}", "__probe: {}"));
        assert_eq!(probe.context, ProbeContext::SlotFill);
        assert_eq!(names(&probe), ["header"]);
    }

    #[test]
    fn type_aliases_have_definitions_and_type_completion() {
        let app = r#"type Kind = "text" | "image"
component Example(kind: Kind) { Text(kind) }"#;
        let analysis = analyze_app(app, None);
        let alias = at(&analysis, app, "Kind)");
        assert_eq!(alias.detail, r#"type Kind = "text" | "image""#);
        assert_eq!(alias.def, at(&analysis, app, "Kind =").def);
        assert_eq!(alias.kind, SymbolKind::Type);

        let probe = probe(&app.replace("Kind)", "__probe)"));
        assert_eq!(probe.context, ProbeContext::Type);
        assert!(names(&probe).contains(&"Kind"));
    }

    #[test]
    fn let_bindings_have_types_definitions_and_scoped_completion() {
        let app = r#"component Example(name: String) {
    if (true) {
        let label = name.uppercase()
        Text(label)
    }
    Text(name)
}"#;
        let analysis = analyze_app(app, None);
        let label = at(&analysis, app, "label)");
        assert_eq!(label.kind, SymbolKind::Let);
        assert_eq!(label.detail, "let label: String");
        assert_eq!(label.def, at(&analysis, app, "label =").def);
        assert_eq!(
            label.def.map(|span| span.start as usize),
            app.find("label =")
        );

        let inner = probe(&app.replace("Text(label)", "Text(__probe)"));
        assert_eq!(inner.context, ProbeContext::Value);
        assert!(names(&inner).contains(&"label"));
        let outer = probe(&app.replace("Text(name)", "Text(__probe)"));
        assert_eq!(outer.context, ProbeContext::Value);
        assert!(!names(&outer).contains(&"label"));
    }

    #[test]
    fn records_calls_and_given_arguments() {
        let analysis = analyze_app(APP, None);
        let offset = APP.find("color =").expect("needle") as u32;
        let call = analysis
            .index
            .call_at(FileId(0), offset)
            .expect("call at offset");
        let names: Vec<&str> = call.params.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(
            names,
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
                "color",
                "size",
                "weight",
                "italic",
                "decoration",
                "font",
                "onTap",
                "value",
                "align",
                "maxLines",
                "lineHeight",
                "onMount",
                "onUnmount",
            ]
        );
        assert_eq!(call.given, ["color", "value"]);
    }

    fn probe(app: &str) -> Probe {
        analyze_app(app, Some("__probe"))
            .index
            .probe
            .expect("probe resolved")
    }

    fn names(probe: &Probe) -> Vec<&str> {
        probe.candidates.iter().map(|c| c.name.as_str()).collect()
    }

    #[test]
    fn probes_report_names_valid_in_context() {
        let app = |body: &str| {
            format!(
                "import \"./models.weft\"\ncomponent App(model: Model, kids: Children) {{\n  state n = 0\n  {body}\n}}\n"
            )
        };

        let p = probe(&app(
            "for (todo in model.todos; key = todo.id) { Text(__probe) }",
        ));
        assert_eq!(p.context, ProbeContext::Value);
        assert_eq!(names(&p), ["model", "n", "todo"]);

        let p = probe(&app("Text(model.__probe)"));
        assert_eq!(p.context, ProbeContext::Member);
        assert_eq!(names(&p), ["todos", "draft"]);

        let p = probe(&app("Text(model.todos.__probe)"));
        assert_eq!(names(&p), ["length", "isEmpty"]);

        let p = probe(&app("Column { __probe }"));
        assert_eq!(p.context, ProbeContext::Node);
        let n = names(&p);
        assert!(n.contains(&"Text") && n.contains(&"App") && n.contains(&"kids"));
        assert!(!n.contains(&"model"));

        let p = probe(&app("Button(onClick = __probe)"));
        assert_eq!(p.context, ProbeContext::Handler);
        assert_eq!(names(&p), ["Remove"]);

        let p = probe(&app("Button(onClick = { __probe = 1 })"));
        assert_eq!(p.context, ProbeContext::AssignTarget);
        assert_eq!(names(&p), ["n"]);

        let p = probe("import \"./models.weft\"\nmodel X { a: __probe }\n");
        assert_eq!(p.context, ProbeContext::Type);
        let n = names(&p);
        assert!(n.contains(&"Int") && n.contains(&"Todo") && !n.contains(&"Remove"));
    }
}
