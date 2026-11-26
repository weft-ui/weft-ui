//! The SwiftUI view `V{n}` of a template maps built-in elements to WeftKit
//! layouts and native controls, and mount points to the views of child scopes.

use std::fmt::{self, Display};

use crate::elements::Element;
use crate::view::{Constant, PointKind, PropSource, StaticProp, Template, ViewNodeKind};

use super::swift::{self, Code};

pub(super) fn has_navbar(template: &Template) -> bool {
    template.roots.iter().any(|&root| {
        matches!(
            &template.nodes[root as usize].kind,
            ViewNodeKind::Element {
                element: Element::NavBar,
                ..
            }
        )
    })
}

/// Writes the view struct `V{index}` of `template`.
pub(crate) fn view(out: &mut Code, index: usize, template: &Template) {
    out.open(format_args!("private struct V{index}: View {{"));
    out.writer.line(format_args!("let s: S{index}"));
    out.writer.blank();
    let body = Body { template };
    let navbar =
        template
            .roots
            .iter()
            .find_map(|&root| match &template.nodes[root as usize].kind {
                ViewNodeKind::Element {
                    element: Element::NavBar,
                    props,
                    children,
                } => Some((root, props, children)),
                _ => None,
            });
    if navbar.is_some_and(|(_, _, children)| !children.is_empty()) {
        out.writer
            .line("@Environment(\\.weftModalPage) private var weftModalPage");
        out.writer
            .line(format_args!("init(s: S{index}) {{ self.s = s }}"));
        out.writer.blank();
    }
    out.open("var body: some View {");
    if navbar.is_some() {
        out.open("Group {");
    }
    for &root in &template.roots {
        if !matches!(
            &template.nodes[root as usize].kind,
            ViewNodeKind::Element {
                element: Element::NavBar,
                ..
            }
        ) {
            body.node(out, root);
        }
    }
    if navbar.is_some() {
        out.close("}");
    }
    if let Some((node, props, children)) = navbar {
        let title = with_default(template.prop(node, props, "title"), "\"\"");
        let hidden = with_default(template.prop(node, props, "hidden"), "false");
        out.writer.line(format_args!(".navigationTitle({title})"));
        out.writer.line("#if os(iOS)");
        out.writer.line(".navigationBarTitleDisplayMode(.inline)");
        out.writer.line(format_args!(
            ".toolbar({hidden} ? .hidden : .visible, for: .navigationBar)"
        ));
        out.writer.line("#endif");
        if !children.is_empty() {
            out.open(".toolbar {");
            out.open("if !weftModalPage {");
            for &child in children {
                if let ViewNodeKind::Element { props, .. } = &template.nodes[child as usize].kind {
                    let label = with_default(template.prop(child, props, "label"), "\"\"");
                    let disabled = with_default(template.prop(child, props, "disabled"), "false");
                    let action = template.event(child, "onTap").map_or_else(
                        || "{}".to_owned(),
                        |slot| format!("{{ _ = s.dispatch({slot}) }}"),
                    );
                    out.open("ToolbarItem(placement: .primaryAction) {");
                    if let Some(icon) = template.prop(child, props, "icon") {
                        out.open(format_args!("Button(action: {action}) {{"));
                        out.writer.line(format_args!(
                            "WeftImage(src: {}).frame(width: 24, height: 24)",
                            Argument::Property(icon)
                        ));
                        out.close("}");
                        out.writer
                            .line(format_args!(".accessibilityLabel({label})"));
                    } else {
                        out.writer
                            .line(format_args!("Button({label}, action: {action})"));
                    }
                    out.writer.line(format_args!(".disabled({disabled})"));
                    out.close("}");
                }
            }
            out.close("}");
            out.close("}");
        }
    }
    out.close("}");
    if let Some((node, props, children)) = navbar {
        let title = with_default(template.prop(node, props, "title"), "\"\"");
        let hidden = with_default(template.prop(node, props, "hidden"), "false");
        out.writer.line("#if os(macOS)");
        out.writer
            .line(format_args!("var modalBarHidden: Bool {{ {hidden} }}"));
        out.open("var modalBar: some View {");
        out.open("HStack {");
        out.writer
            .line(format_args!("Text({title}).font(.headline)"));
        out.writer.line("Spacer()");
        for &child in children {
            if let ViewNodeKind::Element { props, .. } = &template.nodes[child as usize].kind {
                let label = with_default(template.prop(child, props, "label"), "\"\"");
                let disabled = with_default(template.prop(child, props, "disabled"), "false");
                let action = template.event(child, "onTap").map_or_else(
                    || "{}".to_owned(),
                    |slot| format!("{{ _ = s.dispatch({slot}) }}"),
                );
                if let Some(icon) = template.prop(child, props, "icon") {
                    out.open(format_args!("Button(action: {action}) {{"));
                    out.writer.line(format_args!(
                        "WeftImage(src: {}).frame(width: 24, height: 24)",
                        Argument::Property(icon)
                    ));
                    out.close("}");
                    out.writer
                        .line(format_args!(".accessibilityLabel({label})"));
                } else {
                    out.writer
                        .line(format_args!("Button({label}, action: {action})"));
                }
                out.writer.line(format_args!(".disabled({disabled})"));
            }
        }
        out.close("}");
        out.close("}");
        out.writer.line("#endif");
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
        let optional = |source| with_default(source, "nil");
        let padding = Properties::new(PADDING, |name| prop(name).map(Argument::Property));
        let container_padding = fmt::from_fn(|f| {
            if padding.is_empty() {
                Ok(())
            } else {
                write!(f, ", padding: .init({padding})")
            }
        });
        let tap = self.template.event(node, "onTap");
        let interactive_label = (tap.is_some() || element == Element::Button)
            && self.has_interactive_children(children);
        let button = if interactive_label {
            "weftButtonWithChildren"
        } else {
            "Button"
        };
        if let Some(slot) = tap {
            out.open(format_args!(
                "{button}(action: {{ _ = s.dispatch({slot}) }}) {{"
            ));
        }
        let leaf = matches!(
            element,
            Element::Text
                | Element::Button
                | Element::Input
                | Element::Checkbox
                | Element::Switch
                | Element::TextArea
                | Element::Slider
                | Element::Picker
                | Element::Spinner
                | Element::Progress
                | Element::Divider
        );
        if leaf {
            if padding.is_empty() {
                out.open("weftLeaf {");
            } else {
                out.open(format_args!("weftLeaf(padding: .init({padding})) {{"));
            }
        }
        match element {
            Element::NavBar | Element::BarButton => {
                unreachable!("navigation is not supported on native platforms")
            }
            Element::Column | Element::Row | Element::Stack | Element::Scroll => {
                let gap = with_default(prop("gap"), "0");
                let align = Argument::Union(prop("align"), "CrossAlign", ".start");
                match element {
                    Element::Column | Element::Row => {
                        let axis = if element == Element::Column {
                            "vertical"
                        } else {
                            "horizontal"
                        };
                        let justify = Argument::Union(prop("justify"), "Justify", ".start");
                        out.open(format_args!(
                            "weftLinear(axis: .{axis}, gap: {gap}, align: {align}, justify: {justify}{container_padding}) {{"
                        ));
                    }
                    Element::Stack => {
                        let alignment =
                            Argument::Union(prop("alignment"), "Alignment", ".topStart");
                        out.open(format_args!(
                            "weftStack(alignment: {alignment}{container_padding}) {{"
                        ));
                    }
                    Element::Scroll => {
                        let direction = Argument::Union(prop("direction"), "Axis", ".vertical");
                        let indicators = with_default(prop("indicators"), "true");
                        out.open(format_args!(
                            "weftScroll(direction: {direction}, gap: {gap}, align: {align}, indicators: {indicators}{container_padding}) {{"
                        ));
                    }
                    _ => unreachable!("only container elements reach this branch"),
                }
                for &child in children {
                    self.node(out, child);
                }
                out.close("}");
            }
            Element::Spacer => match prop("size") {
                Some(size) => out.writer.line(format_args!(
                    "WeftSpacer(size: {})",
                    Argument::Property(size)
                )),
                None => out.writer.line("WeftSpacer()"),
            },
            Element::Span => unreachable!("`Span` is rendered inline by its parent `Text`"),
            Element::Text => self.text(out, node, props, children),
            Element::Button => {
                match self.template.event(node, "onClick") {
                    Some(slot) => {
                        out.open(format_args!("{button} {{"));
                        out.writer.line(format_args!("_ = s.dispatch({slot})"));
                        out.reopen("} label: {");
                    }
                    None => out.open(format_args!("{button} {{}} label: {{")),
                }
                out.open("weftButtonLabel {");
                for &child in children {
                    self.node(out, child);
                }
                out.close("}");
                out.close("}");
            }
            Element::Input | Element::TextArea => {
                let (control, value, placeholder) = if element == Element::Input {
                    ("WeftInput", "text", "nil")
                } else {
                    ("WeftTextArea", "value", "\"\"")
                };
                let options = Properties::new(
                    [
                        "type",
                        "returnKey",
                        "maxLength",
                        "focused",
                        "onSubmit",
                        "onFocusChange",
                    ],
                    |name| match name {
                        "onSubmit" => self.template.event(node, name).map(Argument::Action),
                        "onFocusChange" => self.template.event(node, name).map(Argument::BoolEvent),
                        _ => prop(name).map(|source| match name {
                            "type" => Argument::Union(Some(source), "InputType", ".text"),
                            "returnKey" => Argument::Union(Some(source), "ReturnKey", "nil"),
                            _ => Argument::Property(source),
                        }),
                    },
                );
                let options = fmt::from_fn(|f| {
                    if options.is_empty() {
                        Ok(())
                    } else {
                        write!(f, ", {options}")
                    }
                });
                let (event, slot) = self.template.controlled(node);
                let placeholder = with_default(prop("placeholder"), placeholder);
                out.writer.line(format_args!(
                    "{control}({value}: s.v{slot}, placeholder: {placeholder}{options}) {{ s.dispatch({event}, .string($0)) ? nil : s.v{slot} }}"
                ));
            }
            Element::Checkbox => {
                let (event, slot) = self.template.controlled(node);
                out.writer.line(format_args!(
                    "WeftCheckbox(checked: s.v{slot}) {{ s.dispatch({event}, .bool($0)) ? nil : s.v{slot} }}"
                ));
            }
            Element::Switch => {
                let (event, slot) = self.template.controlled(node);
                out.writer.line(format_args!(
                    "weftSwitch(checked: s.v{slot}) {{ s.dispatch({event}, .bool($0)) ? nil : s.v{slot} }}"
                ));
            }
            Element::Slider => {
                let (event, slot) = self.template.controlled(node);
                let min = with_default(prop("min"), "0");
                let max = with_default(prop("max"), "100");
                let step = with_default(prop("step"), "1");
                out.writer.line(format_args!(
                    "weftSlider(value: s.v{slot}, min: {min}, max: {max}, step: {step}) {{ s.dispatch({event}, .number($0)) ? nil : Double(s.v{slot}) }}"
                ));
            }
            Element::Picker => {
                let (event, slot) = self.template.controlled(node);
                let options = Argument::Property(prop("options").expect("`Picker` has options"));
                let placeholder = with_default(prop("placeholder"), "\"\"");
                out.writer.line(format_args!(
                    "weftPicker(selected: s.v{slot}, options: {options}, placeholder: {placeholder}) {{ s.dispatch({event}, .number($0)) ? nil : Double(s.v{slot}) }}"
                ));
            }
            Element::Spinner => {
                let color = optional(prop("color"));
                out.writer.line(format_args!("weftSpinner(color: {color})"));
            }
            Element::Progress => {
                let value = Argument::Property(prop("value").expect("`Progress` has a value"));
                let color = optional(prop("color"));
                out.writer
                    .line(format_args!("weftProgress(value: {value}, color: {color})"));
            }
            Element::Divider => {
                let vertical = with_default(prop("vertical"), "false");
                let color = optional(prop("color"));
                out.writer.line(format_args!(
                    "weftDivider(vertical: {vertical}, color: {color})"
                ));
            }
            Element::Image => {
                let src = Argument::Property(prop("src").expect("`Image` has a source"));
                let options = Properties::new(["fit", "placeholder"], |name| {
                    let source = prop(name)?;
                    Some(match name {
                        "fit" => Argument::Union(Some(source), "ImageFit", ".cover"),
                        _ => Argument::Property(source),
                    })
                });
                let arguments = optional_arguments(&options);
                out.writer
                    .line(format_args!("WeftImage(src: {src}{arguments})"));
            }
        }
        if leaf {
            out.close("}");
        }
        let decoration = Properties::new(DECORATION, |name| {
            // Replaced image content follows its border radius regardless of the child-clipping option.
            if name == "clip" && element == Element::Image {
                return prop("radius").map(|_| Argument::Default("true"));
            }
            let source = prop(name)?;
            Some(match name {
                "shadow" => Argument::Union(Some(source), "Shadow", ".none"),
                _ => Argument::Property(source),
            })
        });
        if !decoration.is_empty() {
            out.writer
                .line(format_args!(".weftDecoration({decoration})"));
        }
        if tap.is_some() {
            out.close("}");
            out.writer.line(".buttonStyle(WeftPressStyle())");
        }
        if let Some(opacity) = prop("opacity") {
            let opacity = Argument::Property(opacity);
            out.writer
                .line(format_args!(".weftOpacity(opacity: {opacity})"));
        }
        if let Some(hidden) = prop("hidden") {
            let hidden = Argument::Property(hidden);
            out.writer
                .line(format_args!(".weftVisibility(hidden: {hidden})"));
        }
        if let Some(disabled) = prop("disabled")
            && !matches!(disabled, PropSource::Constant(Constant::Bool(false)))
        {
            let disabled = Argument::Property(disabled);
            out.writer.line(format_args!(".disabled({disabled})"));
        }
        let frame = Properties::new(FRAME, |name| prop(name).map(Argument::Property));
        if !frame.is_empty() {
            out.writer.line(format_args!(".weftFrame({frame})"));
        }
        let child = Properties::new(CHILD, |name| {
            prop(name)
                .map(Argument::Property)
                .or(match (element, name) {
                    (Element::Scroll, "grow") => Some(Argument::Default("1")),
                    (Element::Scroll, "fill") => Some(Argument::Default("true")),
                    _ => None,
                })
        });
        if !child.is_empty() {
            out.writer.line(format_args!(".weftChild({child})"));
        }
    }

    fn has_interactive_children(&self, children: &[u32]) -> bool {
        children.iter().copied().any(|child| {
            match &self.template.nodes[child as usize].kind {
                ViewNodeKind::Element {
                    element, children, ..
                } => {
                    matches!(
                        element,
                        Element::Button
                            | Element::Input
                            | Element::TextArea
                            | Element::Switch
                            | Element::Checkbox
                            | Element::Slider
                            | Element::Picker
                            | Element::Scroll
                    ) || self.template.event(child, "onTap").is_some()
                        || self.has_interactive_children(children)
                }
                // A component, branch, loop, or slot can supply controls at runtime.
                ViewNodeKind::Point(_) => true,
            }
        })
    }

    fn text(&self, out: &mut Code, node: u32, props: &[StaticProp], children: &[u32]) {
        let prop = |name: &str| self.template.prop(node, props, name);
        let options = Properties::new(
            [
                "color",
                "size",
                "font",
                "weight",
                "italic",
                "decoration",
                "align",
                "maxLines",
                "lineHeight",
            ],
            |name| prop(name).map(|value| text_argument(name, value)),
        );
        let arguments = optional_arguments(&options);
        if children.is_empty() {
            let value = Argument::Property(prop("value").expect("plain `Text` has a value"));
            out.writer.line(format_args!(
                "weftText(spans: [.init(value: {value})]{arguments})"
            ));
            return;
        }
        out.open("weftText(spans: [");
        for &child in children {
            let ViewNodeKind::Element {
                element: Element::Span,
                props,
                ..
            } = &self.template.nodes[child as usize].kind
            else {
                unreachable!("only `Span` can be a direct child of `Text`");
            };
            let span = Properties::new(
                [
                    "value",
                    "color",
                    "size",
                    "font",
                    "weight",
                    "italic",
                    "decoration",
                ],
                |name| {
                    self.template
                        .prop(child, props, name)
                        .map(|value| text_argument(name, value))
                },
            );
            out.writer.line(format_args!(".init({span}),"));
        }
        out.close(format_args!("]{arguments})"));
    }

    fn point(&self, out: &mut Code, point: u32) {
        let property = format!("s.p{point}");
        match &self.template.points[point as usize].kind {
            PointKind::Branch { templates } => {
                out.writer.line(format_args!("switch {property} {{"));
                for template in templates {
                    let t = template.0;
                    out.writer
                        .line(format_args!("case let c as S{t}: V{t}(s: c).id(c.id)"));
                }
                out.writer.line("default: EmptyView()");
                out.writer.line("}");
            }
            PointKind::List { template } => {
                out.writer.line(format_args!(
                    "ForEach({property}) {{ c in V{}(s: c) }}",
                    template.0
                ));
            }
            PointKind::Instance { template } => {
                out.writer.line(format_args!(
                    "if let c = {property} {{ V{}(s: c) }}",
                    template.0
                ));
            }
            PointKind::Slot => {
                out.writer
                    .line(format_args!("if let c = {property} {{ c.view.id(c.id) }}"));
            }
        }
    }
}

