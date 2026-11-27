//! DOM create functions: one per component.
//!
//! Every block (component body, `if` branch, `for` row, slot content) gets an
//! update function that re-runs only the bindings whose dirty bits are set
//! and walks into nested blocks only when bits they depend on are set.

use std::fmt::{self, Display};

use crate::bridge::DomView;
use crate::bridge::blocks::{
    Consts, Ctx, Parts, binding_cond, element_handler_body, instance_watches, words,
};
use crate::bridge::expr::{Env, expr};
use crate::bridge::flow::{Backend, ComponentIr, Flow};
use crate::bridge::js::{self, Code};
use crate::elements::{CSS_PROPS, Css, CssTarget, CssUnit, CustomCss, Element, PropType};
use crate::ir::{Component, ComponentId, NodeId, NodeKind, Program, Prop, PropValue};
use crate::style::{self, Edge};
use crate::view::{Constant, Literal, constant, literal};

/// The DOM [`DomView`].
#[derive(Debug, Clone, Copy)]
pub(crate) struct Dom;

impl DomView for Dom {
    fn component(&self, program: &Program, id: ComponentId, consts: &mut Consts, out: &mut Code) {
        component(program, id, consts, out);
    }
}

/// Emits `export function {Name}$c(app, args, children, depth)`.
fn component(program: &Program, id: ComponentId, consts: &mut Consts, out: &mut Code) {
    let comp = program.component(id);
    out.open(format!(
        "export function {}$c(app, args, children, depth) {{",
        comp.name
    ));
    out.line(format!(
        "const c = new $.Instance(app, {}, depth, args, children);",
        words(comp.slots.len())
    ));
    instance_watches(program, comp, consts, out);
    Flow::new(program, comp, consts, Gen).block(&comp.roots, &Ctx::default(), "c", out);
    out.line("return c;");
    out.close("}");
}

