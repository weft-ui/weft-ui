//! Block creation, updates and cleanup shared by the DOM and remote modes.

use std::fmt::Display;

use crate::elements::Element;
use crate::ir::{
    BindingId, Branch, Component, DepRoot, NodeId, NodeKind, Program, Prop, slot_params,
};

use super::blocks::{
    Consts, Ctx, Parts, arg_updates, arg_values, binding_cond, branch_index, lifecycle,
    lifecycle_handlers, root_shape, walk_cond, words,
};
use super::expr::{Env, expr};
use super::js::Code;

pub(crate) struct ComponentIr<'ir> {
    pub(crate) program: &'ir Program,
    pub(crate) comp: &'ir Component,
}

/// Differences in how the two runtimes address nodes and create scopes.
pub(crate) trait Backend {
    /// Emits any declarations needed before creating a block's nodes.
    fn start_block(
        &self,
        _comp: &Component,
        _roots: &[NodeId],
        _consts: &mut Consts,
        _out: &mut Code,
    ) {
    }

    /// Initializes the scope after its nodes have been created.
    fn init_block(&self, _var: &str, _out: &mut Code) {}

    /// Emits properties and events, returning the parent for the element's children.
    fn element<'parent>(
        &self,
        ir: &ComponentIr<'_>,
        id: NodeId,
        parent: &'parent str,
        element: Element,
        props: &[Prop],
        parts: &mut Parts,
    ) -> &'parent str;

    /// Arguments locating a branch or list mount point.
    fn anchor<'parent>(&self, id: NodeId, parent: &'parent str) -> impl Display + 'parent;

    /// Declares block scope `b` for the indexed branch or filled slot template.
    fn block_decl(&self, id: NodeId, index: usize, out: &mut Code);

    /// Extra arguments preceding the common row arguments.
    fn row_args(&self, id: NodeId) -> impl Display;

    /// Statement mounting a component instance or slot block.
    fn mount<'args>(
        &self,
        id: NodeId,
        parent: &'args str,
        child: &'args str,
    ) -> impl Display + 'args;

    /// Destroy call for a mounted component instance or slot block.
    fn slot_destroy(&self) -> &'static str;
}

pub(crate) struct Flow<'ir, 'consts, B> {
    ir: ComponentIr<'ir>,
    consts: &'consts mut Consts,
    backend: B,
}

impl<'ir, 'consts, B: Backend> Flow<'ir, 'consts, B> {
    pub(crate) fn new(
        program: &'ir Program,
        comp: &'ir Component,
        consts: &'consts mut Consts,
        backend: B,
    ) -> Self {
        Self {
            ir: ComponentIr { program, comp },
            consts,
            backend,
        }
    }

    /// Builds `roots` into the already declared scope `var`.
    pub(crate) fn block(&mut self, roots: &[NodeId], ctx: &Ctx, var: &str, out: &mut Code) {
        self.backend
            .start_block(self.ir.comp, roots, self.consts, out);
        let mut parts = Parts::default();
        for &root in roots {
            self.node(root, ctx, var, &mut parts);
        }
        out.append(parts.create);
        self.backend.init_block(var, out);
        if !parts.update.is_empty() {
            out.open(format!("{var}.u = () => {{"));
            out.append(parts.update);
            out.close("};");
        }
        if !parts.cleanup.is_empty() {
            out.open(format!("{var}.x = () => {{"));
            out.append(parts.cleanup);
            out.close("};");
        }
    }

    fn block_scope(
        &mut self,
        id: NodeId,
        index: usize,
        roots: &[NodeId],
        ctx: &Ctx,
        out: &mut Code,
    ) {
        self.backend.block_decl(id, index, out);
        self.block(roots, ctx, "b", out);
        out.line("return b;");
    }

    fn node(&mut self, id: NodeId, ctx: &Ctx, parent: &str, parts: &mut Parts) {
        let kind = &self.ir.comp.node(id).kind;
        match kind {
            NodeKind::Element {
                element,
                props,
                children,
            } => {
                let parent = self
                    .backend
                    .element(&self.ir, id, parent, *element, props, parts);
                for &child in children {
                    if matches!(element.spec().name, "List" | "Grid")
                        && matches!(self.ir.comp.node(child).kind, NodeKind::For { .. })
                    {
                        let columns = props.iter().find(|p| p.name == "columns").and_then(|p| {
                            if let crate::ir::PropValue::Expr(value) = &p.value {
                                Some(expr(value, Env::default()))
                            } else {
                                None
                            }
                        });
                        self.for_node(
                            child,
                            &self.ir.comp.node(child).kind,
                            ctx,
                            parent,
                            parts,
                            Some(columns),
                        );
                    } else {
                        self.node(child, ctx, parent, parts);
                    }
                }
                lifecycle(self.ir.program, lifecycle_handlers(props), parts);
            }
            NodeKind::If { branches, binding } => {
                self.if_node(id, branches, *binding, ctx, parent, parts);
            }
            NodeKind::For { .. } => self.for_node(id, kind, ctx, parent, parts, None),
            NodeKind::Component { .. } => self.component_node(id, kind, ctx, parent, parts),
            NodeKind::Slot { param } => {
                let slot = format!("y{}", id.0);
                let index = slot_params(&self.ir.comp.params)
                    .position(|(id, _)| id == *param)
                    .expect("a slot node refers to a Children parameter");
                parts.create.line(format!(
                    "const {slot} = c.children[{index}]?.create() ?? null;"
                ));
                let mount = self.backend.mount(id, parent, &slot);
                parts.create.line(format!("if ({slot}) {mount}"));
                let destroy = self.backend.slot_destroy();
                parts.cleanup.line(format!("if ({slot}) {slot}.{destroy};"));
            }
        }
    }

