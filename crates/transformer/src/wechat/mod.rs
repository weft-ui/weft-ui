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

use crate::bridge::js;
use crate::elements::CSS;
use crate::style;
use crate::transform::{Context, OutputFile};

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
pub fn transform(cx: &Context<'_>) -> Vec<OutputFile> {
    let program = cx.program;
    let layout = cx.layout.expect("the mini program view needs the layout");
    let (templates, styles) = wxml::templates(program, layout);
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
            let prefix = format!("pages/{slug}/index");
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
                    "{{\n  \"navigationBarTitleText\": {}{}\n  \"usingComponents\": {{\n    \"weft-view\": \"/weft/view\"\n  }}\n}}\n",
                    json_string(title),
                    if hidden { ",\n  \"navigationStyle\": \"custom\"," } else { "," },
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
    if needs_assets {
        // Direct compiler users may not have a Vite asset directory. The plugin replaces this manifest.
        files.push(OutputFile {
            path: "assets.js".to_owned(),
            contents: "module.exports = {};\n".to_owned(),
        });
    }
    files
}
