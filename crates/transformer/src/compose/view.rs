//! The Compose view `V{n}` of a template: built-in elements call the shell's
//! composables, and mount points render child scopes.
//!
//! `Column` and `Row` share `WeftLinear`; `Stack` and `Scroll` have their own
//! layouts. Size constraints, margins, grow and fill travel as modifiers so
//! they are available to whichever parent measures the node.

use std::fmt::{self, Display, Write as _};

use crate::elements::Element;
use crate::view::{Constant, PointKind, PropSource, StaticProp, Template, ViewNodeKind};

use super::kotlin::{self, Code};

/// Writes the composable `V{index}` of `template`.
pub(crate) fn view(out: &mut Code, index: usize, template: &Template) {
    out.writer.line("@Composable");
    out.open(format_args!("private fun V{index}(s: S{index}) {{"));
    let body = Body { template };
    for &root in &template.roots {
        body.node(out, root);
    }
    out.close("}");
}

struct Body<'t> {
    template: &'t Template,
}

impl Body<'_> {
    fn node(&self, out: &mut Code, node: u32) {
        match &self.template.nodes[node as usize].kind {
            ViewNodeKind::Element {
                element,
                props,
                children,
            } => self.element(out, node, *element, props, children),
            ViewNodeKind::Point(point) => self.point(out, *point),
        }
    }

    fn element(
        &self,
        out: &mut Code,
        node: u32,
        element: Element,
        props: &[StaticProp],
        children: &[u32],
    ) {
        let prop = |name: &str| self.template.prop(node, props, name);
        let line = out.writer.start_line();
        line.push_str("Weft");
        line.push_str(match element {
            Element::Column | Element::Row => "Linear",
            _ => element.name(),
        });
        let mut args = CallArgs::new(line);
        let controlled = matches!(
            element,
            Element::Input
                | Element::TextArea
                | Element::Checkbox
                | Element::Switch
                | Element::Slider
                | Element::Picker
        )
        .then(|| self.template.controlled(node));
        let names: &[&str] = match element {
            Element::NavBar | Element::BarButton => {
                unreachable!("navigation is not supported on native platforms")
            }
            Element::Column | Element::Row => {
                let axis = if element == Element::Row {
                    "HORIZONTAL"
                } else {
                    "VERTICAL"
                };
                args.push(format_args!("axis = WeftAxis.{axis}"));
                &["gap", "align", "justify"]
            }
            Element::Button => {
                match self.template.event(node, "onClick") {
                    Some(slot) => args.push(format_args!("onClick = {{ s.dispatch({slot}) }}")),
                    None => args.push("onClick = {}"),
                }
                &["disabled"]
            }
            Element::Text => {
                if let Some(value) = prop("value") {
                    args.push(KotlinProp(value, None));
                }
                &["align", "maxLines", "lineHeight"]
            }
            Element::Span => {
                args.push(KotlinProp(prop("value").expect("`Span` has a value"), None));
                &[]
            }
            Element::Input
            | Element::TextArea
            | Element::Checkbox
            | Element::Switch
            | Element::Slider
            | Element::Picker => {
                let (_, slot) = controlled.expect("controlled elements have value slots");
                args.push(format_args!("s.v{slot}"));
                match element {
                    Element::Input => &[
                        "placeholder",
                        "disabled",
                        "type",
                        "returnKey",
                        "maxLength",
                        "focused",
                    ],
                    Element::TextArea => &["placeholder", "disabled", "maxLength", "focused"],
                    Element::Slider => &["min", "max", "step", "disabled"],
                    Element::Picker => &["options", "placeholder", "disabled"],
                    _ => &["disabled"],
                }
            }
            Element::Image => {
                args.push(KotlinProp(prop("src").expect("`Image` has a source"), None));
                &["fit", "placeholder"]
            }
            Element::Stack => &["alignment"],
            Element::Scroll => &["direction", "gap", "align", "indicators"],
            Element::Spacer => &["size"],
            Element::Spinner => &["color"],
            Element::Progress => {
                args.push(KotlinProp(
                    prop("value").expect("`Progress` has a value"),
                    None,
                ));
                &["color"]
            }
            Element::Divider => &["vertical", "color"],
        };
        let text_style = if matches!(element, Element::Text | Element::Span) {
            TEXT_STYLE
        } else {
            &[]
        };
        for &name in text_style.iter().chain(names).chain(PADDING) {
            let Some(value) = prop(name) else { continue };
            if name == "disabled" && matches!(value, PropSource::Constant(Constant::Bool(false))) {
                continue;
            }
            let union = match name {
                "align" if element == Element::Text => Some("TextAlign"),
                "align" => Some("CrossAlign"),
                "justify" => Some("Justify"),
                "alignment" => Some("Alignment"),
                "direction" => Some("Axis"),
                "fit" => Some("ImageFit"),
                "weight" => Some("Weight"),
                "decoration" => Some("Decoration"),
                "type" => Some("InputType"),
                "returnKey" => Some("ReturnKey"),
                _ => None,
            };
            args.push(format_args!("{name} = {}", KotlinProp(value, union)));
        }
        if element == Element::Input
            && let Some(slot) = self.template.event(node, "onSubmit")
        {
            args.push(format_args!("onSubmit = {{ s.dispatch({slot}) }}"));
        }
        if matches!(element, Element::Input | Element::TextArea)
            && let Some(slot) = self.template.event(node, "onFocusChange")
        {
            args.push(format_args!(
                "onFocusChange = {{ s.dispatch({slot}, WeftValue.Bool(it)) }}"
            ));
        }
        // Image pixels follow the radius of their own box, independent of child clipping.
        let modifier_prop = |name: &str| {
            if element == Element::Image && name == "clip" {
                prop("radius").map(|_| PropSource::Constant(&Constant::Bool(true)))
            } else {
                prop(name)
            }
        };
        modifiers(&mut args, modifier_prop, self.template.event(node, "onTap"));
        args.finish(matches!(
            element,
            Element::Spacer | Element::Spinner | Element::Divider
        ));
        match element {
            Element::NavBar | Element::BarButton => {
                unreachable!("navigation is not supported on Android")
            }
            Element::Input | Element::TextArea => {
                let (event, slot) = controlled.expect("text controls have value slots");
                out.writer.end_line(format_args!(
                    " {{ if (s.dispatch({event}, WeftValue.Text(it))) null else s.v{slot} }}"
                ));
            }
            Element::Checkbox | Element::Switch => {
                let (event, _) = controlled.expect("toggle controls have value slots");
                out.writer.end_line(format_args!(
                    " {{ s.dispatch({event}, WeftValue.Bool(it)) }}"
                ));
            }
            Element::Slider | Element::Picker => {
                let (event, _) = controlled.expect("numeric controls have value slots");
                out.writer.end_line(format_args!(
                    " {{ s.dispatch({event}, WeftValue.Number(it.toDouble())) }}"
                ));
            }
            Element::Text if children.is_empty() => out.writer.end_line(""),
            Element::Span
            | Element::Image
            | Element::Spacer
            | Element::Spinner
            | Element::Progress
            | Element::Divider => out.writer.end_line(""),
            Element::Column
            | Element::Row
            | Element::Stack
            | Element::Scroll
            | Element::Button
            | Element::Text => {
                out.open_after(" {");
                for &child in children {
                    self.node(out, child);
                }
                out.close("}");
            }
        }
    }

    fn point(&self, out: &mut Code, point: u32) {
        match &self.template.points[point as usize].kind {
            PointKind::Branch { templates } => {
                out.open(format_args!("when (val c = s.p{point}) {{"));
                for template in templates {
                    let t = template.0;
                    out.writer
                        .line(format_args!("is S{t} -> key(c.id) {{ V{t}(c) }}"));
                }
                out.close("}");
            }
            PointKind::List { template } => out.writer.line(format_args!(
                "for (c in s.p{point}) key(c.id) {{ V{}(c) }}",
                template.0
            )),
            PointKind::Instance { template } => out
                .writer
                .line(format_args!("s.p{point}?.let {{ V{}(it) }}", template.0)),
            PointKind::Slot => out.writer.line(format_args!(
                "s.p{point}?.let {{ key(it.id) {{ it.Content() }} }}"
            )),
        }
    }
}