/// How a property value reaches the DOM.
#[derive(Debug, Clone, Copy)]
enum Target {
    Text,
    Value,
    InputType,
    Focused,
    Checked,
    RangeValue,
    RangeAttr(&'static str),
    PickerValue,
    PickerOptions,
    PickerPlaceholder,
    Orientation,
    Disabled,
    ImageSource,
    BarIcon,
    Attr(&'static str),
    Class(&'static str),
    Direction,
    Style(usize, PropType),
}

fn target(element: Element, prop: &str, has_clamp: bool, has_placeholder: bool) -> Target {
    if let Some(class) = style::text_clamp_class(has_clamp, prop) {
        return Target::Class(class);
    }
    match (element, prop) {
        (Element::Text | Element::Span, "value") | (Element::BarButton, "label") => Target::Text,
        (Element::NavBar, "title") => Target::Attr("data-title"),
        (Element::NavBar, "hidden") => Target::Class("w-navbar-hidden"),
        (Element::BarButton, "icon") => Target::BarIcon,
        (Element::Input | Element::TextArea, "value") => Target::Value,
        (Element::Input, "type") => Target::InputType,
        (Element::Input, "returnKey") => Target::Attr("enterkeyhint"),
        (Element::Input | Element::TextArea, "maxLength") => Target::Attr("maxlength"),
        (Element::Input | Element::TextArea, "focused") => Target::Focused,
        (Element::Checkbox | Element::Switch, "checked") => Target::Checked,
        (Element::Slider, "value") => Target::RangeValue,
        (Element::Slider, "min") => Target::RangeAttr("min"),
        (Element::Slider, "max") => Target::RangeAttr("max"),
        (Element::Slider, "step") => Target::RangeAttr("step"),
        (Element::Picker, "selected") => Target::PickerValue,
        (Element::Picker, "options") => Target::PickerOptions,
        (Element::Picker, "placeholder") => Target::PickerPlaceholder,
        (Element::Divider, "vertical") => Target::Orientation,
        (_, "disabled") => Target::Disabled,
        (Element::Input | Element::TextArea, "placeholder") => Target::Attr("placeholder"),
        (Element::Image, "src") if has_placeholder => Target::ImageSource,
        (Element::Image, "src") => Target::Attr("src"),
        (Element::Scroll, "direction") => Target::Direction,
        (element, prop) => {
            let spec = element
                .spec()
                .prop(prop)
                .expect("the property was validated during semantic analysis");
            Target::Style(
                spec.css.expect("the property has a DOM CSS mapping"),
                spec.prop_type(),
            )
        }
    }
}

/// Tag, fixed attributes and base class of an element.
fn tag(element: Element, props: &[Prop]) -> (&'static str, &'static str, &'static str) {
    match element {
        Element::NavBar => ("header", "", "w-navbar"),
        Element::BarButton => ("button", " type=\"button\"", "w-bar-button"),
        Element::Column => ("div", "", "w-column"),
        Element::Row => ("div", "", "w-row"),
        Element::Stack => ("div", "", "w-stack"),
        Element::List => ("div", "", "w-list w-scroll-v"),
        Element::Grid => ("div", "", "w-grid w-scroll-v"),
        Element::Scroll => {
            let horizontal = props.iter().any(|prop| {
                let PropValue::Expr(value) = &prop.value else {
                    return false;
                };
                prop.name == "direction"
                    && matches!(literal(value), Some(Literal::Str("horizontal")))
            });
            (
                "div",
                "",
                if horizontal {
                    "w-scroll-h"
                } else {
                    "w-scroll-v"
                },
            )
        }
        Element::Spacer => ("div", "", "w-spacer"),
        Element::Text => ("span", "", "w-text"),
        Element::Span => ("span", "", "w-span"),
        Element::Button => ("button", " type=\"button\"", "w-button"),
        Element::Input => ("input", "", "w-input"),
        Element::Checkbox => ("input", " type=\"checkbox\"", "w-checkbox"),
        Element::Image => ("img", "", "w-image"),
        Element::Switch => ("input", " type=\"checkbox\" role=\"switch\"", "w-switch"),
        Element::TextArea => ("textarea", " rows=\"3\"", "w-textarea"),
        Element::Slider => ("input", " type=\"range\"", "w-slider"),
        Element::Picker => ("select", "", "w-picker"),
        Element::Spinner => ("div", "", "w-spinner"),
        Element::Progress => ("div", "", "w-progress"),
        Element::Divider => {
            let vertical = props.iter().any(|prop| {
                prop.name == "vertical"
                    && matches!(&prop.value, PropValue::Expr(value)
                    if matches!(literal(value), Some(Literal::Bool(true))))
            });
            (
                "div",
                "",
                if vertical { "w-divider-v" } else { "w-divider" },
            )
        }
    }
}

fn child_context(element: Element) -> &'static str {
    match element {
        Element::Stack => " w-in-stack",
        Element::Scroll | Element::List | Element::Grid => " w-in-scroll",
        _ => "",
    }
}

/// Competing edge shorthands and synthetic flex minimums must not overwrite
/// a more specific prop, even when they are updated at different times.
struct StyleSources<'props> {
    props: &'props [Prop],
    margin: Option<[&'static str; 4]>,
    padding: Option<[&'static str; 4]>,
}

impl<'props> StyleSources<'props> {
    fn new(props: &'props [Prop]) -> Self {
        Self {
            props,
            margin: None,
            padding: None,
        }
    }

    /// A bit per declaration in conversion order; `None` writes them all.
    fn mask(&mut self, name: &str, css: Css<'_>) -> Option<u8> {
        if css.unit == CssUnit::Custom(CustomCss::Grow) {
            let mut mask = 0b111;
            for prop in self.props {
                match prop.name {
                    "minWidth" => mask &= !0b010,
                    "minHeight" => mask &= !0b100,
                    _ => {}
                }
            }
            return (mask != 0b111).then_some(mask);
        }
        let (family, sources) = if name.starts_with("margin") {
            (Edge::Margin, &mut self.margin)
        } else if name.starts_with("padding") {
            (Edge::Padding, &mut self.padding)
        } else {
            return None;
        };
        let props = self.props;
        let sources = sources.get_or_insert_with(|| {
            style::edges(|name| props.iter().any(|prop| prop.name == name), family)
        });
        let mut mask = 0;
        for (i, property) in css.properties.iter().enumerate() {
            if family
                .properties()
                .iter()
                .zip(sources.iter())
                .any(|(edge, source)| edge == property && *source == name)
            {
                mask |= 1 << i;
            }
        }
        (mask != (1 << css.properties.len()) - 1).then_some(mask)
    }
}

fn is_void(element: Element) -> bool {
    matches!(
        element,
        Element::Input | Element::Checkbox | Element::Switch | Element::Slider | Element::Image
    )
}

/// Whether a property is written into the template instead of by code.
/// Controlled values are always set by code so the runtime knows them.
fn template_literal(prop: &Prop, target: Target) -> Option<Literal<'_>> {
    let PropValue::Expr(value) = &prop.value else {
        return None;
    };
    if prop.binding.is_some()
        || matches!(
            target,
            Target::Value
                | Target::InputType
                | Target::Focused
                | Target::Checked
                | Target::RangeValue
                | Target::PickerValue
                | Target::PickerOptions
                | Target::PickerPlaceholder
                | Target::ImageSource
                | Target::BarIcon
        )
    {
        return None;
    }
    let value = literal(value)?;
    if matches!((target, &value), (Target::Attr("src"), Literal::Str(src)) if src.starts_with("asset:"))
    {
        return None;
    }
    Some(value)
}

fn apply(target: Target, mask: Option<u8>, node: &str, value: &str) -> String {
    match target {
        Target::Text => format!("{node}.textContent = {value};"),
        Target::Value => format!("$.value({node}, {value});"),
        Target::InputType => format!("$.inputType({node}, {value});"),
        Target::Focused => format!("$.focused({node}, {value});"),
        Target::Checked => format!("$.checked({node}, {value});"),
        Target::RangeValue => format!("$.rangeValue({node}, {value});"),
        Target::RangeAttr(name) => format!("$.rangeAttr({node}, {}, {value});", js::string(name)),
        Target::PickerValue => format!("$.selected({node}, {value});"),
        Target::PickerOptions => format!("$.options({node}, {value});"),
        Target::PickerPlaceholder => format!("$.placeholder({node}, {value});"),
        Target::Disabled => format!("{node}.disabled = {value};"),
        Target::ImageSource | Target::Attr("src") => format!("$.image({node}, {value});"),
        Target::BarIcon => format!("$.barIcon({node}, {value});"),
        Target::Attr(name) => format!("{node}.setAttribute({}, {value});", js::string(name)),
        Target::Class(name) => format!("{node}.classList.toggle({}, {value});", js::string(name)),
        Target::Direction | Target::Orientation => {
            unreachable!("orientation was resolved statically")
        }
        Target::Style(index, _) => match mask {
            Some(mask) => format!("$.style({node}, {index}, {value}, {mask});"),
            None => format!("$.style({node}, {index}, {value});"),
        },
    }
}

fn append_style(out: &mut String, decl: &str) {
    if decl.is_empty() {
        return;
    }
    if !out.is_empty() {
        out.push(';');
    }
    out.push_str(decl);
}

fn control(element: Element) -> Option<&'static str> {
    match element {
        Element::Input | Element::TextArea => Some("input"),
        Element::Checkbox | Element::Switch => Some("checkbox"),
        Element::Slider => Some("slider"),
        Element::Picker => Some("picker"),
        _ => None,
    }
}

struct Gen;

impl Gen {
    fn html(comp: &Component, id: NodeId, context: &str, out: &mut String) {
        let NodeKind::Element {
            element,
            props,
            children,
        } = &comp.node(id).kind
        else {
            out.push_str("<!---->");
            return;
        };
        let element = *element;
        let (tag, fixed, class) = tag(element, props);
        let has_clamp =
            element == Element::Text && props.iter().any(|prop| prop.name == "maxLines");
        let has_placeholder =
            element == Element::Image && props.iter().any(|prop| prop.name == "placeholder");
        let mut sources = StyleSources::new(props);
        let mut classes = String::new();
        let mut style = String::new();
        let mut inner_style = String::new();
        let mut text = None;
        let mut fill = matches!(element, Element::Scroll | Element::List | Element::Grid);
        let mut grow = fill;
        out.push('<');
        out.push_str(tag);
        out.push_str(fixed);
        if has_placeholder {
            out.push_str(" alt=\"\"");
            classes.push_str(" w-image-placeholder");
        }
        let tappable = props.iter().any(|prop| prop.name == "onTap");
        if tappable {
            out.push_str(" role=\"button\" tabindex=\"0\"");
        }
        for prop in props {
            if matches!(element, Element::List | Element::Grid)
                && matches!(
                    prop.name,
                    "columns"
                        | "refreshing"
                        | "endThreshold"
                        | "stickyHeaders"
                        | "onRefresh"
                        | "onEndReached"
                )
            {
                continue;
            }
            let PropValue::Expr(expr) = &prop.value else {
                continue;
            };
            let target = target(element, prop.name, has_clamp, has_placeholder);
            let Some(value) = template_literal(prop, target) else {
                continue;
            };
            match (target, value) {
                (Target::Text, Literal::Str(s)) => text = Some(s),
                (Target::Disabled, Literal::Bool(true)) => out.push_str(" disabled"),
                (Target::Disabled | Target::Direction | Target::Orientation, _) => {}
                (Target::RangeAttr(name) | Target::Attr(name), Literal::Int(v)) => {
                    use fmt::Write as _;
                    let _ = write!(out, " {name}=\"{v}\"");
                }
                (Target::Class(name), Literal::Bool(true)) => {
                    classes.push(' ');
                    classes.push_str(name);
                }
                (Target::Class(_), Literal::Bool(false)) => {}
                (Target::Attr(name), Literal::Str(s)) => {
                    out.push(' ');
                    out.push_str(name);
                    out.push_str("=\"");
                    html_attr(s, out);
                    out.push('"');
                }
                (Target::Style(index, ty), _) => {
                    let css = CSS_PROPS[index];
                    let mask = sources.mask(prop.name, css);
                    if mask == Some(0) {
                        continue;
                    }
                    let value = constant(expr, ty).expect("the property has a static value");
                    match css.unit {
                        CssUnit::Custom(CustomCss::Fill) => {
                            fill = matches!(value, Constant::Bool(true));
                        }
                        CssUnit::Custom(CustomCss::Grow) => {
                            grow = match value {
                                Constant::Float(v) => v.is_finite() && v > 0.0,
                                Constant::Int(v) => v > 0,
                                _ => false,
                            };
                        }
                        _ => {}
                    }
                    let declarations = style::declarations(css, &value);
                    let style = if css.target == CssTarget::Inner {
                        &mut inner_style
                    } else {
                        &mut style
                    };
                    if let Some(mask) = mask {
                        for (i, decl) in declarations.split(';').enumerate() {
                            if mask & (1 << i) != 0 {
                                append_style(style, decl);
                            }
                        }
                    } else {
                        append_style(style, &declarations);
                    }
                }
                (target, _) => unreachable!("literal of the wrong type for {target:?}"),
            }
        }
        out.push_str(" class=\"");
        out.push_str(class);
        out.push_str(context);
        out.push_str(&classes);
        if tappable {
            out.push_str(" w-tap");
        }
        if fill {
            out.push_str(" w-fill");
        }
        if grow {
            out.push_str(" w-grow");
        }
        out.push('"');
        if !style.is_empty() {
            out.push_str(" style=\"");
            html_attr(&style, out);
            out.push('"');
        }
        out.push('>');
        if is_void(element) {
            return;
        }
        match element {
            Element::Progress => {
                out.push_str("<div class=\"w-progress-bar\"");
                if !inner_style.is_empty() {
                    out.push_str(" style=\"");
                    html_attr(&inner_style, out);
                    out.push('"');
                }
                out.push_str("></div>");
            }
            Element::Picker => out.push_str("<option value=\"-1\" disabled hidden></option>"),
            _ => {}
        }
        if let Some(text) = text {
            html_text(text, out);
        }
        let context = child_context(element);
        for &child in children {
            Self::html(comp, child, context, out);
        }
        out.push_str("</");
        out.push_str(tag);
        out.push('>');
    }

