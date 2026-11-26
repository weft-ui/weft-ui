//! Emits JavaScript logic modules: host bindings and component block code.
//!
//! Each `.weft` file becomes one ES module with TypeScript declarations for
//! model classes, events, and root component classes. A module imports what
//! it uses from its direct imports and re-exports every symbol of its import
//! closure, so hosts only reference the entry module.
//!
//! The block code depends on the [`Mode`]: the [Web backend](crate::web) uses
//! [`DomView`] to write DOM blocks, while [`remote_module`] writes blocks
//! that drive the scopes of the view protocol for a separate view layer.

pub(crate) mod blocks;
pub(crate) mod expr;
pub(crate) mod flow;
mod host;
pub(crate) mod js;
pub(crate) mod remote;

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use weft_ui_ast::FileId;

use crate::ir::{ComponentId, EventId, ModelId, Module, NodeKind, ParamKind, Program, Type};
use crate::transform::{Declarations, JsModule};
use crate::view::ViewLayout;

use blocks::{Consts, offset};
use js::Code;

/// How the components of a module render.
#[derive(Debug, Clone, Copy)]
pub enum Mode<'v> {
    /// Browser DOM through `view`; modules import each other as `.weft` files.
    Dom(&'v dyn DomView, &'v crate::AppOptions),
    /// Scopes of the view protocol `layout`, rendered by a separate view
    /// layer; modules import each other as `.weft` files for Vite to resolve.
    Remote(&'v ViewLayout),
}

/// Writes the DOM create functions of components.
pub trait DomView: fmt::Debug {
    /// Emits `export function {Name}$c(app, args, children, depth)` for
    /// component `id`, interning module constants in `consts`.
    fn component(&self, program: &Program, id: ComponentId, consts: &mut Consts, out: &mut Code);
}

/// Generates the logic module of `file`, importing the runtime from
/// `runtime`. Its imports are specified relative to `file`, so the modules
/// of a whole program can be served side by side.
///
/// # Panics
///
/// Panics if `file` is not part of the program.
#[must_use]
pub fn generate(program: &Program, file: FileId, runtime: &str, mode: Mode<'_>) -> JsModule {
    let links = Links::new(program, file, mode);
    let mut dts_text = String::new();
    dts(program, &links).write_to(&mut dts_text);
    JsModule {
        source: links.entry.path.clone(),
        code: code(program, &links, runtime),
        dts: dts_text,
    }
}

/// Generates the declarations of `file`; [`generate`] returns the same text.
///
/// # Panics
///
/// Panics if `file` is not part of the program.
#[must_use]
pub fn declarations(program: &Program, file: FileId, mode: Mode<'_>) -> Declarations {
    let links = Links::new(program, file, mode);
    let mut text = String::new();
    let mappings = dts(program, &links).write_mapped(&mut text);
    Declarations { text, mappings }
}

