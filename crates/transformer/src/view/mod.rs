//! View protocol layout: the contract between the JS logic layer and every
//! non-Web view layer.
//!
//! [`ViewLayout`] splits each component into block templates (component body,
//! `if` branch, `for` row, slot content), numbered across the whole app. A
//! template holds the static element tree with constants inlined, plus the
//! dynamic parts the logic layer drives at run time:
//!
//! - value slots: dynamic properties and text, written by `set` ops; color
//!   properties have semantic type `Color` and travel as strings;
//! - event slots: user events reported back with `dispatch`;
//! - mount points: where child scopes are inserted by `branch`, `rows` and
//!   `attach` ops.
//!
//! Template `i` for `i < components.len()` is the body of component `i`;
//! nested templates follow in discovery order. The encoding of ops is
//! specified in `protocol/SPEC.md`.

mod build;
mod json;

pub(crate) use build::{Literal, constant, literal};

use crate::color::Color;
use crate::elements::Element;
use crate::ir::{ComponentId, NodeId, ParamId};

/// Index into [`ViewLayout::templates`]; the same number the logic layer
/// sends in `create` ops.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TemplateId(pub u32);

impl TemplateId {
    #[must_use]
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

/// Block templates of a whole app.
#[derive(Debug, Clone, PartialEq)]
pub struct ViewLayout {
    app: Option<crate::ir::Application>,
    safe_area: bool,
    theme: Option<Vec<(String, Color, Color)>>,
    templates: Vec<Template>,
    /// Lookup from IR nodes to their place in the layout, by component.
    components: Vec<Vec<NodeMap>>,
    hash: u64,
}

/// One block template.
#[derive(Debug, Clone, PartialEq)]
pub struct Template {
    /// Human-readable name for dumps and diagnostics, e.g. `TodoList:if8.0`.
    pub label: String,
    /// Component whose IR nodes the template renders.
    pub component: ComponentId,
    pub kind: TemplateKind,
    /// Static tree in pre-order; node indices are local to the template.
    pub nodes: Vec<ViewNode>,
    /// Top-level nodes in source order.
    pub roots: Vec<u32>,
    pub values: Vec<ValueSlot>,
    /// Event slots, grouped by ascending local node index.
    pub events: Vec<EventSlot>,
    pub points: Vec<MountPoint>,
}

/// What a template renders.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TemplateKind {
    /// The body of [`Template::component`].
    Component,
    /// The body of a page.
    Page,
    /// Branch `index` of the `if` node `node`.
    Branch { node: NodeId, index: u32 },
    /// One row of the `for` node `node`.
    Row { node: NodeId },
    /// Children that the component call `node` passes to its callee's slot `param`.
    SlotContent { node: NodeId, param: ParamId },
}

/// A node of a template's static tree.
#[derive(Debug, Clone, PartialEq)]
pub struct ViewNode {
    /// IR node of [`Template::component`] this node renders.
    pub source: NodeId,
    pub kind: ViewNodeKind,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ViewNodeKind {
    Element {
        element: Element,
        /// Constant properties, inlined into the template.
        props: Vec<StaticProp>,
        children: Vec<u32>,
    },
    /// Placeholder replaced by the roots of the child scopes mounted at
    /// mount point `index` of the template.
    Point(u32),
}

/// A constant property value.
#[derive(Debug, Clone, PartialEq)]
pub struct StaticProp {
    pub name: &'static str,
    pub value: Constant,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Constant {
    Int(i64),
    Float(f64),
    Bool(bool),
    String(String),
    /// A validated color, formatted as normalized lowercase hex.
    Color(Color),
    /// A color token, serialized with its `@` prefix.
    Token(String),
}

/// A native view property is read from a value slot or inlined as a constant.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PropSource<'t> {
    /// Index into [`Template::values`].
    Slot(usize),
    /// Value borrowed from a node's static properties.
    Constant(&'t Constant),
}

/// Type of the values a slot receives or an event carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ValueType {
    Int,
    Float,
    Bool,
    String,
    Color,
    /// An array of strings (property slots only).
    Strings,
}

impl ValueType {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            ValueType::Int => "Int",
            ValueType::Float => "Float",
            ValueType::Bool => "Bool",
            ValueType::String => "String",
            ValueType::Color => "Color",
            ValueType::Strings => "Strings",
        }
    }
}

