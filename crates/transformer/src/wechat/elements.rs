//! How elements and their properties appear in WXML and in the view data.
//!
//! Data keys of a scope, by IR node id `N`:
//!
//! | Key        | Value                                                  |
//! | ---------- | ------------------------------------------------------ |
//! | `n{N}_{i}` | property `i` of an element                             |
//! | `q{N}`     | computed display label of a picker                     |
//! | `e{N}_{k}` | handler id for event `k` of an element (`data-e<type>`) |
//! | `i{N}`     | index of the active `if` branch, `-1` for none         |
//! | `b{N}`     | data of the active `if` branch, or `null`              |
//! | `l{N}`     | rows of a `for` loop; each row has its scope id in `k` |
//! | `c{N}`     | data of a component instance                           |
//! | `y{N}`     | slot data for the first `Children` parameter            |
//! | `y{N}_{p}` | slot data for another `Children` parameter at index `p` |
//!
//! Slot data holds its content template name in `t`.

use std::fmt;

use crate::elements::Element;
use crate::ir::{ComponentId, NodeId, Prop};
use crate::view::{Constant, ViewLayout, ViewNodeKind};

/// How a property value reaches the view.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Target {
    Text,
    /// String, integer or array attribute.
    Attr(&'static str),
    /// Maps an InputType to the native type and password attributes.
    InputType,
    /// An image source, possibly an `asset:` reference resolved by the sink.
    ImageSource,
    /// Maps an ImageFit to WeChat's image mode.
    ImageFit,
    /// Boolean attribute; WXML treats every non-empty string as true, so
    /// values are always written as expressions.
    Flag {
        name: &'static str,
        default: bool,
    },
    Style(usize),
    /// A constant selecting the scroll axis and base class.
    Direction,
    /// A constant selecting the divider's axis and class.
    Orientation,
    /// A Picker placeholder is read by the sink rather than from markup.
    PickerPlaceholder,
}

pub(crate) fn target(element: Element, prop: &str) -> Target {
    match (element, prop) {
        (Element::NavBar, "title") => Target::Attr("data-title"),
        (Element::NavBar, "hidden") => Target::Flag {
            name: "hidden",
            default: false,
        },
        (Element::BarButton, "label") => Target::Text,
        (Element::BarButton, "icon") => Target::Attr("data-icon"),
        (Element::Text | Element::Span, "value") => Target::Text,
        (Element::Input | Element::TextArea | Element::Slider, "value") => Target::Attr("value"),
        (Element::Input, "type") => Target::InputType,
        (Element::Input, "returnKey") => Target::Attr("confirm-type"),
        (Element::Input | Element::TextArea, "maxLength") => Target::Attr("maxlength"),
        (Element::Input | Element::TextArea, "focused") => Target::Flag {
            name: "focus",
            default: false,
        },
        (Element::Slider, "min") => Target::Attr("min"),
        (Element::Slider, "max") => Target::Attr("max"),
        (Element::Slider, "step") => Target::Attr("step"),
        (Element::Picker, "selected") => Target::Attr("value"),
        (Element::Picker, "options") => Target::Attr("range"),
        (Element::Picker, "placeholder") => Target::PickerPlaceholder,
        (Element::Divider, "vertical") => Target::Orientation,
        (Element::Checkbox | Element::Switch, "checked") => Target::Flag {
            name: "checked",
            default: false,
        },
        (_, "disabled") => Target::Flag {
            name: "disabled",
            default: false,
        },
        (Element::Input | Element::TextArea, "placeholder") => Target::Attr("placeholder"),
        (Element::Image, "src") => Target::ImageSource,
        (Element::Image, "fit") => Target::ImageFit,
        (Element::Scroll, "direction") => Target::Direction,
        (Element::Scroll, "indicators") => Target::Flag {
            name: "show-scrollbar",
            default: true,
        },
        (element, prop) => match element.spec().prop(prop).and_then(|spec| spec.css) {
            Some(index) => Target::Style(index),
            None => unreachable!("`{}` has no property `{prop}`", element.name()),
        },
    }
}