/// Generates the remote mode logic module of `file`, importing
/// `@weft-ui/runtime/remote`. The WeChat mini program and the native
/// platforms share it; only the sink differs.
///
/// # Panics
///
/// Panics if `file` is not part of the program or `layout` was derived from
/// another program.
#[must_use]
pub fn remote_module(program: &Program, layout: &ViewLayout, file: FileId) -> JsModule {
    generate(
        program,
        file,
        "@weft-ui/runtime/remote",
        Mode::Remote(layout),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Symbol {
    Model(ModelId),
    Event(EventId),
    Component(ComponentId),
}

impl Symbol {
    fn name(self, program: &Program) -> &str {
        match self {
            Symbol::Model(id) => &program.model(id).name,
            Symbol::Event(id) => &program.event(id).name,
            Symbol::Component(id) => &program.component(id).name,
        }
    }

    fn file(self, program: &Program) -> FileId {
        match self {
            Symbol::Model(id) => program.model(id).file,
            Symbol::Event(id) => program.event(id).file,
            Symbol::Component(id) => program.component(id).file,
        }
    }
}

/// How the entry module reaches symbols declared in other files.
struct Links<'p> {
    program: &'p Program,
    entry: &'p Module,
    /// Import closure of each direct import, including itself.
    closures: Vec<(&'p Module, BTreeSet<FileId>)>,
    mode: Mode<'p>,
}

impl<'p> Links<'p> {
    fn new(program: &'p Program, file: FileId, mode: Mode<'p>) -> Self {
        let module = |file: FileId| program.module(file);
        let entry = module(file);
        let closures = entry
            .imports
            .iter()
            .map(|&file| {
                let mut seen = BTreeSet::new();
                let mut stack = vec![file];
                while let Some(next) = stack.pop() {
                    if seen.insert(next) {
                        stack.extend(&module(next).imports);
                    }
                }
                (module(file), seen)
            })
            .collect();
        Self {
            program,
            entry,
            closures,
            mode,
        }
    }

    /// The direct import whose module exports `symbol`.
    fn provider(&self, symbol: Symbol) -> &'p Module {
        let file = symbol.file(self.program);
        self.closures
            .iter()
            .find(|(_, closure)| closure.contains(&file))
            .map(|(module, _)| *module)
            .expect("symbols of other files are reachable through a direct import")
    }

    fn specifier(&self, module: &Module) -> String {
        js::string(&js::relative_specifier(&self.entry.path, &module.path))
    }

    fn is_own(&self, symbol: Symbol) -> bool {
        symbol.file(self.program) == self.entry.file
    }

    /// Symbols of other files grouped by the import that provides them.
    fn group(&self, symbols: impl IntoIterator<Item = Symbol>) -> BTreeMap<FileId, Vec<Symbol>> {
        let mut groups: BTreeMap<FileId, Vec<Symbol>> = BTreeMap::new();
        for symbol in symbols {
            if !self.is_own(symbol) {
                groups
                    .entry(self.provider(symbol).file)
                    .or_default()
                    .push(symbol);
            }
        }
        groups
    }

    fn module(&self, file: FileId) -> &'p Module {
        self.closures
            .iter()
            .map(|(m, _)| *m)
            .find(|m| m.file == file)
            .expect("groups only contain direct imports")
    }

    /// Every symbol of other files in this module's import closure, for
    /// re-export.
    fn foreign(&self) -> impl Iterator<Item = Symbol> + '_ {
        let program = self.program;
        let models = (0..program.models.len()).map(|i| Symbol::Model(ModelId(offset(i))));
        let events = (0..program.events.len()).map(|i| Symbol::Event(EventId(offset(i))));
        let components =
            (0..program.components.len()).map(|i| Symbol::Component(ComponentId(offset(i))));
        models.chain(events).chain(components).filter(|&s| {
            let file = s.file(program);
            !self.is_own(s) && self.closures.iter().any(|(_, c)| c.contains(&file))
        })
    }
}

fn models_in(ty: &Type, out: &mut BTreeSet<Symbol>) {
    match ty {
        Type::Model(id) => {
            out.insert(Symbol::Model(*id));
        }
        Type::Array(inner) | Type::Optional(inner) => models_in(inner, out),
        _ => {}
    }
}

/// Models named by the types of the entry's models and component parameters.
fn used_models(program: &Program, entry: &Module, out: &mut BTreeSet<Symbol>) {
    for &id in &entry.models {
        for field in &program.model(id).fields {
            models_in(&field.ty, out);
        }
    }
    for &id in &entry.components {
        for param in &program.component(id).params {
            if let ParamKind::Value(ty) = &param.kind {
                models_in(ty, out);
            }
        }
    }
}

fn code(program: &Program, links: &Links<'_>, runtime: &str) -> String {
    let entry = links.entry;
    let mut out = Code::default();
    out.line(format!("import * as $ from {};", js::string(runtime)));

    // Imports: models for converters, create functions of used components.
    let mut used = BTreeSet::new();
    used_models(program, entry, &mut used);
    let mut callees = BTreeSet::new();
    for &id in &entry.components {
        for node in &program.component(id).nodes {
            if let NodeKind::Component { component, .. } = node.kind {
                callees.insert(Symbol::Component(component));
            }
        }
    }
    let mut imports: BTreeMap<FileId, Vec<String>> = BTreeMap::new();
    for (file, symbols) in links.group(used) {
        imports
            .entry(file)
            .or_default()
            .extend(symbols.iter().map(|s| {
                let name = s.name(program);
                js::aliased(name, &js::binding(name))
            }));
    }
    for (file, symbols) in links.group(callees) {
        imports
            .entry(file)
            .or_default()
            .extend(symbols.iter().map(|s| format!("{}$c", s.name(program))));
    }
    let theme = program
        .theme
        .as_ref()
        .filter(|_| matches!(links.mode, Mode::Dom(..)));
    if let Some(theme) = theme
        && theme.span.file != entry.file
        && entry
            .components
            .iter()
            .any(|&id| program.component(id).uses_theme)
    {
        // Styles can carry tokens from their own imports without declaring runtime symbols.
        imports.entry(theme.span.file).or_default();
    }
    for (file, names) in imports {
        let path = links.specifier(program.module(file));
        if names.is_empty() {
            out.line(format!("import {path};"));
        } else {
            out.line(format!("import {{ {} }} from {path};", names.join(", ")));
        }
    }
    // Events have no runtime value.
    let reexports = links.foreign().filter(|s| !matches!(s, Symbol::Event(_)));
    for (file, symbols) in links.group(reexports) {
        let names: Vec<&str> = symbols.iter().map(|s| s.name(program)).collect();
        out.line(format!(
            "export {{ {} }} from {};",
            names.join(", "),
            links.specifier(links.module(file))
        ));
    }

    if let Some(theme) = theme.filter(|theme| theme.span.file == entry.file) {
        out.open("$.theme({");
        for (name, light, dark) in &theme.colors {
            // A computed key also treats `__proto__` as an ordinary token.
            out.line(format!(
                "[\"{name}\"]: [\"{}\", \"{}\"],",
                light.rgba_hex(),
                dark.rgba_hex()
            ));
        }
        out.close("});");
    }

    let mut converters = host::Converters::default();
    let mut models = Code::default();
    for &id in &entry.models {
        models.line("");
        host::model_class(program, id, &mut converters, &mut models);
    }
    let mut consts = Consts::default();
    let mut components = Code::default();
    for &id in &entry.components {
        components.line("");
        match links.mode {
            Mode::Dom(view, _) => view.component(program, id, &mut consts, &mut components),
            Mode::Remote(layout) => {
                remote::component(program, layout, id, &mut consts, &mut components);
            }
        }
        components.line("");
        host::app_class(program, id, links.mode, &mut converters, &mut components);
    }

    out.append(models);
    out.line("");
    converters.write(&mut out);
    consts.write(&mut out);
    out.append(components);
    let aliases = own_aliases(program, entry, false);
    if !aliases.is_empty() {
        out.line("");
        out.line(format!("export {{ {} }};", aliases.join(", ")));
    }
    let mut text = String::new();
    out.write_to(&mut text);
    text
}