/// A dynamic property or text of an element.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValueSlot {
    /// Local node index of the element.
    pub node: u32,
    pub prop: &'static str,
    pub ty: ValueType,
}

/// A user event of an element.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventSlot {
    /// Local node index of the element.
    pub node: u32,
    /// Handler property, e.g. `onClick`.
    pub event: &'static str,
    /// Type of the element's value sent with the event, if any.
    pub payload: Option<ValueType>,
    /// Value slot the user edits on a controlled element. The view
    /// restores it to the last value it received when `dispatch` reports
    /// that the edit was not accepted.
    pub controls: Option<u32>,
}

/// Where child scopes are inserted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MountPoint {
    /// Local node index of the [`ViewNodeKind::Point`] node.
    pub node: u32,
    pub kind: PointKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PointKind {
    /// An `if` chain: at most one child, from the template of its branch.
    Branch { templates: Vec<TemplateId> },
    /// A `for` loop: ordered children of the row template.
    List { template: TemplateId },
    /// A virtualized list with its row templates.
    Lazy { templates: Vec<TemplateId> },
    /// A component call: one child of the callee's body template.
    Instance { template: TemplateId },
    /// A component's `Children` parameter: at most one child, whose
    /// template is the caller's slot content.
    Slot,
}

/// Place of an IR node in the layout.
#[derive(Debug, Clone, PartialEq, Eq)]
struct NodeMap {
    template: TemplateId,
    local: u32,
    role: Role,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Role {
    Element {
        /// Value slot of each IR property, by property index.
        values: Vec<Option<u32>>,
        /// Event slot of each IR handler property, by property index.
        events: Vec<Option<u32>>,
        /// Control event slot, even when no handler was supplied.
        edit: Option<u32>,
    },
    Point {
        index: u32,
        /// Branch templates of an `if`, the row template of a `for`, or the
        /// filled slots of a component call, in parameter order.
        children: Vec<TemplateId>,
    },
}

impl ViewLayout {
    /// Color tokens in declaration order with their light and dark colors.
    #[must_use]
    pub fn theme(&self) -> &[(String, Color, Color)] {
        self.theme.as_deref().unwrap_or_default()
    }

    #[must_use]
    pub fn templates(&self) -> &[Template] {
        &self.templates
    }

    #[must_use]
    pub fn template(&self, id: TemplateId) -> &Template {
        &self.templates[id.index()]
    }

    /// The body template of `component`.
    #[must_use]
    pub fn body(component: ComponentId) -> TemplateId {
        TemplateId(component.0)
    }

    fn node(&self, component: ComponentId, node: NodeId) -> &NodeMap {
        &self.components[component.index()][node.index()]
    }

    /// The template holding `node` of `component` and the node's local index
    /// in it.
    #[must_use]
    pub fn location(&self, component: ComponentId, node: NodeId) -> (TemplateId, u32) {
        let map = self.node(component, node);
        (map.template, map.local)
    }

    /// Value slot of property `prop` (an index into the IR properties) of
    /// the element `node`; `None` for constants and handlers.
    ///
    /// # Panics
    ///
    /// Panics if `node` is not an element.
    #[must_use]
    pub fn value_slot(&self, component: ComponentId, node: NodeId, prop: usize) -> Option<u32> {
        match &self.node(component, node).role {
            Role::Element { values, .. } => values[prop],
            Role::Point { .. } => panic!("node {} is not an element", node.0),
        }
    }

