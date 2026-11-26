//! WeChat mini program backend.
//!
//! The logic layer comes from
//! [`crate::bridge::remote_module`],
//! with bare `@weft-ui/runtime/remote` imports for Vite to resolve and bundle.
//!
//! The view layer ([`transform`]) generates files relative to the app's
//! `weft/` directory: the `view.*` files define one component containing
//! every app template, the sink's layout table, and the shared stylesheet.
//! The `index.*` files define the page hosting it.
//! The component and page use `getApp().weft`, registered by the bundled
//! `@weft-ui/platform` entry, without importing logic or runtime files.

mod elements;
mod table;
mod wxml;

use std::collections::{BTreeMap, BTreeSet};

use crate::AppOptions;
use crate::bridge::js;
use crate::elements::CSS;
use crate::ir::{NodeKind, Program, PropValue};
use crate::style;
use crate::transform::{Context, OutputFile};

/// Static resources used by a package's reachable templates.
#[derive(Debug, Clone, Default)]
pub struct ResourceUsage {
    pub assets: BTreeSet<String>,
    pub fonts: BTreeSet<String>,
    pub dynamic_assets: bool,
    pub dynamic_fonts: bool,
}

/// Resource usage of the main package and each configured subpackage.
#[derive(Debug, Clone, Default)]
pub struct PackageUsage {
    pub main: ResourceUsage,
    pub sub_packages: BTreeMap<String, ResourceUsage>,
}

fn reachable(program: &Program, pages: impl Iterator<Item = usize>) -> Vec<bool> {
    let mut included = vec![false; program.components.len()];
    let mut pending: Vec<usize> = pages.collect();
    while let Some(index) = pending.pop() {
        if std::mem::replace(&mut included[index], true) {
            continue;
        }
        for node in &program.components[index].nodes {
            if let NodeKind::Component { component, .. } = &node.kind {
                pending.push(component.index());
            }
        }
    }
    included
}

fn resources(program: &Program, included: &[bool]) -> ResourceUsage {
    let mut usage = ResourceUsage::default();
    for (component, include) in program.components.iter().zip(included) {
        if !include {
            continue;
        }
        for node in &component.nodes {
            let NodeKind::Element { element, props, .. } = &node.kind else {
                continue;
            };
            for prop in props {
                let is_src = *element == crate::elements::Element::Image && prop.name == "src";
                let is_font = prop.name == "font";
                if !is_src && !is_font {
                    continue;
                }
                let literal = match &prop.value {
                    PropValue::Expr(expr) => crate::view::literal(expr),
                    _ => None,
                };
                match literal {
                    Some(crate::view::Literal::Str(value)) if is_src => {
                        if let Some(name) = value.strip_prefix("asset:") {
                            usage.assets.insert(name.to_owned());
                        }
                    }
                    Some(crate::view::Literal::Str(value)) if is_font => {
                        usage.fonts.insert(value.to_owned());
                    }
                    None if is_src => usage.dynamic_assets = true,
                    None if is_font => usage.dynamic_fonts = true,
                    _ => {}
                }
            }
        }
    }
    usage
}

pub(crate) fn package_usage(program: &Program, options: &AppOptions) -> PackageUsage {
    let package_for = |name: &str| {
        options
            .sub_packages
            .iter()
            .find(|(_, pages)| pages.iter().any(|page| page == name))
            .map(|(root, _)| root.as_str())
    };
    let main = if program.app.is_some() {
        reachable(
            program,
            program
                .components
                .iter()
                .enumerate()
                .filter(|(_, c)| c.page.is_some() && package_for(&c.name).is_none())
                .map(|(i, _)| i),
        )
    } else {
        vec![true; program.components.len()]
    };
    let mut result = PackageUsage {
        main: resources(program, &main),
        ..PackageUsage::default()
    };
    for (root, pages) in &options.sub_packages {
        let set = reachable(
            program,
            program
                .components
                .iter()
                .enumerate()
                .filter(|(_, c)| c.page.is_some() && pages.contains(&c.name))
                .map(|(i, _)| i),
        );
        result
            .sub_packages
            .insert(root.clone(), resources(program, &set));
    }
    result
}