const PADDING: [&str; 7] = [
    "padding",
    "paddingX",
    "paddingY",
    "paddingTop",
    "paddingBottom",
    "paddingStart",
    "paddingEnd",
];
const DECORATION: [&str; 6] = [
    "background",
    "radius",
    "border",
    "borderColor",
    "shadow",
    "clip",
];
const FRAME: [&str; 7] = [
    "width",
    "height",
    "minWidth",
    "maxWidth",
    "minHeight",
    "maxHeight",
    "aspectRatio",
];
const CHILD: [&str; 9] = [
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

struct Properties<'t, const N: usize>([(&'static str, Option<Argument<'t>>); N]);

impl<'t, const N: usize> Properties<'t, N> {
    fn new(names: [&'static str; N], prop: impl Fn(&str) -> Option<Argument<'t>>) -> Self {
        Self(names.map(|name| (name, prop(name))))
    }

    fn is_empty(&self) -> bool {
        self.0.iter().all(|(_, value)| value.is_none())
    }
}

impl<const N: usize> Display for Properties<'_, N> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut separator = "";
        for (name, argument) in &self.0 {
            if let Some(argument) = argument {
                write!(f, "{separator}{name}: {argument}")?;
                separator = ", ";
            }
        }
        Ok(())
    }
}

