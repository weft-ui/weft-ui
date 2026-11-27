//! WXML templates of the mini program backend.
//!
//! Every component becomes a `<template>` that renders the data object of one
//! instance (keys are listed in [`super::elements`]); nested scopes are
//! reached through their key (`b3.n7_0`, `r0.n9_0`). Slot content is
//! rendered by a template of the calling component, chosen at run time
//! through `t`, so all templates of the app live in one file.

use std::fmt::{self, Write as _};

use crate::elements::{CSS_PROPS, CssTarget, CssUnit, CustomCss, Element};
use crate::ir::{
    Component, ComponentId, NodeId, NodeKind, ParamId, Program, PropValue, first_slot,
};
use crate::style;
use crate::view::{Constant, ViewLayout};

use super::elements::{
    Target, Value, event_key, event_types, image_key, image_layout, picker_label_key, prop_value,
    target, value_key,
};

fn slot_name(base: fmt::Arguments<'_>, callee: &Component, param: ParamId) -> String {
    if first_slot(&callee.params) == Some(param) {
        base.to_string()
    } else {
        format!("{base}_{}", param.0)
    }
}

/// Data key for a rendered slot in the receiving component.
pub(crate) fn slot_key(comp: &Component, node: NodeId, param: ParamId) -> String {
    slot_name(format_args!("y{}", node.0), comp, param)
}

/// Template rendering the children a component call passes to a slot.
pub(crate) fn slot_template(
    program: &Program,
    comp: &Component,
    node: NodeId,
    param: ParamId,
) -> String {
    let NodeKind::Component { component, .. } = comp.node(node).kind else {
        unreachable!("slot content comes from a component call");
    };
    slot_name(
        format_args!("{}-s{}", comp.name, node.0),
        program.component(component),
        param,
    )
}

#[derive(Default)]
pub(crate) struct ViewStyles {
    pub has_textarea: bool,
    pub has_intrinsic_image: bool,
}

/// Templates for every component, plus the conditional styles they need.
pub(crate) fn templates(
    program: &Program,
    layout: &ViewLayout,
    included: Option<&[bool]>,
) -> (String, ViewStyles) {
    let mut out = String::new();
    let mut styles = ViewStyles::default();
    for (index, comp) in program.components.iter().enumerate() {
        if included.is_some_and(|set| !set[index]) {
            continue;
        }
        let mut markup = Markup {
            program,
            layout,
            id: ComponentId(u32::try_from(index).expect("component ids fit in u32")),
            comp,
            slots: Vec::new(),
            styles: &mut styles,
        };
        let mut body = String::new();
        markup.nodes(&comp.roots, "", Parent::Inherited, &mut body);
        template(&comp.name, &body, &mut out);
        for (name, body) in markup.slots {
            template(&name, &body, &mut out);
        }
    }
    (out, styles)
}

fn template(name: &str, body: &str, out: &mut String) {
    out.push_str("<template name=\"");
    out.push_str(name);
    out.push_str("\">");
    out.push_str(body);
    out.push_str("</template>\n");
}

/// Tag, base class and fixed attributes of an element.
fn tag(element: Element) -> (&'static str, &'static str, &'static str) {
    match element {
        Element::NavBar => ("view", "w-navbar", " style=\"display:none\""),
        Element::BarButton => ("view", "w-bar-button", " style=\"display:none\""),
        Element::Column => ("view", "w-column", ""),
        Element::Row => ("view", "w-row", ""),
        Element::Stack => ("view", "w-stack", ""),
        Element::Scroll => (
            "scroll-view",
            "w-scroll-v",
            " scroll-y enable-flex enhanced",
        ),
        Element::List => (
            "scroll-view",
            "w-list w-scroll-v",
            " scroll-y enable-flex enhanced",
        ),
        Element::Grid => (
            "scroll-view",
            "w-grid w-scroll-v",
            " scroll-y enable-flex enhanced",
        ),
        Element::Spacer => ("view", "w-spacer", ""),
        Element::Text => ("text", "w-text", ""),
        Element::Span => ("text", "w-span", ""),
        Element::Button => ("button", "w-button w-wx", " size=\"mini\""),
        Element::Input => ("input", "w-input w-wx", " maxlength=\"-1\""),
        Element::Checkbox => ("switch", "w-checkbox", " type=\"checkbox\""),
        Element::Image => ("image", "w-image", ""),
        Element::Switch => ("switch", "w-switch", ""),
        Element::TextArea => ("textarea", "w-textarea w-wx", " maxlength=\"-1\""),
        Element::Slider => ("slider", "w-slider", ""),
        Element::Picker => ("picker", "w-picker-host", " mode=\"selector\""),
        Element::Spinner => ("view", "w-spinner", ""),
        Element::Progress => ("view", "w-progress", ""),
        Element::Divider => ("view", "w-divider", ""),
    }
}

