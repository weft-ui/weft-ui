use crate::AppOptions;
use crate::color::Color;
use crate::elements::{ElementSpec, Level, PropKind, PropType};
use crate::ir::{
    Coercion, Component, ComponentId, Expr, ExprKind, NodeId, NodeKind, Program, Prop, PropValue,
    UnaryOp, first_slot,
};
use crate::transform::Platform;

use super::json::fnv1a;
use super::{
    Constant, EventSlot, MountPoint, NodeMap, PointKind, Role, StaticProp, Template, TemplateId,
    TemplateKind, ValueSlot, ValueType, ViewLayout, ViewNode, ViewNodeKind,
};

impl ViewLayout {
    /// Derives the layout of every component of `program`.
    #[must_use]
    pub fn new(program: &Program) -> Self {
        Self::for_platform(program, None, &AppOptions::default())
    }

    pub(crate) fn for_platform(
        program: &Program,
        platform: Option<Platform>,
        options: &AppOptions,
    ) -> Self {
        let mut builder = Builder {
            program,
            platform,
            templates: program.components.iter().map(|_| None).collect(),
            components: program
                .components
                .iter()
                .map(|c| vec![None; c.nodes.len()])
                .collect(),
        };
        for (index, comp) in program.components.iter().enumerate() {
            let id = TemplateId(offset(index));
            let component = ComponentId(id.0);
            builder.build(
                id,
                component,
                comp.name.clone(),
                if comp.page.is_some() {
                    TemplateKind::Page
                } else {
                    TemplateKind::Component
                },
                &comp.roots,
            );
        }
        let templates: Vec<Template> = builder
            .templates
            .into_iter()
            .map(|t| t.expect("every reserved template is built"))
            .collect();
        let components = builder
            .components
            .into_iter()
            .map(|nodes| {
                nodes
                    .into_iter()
                    .map(|n| n.expect("every IR node belongs to a template"))
                    .collect()
            })
            .collect();
        let mut layout = ViewLayout {
            safe_area: options.safe_area,
            theme: program.theme.as_ref().map(|theme| theme.colors.clone()),
            templates,
            components,
            hash: 0,
        };
        layout.hash = fnv1a(layout.templates_json(None).as_bytes());
        layout
    }
}

impl ValueType {
    fn of(ty: PropType) -> Self {
        match ty {
            PropType::Int => ValueType::Int,
            PropType::Float => ValueType::Float,
            PropType::Bool => ValueType::Bool,
            PropType::String | PropType::Union(_) => ValueType::String,
            PropType::Color => ValueType::Color,
            PropType::Strings => ValueType::Strings,
        }
    }
}

/// Converts an index into a layout `u32`.
fn offset(index: usize) -> u32 {
    u32::try_from(index).expect("layout indices fit in u32")
}

/// A property literal borrowing any text from the IR.
pub(crate) enum Literal<'e> {
    Str(&'e str),
    Token(&'e str),
    Int(i64),
    Float(f64),
    Bool(bool),
}

/// Detects values that can be inserted into static markup without evaluating JavaScript.
pub(crate) fn literal(expr: &Expr) -> Option<Literal<'_>> {
    match &expr.kind {
        ExprKind::Str(s) => Some(Literal::Str(s)),
        ExprKind::Theme(name) => Some(Literal::Token(name)),
        ExprKind::Int(v) => Some(Literal::Int(*v)),
        ExprKind::Float(v) => Some(Literal::Float(*v)),
        ExprKind::Bool(v) => Some(Literal::Bool(*v)),
        ExprKind::Coerce { coercion, expr } => match (coercion, literal(expr)?) {
            (Coercion::IntToFloat, Literal::Int(v)) => Some(Literal::Float(v as f64)),
            (Coercion::WrapOptional, value) => Some(value),
            _ => None,
        },
        ExprKind::Unary {
            op: UnaryOp::Neg,
            expr,
        } => match literal(expr)? {
            Literal::Int(v) => v.checked_neg().map(Literal::Int),
            Literal::Float(v) => Some(Literal::Float(-v)),
            _ => None,
        },
        _ => None,
    }
}