// A mini program image has a default 320×240 size, with no CSS intrinsic size.
// When the parent supplies a dimension, let CSS use that size and derive the
// other from the ratio instead of pinning both to the loaded source dimensions.
const INTRINSIC_IMAGE_CSS: &str = "\
.w-image-intrinsic{width:auto;height:auto;aspect-ratio:var(--w-image-ratio,4/3)}
.w-image-natural-width{width:var(--w-image-width,320px)}
.w-root > .w-image-natural-width.w-fill,
.w-column > .w-image-natural-width.w-fill,.w-column > .w-image-natural-width.w-grow,.w-column.w-stretch > .w-image-natural-width,
.w-row > .w-image-natural-width.w-fill,.w-row > .w-image-natural-width.w-grow,.w-row.w-stretch > .w-image-natural-width,
.w-scroll-content-v > .w-image-natural-width.w-fill,.w-scroll-content-v > .w-image-natural-width.w-grow,.w-scroll-content-v.w-stretch > .w-image-natural-width,
.w-scroll-content-h > .w-image-natural-width.w-fill,.w-scroll-content-h > .w-image-natural-width.w-grow,.w-scroll-content-h.w-stretch > .w-image-natural-width,
.w-stack > .w-image-natural-width.w-fill{width:auto}
.w-stack > .w-image-intrinsic.w-fill{aspect-ratio:auto}
";