/// The parent element's layout class passes through zero-width WXML wrappers.
#[derive(Clone, Copy)]
enum Parent {
    Ordinary,
    Stack,
    Scroll,
    /// A reusable component or slot template receives its parent at the call site.
    Inherited,
}

impl Parent {
    fn of(element: Element) -> Self {
        match element {
            Element::Stack => Self::Stack,
            Element::Scroll => Self::Scroll,
            _ => Self::Ordinary,
        }
    }

    fn class(self) -> &'static str {
        match self {
            Self::Ordinary => "",
            Self::Stack => " w-in-stack",
            Self::Scroll => " w-in-scroll",
            Self::Inherited => "{{wParent}}",
        }
    }

    fn argument(self) -> impl fmt::Display {
        fmt::from_fn(move |out| match self {
            Self::Inherited => out.write_str("wParent"),
            _ => write!(out, "'{}'", self.class()),
        })
    }
}

fn is_void(element: Element) -> bool {
    matches!(
        element,
        Element::Input
            | Element::Checkbox
            | Element::Switch
            | Element::Slider
            | Element::Image
            | Element::TextArea
    )
}

fn push_style(out: &mut String, part: impl fmt::Display) {
    if !out.is_empty() {
        out.push(';');
    }
    let _ = write!(out, "{part}");
}

struct Markup<'a> {
    program: &'a Program,
    layout: &'a ViewLayout,
    id: ComponentId,
    comp: &'a Component,
    /// Slot content templates found so far: name and body.
    slots: Vec<(String, String)>,
    styles: &'a mut ViewStyles,
}