/// The mini program event type bound to an element's handler.
pub(crate) fn event_types(element: Element, event: &str) -> &'static [&'static str] {
    match (element, event) {
        (Element::Input | Element::TextArea, "onChange") => &["input"],
        (Element::Input, "onSubmit") => &["confirm"],
        (Element::Input | Element::TextArea, "onFocusChange") => &["focus", "blur"],
        (Element::Checkbox | Element::Switch | Element::Picker, "onChange") => &["change"],
        (Element::Slider, "onChange") => &["changing", "change"],
        (Element::Button, "onClick") | (_, "onTap") => &["tap"],
        _ => unreachable!("`{}` has no handler `{event}`", element.name()),
    }
}

/// Data key of event `index` on element `node`.
pub(crate) fn event_key(node: NodeId, index: usize) -> impl fmt::Display {
    fmt::from_fn(move |f| write!(f, "e{}_{index}", node.0))
}

/// Data key of property `index` of element `node`.
pub(crate) fn value_key(node: NodeId, index: usize) -> impl fmt::Display {
    fmt::from_fn(move |f| write!(f, "n{}_{index}", node.0))
}

/// Data key of the computed label of a picker.
pub(crate) fn picker_label_key(node: NodeId) -> impl fmt::Display {
    fmt::from_fn(move |f| write!(f, "q{}", node.0))
}

/// Image metrics and placeholder state collected from the native load event.
pub(crate) fn image_key(node: NodeId) -> impl fmt::Display {
    fmt::from_fn(move |out| write!(out, "m{}", node.0))
}

/// What the load event needs to supply when a dimension is not fixed by props.
pub(crate) fn image_layout(props: &[Prop]) -> Option<(&'static str, bool)> {
    let width = props.iter().any(|prop| prop.name == "width");
    let height = props.iter().any(|prop| prop.name == "height");
    let placeholder = props.iter().any(|prop| prop.name == "placeholder");
    let size = match (width, height) {
        (false, false) => "auto",
        (true, false) | (false, true) => "ratio",
        (true, true) if placeholder => "fixed",
        (true, true) => return None,
    };
    Some((size, placeholder))
}

/// Where the view reads a property from.
#[derive(Clone, Copy)]
pub(crate) enum Value<'a> {
    /// Constant written into the markup.
    Inline(&'a Constant),
    /// Key in the scope's data.
    Data,
}

/// Whether a string can appear verbatim in WXML text or attribute values.
/// Anything WXML could interpret (`{{`, entities, quotes) or trim is sent as
/// data instead.
fn markup_safe(s: &str) -> bool {
    s.trim() == s
        && !s
            .chars()
            .any(|c| matches!(c, '<' | '>' | '&' | '"' | '\'' | '{' | '}') || c.is_control())
}

/// Constants whose text has to be sent through data instead of markup.
pub(crate) fn needs_data(target: Target, constant: &Constant) -> bool {
    matches!(target, Target::PickerPlaceholder)
        || matches!((target, constant), (Target::Text | Target::Attr(_) | Target::ImageSource, Constant::String(s)) if !markup_safe(s))
        || matches!((target, constant), (Target::ImageSource, Constant::String(s)) if s.starts_with("asset:"))
}

/// How property `index` of element node `node` appears in the view.
pub(crate) fn prop_value<'a>(
    layout: &'a ViewLayout,
    component: ComponentId,
    node: NodeId,
    index: usize,
    prop: &Prop,
    target: Target,
) -> Value<'a> {
    if layout.value_slot(component, node, index).is_some() {
        return Value::Data;
    }
    let (template, local) = layout.location(component, node);
    let ViewNodeKind::Element { props, .. } = &layout.template(template).nodes[local as usize].kind
    else {
        unreachable!("node {} is an element", node.0);
    };
    let constant = &props
        .iter()
        .find(|p| p.name == prop.name)
        .expect("properties without a value slot are static")
        .value;
    if needs_data(target, constant) {
        Value::Data
    } else {
        Value::Inline(constant)
    }
}
