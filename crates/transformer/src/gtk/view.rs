//! Imperative construction of a template's elements and mount points.

use std::fmt::Write;

use crate::elements::Element;
use crate::view::{Constant, Template, ValueType, ViewNodeKind};

use super::cpp::{self, Code};

/// Constructs the template's roots in pre-order.
pub(crate) fn body(out: &mut Code, template: &Template) {
    for &root in &template.roots {
        node(out, template, root, None);
    }
}

fn node(out: &mut Code, template: &Template, index: u32, parent: Option<u32>) {
    let region = match parent {
        Some(parent) => format!("{}children()", member(template, parent)),
        None => "roots()".to_owned(),
    };
    match &template.nodes[index as usize].kind {
        ViewNodeKind::Element {
            element,
            props,
            children,
        } => {
            let args = match element {
                Element::NavBar => String::new(),
                Element::BarButton => match template.event(index, "onTap") {
                    Some(slot) => format!("[this] {{ dispatch({slot}); }}"),
                    None => "nullptr".to_owned(),
                },
                Element::Column => "weft::Axis::Vertical".to_owned(),
                Element::Row => "weft::Axis::Horizontal".to_owned(),
                Element::Button => match template.event(index, "onClick") {
                    Some(slot) => format!("[this] {{ dispatch({slot}); }}"),
                    None => "nullptr".to_owned(),
                },
                Element::Input | Element::TextArea => {
                    let (slot, _) = template.controlled(index);
                    let mut args =
                        format!("[this](std::string_view v) {{ return dispatch({slot}, v); }}");
                    let focus = template.event(index, "onFocusChange");
                    if *element == Element::Input {
                        if let Some(submit) = template.event(index, "onSubmit") {
                            write!(args, ", [this] {{ dispatch({submit}); }}")
                                .expect("writing to a String cannot fail");
                        } else if focus.is_some() {
                            args.push_str(", nullptr");
                        }
                    }
                    if let Some(focus) = focus {
                        write!(args, ", [this](bool v) {{ dispatch_focus({focus}, v); }}")
                            .expect("writing to a String cannot fail");
                    }
                    args
                }
                Element::Checkbox | Element::Switch => {
                    let (slot, _) = template.controlled(index);
                    format!("[this](bool v) {{ return dispatch({slot}, v); }}")
                }
                Element::Slider | Element::Picker => {
                    let (slot, _) = template.controlled(index);
                    format!("[this](double v) {{ return dispatch({slot}, v); }}")
                }
                Element::Scroll | Element::Divider => props
                    .iter()
                    .find(|prop| is_constructor_prop(*element, prop.name))
                    .map_or_else(String::new, |prop| {
                        literal(*element, prop.name, &prop.value)
                    }),
                Element::Text if !children.is_empty() => children.len().to_string(),
                Element::Stack
                | Element::Spacer
                | Element::Text
                | Element::Image
                | Element::Spinner
                | Element::Progress => String::new(),
                Element::Span => unreachable!("Span is emitted by its parent Text"),
            };
            let made = format!("make<weft::{}>({args})", wrapper(*element));
            let access = initialize(out, template, index, &made);
            if *element != Element::BarButton
                && let Some(slot) = template.event(index, "onTap")
            {
                out.writer.line(format_args!(
                    "{access}set_on_tap([this] {{ dispatch({slot}); }});"
                ));
            }
            match element {
                Element::NavBar => out.writer.line(format_args!(
                    "set_page_bar({});",
                    reference(template, index)
                )),
                Element::BarButton => {
                    let parent = parent.expect("BarButton belongs to a NavBar");
                    out.writer.line(format_args!(
                        "{}add({});",
                        member(template, parent),
                        reference(template, index)
                    ));
                }
                _ => out.writer.line(format_args!(
                    "{region}.add({});",
                    reference(template, index)
                )),
            }
            if *element == Element::Text {
                for (position, &child) in children.iter().enumerate() {
                    span(out, template, child, &access, position);
                }
            } else {
                for &child in children {
                    node(out, template, child, Some(index));
                }
            }
        }
        ViewNodeKind::Point(point) => out
            .writer
            .line(format_args!("{region}.point(*this, {point});")),
    }
}

fn span(out: &mut Code, template: &Template, index: u32, text: &str, position: usize) {
    initialize(out, template, index, &format!("{text}span({position})"));
}