impl Markup<'_> {
    /// `prefix` leads from the template's data to the current block's data,
    /// e.g. `""`, `"b3."` or `"r0."`.
    fn nodes(&mut self, ids: &[NodeId], prefix: &str, parent: Parent, out: &mut String) {
        for &id in ids {
            self.node(id, prefix, parent, out);
        }
    }

    fn node(&mut self, id: NodeId, prefix: &str, parent: Parent, out: &mut String) {
        let n = id.0;
        match &self.comp.node(id).kind {
            NodeKind::Element { .. } => self.element(id, prefix, parent, out),
            NodeKind::If { branches, .. } => {
                for (i, branch) in branches.iter().enumerate() {
                    let directive = match (i, &branch.cond) {
                        (_, None) => "wx:else".to_owned(),
                        (0, Some(_)) => format!("wx:if=\"{{{{{prefix}i{n} === 0}}}}\""),
                        (i, Some(_)) => format!("wx:elif=\"{{{{{prefix}i{n} === {i}}}}}\""),
                    };
                    out.push_str(&format!("<block {directive}>"));
                    self.nodes(&branch.children, &format!("{prefix}b{n}."), parent, out);
                    out.push_str("</block>");
                }
            }
            NodeKind::For {
                loop_id, children, ..
            } => {
                let row = format!("r{}", loop_id.0);
                out.push_str(&format!(
                    "<block wx:for=\"{{{{{prefix}l{n}}}}}\" wx:for-item=\"{row}\" wx:key=\"k\">"
                ));
                self.nodes(children, &format!("{row}."), parent, out);
                out.push_str("</block>");
            }
            NodeKind::Component {
                component, slots, ..
            } => {
                let callee = &self.program.component(*component).name;
                let arg = parent.argument();
                let _ = write!(
                    out,
                    "<template is=\"{callee}\" data=\"{{{{...{prefix}c{n}, wParent: {arg}, wFocus: wFocus}}}}\"/>"
                );
                for fill in slots {
                    let mut body = String::new();
                    self.nodes(&fill.children, "", Parent::Inherited, &mut body);
                    self.slots
                        .push((slot_template(self.program, self.comp, id, fill.param), body));
                }
            }
            NodeKind::Slot { param } => {
                let y = format!("{prefix}{}", slot_key(self.comp, id, *param));
                let arg = parent.argument();
                let _ = write!(
                    out,
                    "<block wx:if=\"{{{{{y}}}}}\"><template is=\"{{{{{y}.t}}}}\" data=\"{{{{...{y}, wParent: {arg}, wFocus: wFocus}}}}\"/></block>"
                );
            }
        }
    }

    fn element(&mut self, id: NodeId, prefix: &str, parent: Parent, out: &mut String) {
        let NodeKind::Element {
            element,
            props,
            children,
        } = &self.comp.node(id).kind
        else {
            unreachable!("caller checked the node kind");
        };
        let element = *element;
        if element == Element::BarButton {
            return;
        }
        self.styles.has_textarea |= element == Element::TextArea;
        let (tag, mut class, mut fixed) = tag(element);
        let tappable = props.iter().any(|prop| prop.name == "onTap");
        // Unlike view, text and image do not implement WeChat's hover behavior.
        let wraps_text = tappable && element == Element::Text;
        let wraps_image = tappable && element == Element::Image;
        let track_image = (element == Element::Image)
            .then(|| image_layout(props))
            .flatten();
        let mut default_image_fit = element == Element::Image;
        if matches!(element, Element::Input | Element::TextArea)
            && props.iter().any(|prop| prop.name == "maxLength")
        {
            fixed = "";
        }
        let scrolling = matches!(element, Element::Scroll | Element::List | Element::Grid);
        let lazy = matches!(element, Element::List | Element::Grid);
        let mut default_scrollbar = scrolling;
        let mut default_grow = scrolling;
        let mut default_fill = scrolling;
        let mut attrs = String::new();
        if matches!(element, Element::Input | Element::TextArea) {
            let _ = write!(
                attrs,
                " id=\"w{{{{{prefix}ws}}}}-{}\" adjust-position=\"{{{{false}}}}\" cursor-spacing=\"16\" bindkeyboardheightchange=\"$keyboard\" bindfocus=\"$focus\"",
                id.0
            );
        } else if element == Element::Scroll {
            attrs.push_str(" scroll-into-view=\"{{wFocus}}\"");
        }
        let mut image_attrs = String::new();
        let mut classes = String::new();
        let mut style = String::new();
        let mut inner_style = String::new();
        let mut picker_classes = String::new();
        let mut scroll_classes = String::new();
        if let Some((size, _)) = track_image.filter(|(size, _)| *size != "fixed") {
            self.styles.has_intrinsic_image = true;
            classes.push_str(" w-image-intrinsic");
            if size == "auto" {
                classes.push_str(" w-image-natural-width");
            }
        }
        let metrics = image_key(id);
        if track_image.is_some() {
            push_style(&mut style, format_args!("{{{{{prefix}{metrics}}}}}"));
        }
        // Text values are emitted after the opening tag has been written.
        let mut text = None;
        let has_clamp =
            element == Element::Text && props.iter().any(|prop| prop.name == "maxLines");
        for (index, prop) in props.iter().enumerate() {
            if matches!(prop.value, PropValue::Handler(_)) {
                continue;
            }
            let target = target(element, prop.name);
            let value = prop_value(self.layout, self.id, id, index, prop, target);
            let key = value_key(id, index);
            let binding = fmt::from_fn(|out| write!(out, "{{{{{prefix}{key}}}}}"));
            let attrs = if wraps_image && matches!(target, Target::ImageSource | Target::ImageFit) {
                &mut image_attrs
            } else {
                &mut attrs
            };
            match (target, value) {
                (Target::Text, value) => text = Some((index, value)),
                (Target::Attr(name), Value::Inline(Constant::String(s))) => {
                    let _ = write!(attrs, " {name}=\"{s}\"");
                }
                (Target::Attr(name), Value::Inline(Constant::Int(v))) => {
                    let _ = write!(attrs, " {name}=\"{{{{{v}}}}}\"");
                }
                (Target::Attr(name), Value::Data) => {
                    let _ = write!(attrs, " {name}=\"{binding}\"");
                }
                (Target::ImageSource, value) => {
                    let src = fmt::from_fn(|out| match value {
                        Value::Inline(Constant::String(src)) => out.write_str(src),
                        Value::Data => write!(out, "{binding}"),
                        _ => unreachable!("Image.src is a string"),
                    });
                    let _ = write!(attrs, " src=\"{src}\"");
                    if let Some((size, _)) = track_image {
                        let _ = write!(
                            attrs,
                            " bindload=\"$image\" data-scope=\"{{{{{prefix}ws}}}}\" data-image=\"{metrics}\" data-src=\"{src}\" data-size=\"{size}\""
                        );
                    }
                }
                (Target::ImageFit, Value::Inline(Constant::String(fit))) => {
                    default_image_fit = false;
                    let mode = match fit.as_str() {
                        "contain" => "aspectFit",
                        "fill" => "scaleToFill",
                        _ => "aspectFill",
                    };
                    let _ = write!(attrs, " mode=\"{mode}\"");
                }
                (Target::ImageFit, Value::Data) => {
                    default_image_fit = false;
                    let _ = write!(attrs, " mode=\"{binding}\"");
                }
                (Target::InputType, Value::Inline(Constant::String(kind))) => {
                    let mapping = match kind.as_str() {
                        "password" => " password=\"{{true}}\"",
                        "number" | "phone" => " type=\"number\"",
                        "text" | "email" => " type=\"text\"",
                        _ => unreachable!("invalid InputType {kind}"),
                    };
                    attrs.push_str(mapping);
                }
                (Target::InputType, Value::Data) => {
                    let _ = write!(
                        attrs,
                        " type=\"{{{{{prefix}{key} === 'number' || {prefix}{key} === 'phone' ? 'number' : 'text'}}}}\" password=\"{{{{{prefix}{key} === 'password'}}}}\""
                    );
                }
                (Target::Flag { name, default }, value) => {
                    if default {
                        default_scrollbar = false;
                    }
                    if element == Element::Picker && name == "disabled" {
                        match value {
                            Value::Inline(Constant::Bool(true)) => {
                                picker_classes.push_str(" w-picker-disabled")
                            }
                            Value::Data => {
                                let _ = write!(
                                    picker_classes,
                                    "{{{{{prefix}{key} ? ' w-picker-disabled' : ''}}}}"
                                );
                            }
                            _ => {}
                        }
                    }
                    match value {
                        Value::Inline(Constant::Bool(value)) if *value || default => {
                            let _ = write!(attrs, " {name}=\"{{{{{value}}}}}\"");
                        }
                        Value::Inline(Constant::Bool(_)) => {}
                        Value::Data => {
                            let _ = write!(attrs, " {name}=\"{binding}\"");
                        }
                        Value::Inline(_) => unreachable!("{name} is a WXML flag"),
                    }
                }
                (Target::Style(index), value) => {
                    let css = CSS_PROPS[index];
                    if let Some(class) = style::text_clamp_class(has_clamp, prop.name) {
                        match value {
                            Value::Inline(Constant::Bool(true)) => {
                                let _ = write!(classes, " {class}");
                            }
                            Value::Data => {
                                let enabled = style::declarations(css, &Constant::Bool(true));
                                let _ = write!(
                                    classes,
                                    "{{{{{prefix}{key} === '{enabled}' ? ' {class}' : ''}}}}"
                                );
                            }
                            Value::Inline(_) => {}
                        }
                        continue;
                    }
                    if css.unit == CssUnit::Custom(CustomCss::Grow) {
                        default_grow = false;
                    }
                    if css.unit == CssUnit::Custom(CustomCss::Fill) {
                        default_fill = false;
                    }
                    if prop.name == "align"
                        && matches!(element, Element::Column | Element::Row | Element::Scroll)
                    {
                        let align_classes = if element == Element::Scroll {
                            &mut scroll_classes
                        } else {
                            &mut classes
                        };
                        match value {
                            Value::Inline(Constant::String(value)) if value == "stretch" => {
                                align_classes.push_str(" w-stretch");
                            }
                            Value::Data => {
                                let _ = write!(
                                    align_classes,
                                    "{{{{{prefix}{key} === 'align-items:stretch' ? ' w-stretch' : ''}}}}"
                                );
                            }
                            _ => {}
                        }
                    }
                    let style = if css.target == CssTarget::Inner
                        || scrolling && matches!(prop.name, "gap" | "align")
                    {
                        &mut inner_style
                    } else {
                        &mut style
                    };
                    match value {
                        Value::Inline(value) => {
                            let declarations = style::declarations(css, value);
                            if !declarations.is_empty() {
                                push_style(style, declarations);
                            }
                        }
                        Value::Data => push_style(style, binding),
                    }
                    // A dynamic declaration also supplies the value for its layout class.
                    match (css.unit, value) {
                        (CssUnit::Custom(CustomCss::Fill), Value::Inline(Constant::Bool(true))) => {
                            classes.push_str(" w-fill");
                        }
                        (CssUnit::Custom(CustomCss::Grow), Value::Inline(Constant::Int(v)))
                            if *v > 0 =>
                        {
                            classes.push_str(" w-grow");
                        }
                        (CssUnit::Custom(CustomCss::Grow), Value::Inline(Constant::Float(v)))
                            if v.is_finite() && *v > 0.0 =>
                        {
                            classes.push_str(" w-grow");
                        }
                        (CssUnit::Custom(CustomCss::Fill), Value::Data) => {
                            let filled = style::declarations(css, &Constant::Bool(true));
                            let _ = write!(
                                classes,
                                "{{{{{prefix}{key} === '{filled}' ? ' w-fill' : ''}}}}"
                            );
                        }
                        (CssUnit::Custom(CustomCss::Grow), Value::Data) => {
                            let no_grow = style::declarations(css, &Constant::Float(0.0));
                            let _ = write!(
                                classes,
                                "{{{{{prefix}{key} === '{no_grow}' ? '' : ' w-grow'}}}}"
                            );
                        }
                        _ => {}
                    }
                }
                (Target::Direction, Value::Inline(Constant::String(axis)))
                    if axis == "vertical" => {}
                (Target::Direction, Value::Inline(Constant::String(axis)))
                    if axis == "horizontal" =>
                {
                    class = "w-scroll-h";
                    fixed = " scroll-x enable-flex enhanced";
                }
                (Target::Orientation, Value::Inline(Constant::Bool(vertical))) => {
                    if *vertical {
                        class = "w-divider-v";
                    }
                }
                (Target::PickerPlaceholder, Value::Data) => {}
                _ => unreachable!("invalid WXML property {}.{}", element.name(), prop.name),
            }
        }
        if default_image_fit {
            let attrs = if wraps_image {
                &mut image_attrs
            } else {
                &mut attrs
            };
            attrs.push_str(" mode=\"aspectFill\"");
        }
        if track_image.is_some_and(|(_, placeholder)| placeholder) {
            push_style(
                &mut style,
                format_args!(
                    "{{{{{prefix}{metrics} ? '' : 'background-color:var(--w-image-placeholder)!important'}}}}"
                ),
            );
        }
        if default_scrollbar {
            attrs.push_str(" show-scrollbar=\"{{true}}\"");
        }
        if default_grow {
            classes.push_str(" w-grow");
        }
        if default_fill {
            classes.push_str(" w-fill");
        }
        if wraps_image {
            classes.push_str(" w-wx-tap-image");
        }
        let outer_tag = if wraps_text || wraps_image {
            "view"
        } else {
            tag
        };
        let _ = write!(
            out,
            "<{outer_tag} class=\"{class}{}{classes}\"{fixed}{attrs}",
            parent.class()
        );
        if tappable {
            out.push_str(concat!(
                " aria-role=\"button\" hover-class=\"w-pressed\"",
                " hover-start-time=\"{{0}}\" hover-stay-time=\"{{0}}\"",
            ));
        }
        let (template, local) = self.layout.location(self.id, id);
        for (k, (_, event)) in self.layout.template(template).events(local).enumerate() {
            let key = event_key(id, k);
            for kind in event_types(element, event.event) {
                let binding = if *kind == "tap" {
                    out.push_str(" hover-stop-propagation=\"{{true}}\"");
                    "catch"
                } else {
                    "bind"
                };
                if *kind == "focus" && matches!(element, Element::Input | Element::TextArea) {
                    let _ = write!(out, " data-e{kind}=\"{{{{{prefix}{key}}}}}\"");
                } else {
                    let _ = write!(
                        out,
                        " {binding}{kind}=\"$e\" data-e{kind}=\"{{{{{prefix}{key}}}}}\""
                    );
                }
            }
        }
        if lazy {
            let node = children
                .iter()
                .find(|child| matches!(self.comp.node(**child).kind, NodeKind::For { .. }))
                .expect("lazy list has one for");
            let point = self.layout.point(self.id, *node);
            let _ = write!(
                out,
                " id=\"wl-{{{{{prefix}ws}}}}-{point}\" data-scope=\"{{{{{prefix}ws}}}}\" data-point=\"{point}\" bindscroll=\"$scroll\" scroll-top=\"{{{{{prefix}z{}}}}}\"",
                node.0
            );
        }
        if !style.is_empty() {
            let _ = write!(out, " style=\"{style}\"");
        }
        if wraps_image {
            let _ = write!(
                out,
                "><image class=\"w-wx-tap-image-content\"{image_attrs}/></view>"
            );
            return;
        }
        if is_void(element) {
            out.push_str("/>");
            return;
        }
        out.push('>');
        if wraps_text {
            out.push_str("<text>");
        }
        match text {
            Some((_, Value::Inline(Constant::String(text)))) => out.push_str(text),
            Some((_, Value::Inline(_))) => unreachable!("text content is a string"),
            Some((index, Value::Data)) => {
                let key = value_key(id, index);
                let _ = write!(out, "{{{{{prefix}{key}}}}}");
            }
            None => {}
        }
        if scrolling {
            let axis = if class == "w-scroll-h" { 'h' } else { 'v' };
            let _ = write!(
                out,
                "<view class=\"w-scroll-content-{axis}{scroll_classes}\""
            );
            let separator = if inner_style.is_empty() { "" } else { ";" };
            let _ = write!(
                out,
                " style=\"{inner_style}{{{{wFocus ? '{separator}padding-bottom:16px' : ''}}}}\""
            );
            out.push('>');
        } else if element == Element::Progress {
            out.push_str("<view class=\"w-progress-bar\"");
            if !inner_style.is_empty() {
                let _ = write!(out, " style=\"{inner_style}\"");
            }
            out.push_str("></view>");
        } else if element == Element::Picker {
            let label = picker_label_key(id);
            let _ = write!(
                out,
                "<view class=\"w-picker w-wx{picker_classes}\">{{{{{prefix}{label}}}}}</view>"
            );
        }
        if lazy {
            for &child in children {
                if let NodeKind::For { children: rows, .. } = &self.comp.node(child).kind {
                    let name = format!("{}-l{}", self.comp.name, child.0);
                    let mut body = String::new();
                    self.nodes(rows, "", Parent::Ordinary, &mut body);
                    self.slots.push((name.clone(), body));
                    let columns = props
                        .iter()
                        .enumerate()
                        .find(|(_, prop)| prop.name == "columns")
                        .and_then(|(index, prop)| {
                            match prop_value(
                                self.layout,
                                self.id,
                                id,
                                index,
                                prop,
                                target(element, prop.name),
                            ) {
                                Value::Inline(Constant::Int(value)) => Some(*value),
                                _ => None,
                            }
                        })
                        .unwrap_or(1);
                    let grid = if element == Element::Grid {
                        format!(
                            "display:grid;grid-template-columns:repeat({columns},minmax(0,1fr));{inner_style};"
                        )
                    } else {
                        format!("display:flex;flex-direction:column;{inner_style};")
                    };
                    let point = self.layout.point(self.id, child);
                    let _ = write!(
                        out,
                        "<block wx:for=\"{{{{{prefix}l{}}}}}\" wx:for-item=\"segment\" wx:key=\"k\"><view class=\"w-lazy-segment wl-segment-{{{{{prefix}ws}}}}-{point}\" data-segment=\"{{{{segment.k}}}}\" style=\"{grid}{{{{segment.r ? '' : segment.s}}}}\"><block wx:for=\"{{{{segment.r}}}}\" wx:for-item=\"lazyrow\" wx:key=\"k\"><block wx:if=\"{{{{lazyrow.w}}}}\"><view class=\"w-lazy-row\"><template is=\"{name}\" data=\"{{{{...lazyrow}}}}\"/></view></block><view wx:else class=\"w-lazy-row\" style=\"height:44px\"></view></block></view></block>",
                        child.0
                    );
                } else {
                    self.node(child, prefix, Parent::Scroll, out);
                }
            }
        } else {
            self.nodes(children, prefix, Parent::of(element), out);
        }
        if scrolling {
            out.push_str("</view>");
        } else if wraps_text {
            out.push_str("</text>");
        }
        let _ = write!(out, "</{outer_tag}>");
    }
}