    /// Event slot of IR property `prop` on `node`, if it has one.
    ///
    /// # Panics
    ///
    /// Panics if `node` is not an element or `prop` is out of bounds.
    #[must_use]
    pub fn event_slot(&self, component: ComponentId, node: NodeId, prop: usize) -> Option<u32> {
        match &self.node(component, node).role {
            Role::Element { events, .. } => events[prop],
            Role::Point { .. } => panic!("node {} is not an element", node.0),
        }
    }

    /// Control event slot of an element, even if it has no handler.
    ///
    /// # Panics
    ///
    /// Panics if `node` is not an element.
    #[must_use]
    pub fn edit_slot(&self, component: ComponentId, node: NodeId) -> Option<u32> {
        match &self.node(component, node).role {
            Role::Element { edit, .. } => *edit,
            Role::Point { .. } => panic!("node {} is not an element", node.0),
        }
    }

    /// Mount point of an `if`, `for`, component call or slot node within its
    /// template.
    ///
    /// # Panics
    ///
    /// Panics if `node` is an element.
    #[must_use]
    pub fn point(&self, component: ComponentId, node: NodeId) -> u32 {
        match &self.node(component, node).role {
            Role::Point { index, .. } => *index,
            Role::Element { .. } => panic!("node {} is an element", node.0),
        }
    }