const TEXT_STYLE: &[&str] = &["color", "size", "weight", "italic", "decoration", "font"];

const PADDING: &[&str] = &[
    "padding",
    "paddingX",
    "paddingY",
    "paddingTop",
    "paddingBottom",
    "paddingStart",
    "paddingEnd",
];

const SIZE: &[&str] = &[
    "width",
    "height",
    "minWidth",
    "maxWidth",
    "minHeight",
    "maxHeight",
    "aspectRatio",
];

const CHILD: &[&str] = &[
    "grow",
    "fill",
    "margin",
    "marginX",
    "marginY",
    "marginTop",
    "marginBottom",
    "marginStart",
    "marginEnd",
];

const APPEARANCE: &[&str] = &[
    "opacity",
    "hidden",
    "background",
    "radius",
    "border",
    "borderColor",
    "shadow",
    "clip",
];

fn modifiers<'t>(
    args: &mut CallArgs<'_>,
    prop: impl Fn(&str) -> Option<PropSource<'t>>,
    tap: Option<usize>,
) {
    let groups = [
        ("weftSize", SIZE, None),
        ("weftChild", CHILD, None),
        ("weftAppearance", APPEARANCE, tap),
    ];
    if tap.is_none()
        && !groups
            .iter()
            .any(|(_, names, _)| names.iter().any(|name| prop(name).is_some()))
    {
        return;
    }
    args.push(fmt::from_fn(|f| {
        f.write_str("modifier = Modifier")?;
        for (method, names, tap) in groups {
            let mut first = true;
            for &name in names {
                let Some(value) = prop(name) else { continue };
                if first {
                    write!(f, ".{method}(")?;
                    first = false;
                } else {
                    f.write_str(", ")?;
                }
                let union = (name == "shadow").then_some("Shadow");
                write!(f, "{name} = {}", KotlinProp(value, union))?;
            }
            if let Some(slot) = tap {
                if first {
                    write!(f, ".{method}(")?;
                    first = false;
                } else {
                    f.write_str(", ")?;
                }
                write!(f, "onTap = {{ s.dispatch({slot}) }}")?;
            }
            if !first {
                f.write_char(')')?;
            }
        }
        Ok(())
    }));
}