/// Extracts a static property value for a platform view template.
pub(crate) fn constant(expr: &Expr, ty: PropType) -> Option<Constant> {
    Some(match literal(expr)? {
        Literal::Str(s) if ty == PropType::Color => Constant::Color(
            Color::parse(s).expect("color literals were validated during semantic analysis"),
        ),
        Literal::Str(s) => Constant::String(s.to_owned()),
        Literal::Token(name) => Constant::Token(name.to_owned()),
        Literal::Int(v) => Constant::Int(v),
        Literal::Float(v) => Constant::Float(v),
        Literal::Bool(v) => Constant::Bool(v),
    })
}

/// Allocates the control event first, then other handlers in IR property order.
pub(super) fn element_events(
    slots: &mut Vec<EventSlot>,
    node: u32,
    spec: &ElementSpec,
    props: &[Prop],
    edited: Option<(&'static str, u32, ValueType)>,
) -> (Vec<Option<u32>>, Option<u32>) {
    let mut allocate = |event, payload, controls| {
        let slot = offset(slots.len());
        slots.push(EventSlot {
            node,
            event,
            payload,
            controls,
        });
        slot
    };
    let edit = edited.map(|(name, value, ty)| allocate(name, Some(ty), Some(value)));
    let events = props
        .iter()
        .map(|prop| {
            if !matches!(prop.value, PropValue::Handler(_)) {
                return None;
            }
            if edited.is_some_and(|(event, ..)| event == prop.name) {
                return edit;
            }
            // Lifecycle hooks are not part of the element's schema or view.
            let PropKind::Handler { payload } = spec.prop(prop.name)?.kind else {
                return None;
            };
            Some(allocate(prop.name, payload.map(ValueType::of), None))
        })
        .collect();
    (events, edit)
}

struct Builder<'p> {
    program: &'p Program,
    platform: Option<Platform>,
    /// Reserved templates are `None` until built.
    templates: Vec<Option<Template>>,
    components: Vec<Vec<Option<NodeMap>>>,
}

/// A template under construction.
struct Draft {
    id: TemplateId,
    component: ComponentId,
    nodes: Vec<ViewNode>,
    values: Vec<ValueSlot>,
    events: Vec<EventSlot>,
    points: Vec<MountPoint>,
}