    /// Templates created for the children of a mount point: one per branch
    /// of an `if`, the row of a `for`, or one per filled slot of a component call.
    ///
    /// # Panics
    ///
    /// Panics if `node` is an element.
    #[must_use]
    pub fn child_templates(&self, component: ComponentId, node: NodeId) -> &[TemplateId] {
        match &self.node(component, node).role {
            Role::Point { children, .. } => children,
            Role::Element { .. } => panic!("node {} is an element", node.0),
        }
    }
}

impl Template {
    /// Finds a property of `node`, preferring a value slot to an inlined constant.
    ///
    /// Pass the static properties of `node` as `props`.
    #[must_use]
    pub fn prop<'t>(
        &self,
        node: u32,
        props: &'t [StaticProp],
        name: &str,
    ) -> Option<PropSource<'t>> {
        if let Some(slot) = self
            .values
            .iter()
            .position(|value| value.node == node && value.prop == name)
        {
            return Some(PropSource::Slot(slot));
        }
        props
            .iter()
            .find(|prop| prop.name == name)
            .map(|prop| PropSource::Constant(&prop.value))
    }

    /// Returns the slot of a named event on `node`, if present.
    #[must_use]
    pub fn event(&self, node: u32, name: &str) -> Option<usize> {
        self.events(node)
            .find_map(|(slot, event)| (event.event == name).then_some(slot))
    }

    /// Iterates over an element's events in slot order, with their slot indices.
    pub fn events(&self, node: u32) -> impl Iterator<Item = (usize, &EventSlot)> {
        let start = self.events.partition_point(|event| event.node < node);
        self.events
            .iter()
            .enumerate()
            .skip(start)
            .take_while(move |(_, event)| event.node == node)
    }

    /// Returns the edit event and value slots of a controlled element.
    ///
    /// # Panics
    ///
    /// Panics if `node` does not have an event that controls a value slot.
    #[must_use]
    pub fn controlled(&self, node: u32) -> (usize, u32) {
        self.events(node)
            .find_map(|(slot, event)| event.controls.map(|value| (slot, value)))
            .expect("controlled elements have an edit event with a value slot")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use weft_ui_parser::MemoryLoader;

    fn layout() -> ViewLayout {
        let mut loader = MemoryLoader::new();
        loader.insert(
            "App.weft",
            r#"
            event Clicked
            component App(text: String) {
                Text(text, weight = "bold")
                Button(onClick = Clicked) { Text("click") }
                Input("")
            }
            "#,
        );
        let compilation = crate::check(weft_ui_parser::load(&["App.weft"], &mut loader));
        let Some(program) = &compilation.program else {
            panic!("{}", compilation.render_diagnostics());
        };
        ViewLayout::new(program)
    }

    #[test]
    fn finds_dynamic_and_static_properties() {
        let layout = layout();
        let template = &layout.templates()[0];
        let text = template.roots[0];
        let ViewNodeKind::Element { props, .. } = &template.nodes[text as usize].kind else {
            panic!("the first root is a Text element");
        };
        assert_eq!(
            template.prop(text, props, "value"),
            Some(PropSource::Slot(0))
        );
        assert_eq!(
            template.prop(text, props, "weight"),
            Some(PropSource::Constant(&Constant::String("bold".into())))
        );
        assert_eq!(template.prop(text, props, "color"), None);
    }

    #[test]
    fn finds_click_and_controlled_events_in_slot_order() {
        let layout = layout();
        let template = &layout.templates()[0];
        assert_eq!(template.events(template.roots[0]).next(), None);
        assert_eq!(template.event(template.roots[1], "onClick"), Some(0));
        assert_eq!(template.events[0].controls, None);
        assert_eq!(template.controlled(template.roots[2]), (1, 1));
        let button = template.nodes[template.roots[1] as usize].source;
        let input = template.nodes[template.roots[2] as usize].source;
        assert_eq!(layout.event_slot(template.component, button, 0), Some(0));
        assert_eq!(layout.event_slot(template.component, input, 0), None);
        assert_eq!(layout.edit_slot(template.component, input), Some(1));
    }

    #[test]
    fn allocates_multiple_handlers_for_one_element() {
        use crate::elements::{Children, ElementSpec, PropKind, PropSpec, PropType};
        use crate::ir::{Handler, Prop, PropValue};

        const CLICK: PropSpec = PropSpec {
            name: "onClick",
            kind: PropKind::Handler { payload: None },
            positional: false,
            required: false,
            constant: false,
            css: None,
            controlled_by: None,
            support: &[],
        };
        let spec = ElementSpec {
            element: Element::Button,
            name: "Button",
            props: &[
                CLICK,
                PropSpec {
                    name: "onSecondary",
                    kind: PropKind::Handler {
                        payload: Some(PropType::Bool),
                    },
                    ..CLICK
                },
            ],
            children: Children::Any,
            page_root: false,
            parents: &[],
            content: None,
            support: &[],
        };
        let mut template = Template {
            label: "Test".into(),
            component: ComponentId(0),
            kind: TemplateKind::Component,
            nodes: vec![ViewNode {
                source: NodeId(0),
                kind: ViewNodeKind::Element {
                    element: Element::Button,
                    props: Vec::new(),
                    children: Vec::new(),
                },
            }],
            roots: vec![0],
            values: Vec::new(),
            events: Vec::new(),
            points: Vec::new(),
        };
        let props = ["onClick", "onMount", "onSecondary"].map(|name| Prop {
            name,
            value: PropValue::Handler(Handler::Lambda {
                param: None,
                body: Vec::new(),
            }),
            binding: None,
            span: Default::default(),
        });
        let (slots, edit) = build::element_events(&mut template.events, 0, &spec, &props, None);
        assert_eq!(slots, [Some(0), None, Some(1)]);
        assert_eq!(edit, None);
        assert_eq!(template.event(0, "onClick"), Some(0));
        assert_eq!(template.event(0, "onSecondary"), Some(1));
        assert_eq!(template.event(0, "onMount"), None);
        assert_eq!(template.events[1].payload, Some(ValueType::Bool));

        template.events.clear();
        let (slots, edit) = build::element_events(
            &mut template.events,
            0,
            &spec,
            &props,
            Some(("onSecondary", 0, ValueType::Bool)),
        );
        assert_eq!(slots, [Some(1), None, Some(0)]);
        assert_eq!(edit, Some(0));
        assert_eq!(template.controlled(0), (0, 0));
    }

    #[test]
    #[should_panic(expected = "controlled elements have an edit event with a value slot")]
    fn rejects_an_event_without_a_controlled_slot() {
        let layout = layout();
        let template = &layout.templates()[0];
        let _ = template.controlled(template.roots[1]);
    }
}