/// `local as name` for own declarations whose names are reserved words.
fn own_aliases(program: &Program, entry: &Module, with_events: bool) -> Vec<String> {
    let models = entry.models.iter().map(|&id| &program.model(id).name);
    let events = entry
        .events
        .iter()
        .filter(|_| with_events)
        .map(|&id| &program.event(id).name);
    let components = entry
        .components
        .iter()
        .map(|&id| &program.component(id).name);
    models
        .chain(events)
        .chain(components)
        .filter_map(|name| {
            let local = js::binding(name);
            (local != *name).then(|| format!("{local} as {name}"))
        })
        .collect()
}

fn dts(program: &Program, links: &Links<'_>) -> Code {
    let entry = links.entry;
    let mut out = Code::default();
    if entry
        .components
        .iter()
        .any(|&id| program.component(id).page.is_some())
    {
        let runtime = match links.mode {
            Mode::Dom(..) => "@weft-ui/runtime",
            Mode::Remote(_) => "@weft-ui/runtime/remote",
        };
        out.line(format!(
            "import type {{ Page as $Page }} from {};",
            js::string(runtime)
        ));
    }

    let mut used = BTreeSet::new();
    used_models(program, entry, &mut used);
    for &id in &entry.events {
        for param in &program.event(id).params {
            models_in(&param.ty, &mut used);
        }
    }
    for &id in &entry.components {
        used.extend(
            program
                .component(id)
                .reachable_events
                .iter()
                .map(|&e| Symbol::Event(e)),
        );
    }
    for (file, symbols) in links.group(used) {
        let names: Vec<String> = symbols
            .iter()
            .map(|s| {
                let name = s.name(program);
                js::aliased(name, &js::binding(name))
            })
            .collect();
        out.line(format!(
            "import type {{ {} }} from {};",
            names.join(", "),
            links.specifier(links.module(file))
        ));
    }
    // `export *` keeps the text independent of what the imports declare, so
    // TypeScript's per-file content mapper cache stays valid when they change.
    for (module, _) in &links.closures {
        out.line(format!("export * from {};", links.specifier(module)));
    }
    // `export *` skips `default`.
    for symbol in links.foreign().filter(|s| s.name(program) == "default") {
        let keyword = match symbol {
            Symbol::Component(_) => "export",
            Symbol::Model(_) | Symbol::Event(_) => "export type",
        };
        out.line(format!(
            "{keyword} {{ default }} from {};",
            links.specifier(links.provider(symbol))
        ));
    }

    for &id in &entry.models {
        out.line("");
        host::model_dts(program, id, &mut out);
    }
    if !entry.events.is_empty() {
        out.line("");
    }
    for &id in &entry.events {
        host::event_dts(program, id, &mut out);
    }
    for &id in &entry.components {
        out.line("");
        host::app_dts(program, id, links.mode, &mut out);
    }
    let aliases = own_aliases(program, entry, true);
    if !aliases.is_empty() {
        out.line("");
        out.line(format!("export {{ {} }};", aliases.join(", ")));
    }
    out
}