fn optional_arguments<'a, const N: usize>(options: &'a Properties<'_, N>) -> impl Display + 'a {
    fmt::from_fn(move |f| {
        if options.is_empty() {
            Ok(())
        } else {
            write!(f, ", {options}")
        }
    })
}

fn with_default<'t>(source: Option<PropSource<'t>>, default: &'static str) -> Argument<'t> {
    source.map_or(Argument::Default(default), Argument::Property)
}

fn text_argument<'t>(name: &str, source: PropSource<'t>) -> Argument<'t> {
    match name {
        "weight" => Argument::Union(Some(source), "Weight", ".regular"),
        "decoration" => Argument::Union(Some(source), "Decoration", ".none"),
        "align" => Argument::Union(Some(source), "TextAlign", ".start"),
        _ => Argument::Property(source),
    }
}

enum Argument<'t> {
    Property(PropSource<'t>),
    Union(Option<PropSource<'t>>, &'static str, &'static str),
    Action(usize),
    BoolEvent(usize),
    Default(&'static str),
}

impl Display for Argument<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Default(value) | Self::Union(None, _, value) => f.write_str(value),
            Self::Union(Some(PropSource::Slot(slot)), name, _) => {
                write!(f, "Weft{name}(weft: s.v{slot})")
            }
            Self::Union(Some(PropSource::Constant(Constant::String(case))), name, _) => {
                // `.none` by itself would mean nil for the optional text decoration.
                if *name == "Decoration" && case == "none" {
                    f.write_str("WeftDecoration")?;
                }
                write!(f, ".{case}")
            }
            Self::Union(Some(PropSource::Constant(_)), name, _) => {
                unreachable!("{name} is a string union")
            }
            Self::Action(slot) => write!(f, "{{ _ = s.dispatch({slot}) }}"),
            Self::BoolEvent(slot) => write!(f, "{{ _ = s.dispatch({slot}, .bool($0)) }}"),
            Self::Property(PropSource::Slot(slot)) => write!(f, "s.v{slot}"),
            Self::Property(PropSource::Constant(value)) => match value {
                Constant::Int(v) => v.fmt(f),
                Constant::Float(v) => write!(f, "{v:?}"),
                Constant::Bool(v) => v.fmt(f),
                Constant::String(s) => swift::string(f, s),
                Constant::Token(name) => {
                    f.write_str("WeftColor.token(")?;
                    swift::string(f, name)?;
                    f.write_str(")")
                }
                Constant::Color(c) => write!(f, "WeftColor.rgba({})", swift::rgba(*c)),
            },
        }
    }
}