fn json_string(value: &str) -> String {
    use std::fmt::Write as _;

    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if c.is_control() => {
                let _ = write!(out, "\\u{:04x}", u32::from(c));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Generates the WeChat mini program's view component and host page.
///
/// # Panics
///
/// Panics without a layout in `cx`.
#[must_use]
pub fn transform(cx: &Context<'_>, options: &AppOptions) -> Vec<OutputFile> {
    let program = cx.program;
    let layout = cx.layout.expect("the mini program view needs the layout");
    let split = program.app.is_some() && !options.sub_packages.is_empty();
    let main = reachable(
        program,
        program
            .components
            .iter()
            .enumerate()
            .filter(|(_, c)| {
                c.page.is_some()
                    && !options
                        .sub_packages
                        .values()
                        .any(|pages| pages.contains(&c.name))
            })
            .map(|(i, _)| i),
    );
    let (templates, mut styles) =
        wxml::templates(program, layout, split.then_some(main.as_slice()));
    if split {
        // Styles are shared by all package views.
        styles = wxml::templates(program, layout, None).1;
    }
    let image_css = if styles.has_intrinsic_image {
        INTRINSIC_IMAGE_CSS
    } else {
        ""
    };
    // WeChat gives textarea a fixed width that prevents cross-axis stretch.
    let textarea_css = if styles.has_textarea {
        ".w-textarea.w-wx{width:auto}\n"
    } else {
        ""
    };
    let (table, needs_assets) = table::object(program, layout);
    let manifest = if needs_assets {
        ", require(\"./assets.js\")"
    } else {
        ""
    };
    let (safe_class, safe_css) = if layout.safe_area() {
        (
            " w-safe",
            ".w-safe{padding-bottom:env(safe-area-inset-bottom)}\n",
        )
    } else {
        ("", "")
    };
    let mut files = vec![
        OutputFile {
            path: "view.js".to_owned(),
            contents: format!(
                "Component(getApp().weft.view({}{manifest}));\n",
                table.trim_end(),
            ),
        },
        OutputFile {
            path: "view.json".to_owned(),
            contents: "{\n  \"component\": true\n}\n".to_owned(),
        },
        OutputFile {
            path: "view.wxml".to_owned(),
            contents: format!(
                "{templates}<block wx:if=\"{{{{t}}}}\"><template is=\"{{{{t}}}}\" data=\"{{{{...r, wParent: ''}}}}\"/></block>\n"
            ),
        },
        OutputFile {
            path: "view.wxss".to_owned(),
            contents: format!(
                "{CSS}{image_css}{textarea_css}{}",
                style::theme_styles(layout.theme())
            ),
        },
        OutputFile {
            path: "index.js".to_owned(),
            contents: concat!(
                "Page({\n",
                "  onReady() {\n",
                "    getApp().weft.mount(this.selectComponent(\"#weft\"));\n",
                "  },\n",
                "  onUnload() {\n",
                "    getApp().weft.unmount();\n",
                "  }\n",
                "});\n",
            )
            .to_owned(),
        },
        OutputFile {
            path: "index.json".to_owned(),
            contents: "{\n  \"usingComponents\": {\n    \"weft-view\": \"./view\"\n  }\n}\n"
                .to_owned(),
        },
        OutputFile {
            path: "index.wxml".to_owned(),
            contents: format!("<weft-view id=\"weft\" class=\"w-root{safe_class}\"/>\n"),
        },
        OutputFile {
            path: "index.wxss".to_owned(),
            contents: format!(
                "@import \"./view.wxss\";\npage{{height:100%;overflow:hidden}}\n{safe_css}"
            ),
        },
    ];
    if let Some(app) = &program.app {
        files.retain(|file| !file.path.starts_with("index."));
        let start = app.start.index();
        let pages = std::iter::once(&program.components[start]).chain(
            program
                .components
                .iter()
                .enumerate()
                .filter(|(index, component)| *index != start && component.page.is_some())
                .map(|(_, component)| component),
        );
        for page in pages {
            let mut slug = String::new();
            for (index, c) in page.name.chars().enumerate() {
                if c.is_ascii_uppercase() && index != 0 {
                    slug.push('-');
                }
                slug.push(c.to_ascii_lowercase());
            }
            let package = options
                .sub_packages
                .iter()
                .find(|(_, pages)| pages.contains(&page.name))
                .map(|(root, _)| root.as_str());
            let prefix = match package {
                Some(root) => format!("../{root}/weft/pages/{slug}/index"),
                None => format!("pages/{slug}/index"),
            };
            files.push(OutputFile {
                path: format!("{prefix}.js"),
                contents: format!("Page(getApp().weft.page({}));\n", js::string(&page.name)),
            });
            let mut title = "";
            let mut hidden = false;
            if let Some(root) = page.roots.first()
                && let crate::ir::NodeKind::Element {
                    element: crate::elements::Element::NavBar,
                    props,
                    ..
                } = &page.node(*root).kind
            {
                for prop in props {
                    let crate::ir::PropValue::Expr(expr) = &prop.value else {
                        continue;
                    };
                    match (prop.name, crate::view::literal(expr)) {
                        ("title", Some(crate::view::Literal::Str(value))) => title = value,
                        ("hidden", Some(crate::view::Literal::Bool(true))) => hidden = true,
                        _ => {}
                    }
                }
            }
            files.push(OutputFile {
                path: format!("{prefix}.json"),
                contents: format!(
                    "{{\n  \"navigationBarTitleText\": {}{}\n  \"usingComponents\": {{\n    \"weft-view\": {}\n  }}\n}}\n",
                    json_string(title),
                    if hidden { ",\n  \"navigationStyle\": \"custom\"," } else { "," },
                    json_string(&package.map_or_else(|| "/weft/view".to_owned(), |root| format!("/{root}/weft/view"))),
                ),
            });
            files.push(OutputFile {
                path: format!("{prefix}.wxml"),
                contents: format!("<weft-view id=\"weft\" class=\"w-root{safe_class}\"/>\n"),
            });
            files.push(OutputFile {
                path: format!("{prefix}.wxss"),
                contents: format!(
                    "@import \"../../view.wxss\";\npage{{height:100%;overflow:hidden}}\n{safe_css}"
                ),
            });
        }
    }
    if split {
        for (root, pages) in &options.sub_packages {
            let mut included = reachable(
                program,
                program
                    .components
                    .iter()
                    .enumerate()
                    .filter(|(_, c)| c.page.is_some() && pages.contains(&c.name))
                    .map(|(i, _)| i),
            );
            for (item, in_main) in included.iter_mut().zip(&main) {
                *item &= !in_main;
            }
            let (extra, _) = wxml::templates(program, layout, Some(&included));
            let base = format!("../{root}/weft/view");
            files.push(OutputFile { path: format!("{base}.wxml"), contents: format!("<import src=\"/weft/view.wxml\"/>\n{extra}<block wx:if=\"{{{{t}}}}\"><template is=\"{{{{t}}}}\" data=\"{{{{...r, wParent: ''}}}}\"/></block>\n") });
            files.push(OutputFile {
                path: format!("{base}.js"),
                contents: format!(
                    "Component(getApp().weft.view({}{}));\n",
                    table.trim_end(),
                    if needs_assets {
                        ", require(\"../../weft/assets.js\")"
                    } else {
                        ""
                    }
                ),
            });
            files.push(OutputFile {
                path: format!("{base}.json"),
                contents: "{\n  \"component\": true\n}\n".to_owned(),
            });
            files.push(OutputFile {
                path: format!("{base}.wxss"),
                contents: "@import \"/weft/view.wxss\";\n".to_owned(),
            });
        }
    }
    if needs_assets {
        // Direct compiler users may not have a Vite asset directory. The plugin replaces this manifest.
        files.push(OutputFile {
            path: "assets.js".to_owned(),
            contents: "module.exports = {};\n".to_owned(),
        });
    }
    files
}
