//! Checks Weft UI programs and emits code for platform backends.
//!
//! [`check`] takes a [`ParsedProgram`] (entry modules and their imports, as
//! loaded by `weft_ui_parser::load`), resolves and type checks it, and lowers
//! it to a typed [`ir::Program`] with dependency information for every
//! binding. [`compile_app`] dispatches this
//! IR to the backend modules for the selected [`transform::Platform`].
//! Platforms with a separate view layer share a [`view::ViewLayout`] between
//! their view files and their generated JS logic modules. Use [`declarations`]
//! to obtain TypeScript declarations with source mappings without emitting JS.

mod bridge;
mod code;
pub mod color;
mod compose;
mod deps;
pub mod elements;
mod gtk;
pub mod ide;
pub mod ir;
mod protocol;
mod report;
mod sema;
mod style;
mod support;
mod swiftui;
pub mod transform;
pub mod view;
mod web;
mod wechat;
mod winui;

use std::fmt::Write as _;

use weft_ui_ast::{Diagnostic, FileId, ParsedProgram, SourceMap, diagnostic};

use crate::bridge::js;
use crate::ir::Program;
use crate::transform::{Context, Declarations, JsModule, OutputFile, Platform};
use crate::view::ViewLayout;

pub use report::dependency_report;

/// Outcome of checking an import closure.
#[derive(Debug, Clone)]
pub struct Compilation {
    /// Source text and locations for checked modules.
    pub sources: SourceMap,
    /// Errors and warnings, ordered by file and position.
    pub diagnostics: Vec<Diagnostic>,
    /// Present only when no errors were reported.
    pub program: Option<ir::Program>,
}

impl Compilation {
    /// Whether any diagnostic is an error rather than a warning.
    #[must_use]
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(Diagnostic::is_error)
    }

    /// Renders all diagnostics with source snippets.
    #[must_use]
    pub fn render_diagnostics(&self) -> String {
        diagnostic::render_all(&self.diagnostics, &self.sources)
    }
}

/// Resolves and type checks a parsed import closure as one program, so
/// declaration names must be unique across all of its modules.
///
/// The returned diagnostics include those of `parsed`.
#[must_use]
pub fn check(parsed: ParsedProgram) -> Compilation {
    let analysis = sema::analyze(parsed);
    Compilation {
        sources: analysis.sources,
        diagnostics: analysis.diagnostics,
        program: analysis.program,
    }
}

/// Result of [`compile_app`].
#[derive(Debug, Clone)]
pub struct AppOutput {
    /// Sources, diagnostics and, without errors, the program.
    pub compilation: Compilation,
    /// One logic module per `.weft` file, entries first; empty on errors.
    pub logic: Vec<JsModule>,
    /// View files relative to `apps/<platform>/weft/`; empty on errors.
    pub views: Vec<OutputFile>,
    /// View protocol layout shared by the logic modules and the view files;
    /// `None` on errors and for `web`.
    pub layout: Option<ViewLayout>,
}

/// App-wide settings shared by the compiler backends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AppOptions {
    /// Keep root content inside the host's safe area. Defaults to `true`.
    pub safe_area: bool,
}

impl Default for AppOptions {
    fn default() -> Self {
        Self { safe_area: true }
    }
}

/// Checks a parsed app (see [`check`]) and transforms it for `platform`.
///
/// On compilation errors, no logic modules or view files are generated.
///
/// Native platforms get the remote mode logic modules, `layout.json` (the
/// layout the native views implement, including its hash) and the views of
/// their backend: SwiftUI for iOS and macOS, Jetpack Compose for Android,
/// WinUI 3 for Windows, and GTK 4 for Linux.
#[must_use]
pub fn compile_app(parsed: ParsedProgram, platform: Platform, options: &AppOptions) -> AppOutput {
    let compilation = check(parsed);
    let mut output = AppOutput {
        compilation,
        logic: Vec::new(),
        views: Vec::new(),
        layout: None,
    };
    if let Some(program) = &output.compilation.program {
        let diagnostics = support::check(program, platform);
        if diagnostics.is_empty() {
            (output.logic, output.views, output.layout) =
                transform_program(program, platform, options);
        } else {
            output.compilation.program = None;
            output.compilation.diagnostics.extend(diagnostics);
            output
                .compilation
                .diagnostics
                .sort_by_key(|d| (d.span.file, d.span.start));
        }
    }
    output
}

/// Generates the TypeScript declarations and source mappings of the Web logic module of `file`.
///
/// # Panics
///
/// Panics if `file` is not part of the program.
#[must_use]
pub fn declarations(program: &Program, file: FileId) -> Declarations {
    bridge::declarations(
        program,
        file,
        bridge::Mode::Dom(&web::dom::Dom, &AppOptions::default()),
    )
}

/// Declarations of a module at `path` whose program has errors: re-exports
/// of its direct `imports`, so TypeScript still loads and reports them.
#[must_use]
pub fn import_declarations<'a>(path: &str, imports: impl IntoIterator<Item = &'a str>) -> String {
    let mut text = String::new();
    for import in imports {
        let specifier = js::string(&js::relative_specifier(path, import));
        // Infallible: writing to a `String`.
        let _ = writeln!(text, "export * from {specifier};");
    }
    text.push_str("export {};\n");
    text
}

fn transform_program(
    program: &Program,
    platform: Platform,
    options: &AppOptions,
) -> (Vec<JsModule>, Vec<OutputFile>, Option<ViewLayout>) {
    match platform {
        // DOM code lives in the logic modules; there are no view files.
        Platform::Web => (
            program
                .modules
                .iter()
                .map(|module| crate::web::module(program, module.file, options))
                .collect(),
            Vec::new(),
            None,
        ),
        Platform::Wechat => {
            let layout = ViewLayout::for_platform(program, Some(Platform::Wechat), options);
            let cx = Context::new(program, Some(&layout), platform);
            let views = crate::wechat::transform(&cx);
            (remote_modules(program, &layout), views, Some(layout))
        }
        Platform::Ios | Platform::Macos => {
            transform_native(program, platform, options, crate::swiftui::transform)
        }
        Platform::Android => {
            transform_native(program, platform, options, crate::compose::transform)
        }
        Platform::Windows => transform_native(program, platform, options, crate::winui::transform),
        Platform::Linux => transform_native(program, platform, options, crate::gtk::transform),
    }
}

fn transform_native(
    program: &Program,
    platform: Platform,
    options: &AppOptions,
    transform_view: impl FnOnce(&Context<'_>) -> Vec<OutputFile>,
) -> (Vec<JsModule>, Vec<OutputFile>, Option<ViewLayout>) {
    let layout = ViewLayout::for_platform(program, Some(platform), options);
    let layout_file = OutputFile {
        path: "layout.json".to_owned(),
        contents: layout.to_json(),
    };
    let cx = Context::new(program, Some(&layout), platform);
    let mut views = transform_view(&cx);
    views.insert(0, layout_file);
    (remote_modules(program, &layout), views, Some(layout))
}

fn remote_modules(program: &Program, layout: &ViewLayout) -> Vec<JsModule> {
    program
        .modules
        .iter()
        .map(|module| crate::bridge::remote_module(program, layout, module.file))
        .collect()
}