    /// Declares `n{id}` for every template node of `nodes` and their element
    /// children.
    fn refs(
        comp: &Component,
        nodes: &[NodeId],
        parent: &str,
        mut prev: Option<String>,
        out: &mut Code,
    ) {
        for &id in nodes {
            let name = format!("n{}", id.0);
            match &prev {
                Some(prev) => out.line(format!("const {name} = {prev}.nextSibling;")),
                None => out.line(format!("const {name} = {parent}.firstChild;")),
            }
            if let NodeKind::Element { children, .. } = &comp.node(id).kind
                && !children.is_empty()
            {
                Self::refs(comp, children, &name, None, out);
            }
            prev = Some(name);
        }
    }
}

impl Backend for Gen {
    fn start_block(&self, comp: &Component, roots: &[NodeId], consts: &mut Consts, out: &mut Code) {
        // The first node must be stable: dynamic content is inserted before
        // anchors, so a leading anchor gets a marker comment in front.
        let marker = roots
            .first()
            .is_none_or(|&r| !matches!(comp.node(r).kind, NodeKind::Element { .. }));
        let mut html = String::new();
        if marker {
            html.push_str("<!---->");
        }
        for &root in roots {
            Self::html(comp, root, "", &mut html);
        }
        let template = consts.template(format!("$.template({})", js::string(&html)));
        out.line(format!("const f = {template}();"));
        Self::refs(
            comp,
            roots,
            "f",
            marker.then(|| "f.firstChild".to_owned()),
            out,
        );
    }