/// Writes the argument list directly into the output.
struct CallArgs<'a> {
    line: &'a mut String,
    started: bool,
}

impl<'a> CallArgs<'a> {
    fn new(line: &'a mut String) -> Self {
        Self {
            line,
            started: false,
        }
    }

    fn push(&mut self, argument: impl Display) {
        if self.started {
            self.line.push_str(", ");
        } else {
            self.line.push('(');
            self.started = true;
        }
        write!(self.line, "{argument}").expect("writing to a String cannot fail");
    }

    fn finish(self, parentheses: bool) {
        if self.started {
            self.line.push(')');
        } else if parentheses {
            self.line.push_str("()");
        }
    }
}

struct KotlinProp<'t>(PropSource<'t>, Option<&'static str>);

impl Display for KotlinProp<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(union) = self.1 {
            return match self.0 {
                PropSource::Slot(slot) => write!(f, "Weft{union}.parse(s.v{slot})"),
                PropSource::Constant(Constant::String(value)) => {
                    write!(f, "Weft{union}.")?;
                    for c in value.chars() {
                        if c.is_ascii_uppercase() {
                            f.write_char('_')?;
                        }
                        f.write_char(c.to_ascii_uppercase())?;
                    }
                    Ok(())
                }
                PropSource::Constant(_) => unreachable!("union properties contain strings"),
            };
        }
        match self.0 {
            PropSource::Slot(slot) => write!(f, "s.v{slot}"),
            PropSource::Constant(value) => match value {
                Constant::Int(v) => write!(f, "{v}f"),
                Constant::Float(v) => write!(f, "{v:?}f"),
                Constant::Bool(v) => v.fmt(f),
                Constant::String(s) => kotlin::string(f, s),
                Constant::Token(name) => {
                    f.write_str("WeftColor.token(")?;
                    kotlin::string(f, name)?;
                    f.write_char(')')
                }
                Constant::Color(c) => write!(f, "WeftColor.Fixed({})", kotlin::color(*c)),
            },
        }
    }
}
