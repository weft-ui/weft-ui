//! Remote mode: one create function per component that drives the scopes of
//! the [view protocol](crate::view) for a separate view layer on WeChat and
//! the native platforms.
//!
//! Every block (component body, `if` branch, `for` row, slot content) is a
//! scope of its layout template. Create code writes every value slot once;
//! update functions re-run only the bindings whose dirty bits are set and
//! write values that changed, which the runtime (`@weft-ui/runtime/remote`)
//! turns into ops for its sink. Event handlers and keys are evaluated in the
//! logic layer when they fire or when rows are aligned, so they never travel
//! to the view: the view only reports which event slot of which scope fired.

use std::fmt::{self, Display};

use crate::elements::Element;
use crate::ir::{ComponentId, NodeId, Program, Prop, PropValue};
use crate::view::ViewLayout;

use super::blocks::{
    Consts, Ctx, Parts, binding_cond, element_handler_body, instance_watches, words,
};
use super::expr::{Env, expr};
use super::flow::{Backend, ComponentIr, Flow};
use super::js::Code;

/// Emits `export function {Name}$c(app, args, children, depth)`.
pub(crate) fn component(
    program: &Program,
    layout: &ViewLayout,
    id: ComponentId,
    consts: &mut Consts,
    out: &mut Code,
) {
    let comp = program.component(id);
    out.open(format!(
        "export function {}$c(app, args, children, depth) {{",
        comp.name
    ));
    out.line(format!(
        "const c = new $.Instance(app, {}, {}, depth, args, children);",
        ViewLayout::body(id).0,
        words(comp.slots.len())
    ));
    instance_watches(program, comp, consts, out);
    Flow::new(program, comp, consts, Gen { layout, id }).block(
        &comp.roots,
        &Ctx::default(),
        "c",
        out,
    );
    out.line("return c;");
    out.close("}");
}

struct Gen<'a> {
    layout: &'a ViewLayout,
    id: ComponentId,
}

impl Backend for Gen<'_> {
    fn element<'parent>(
        &self,
        ir: &ComponentIr<'_>,
        id: NodeId,
        var: &'parent str,
        _element: Element,
        props: &[Prop],
        parts: &mut Parts,
    ) -> &'parent str {
        for (index, prop) in props.iter().enumerate() {
            let Some(slot) = self.layout.value_slot(self.id, id, index) else {
                continue;
            };
            let PropValue::Expr(value) = &prop.value else {
                unreachable!("only expressions have value slots");
            };
            let value = expr(value, Env::default());
            parts.create.line(format!("{var}.set({slot}, {value});"));
            if let Some(cond) = binding_cond(ir.comp, prop.binding) {
                parts
                    .update
                    .line(format!("if ({cond}) {var}.set({slot}, {value});"));
            }
        }
        let template = self.layout.template(self.layout.location(self.id, id).0);
        let mut unhandled_edit = self.layout.edit_slot(self.id, id);
        for (index, prop) in props.iter().enumerate() {
            let Some(slot) = self.layout.event_slot(self.id, id, index) else {
                continue;
            };
            if unhandled_edit == Some(slot) {
                unhandled_edit = None;
            }
            let PropValue::Handler(handler) = &prop.value else {
                unreachable!("only handlers have event slots in the property map");
            };
            let event = &template.events[slot as usize];
            let param = if event.payload.is_some() { "$a" } else { "" };
            let body = element_handler_body(ir.program, ir.comp, id, prop, handler, parts);
            let controls = event.controls.map_or(-1, i64::from);
            parts.create.line(format!(
                "{var}.on({slot}, ({param}) => {{ {body} }}, {controls});"
            ));
        }
        if let Some(slot) = unhandled_edit {
            let controls = template.events[slot as usize]
                .controls
                .expect("the edit event controls a value slot");
            parts
                .create
                .line(format!("{var}.on({slot}, null, {controls});"));
        }
        var
    }

    fn anchor<'parent>(&self, id: NodeId, parent: &'parent str) -> impl Display + 'parent {
        let point = self.layout.point(self.id, id);
        fmt::from_fn(move |f| write!(f, "{parent}, {point}"))
    }

    fn block_decl(&self, id: NodeId, index: usize, out: &mut Code) {
        let template = self.layout.child_templates(self.id, id)[index].0;
        out.line(format!("const b = new $.Block(c.app, {template});"));
    }

    fn row_args(&self, id: NodeId) -> impl Display {
        let template = self.layout.child_templates(self.id, id)[0].0;
        fmt::from_fn(move |f| write!(f, "c.app, {template}, "))
    }

    fn lazy_columns(&self) -> bool {
        false
    }

    fn mount<'args>(
        &self,
        id: NodeId,
        parent: &'args str,
        child: &'args str,
    ) -> impl Display + 'args {
        let point = self.layout.point(self.id, id);
        fmt::from_fn(move |f| write!(f, "{parent}.attach({point}, {child});"))
    }

    fn slot_destroy(&self) -> &'static str {
        "destroy()"
    }
}
