//! Block creation, updates and cleanup shared by the DOM and remote modes.

use std::fmt::Display;

use crate::elements::Element;
use crate::ir::{
    BindingId, Branch, Component, DepRoot, NodeId, NodeKind, Program, Prop, PropValue, slot_params,
};

use super::blocks::{
    Consts, Ctx, Parts, arg_updates, arg_values, binding_cond, branch_index, element_handler_body,
    lifecycle, lifecycle_handlers, root_shape, walk_cond, words,
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

    /// DOM lazy lists take a columns argument before their options.
    fn lazy_columns(&self) -> bool;

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
                        self.for_node(
                            child,
                            &self.ir.comp.node(child).kind,
                            ctx,
                            parent,
                            parts,
                            Some((id, props)),
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
        lazy: Option<(NodeId, &[Prop])>,
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
        let row_words = words(self.ir.comp.loops[loop_id.index()].slots.len());

        let section = lazy.and_then(|_| {
            let (&inner, headers) = children.split_last()?;
            match &self.ir.comp.node(inner).kind {
                NodeKind::For { .. } => Some((inner, headers)),
                _ => None,
            }
        });
        let mut options = Vec::new();
        let mut columns = None;
        if let Some((owner, props)) = lazy {
            for prop in props {
                match (&prop.value, prop.name) {
                    (PropValue::Expr(value), "columns") => {
                        columns = Some(expr(value, Env::default()))
                    }
                    (PropValue::Expr(value), "endThreshold" | "stickyHeaders") => {
                        options.push(format!("{}: {}", prop.name, expr(value, Env::default())))
                    }
                    (PropValue::Handler(handler), "onEndReached" | "onRefresh") => {
                        if prop.name == "onRefresh" && !self.backend.lazy_columns() {
                            continue;
                        }
                        let body = element_handler_body(
                            self.ir.program,
                            self.ir.comp,
                            owner,
                            prop,
                            handler,
                            parts,
                        );
                        options.push(format!("{}: () => {{ {body} }}", prop.name));
                    }
                    _ => {}
                }
            }
        }
        if let Some((inner, _)) = section {
            let NodeKind::For {
                loop_id: inner_loop,
                list: inner_list,
                key: inner_key,
                children: rows,
                ..
            } = &self.ir.comp.node(inner).kind
            else {
                unreachable!()
            };
            let inner_loop = *inner_loop;
            let inner_row = format!("r{}", inner_loop.0);
            let inner_shape = root_shape(
                self.ir.program,
                self.ir.comp,
                self.consts,
                DepRoot::Item(inner_loop),
            );
            let inner_words = words(self.ir.comp.loops[inner_loop.index()].slots.len());
            let inner_list = expr(inner_list, Env::default());
            let inner_key = expr(
                inner_key,
                Env {
                    key_loop: Some(inner_loop),
                },
            );
            let mut code = Code::default();
            code.open("createRow: (section, item) => {");
            code.line(format!("const {inner_row} = new $.Row({}{inner_words}, {}.depth + 1, {inner_shape}, item);", self.backend.row_args(inner), ctx.scope()));
            code.line(format!("const {row} = {{ item: section, d: new Uint32Array({row_words}), mark(bit) {{ this.d[bit >>> 5] |= 1 << (bit & 31); {inner_row}.mark(0); }} }};"));
            code.line(format!(
                "const $sectionWatch = $.watch({shape}, {row}, section);"
            ));
            self.block(
                rows,
                &ctx.with_loop(loop_id).with_loop(inner_loop),
                &inner_row,
                &mut code,
            );
            code.line(format!("const $update = {inner_row}.u; {inner_row}.u = () => {{ $update(); {row}.d.fill(0); }};"));
            code.line(format!("const $cleanup = {inner_row}.x; {inner_row}.x = () => {{ $cleanup(); $sectionWatch.dispose(); }};"));
            code.line(format!("{inner_row}.setSection = (section, item) => {{ {row}.item = section; $sectionWatch.set(section); {inner_row}.setItem(item); }};"));
            code.line(format!("return {inner_row};"));
            code.close("}");
            let mut create_row = String::new();
            code.write_to(&mut create_row);
            options.push(format!("sections: {{ rows: (section) => {{ const {row} = {{ item: section }}; return {inner_list}; }}, rowKey: (section, $it) => {{ const {row} = {{ item: section }}; return {inner_key}; }}, watchShape: {shape}, {create_row} }}"));
        }
        let constructor = if lazy.is_some() { "LazyList" } else { "List" };
        parts.create.open(format!(
            "const {var} = new $.{constructor}({}, (item) => {{",
            self.backend.anchor(id, parent)
        ));
        parts.create.line(format!(
            "const {row} = new $.Row({}{row_words}, {}.depth + 1, {shape}, item);",
            self.backend.row_args(id),
            ctx.scope()
        ));
        self.block(
            section.map_or(children.as_slice(), |(_, headers)| headers),
            &ctx.with_loop(loop_id),
            &row,
            &mut parts.create,
        );
        parts.create.line(format!("return {row};"));
        let mut extra = String::new();
        if lazy.is_some()
            && self.backend.lazy_columns()
            && (columns.is_some() || !options.is_empty())
        {
            extra.push_str(&format!(", {}", columns.as_deref().unwrap_or("undefined")));
        }
        if !options.is_empty() {
            extra.push_str(&format!(", {{ {} }}", options.join(", ")));
        }
        parts.create.close(format!("}}, ($it) => {key}{extra});"));
        if let Some((_, props)) = lazy
            && self.backend.lazy_columns()
            && let Some(prop) = props.iter().find(|p| p.name == "refreshing")
            && let PropValue::Expr(value) = &prop.value
        {
            let statement = format!("{var}.setRefreshing({});", expr(value, Env::default()));
            parts.create.line(&statement);
            if let Some(cond) = binding_cond(self.ir.comp, prop.binding) {
                parts.update.line(format!("if ({cond}) {statement}"));
            }
        }
        parts.create.line(format!("{var}.set({list});"));

        if let Some(cond) = binding_cond(self.ir.comp, *list_binding) {
            parts.update.line(format!("if ({cond}) {var}.set({list});"));
        }
        if let Some(cond) = walk_cond(self.ir.comp, children.iter().copied(), ctx) {
            if section.is_some() {
                parts.update.line(format!(
                    "if ({cond}) {{ {var}.set({list}); {var}.update(); }}"
                ));
            } else {
                parts.update.line(format!("if ({cond}) {var}.update();"));
            }
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
