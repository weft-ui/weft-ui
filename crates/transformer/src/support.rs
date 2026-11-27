//! Platform-specific checks that run after target-independent semantic analysis.

use weft_ui_ast::Diagnostic;

use crate::elements::{Element, Level};
use crate::ir::{NodeKind, Program};
use crate::transform::Platform;

pub(crate) fn check(program: &Program, platform: Platform) -> Vec<Diagnostic> {
    let level = |support: &[(Platform, Level)]| {
        support
            .iter()
            .find_map(|&(target, level)| (target == platform).then_some(level))
    };
    check_with(program, platform, |element, member| {
        let spec = element.spec();
        level(match member {
            None => spec.support,
            Some(name) => spec.prop(name)?.support,
        })
    })
}

fn check_with(
    program: &Program,
    platform: Platform,
    level: impl Fn(Element, Option<&str>) -> Option<Level>,
) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for component in &program.components {
        for node in &component.nodes {
            let NodeKind::Element { element, props, .. } = &node.kind else {
                continue;
            };
            if level(*element, None) == Some(Level::No) {
                diagnostics.push(Diagnostic::error(
                    node.span,
                    format!("`{}` is not supported on {platform}", element.name()),
                ));
            }
            for prop in props {
                if level(*element, Some(prop.name)) == Some(Level::No) {
                    diagnostics.push(Diagnostic::error(
                        prop.span,
                        format!(
                            "`{}.{}` is not supported on {platform}",
                            element.name(),
                            prop.name
                        ),
                    ));
                }
            }
        }
    }
    diagnostics
}

#[cfg(test)]
mod tests {
    use weft_ui_parser::{MemoryLoader, load};

    use super::*;

    #[test]
    fn return_key_is_ignored_on_desktop_native_platforms() {
        let path = "Main.weft";
        let mut loader = MemoryLoader::new();
        loader.insert(
            path,
            r#"
type Key = "done" | "go" | "next" | "search" | "send"
component Main(key: Key) {
    Input("", returnKey = "done")
    Input("", returnKey = key)
}
"#,
        );
        for platform in [Platform::Macos, Platform::Windows, Platform::Linux] {
            let compiled =
                crate::compile_app(load(&[path], &mut loader), platform, &Default::default());
            assert!(
                compiled.compilation.diagnostics.is_empty(),
                "{}",
                compiled.compilation.render_diagnostics()
            );
            let layout = compiled.layout.expect("native apps have a layout");
            assert!(!layout.to_json().contains("returnKey"), "{platform} layout");
        }
    }

    #[test]
    fn reports_unsupported_elements_and_members_at_their_source_spans() {
        let source = r#"component Main() {
  Column {
    if (true) { Image("test.png") }
    Button(disabled = false, onClick = Click) { Text("ok", size = 12) }
  }
}
event Click
component Unused() { Checkbox(false, disabled = true) }
"#;
        let path = "Main.weft";
        let mut loader = MemoryLoader::new();
        loader.insert(path, source);
        let compilation = crate::check(load(&[path], &mut loader));
        let program = compilation
            .program
            .as_ref()
            .expect("the fixture is valid on a target that supports all elements");
        let mut diagnostics = check_with(program, Platform::Linux, |element, member| {
            match (element, member) {
                (Element::Image, None)
                | (Element::Button, Some("onClick"))
                | (Element::Checkbox, Some("disabled")) => Some(Level::No),
                (Element::Button, Some("disabled")) | (Element::Text, None) => Some(Level::Ignored),
                _ => None,
            }
        });
        diagnostics.sort_by_key(|d| d.span.start);
        let actual: Vec<_> = diagnostics
            .iter()
            .map(|d| {
                assert!(d.is_error());
                let span = d.span;
                (
                    &source[span.start as usize..span.end as usize],
                    d.message.as_str(),
                )
            })
            .collect();
        assert_eq!(
            actual,
            [
                ("Image(\"test.png\")", "`Image` is not supported on linux"),
                (
                    "onClick = Click",
                    "`Button.onClick` is not supported on linux"
                ),
                (
                    "disabled = true",
                    "`Checkbox.disabled` is not supported on linux"
                ),
            ]
        );
    }
}