    fn if_node(
        &mut self,
        id: NodeId,
        branches: &[Branch],
        binding: Option<BindingId>,
        ctx: &Ctx,
        parent: &str,
        parts: &mut Parts,
    ) {
        let var = format!("i{}", id.0);
        let index = branch_index(branches);
        parts.create.open(format!(
            "const {var} = new $.Branches({}, (i) => {{",
            self.backend.anchor(id, parent)
        ));
        parts.create.open("switch (i) {");
        for (i, branch) in branches.iter().enumerate() {
            parts.create.open(format!("case {i}: {{"));
            self.block_scope(id, i, &branch.children, ctx, &mut parts.create);
            parts.create.close("}");
        }
        parts.create.line("default:");
        parts.create.line("  return null;");
        parts.create.close("}");
        parts.create.close("});");
        parts.create.line(format!("{var}.set({index});"));

        if let Some(cond) = binding_cond(self.ir.comp, binding) {
            parts
                .update
                .line(format!("if ({cond}) {var}.set({index});"));
        }
        let roots = branches
            .iter()
            .flat_map(|branch| branch.children.iter().copied());
        if let Some(cond) = walk_cond(self.ir.comp, roots, ctx) {
            parts.update.line(format!("if ({cond}) {var}.update();"));
        }
        parts.cleanup.line(format!("{var}.destroy();"));
    }

    fn for_node(
        &mut self,
        id: NodeId,
        kind: &NodeKind,
        ctx: &Ctx,
        parent: &str,
        parts: &mut Parts,
        lazy: Option<Option<String>>,
    ) {
        let NodeKind::For {
            loop_id,
            list,
            key,
            children,
            list_binding,
            ..
        } = kind
        else {
            unreachable!("caller checked the node kind");
        };
        let loop_id = *loop_id;
        let (var, row) = (format!("l{}", id.0), format!("r{}", loop_id.0));
        let list = expr(list, Env::default());
        let key = expr(
            key,
            Env {
                key_loop: Some(loop_id),
            },
        );
        let shape = root_shape(
            self.ir.program,
            self.ir.comp,
            self.consts,
            DepRoot::Item(loop_id),
        );
        let words = words(self.ir.comp.loops[loop_id.index()].slots.len());

        let constructor = if lazy.is_some() { "LazyList" } else { "List" };
        parts.create.open(format!(
            "const {var} = new $.{constructor}({}, (item) => {{",
            self.backend.anchor(id, parent)
        ));
        parts.create.line(format!(
            "const {row} = new $.Row({}{words}, {}.depth + 1, {shape}, item);",
            self.backend.row_args(id),
            ctx.scope()
        ));
        self.block(children, &ctx.with_loop(loop_id), &row, &mut parts.create);
        parts.create.line(format!("return {row};"));
        let extra = lazy
            .flatten()
            .map_or_else(String::new, |columns| format!(", {columns}"));
        parts.create.close(format!("}}, ($it) => {key}{extra});"));
        parts.create.line(format!("{var}.set({list});"));

        if let Some(cond) = binding_cond(self.ir.comp, *list_binding) {
            parts.update.line(format!("if ({cond}) {var}.set({list});"));
        }
        if let Some(cond) = walk_cond(self.ir.comp, children.iter().copied(), ctx) {
            parts.update.line(format!("if ({cond}) {var}.update();"));
        }
        parts.cleanup.line(format!("{var}.destroy();"));
    }

    fn component_node(
        &mut self,
        id: NodeId,
        kind: &NodeKind,
        ctx: &Ctx,
        parent: &str,
        parts: &mut Parts,
    ) {
        let NodeKind::Component {
            component,
            args,
            props,
            slots,
        } = kind
        else {
            unreachable!("caller checked the node kind");
        };
        let callee = self.ir.program.component(*component);
        let var = format!("k{}", id.0);
        arg_updates(self.ir.program, self.ir.comp, &var, args, &mut parts.update);

        let mut fills = slots.iter().enumerate().peekable();
        let children: Vec<_> = slot_params(&callee.params)
            .enumerate()
            .map(|(ordinal, (param, _))| {
                let Some((index, fill)) = fills.next_if(|(_, fill)| fill.param == param) else {
                    return "null".to_owned();
                };
                let slot = if ordinal == 0 {
                    format!("s{}", id.0)
                } else {
                    format!("s{}_{}", id.0, param.0)
                };
                parts
                    .create
                    .open(format!("const {slot} = new $.Slot(() => {{"));
                self.block_scope(id, index, &fill.children, ctx, &mut parts.create);
                parts.create.close("});");
                if let Some(cond) = walk_cond(self.ir.comp, fill.children.iter().copied(), ctx) {
                    parts.update.line(format!("if ({cond}) {slot}.update();"));
                }
                slot
            })
            .collect();

        parts.create.line(format!(
            "const {var} = {}$c(c.app, [{}], [{}], {}.depth + 1);",
            callee.name,
            arg_values(self.ir.program, callee, args).join(", "),
            children.join(", "),
            ctx.scope()
        ));
        parts
            .create
            .line(self.backend.mount(id, parent, &var).to_string());
        let destroy = self.backend.slot_destroy();
        parts.cleanup.line(format!("{var}.{destroy};"));
        lifecycle(self.ir.program, lifecycle_handlers(props), parts);
    }
}