/// Binds a widget or inline run and writes its constant properties.
fn initialize(out: &mut Code, template: &Template, index: u32, instance: &str) -> String {
    let ViewNodeKind::Element { element, props, .. } = &template.nodes[index as usize].kind else {
        unreachable!("only elements have properties");
    };
    let is_field = is_field(template, index);
    let member = if is_field {
        out.writer.line(format_args!("n{index}_ = &{instance};"));
        format!("n{index}_->")
    } else {
        out.writer
            .line(format_args!("auto &n{index} = {instance};"));
        format!("n{index}.")
    };
    for prop in props
        .iter()
        .filter(|prop| !is_constructor_prop(*element, prop.name))
    {
        out.writer.line(format_args!(
            "{member}{}({});",
            setter(prop.name),
            literal(*element, prop.name, &prop.value)
        ));
    }
    member
}

fn is_constructor_prop(element: Element, prop: &str) -> bool {
    matches!(
        (element, prop),
        (Element::Scroll, "direction") | (Element::Divider, "vertical")
    )
}

/// Whether node `index` is kept in a field `n{index}_` for `apply`.
pub(crate) fn is_field(template: &Template, index: u32) -> bool {
    template.values.iter().any(|v| v.node == index)
}

/// The element of node `index` in the constructor: a local reference, or a field pointer.
fn reference(template: &Template, index: u32) -> String {
    if is_field(template, index) {
        format!("*n{index}_")
    } else {
        format!("n{index}")
    }
}

/// Member access on the element of node `index`, up to the member name.
fn member(template: &Template, index: u32) -> String {
    if is_field(template, index) {
        format!("n{index}_->")
    } else {
        format!("n{index}.")
    }
}

pub(crate) fn wrapper(element: Element) -> &'static str {
    match element {
        Element::NavBar => "NavBar",
        Element::BarButton => "BarButton",
        Element::Column | Element::Row => "Linear",
        Element::Stack => "Stack",
        Element::Scroll => "Scroll",
        Element::Spacer => "Spacer",
        Element::Text => "Text",
        Element::Span => "Text::Span",
        Element::Button => "Button",
        Element::Input => "Input",
        Element::Checkbox => "Checkbox",
        Element::Image => "Image",
        Element::Switch => "Switch",
        Element::TextArea => "TextArea",
        Element::Spinner => "Spinner",
        Element::Progress => "Progress",
        Element::Divider => "Divider",
        Element::Slider => "Slider",
        Element::Picker => "Picker",
    }
}

/// The wrapper method writing property `name`: `set_` and the name in snake case.
pub(crate) fn setter(name: &str) -> String {
    prefixed("set", name)
}

fn prefixed(prefix: &str, name: &str) -> String {
    let mut result = String::from(prefix);
    for (index, c) in name.chars().enumerate() {
        if index == 0 || c.is_ascii_uppercase() {
            result.push('_');
        }
        result.push(c.to_ascii_lowercase());
    }
    result
}

fn union_type(element: Element, prop: &str) -> Option<&'static str> {
    match (element, prop) {
        (Element::Column | Element::Row | Element::Scroll, "align") => Some("CrossAlign"),
        (Element::Column | Element::Row, "justify") => Some("Justify"),
        (Element::Stack, "alignment") => Some("Alignment"),
        (Element::Scroll, "direction") => Some("Axis"),
        (Element::Text, "align") => Some("TextAlign"),
        (Element::Text | Element::Span, "weight") => Some("Weight"),
        (Element::Text | Element::Span, "decoration") => Some("Decoration"),
        (Element::Input, "type") => Some("InputType"),
        (Element::Image, "fit") => Some("ImageFit"),
        (_, "shadow") => Some("Shadow"),
        _ => None,
    }
}

pub(crate) fn slot_value(element: Element, prop: &str, ty: ValueType) -> String {
    if let Some(union) = union_type(element, prop) {
        return format!("weft::{}(weft::string(value))", prefixed("parse", union));
    }
    let accessor = match ty {
        ValueType::Int | ValueType::Float => "number",
        ValueType::Bool => "boolean",
        ValueType::String => "string",
        ValueType::Color => "color",
        ValueType::Strings => "strings",
    };
    format!("weft::{accessor}(value)")
}

fn literal(element: Element, prop: &str, value: &Constant) -> String {
    match value {
        Constant::Int(v) => v.to_string(),
        Constant::Float(v) => format!("{v:?}"),
        Constant::Bool(v) => v.to_string(),
        Constant::String(s) => union_type(element, prop).map_or_else(
            || cpp::string(s),
            |union| format!("weft::{union}::{}{}", s[..1].to_ascii_uppercase(), &s[1..]),
        ),
        Constant::Token(name) => format!("weft::Color::token({})", cpp::string(name)),
        Constant::Color(c) => format!("weft::Color::rgba({})", cpp::rgba(*c)),
    }
}