impl Builder<'_> {
    fn reserve(&mut self) -> TemplateId {
        let id = TemplateId(offset(self.templates.len()));
        self.templates.push(None);
        id
    }

    fn build(
        &mut self,
        id: TemplateId,
        component: ComponentId,
        label: String,
        kind: TemplateKind,
        roots: &[NodeId],
    ) {
        let mut draft = Draft {
            id,
            component,
            nodes: Vec::new(),
            values: Vec::new(),
            events: Vec::new(),
            points: Vec::new(),
        };
        let roots = roots.iter().map(|&n| self.node(&mut draft, n)).collect();
        self.templates[id.index()] = Some(Template {
            label,
            component,
            kind,
            nodes: draft.nodes,
            roots,
            values: draft.values,
            events: draft.events,
            points: draft.points,
        });
    }

    fn comp(&self, id: ComponentId) -> &Component {
        self.program.component(id)
    }

    /// Adds `id` and its subtree to the template; returns its local index.
    fn node(&mut self, draft: &mut Draft, id: NodeId) -> u32 {
        let program = self.program;
        let comp = program.component(draft.component);
        let local = offset(draft.nodes.len());
        let role = match &comp.node(id).kind {
            NodeKind::Element {
                element,
                props,
                children,
            } => {
                draft.nodes.push(ViewNode {
                    source: id,
                    kind: ViewNodeKind::Element {
                        element: *element,
                        props: Vec::new(),
                        children: Vec::new(),
                    },
                });
                let spec = element.spec();
                let mut statics = Vec::new();
                let mut values = Vec::with_capacity(props.len());
                let mut edited = None;
                for prop in props {
                    let slot = match &prop.value {
                        PropValue::Handler(_) => None,
                        PropValue::Expr(value) => {
                            let prop_spec = spec
                                .prop(prop.name)
                                .expect("every element value property has a spec");
                            if self.platform.is_some_and(|platform| {
                                prop_spec.support.contains(&(platform, Level::Ignored))
                            }) {
                                values.push(None);
                                continue;
                            }
                            let controlled_by = prop_spec.controlled_by;
                            let ty = prop_spec.prop_type();
                            let fixed = (prop.binding.is_none() && controlled_by.is_none())
                                .then(|| constant(value, ty))
                                .flatten();
                            match fixed {
                                Some(value) => {
                                    statics.push(StaticProp {
                                        name: prop.name,
                                        value,
                                    });
                                    None
                                }
                                None => {
                                    let slot = offset(draft.values.len());
                                    let ty = ValueType::of(ty);
                                    draft.values.push(ValueSlot {
                                        node: local,
                                        prop: prop.name,
                                        ty,
                                    });
                                    if let Some(event) = controlled_by {
                                        edited = Some((event, slot, ty));
                                    }
                                    Some(slot)
                                }
                            }
                        }
                    };
                    values.push(slot);
                }
                let (events, edit) = element_events(&mut draft.events, local, spec, props, edited);
                let children: Vec<u32> = children.iter().map(|&c| self.node(draft, c)).collect();
                if let ViewNodeKind::Element {
                    props, children: c, ..
                } = &mut draft.nodes[local as usize].kind
                {
                    *props = statics;
                    *c = children;
                }
                Role::Element {
                    values,
                    events,
                    edit,
                }
            }
            kind => {
                let index = offset(draft.points.len());
                draft.nodes.push(ViewNode {
                    source: id,
                    kind: ViewNodeKind::Point(index),
                });
                let (point, children) = self.point(draft.component, id, kind);
                draft.points.push(MountPoint {
                    node: local,
                    kind: point,
                });
                Role::Point { index, children }
            }
        };
        self.components[draft.component.index()][id.index()] = Some(NodeMap {
            template: draft.id,
            local,
            role,
        });
        local
    }

    /// Builds the child templates of a mount point node.
    fn point(
        &mut self,
        component: ComponentId,
        id: NodeId,
        kind: &NodeKind,
    ) -> (PointKind, Vec<TemplateId>) {
        let name = self.comp(component).name.clone();
        let n = id.0;
        match kind {
            NodeKind::If { branches, .. } => {
                let mut templates = Vec::with_capacity(branches.len());
                for (index, branch) in branches.iter().enumerate() {
                    let child = self.reserve();
                    let index = offset(index);
                    self.build(
                        child,
                        component,
                        format!("{name}:if{n}.{index}"),
                        TemplateKind::Branch { node: id, index },
                        &branch.children,
                    );
                    templates.push(child);
                }
                (
                    PointKind::Branch {
                        templates: templates.clone(),
                    },
                    templates,
                )
            }
            NodeKind::For { children, .. } => {
                let child = self.reserve();
                self.build(
                    child,
                    component,
                    format!("{name}:for{n}"),
                    TemplateKind::Row { node: id },
                    children,
                );
                (PointKind::List { template: child }, vec![child])
            }
            NodeKind::Component {
                component: callee,
                slots,
                ..
            } => {
                let params = &self.program.component(*callee).params;
                let first = first_slot(params);
                let content = slots
                    .iter()
                    .map(|fill| {
                        let param = fill.param;
                        let label = if Some(param) == first {
                            format!("{name}:slot{n}")
                        } else {
                            format!("{name}:slot{n}.{}", params[param.index()].name)
                        };
                        let child = self.reserve();
                        self.build(
                            child,
                            component,
                            label,
                            TemplateKind::SlotContent { node: id, param },
                            &fill.children,
                        );
                        child
                    })
                    .collect();
                (
                    PointKind::Instance {
                        template: ViewLayout::body(*callee),
                    },
                    content,
                )
            }
            NodeKind::Slot { .. } => (PointKind::Slot, Vec::new()),
            NodeKind::Element { .. } => unreachable!("elements are not mount points"),
        }
    }
}