    fn init_block(&self, var: &str, out: &mut Code) {
        out.line(format!("{var}.init(f);"));
    }

    fn element<'parent>(
        &self,
        ir: &ComponentIr<'_>,
        id: NodeId,
        parent: &'parent str,
        element: Element,
        props: &[Prop],
        parts: &mut Parts,
    ) -> &'parent str {
        let n = format!("n{}", id.0);
        let has_clamp =
            element == Element::Text && props.iter().any(|prop| prop.name == "maxLines");
        let mut sources = StyleSources::new(props);
        let has_placeholder =
            element == Element::Image && props.iter().any(|prop| prop.name == "placeholder");
        if has_placeholder {
            parts.create.line(format!("$.imagePlaceholder({n});"));
        }
        let mut listens_for_edits = false;
        for prop in props {
            if matches!(element, Element::List | Element::Grid)
                && matches!(
                    prop.name,
                    "columns"
                        | "refreshing"
                        | "endThreshold"
                        | "stickyHeaders"
                        | "onRefresh"
                        | "onEndReached"
                )
            {
                continue;
            }
            match &prop.value {
                PropValue::Expr(value) => {
                    let target = target(element, prop.name, has_clamp, has_placeholder);
                    if template_literal(prop, target).is_some() {
                        continue;
                    }
                    let mask = match target {
                        Target::Style(index, _) => sources.mask(prop.name, CSS_PROPS[index]),
                        _ => None,
                    };
                    if mask == Some(0) {
                        continue;
                    }
                    let value = expr(value, Env::default());
                    let statement = apply(target, mask, &n, &value);
                    if let Some(cond) = binding_cond(ir.comp, prop.binding) {
                        parts.update.line(format!("if ({cond}) {statement}"));
                    }
                    parts.create.line(statement);
                }
                PropValue::Handler(_) if matches!(prop.name, "onMount" | "onUnmount") => {}
                PropValue::Handler(handler) => {
                    let body = element_handler_body(ir.program, ir.comp, id, prop, handler, parts);
                    parts.create.line(match (element, prop.name) {
                        (_, "onChange") => {
                            listens_for_edits = true;
                            let helper =
                                control(element).expect("onChange belongs to a controlled element");
                            format!("$.{helper}({n}, ($a) => {{ {body} }});")
                        }
                        (Element::Button, "onClick") => {
                            format!("{n}.addEventListener(\"click\", ($event) => {{ $event.stopPropagation(); {body} }});")
                        }
                        (_, "onTap") => format!("$.onTap({n}, () => {{ {body} }});"),
                        (Element::Input, "onSubmit") => {
                            format!("$.onSubmit({n}, () => {{ {body} }});")
                        }
                        (Element::Input | Element::TextArea, "onFocusChange") => {
                            format!("$.onFocusChange({n}, ($a) => {{ {body} }});")
                        }
                        (element, name) => {
                            unreachable!("`{}` has no handler `{name}`", element.name())
                        }
                    });
                }
            }
        }
        // Controlled inputs revert user edits the host did not accept.
        if !listens_for_edits && let Some(helper) = control(element) {
            parts.create.line(format!("$.{helper}({n}, null);"));
        }
        // The element DOM is in the template; dynamic children use their own anchors.
        parent
    }

    fn anchor<'parent>(&self, id: NodeId, _parent: &'parent str) -> impl Display + 'parent {
        fmt::from_fn(move |f| write!(f, "n{}", id.0))
    }

    fn block_decl(&self, _id: NodeId, _index: usize, out: &mut Code) {
        out.line("const b = new $.Block();");
    }

    fn row_args(&self, _id: NodeId) -> impl Display {
        ""
    }

    fn lazy_columns(&self) -> bool {
        true
    }

    fn mount<'args>(
        &self,
        id: NodeId,
        _parent: &'args str,
        child: &'args str,
    ) -> impl Display + 'args {
        fmt::from_fn(move |f| write!(f, "{child}.mount(n{0}.parentNode, n{0});", id.0))
    }

    fn slot_destroy(&self) -> &'static str {
        "destroy(false)"
    }
}

/// Escapes text content for an HTML template.
fn html_text(value: &str, out: &mut String) {
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            c => out.push(c),
        }
    }
}

/// Escapes a double-quoted HTML attribute value.
fn html_attr(value: &str, out: &mut String) {
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            '<' => out.push_str("&lt;"),
            c => out.push(c),
        }
    }
}
