use std::ops::Range;

use weft_ui_ast as ast;
use weft_ui_ast::span::offset;
use weft_ui_ast::{Diagnostic, Span};

use crate::deps;
use crate::elements::{
    self, Children, ELEMENTS as BUILTIN_ELEMENTS, Element, ElementSpec, LIFECYCLE as CALL_HOOKS,
    PropKind,
};
use crate::ir::{
    Arg, ArgValue, Binding, BindingId, BindingKind, Branch, ComponentId, Dep, Expr, ExprKind, Loop,
    LoopId, Node, NodeId, NodeKind, Param, ParamId, ParamKind, Prop, PropValue, SlotFill, Type,
    UnaryOp, first_slot, slot_params,
};
use crate::sema::record::{ProbeContext, RawCall, Target};
use crate::sema::{DeclKind, Style, article};

use super::expr::{constant_kind, error_expr};
use super::scope::LocalKind;
use super::{Instance, Lowerer};

/// Placeholder until the owning node is pushed and its bindings are patched.
const PENDING_NODE: NodeId = NodeId(u32::MAX);
const STYLE: &str = "style";

fn nested_lists(nodes: &[Node], id: NodeId, found: &mut Vec<Span>) {
    let node = &nodes[id.index()];
    match &node.kind {
        NodeKind::Element { element, .. } if element.spec().name == "List" => found.push(node.span),
        NodeKind::Component { .. } | NodeKind::Slot { .. } => {}
        kind => {
            for child in kind.children() {
                nested_lists(nodes, child, found);
            }
        }
    }
}

/// One expected argument when matching call arguments.
pub(super) struct ArgSlot<'n> {
    pub(super) name: &'n str,
    pub(super) positional: bool,
    pub(super) required: bool,
}

impl<'cx> Lowerer<'cx, '_> {
    fn bind(&mut self, kind: BindingKind, mut deps: Vec<Dep>) -> Option<BindingId> {
        if deps.is_empty() {
            return None;
        }
        deps::normalize(&mut deps);
        self.bindings.push(Binding {
            node: PENDING_NODE,
            kind,
            deps,
            bits: Vec::new(),
        });
        Some(BindingId(offset(self.bindings.len() - 1)))
    }

    fn push_node(&mut self, kind: NodeKind, span: Span, own_bindings: Range<usize>) -> NodeId {
        let id = NodeId(offset(self.nodes.len()));
        self.nodes.push(Node { kind, span });
        for binding in &mut self.bindings[own_bindings] {
            binding.node = id;
        }
        id
    }

    pub(super) fn nodes(&mut self, nodes: &[ast::Node], parent: Option<Element>) -> Vec<NodeId> {
        nodes.iter().filter_map(|n| self.node(n, parent)).collect()
    }

    fn block(&mut self, block: &ast::Block) -> Vec<NodeId> {
        let scope_len = self.scope.len();
        self.let_declarations(&block.lets);
        let ids = self.nodes(&block.nodes, None);
        self.scope.truncate(scope_len);
        ids
    }

    fn guarded_block(&mut self, block: &ast::Block) -> Vec<NodeId> {
        self.guard_depth += 1;
        let ids = self.block(block);
        self.guard_depth -= 1;
        ids
    }

    fn node(&mut self, node: &ast::Node, parent: Option<Element>) -> Option<NodeId> {
        match &node.kind {
            ast::NodeKind::Element(e) => self.element(e, node.span, parent),
            ast::NodeKind::If(i) => Some(self.if_node(i, node.span)),
            ast::NodeKind::For(f) => Some(self.for_node(f, node.span)),
            ast::NodeKind::SlotFill(fill) => {
                self.error(
                    fill.name.span,
                    format!(
                        "slot fill `{}:` is only allowed directly inside a component call",
                        fill.name.name
                    ),
                );
                None
            }
            ast::NodeKind::Error => None,
        }
    }

    fn element(
        &mut self,
        e: &ast::ElementNode,
        span: Span,
        parent: Option<Element>,
    ) -> Option<NodeId> {
        let first = e.path.first()?;
        if e.path.len() > 1 {
            let name: Vec<&str> = e.path.iter().map(|i| i.name.as_str()).collect();
            let path_span = first.span.to(e.path[e.path.len() - 1].span);
            self.error(
                path_span,
                format!("unknown platform element `{}`", name.join(".")),
            );
            return None;
        }
        let name = first.name.as_str();
        if self.cx.is_probe(name) {
            let elements = BUILTIN_ELEMENTS.iter().map(Target::Element);
            let components = self
                .cx
                .visible_decls(self.file, |k| matches!(k, DeclKind::Component(_)));
            self.probe_locals(
                ProbeContext::Node,
                |k| matches!(k, LocalKind::Slot(_)),
                elements.chain(components).collect(),
            );
        }
        if let Some(local) = self.local(name) {
            self.cx.record(first.span, || self.local_target(local));
            let LocalKind::Slot(param) = local.kind else {
                self.error(
                    first.span,
                    format!("`{name}` is a value, not an element or component"),
                );
                return None;
            };
            if !e.args.is_empty() || e.children.is_some() {
                self.error(
                    span,
                    format!("slot `{name}` takes no arguments or children"),
                );
            }
            return Some(self.push_node(NodeKind::Slot { param }, span, 0..0));
        }
        if let Some(spec) = elements::element(name) {
            self.cx.record(first.span, || Target::Element(spec));
            self.check_parent(spec, parent, first.span);
            return Some(self.builtin_element(spec, e, span));
        }
        match self.cx.global(self.file, name, first.span, self.diags) {
            Some(DeclKind::Component(id)) if self.cx.components[id.index()].page.is_some() => {
                self.error(first.span, format!("page `{name}` cannot be used as a component; open it with `navigation.push`"));
                None
            }
            Some(DeclKind::Component(id)) => Some(self.component_call(id, e, span)),
            Some(kind) => {
                self.error(
                    first.span,
                    format!("`{name}` is {}, not an element or component", article(kind)),
                );
                None
            }
            None => {
                self.error(first.span, format!("unknown element or component `{name}`"));
                None
            }
        }
    }

    fn builtin_element(
        &mut self,
        spec: &'static ElementSpec,
        e: &ast::ElementNode,
        span: Span,
    ) -> NodeId {
        let props_spec: Vec<_> = spec.props.iter().chain(&CALL_HOOKS).collect();
        let has_children = e
            .children
            .as_ref()
            .is_some_and(|block| !block.nodes.is_empty());
        let slots: Vec<ArgSlot<'_>> = props_spec
            .iter()
            .map(|p| ArgSlot {
                name: p.name,
                positional: p.positional,
                required: if spec.content == Some(p.name) {
                    !has_children
                } else {
                    p.required
                },
            })
            .chain([ArgSlot {
                name: STYLE,
                positional: false,
                required: false,
            }])
            .collect();
        let mut matched = self.match_args(spec.name, &slots, e.args.iter(), span);
        let style_arg = matched.pop().flatten();
        self.record_args(args_span(e, span), &matched, |i| {
            let owner = (i < spec.props.len()).then_some(spec);
            Target::Prop {
                owner,
                prop: props_spec[i],
            }
        });

        let first_binding = self.bindings.len();
        let mut props = Vec::new();
        let style = style_arg.and_then(|arg| self.element_style(spec, arg));
        for (prop, arg) in props_spec.iter().zip(matched) {
            let Some(arg) = arg else {
                if let Some((style, span)) = style
                    && prop.is_style_property()
                    && let Some(index) = style
                        .declaration
                        .entries
                        .iter()
                        .position(|entry| entry.name.name == prop.name)
                {
                    let (value, uses_theme) = &style.values[index];
                    let expr = Expr {
                        span,
                        ..value.clone()
                    };
                    self.uses_theme |= uses_theme;
                    let expr = self.coerce_to(expr, &prop.prop_type().to_type());
                    let expr = self.check_float_literal(expr);
                    props.push(Prop {
                        name: prop.name,
                        value: PropValue::Expr(expr),
                        binding: None,
                        span,
                    });
                }
                continue;
            };
            if has_children && spec.content == Some(prop.name) {
                self.error(
                    arg.span,
                    format!(
                        "`{}` takes either `{}` or children, not both",
                        spec.name, prop.name
                    ),
                );
            }
            let (value, binding) = match prop.kind {
                PropKind::Value(ty) => {
                    let expr = self.expr_as(&arg.value, &ty.to_type());
                    let expr = self.check_float_literal(expr);
                    let deps = expr_deps(&expr);
                    if prop.constant && !expr.ty.has_error() {
                        let Expr { kind, ty, span } = expr;
                        let expr = match deps.is_empty().then(|| constant_kind(kind)).flatten() {
                            Some(kind) => Expr { kind, ty, span },
                            None => {
                                self.error(
                                    span,
                                    format!("`{}.{}` must be a constant", spec.name, prop.name),
                                );
                                error_expr(span)
                            }
                        };
                        (PropValue::Expr(expr), None)
                    } else {
                        let binding = self.bind(BindingKind::Prop(prop.name), deps);
                        (PropValue::Expr(expr), binding)
                    }
                }
                PropKind::Handler { payload } => {
                    let payload = payload.map(|ty| ty.to_type());
                    let Some((handler, deps)) =
                        self.handler(&arg.value, prop.name, payload.as_ref(), false)
                    else {
                        continue;
                    };
                    (
                        PropValue::Handler(handler),
                        self.bind(BindingKind::Handler(prop.name), deps),
                    )
                }
                PropKind::Lifecycle => {
                    let Some((handler, deps)) = self.handler(&arg.value, prop.name, None, true)
                    else {
                        continue;
                    };
                    (
                        PropValue::Handler(handler),
                        self.bind(BindingKind::Handler(prop.name), deps),
                    )
                }
            };
            props.push(Prop {
                name: prop.name,
                value,
                binding,
                span: arg.span,
            });
        }
        if spec.name == "Grid"
            && let Some(prop) = props.iter().find(|p| p.name == "columns")
            && matches!(&prop.value, PropValue::Expr(Expr { kind: ExprKind::Int(n), .. }) if *n < 1)
        {
            self.error(prop.span, "`Grid.columns` must be at least 1");
        }
        if matches!(spec.name, "List" | "Grid") {
            let count = e.children.as_ref().map_or(0, |block| {
                block
                    .nodes
                    .iter()
                    .filter(|n| matches!(n.kind, ast::NodeKind::For(_)))
                    .count()
            });
            if count != 1 {
                self.error(
                    span,
                    format!("`{}` needs exactly one `for` among its children", spec.name),
                );
            } else if let Some(block) = &e.children {
                for node in &block.nodes {
                    let ast::NodeKind::For(outer) = &node.kind else {
                        continue;
                    };
                    let inner_count = outer
                        .body
                        .nodes
                        .iter()
                        .filter(|n| matches!(n.kind, ast::NodeKind::For(_)))
                        .count();
                    if inner_count > 0 {
                        if spec.name == "Grid" {
                            self.error(node.span, "`Grid` does not support sections");
                        } else if inner_count != 1
                            || outer.body.nodes.len() < 2
                            || !matches!(
                                outer.body.nodes.last().map(|n| &n.kind),
                                Some(ast::NodeKind::For(_))
                            )
                        {
                            self.error(
                                node.span,
                                "a `List` section is header nodes followed by one `for`",
                            );
                        }
                    }
                }
            }
        }
        let own = first_binding..self.bindings.len();

        let children = e
            .children
            .as_ref()
            .map_or_else(Vec::new, |block| self.builtin_children(spec, block));
        let vertical_scroll = spec.name == "Scroll" && !props.iter().any(|p| {
            p.name == "direction" && matches!(&p.value, PropValue::Expr(Expr { kind: ExprKind::Str(value), .. }) if value == "horizontal")
        });
        if spec.name == "List" || vertical_scroll {
            let mut nested = Vec::new();
            for &child in &children {
                nested_lists(&self.nodes, child, &mut nested);
            }
            for span in nested {
                self.error(
                    span,
                    "`List` cannot be inside a vertical `Scroll` or another `List`",
                );
            }
        }
        self.push_node(
            NodeKind::Element {
                element: spec.element,
                props,
                children,
            },
            span,
            own,
        )
    }

    fn check_float_literal(&mut self, expr: Expr) -> Expr {
        if expr.ty == Type::Float {
            let mut literal = &expr;
            while let ExprKind::Unary {
                op: UnaryOp::Neg,
                expr,
            } = &literal.kind
            {
                literal = expr;
            }
            if matches!(literal.kind, ExprKind::Float(value) if !value.is_finite()) {
                self.error(
                    expr.span,
                    "floating-point literal is out of range for `Float`",
                );
                return error_expr(expr.span);
            }
        }
        expr
    }

    /// Returns whether `spec` can appear immediately under this built-in parent.
    fn check_parent(&mut self, spec: &ElementSpec, parent: Option<Element>, span: Span) -> bool {
        if spec.parents.is_empty() || parent.is_some_and(|parent| spec.parents.contains(&parent)) {
            return true;
        }
        self.error(
            span,
            format!(
                "`{}` must be a direct child of {}",
                spec.name,
                element_list(spec.parents)
            ),
        );
        false
    }

    fn direct_builtin(&self, node: &ast::Node) -> Option<(&'static ElementSpec, Span)> {
        let ast::NodeKind::Element(element) = &node.kind else {
            return None;
        };
        let [name] = element.path.as_slice() else {
            return None;
        };
        if self.local(&name.name).is_some() {
            return None;
        }
        Some((elements::element(&name.name)?, name.span))
    }

    fn builtin_children(&mut self, spec: &ElementSpec, block: &ast::Block) -> Vec<NodeId> {
        let parent = Some(spec.element);
        if spec.children == Children::None {
            // Still diagnose explicitly misplaced elements in a rejected block.
            let mut leaf_error = block.nodes.is_empty() || !block.lets.is_empty();
            for node in &block.nodes {
                match self.direct_builtin(node) {
                    Some((child, span)) => leaf_error |= self.check_parent(child, parent, span),
                    None => leaf_error = true,
                }
            }
            if leaf_error {
                self.error(
                    block.span,
                    format!("`{}` does not accept children", spec.name),
                );
            }
            return Vec::new();
        }
        for decl in &block.lets {
            self.error(
                decl.span,
                "`let` cannot be declared directly inside a built-in element",
            );
        }
        let scope_len = self.scope.len();
        self.let_declarations(&block.lets);
        let children = block
            .nodes
            .iter()
            .filter_map(|node| {
                if let Children::Only(allowed) = spec.children
                    && !matches!(node.kind, ast::NodeKind::Error)
                    && !self
                        .direct_builtin(node)
                        .is_some_and(|(child, _)| allowed.contains(&child.element))
                {
                    self.error(
                        node.span,
                        format!(
                            "`{}` only accepts {} as children",
                            spec.name,
                            element_list(allowed)
                        ),
                    );
                    return None;
                }
                self.node(node, parent)
            })
            .collect();
        self.scope.truncate(scope_len);
        children
    }

    fn element_style(
        &mut self,
        spec: &ElementSpec,
        arg: &ast::Arg,
    ) -> Option<(&'cx Style<'cx>, Span)> {
        let cx = self.cx;
        if matches!(arg.value.kind, ast::ExprKind::Error) {
            return None;
        }
        if let ast::ExprKind::Ident(name) = &arg.value.kind
            && arg.value.span.end - arg.value.span.start == offset(name.len())
        {
            if cx.is_probe(name) {
                cx.set_probe(
                    ProbeContext::Style,
                    cx.visible_decls(self.file, |kind| matches!(kind, DeclKind::Style(_))),
                );
            }
            if let Some(DeclKind::Style(id)) =
                cx.global(self.file, name, arg.value.span, self.diags)
            {
                let style = &cx.styles[id];
                for entry in &style.declaration.entries {
                    let property = &entry.name.name;
                    if !spec
                        .props
                        .iter()
                        .any(|p| p.name == property && p.is_style_property())
                        && elements::is_style_property(property)
                    {
                        self.error(
                            arg.span,
                            format!(
                                "style `{name}` sets `{property}`, which `{}` does not accept",
                                spec.name
                            ),
                        );
                    }
                }
                return Some((style, arg.span));
            }
        }
        self.error(arg.value.span, "`style` expects a style name");
        None
    }

    fn component_call(&mut self, id: ComponentId, e: &ast::ElementNode, span: Span) -> NodeId {
        let cx = self.cx;
        let callee = &cx.components[id.index()];
        self.instances.push(Instance {
            component: id,
            guarded: self.guard_depth > 0,
            span: e.path[0].span,
        });

        // Value and callback parameters are positional; lifecycle props follow.
        let params: Vec<(ParamId, &Param)> = callee
            .params
            .iter()
            .enumerate()
            .filter(|(_, p)| p.kind != ParamKind::Children)
            .map(|(i, p)| (ParamId(offset(i)), p))
            .collect();
        let mut slots: Vec<ArgSlot<'_>> = params
            .iter()
            .map(|(_, p)| ArgSlot {
                name: &p.name,
                positional: true,
                required: matches!(p.kind, ParamKind::Value(_)) && p.default.is_none(),
            })
            .collect();
        slots.extend(CALL_HOOKS.iter().map(|p| ArgSlot {
            name: p.name,
            positional: false,
            required: false,
        }));
        let has_style_param = params.iter().any(|(_, param)| param.name == STYLE);
        let is_style = |arg: &ast::Arg| arg.name.as_ref().is_some_and(|name| name.name == STYLE);
        let args = if has_style_param {
            e.args.iter().collect::<Vec<_>>()
        } else {
            for arg in e.args.iter().filter(|arg| is_style(arg)) {
                self.error(arg.span, "`style` only applies to built-in elements");
            }
            e.args
                .iter()
                .filter(|arg| !is_style(arg))
                .collect::<Vec<_>>()
        };
        let matched = self.match_args(&callee.name, &slots, args.into_iter(), span);
        self.record_args(args_span(e, span), &matched, |i| match params.get(i) {
            Some(&(param, _)) => Target::ComponentParam(id, param.index()),
            None => Target::Prop {
                owner: None,
                prop: &CALL_HOOKS[i - params.len()],
            },
        });

        let first_binding = self.bindings.len();
        let mut args = Vec::new();
        let mut props = Vec::new();
        for (index, arg) in matched.into_iter().enumerate() {
            let Some(arg) = arg else { continue };
            if let Some(&(param, spec)) = params.get(index) {
                let (value, deps) = match &spec.kind {
                    ParamKind::Value(ty) => {
                        let value = self.expr_as(&arg.value, ty);
                        let deps = expr_deps(&value);
                        (ArgValue::Expr(value), deps)
                    }
                    ParamKind::Callback { payload } => {
                        let Some((handler, deps)) =
                            self.handler(&arg.value, &spec.name, payload.as_ref(), false)
                        else {
                            continue;
                        };
                        (ArgValue::Callback(handler), deps)
                    }
                    ParamKind::Children => unreachable!("slots are filled by the child block"),
                };
                let binding = self.bind(BindingKind::Arg(param), deps);
                args.push(Arg {
                    param,
                    value,
                    binding,
                    span: arg.span,
                });
            } else {
                let name = CALL_HOOKS[index - params.len()].name;
                if let Some((handler, deps)) = self.handler(&arg.value, name, None, true) {
                    let binding = self.bind(BindingKind::Handler(name), deps);
                    props.push(Prop {
                        name,
                        value: PropValue::Handler(handler),
                        binding,
                        span: arg.span,
                    });
                }
            }
        }
        let own = first_binding..self.bindings.len();

        let slots = e
            .children
            .as_ref()
            .map_or_else(Vec::new, |block| self.slot_fills(id, block));
        self.push_node(
            NodeKind::Component {
                component: id,
                args,
                props,
                slots,
            },
            span,
            own,
        )
    }

    fn slot_fills(&mut self, id: ComponentId, block: &ast::Block) -> Vec<SlotFill> {
        let cx = self.cx;
        let callee = &cx.components[id.index()];
        let Some(first) = first_slot(&callee.params) else {
            self.diags.push(
                Diagnostic::error(
                    block.span,
                    format!("component `{}` does not accept children", callee.name),
                )
                .with_note("declare a parameter of type `Children` to accept a block"),
            );
            return Vec::new();
        };

        let has_default = block
            .nodes
            .iter()
            .any(|node| !matches!(node.kind, ast::NodeKind::SlotFill(_)));
        let scope_len = self.scope.len();
        self.let_declarations(&block.lets);
        let mut fills: Vec<SlotFill> = Vec::new();
        let mut default_children = Vec::new();
        for node in &block.nodes {
            let ast::NodeKind::SlotFill(fill) = &node.kind else {
                default_children.extend(self.node(node, None));
                continue;
            };
            let name = &fill.name.name;
            let available = || slot_params(&callee.params);
            if cx.is_probe(name) {
                let candidates = available()
                    .filter(|(param, slot)| {
                        !(has_default && *param == first)
                            && !block.nodes.iter().any(|node| {
                                matches!(&node.kind, ast::NodeKind::SlotFill(fill) if fill.name.name == slot.name)
                            })
                    })
                    .map(|(param, _)| Target::ComponentParam(id, param.index()))
                    .collect();
                cx.set_probe(ProbeContext::SlotFill, candidates);
            }
            let Some((param, _)) = available().find(|(_, param)| &param.name == name) else {
                self.error(
                    fill.name.span,
                    format!("`{}` has no slot `{name}`", callee.name),
                );
                continue;
            };
            cx.record(fill.name.span, || Target::ComponentParam(id, param.index()));
            if (has_default && param == first) || fills.iter().any(|fill| fill.param == param) {
                self.error(fill.name.span, format!("slot `{name}` is filled twice"));
                continue;
            }
            fills.push(SlotFill {
                param,
                children: self.block(&fill.block),
            });
        }
        self.scope.truncate(scope_len);
        if !default_children.is_empty() {
            fills.push(SlotFill {
                param: first,
                children: default_children,
            });
        }
        fills.sort_unstable_by_key(|fill| fill.param);
        fills
    }

    fn if_node(&mut self, node: &ast::IfNode, span: Span) -> NodeId {
        let first_binding = self.bindings.len();
        let conds: Vec<Expr> = node
            .branches
            .iter()
            .map(|b| self.expr_as(&b.cond, &Type::Bool))
            .collect();
        let mut deps = Vec::new();
        for cond in &conds {
            deps::collect(cond, &mut deps);
        }
        let binding = self.bind(BindingKind::Condition, deps);
        let own = first_binding..self.bindings.len();

        let mut branches: Vec<Branch> = conds
            .into_iter()
            .zip(&node.branches)
            .map(|(cond, b)| Branch {
                cond: Some(cond),
                children: self.guarded_block(&b.block),
            })
            .collect();
        if let Some(block) = &node.else_block {
            branches.push(Branch {
                cond: None,
                children: self.guarded_block(block),
            });
        }
        self.push_node(NodeKind::If { branches, binding }, span, own)
    }

    fn for_node(&mut self, node: &ast::ForNode, span: Span) -> NodeId {
        let first_binding = self.bindings.len();
        let list = self.expr(&node.iter);
        let item_ty = match &list.ty {
            Type::Array(elem) => (**elem).clone(),
            Type::Error => Type::Error,
            other => {
                let found = self.type_name(other);
                self.error(
                    node.iter.span,
                    format!("`for` expects a list, found `{found}`"),
                );
                Type::Error
            }
        };
        let list_binding = self.bind(BindingKind::List, expr_deps(&list));

        let loop_id = LoopId(offset(self.loops.len()));
        self.loops.push(Loop {
            var: node.var.name.clone(),
            item_ty: item_ty.clone(),
            node: PENDING_NODE,
            slots: Vec::new(),
        });
        let scope_len = self.scope.len();
        self.declare(
            &node.var.name,
            LocalKind::Item(loop_id, item_ty),
            node.var.span,
        );

        let key = match &node.key {
            Some(key) => {
                let key = self.expr(key);
                if !matches!(
                    key.ty,
                    Type::Int | Type::String | Type::Union(_) | Type::Error
                ) {
                    let found = self.type_name(&key.ty);
                    self.error(
                        key.span,
                        format!("`for` key must be `Int` or `String`, found `{found}`"),
                    );
                }
                key
            }
            None => {
                let header = span.to(node.iter.span);
                self.diags.push(
                    Diagnostic::error(header, "`for` requires a key")
                        .with_label(format!("add `; key = {}.<id>`", node.var.name))
                        .with_note("keys identify items so list updates can move nodes instead of recreating them"),
                );
                error_expr(header)
            }
        };
        let key_binding = self.bind(BindingKind::Key, expr_deps(&key));
        let own = first_binding..self.bindings.len();

        let children = self.guarded_block(&node.body);
        self.scope.truncate(scope_len);
        let id = self.push_node(
            NodeKind::For {
                loop_id,
                list,
                key,
                children,
                list_binding,
                key_binding,
            },
            span,
            own,
        );
        self.loops[loop_id.index()].node = id;
        id
    }

    /// Matches call arguments to parameters, reporting every mismatch.
    pub(super) fn match_args<'a>(
        &mut self,
        callee: &str,
        params: &[ArgSlot<'_>],
        args: impl Iterator<Item = &'a ast::Arg>,
        span: Span,
    ) -> Vec<Option<&'a ast::Arg>> {
        let mut out: Vec<Option<&ast::Arg>> = vec![None; params.len()];
        let positional: Vec<usize> = (0..params.len())
            .filter(|&i| params[i].positional)
            .collect();
        let mut next_positional = 0;
        let mut seen_named = false;
        for arg in args {
            let index = match &arg.name {
                None if seen_named => {
                    self.error(arg.span, "positional argument after a named argument");
                    continue;
                }
                None => {
                    let Some(&index) = positional.get(next_positional) else {
                        let n = positional.len();
                        let plural = if n == 1 { "" } else { "s" };
                        self.error(
                            arg.span,
                            format!("`{callee}` takes {n} positional argument{plural}"),
                        );
                        continue;
                    };
                    next_positional += 1;
                    index
                }
                Some(name) => {
                    seen_named = true;
                    let Some(index) = params.iter().position(|p| p.name == name.name) else {
                        self.error(
                            name.span,
                            format!("`{callee}` has no argument named `{}`", name.name),
                        );
                        continue;
                    };
                    index
                }
            };
            if out[index].is_some() {
                self.error(
                    arg.span,
                    format!("argument `{}` is given more than once", params[index].name),
                );
                continue;
            }
            out[index] = Some(arg);
        }
        for (param, arg) in params.iter().zip(&out) {
            if param.required && arg.is_none() {
                self.error(
                    span,
                    format!("missing argument `{}` for `{callee}`", param.name),
                );
            }
        }
        out
    }

    /// Records named arguments matched to `targets` (by slot index) and the
    /// argument list as a call site.
    pub(super) fn record_args(
        &self,
        args_span: Span,
        matched: &[Option<&ast::Arg>],
        targets: impl Fn(usize) -> Target,
    ) {
        if !self.cx.recording() {
            return;
        }
        for (index, arg) in matched.iter().enumerate() {
            if let Some(name) = arg.and_then(|a| a.name.as_ref()) {
                self.cx.record(name.span, || targets(index));
            }
        }
        self.cx.record_call(|| RawCall {
            args: args_span,
            params: (0..matched.len()).map(&targets).collect(),
            given: matched.iter().map(Option::is_some).collect(),
        });
    }
}

/// From the end of the element's name to its children block or end.
fn args_span(e: &ast::ElementNode, span: Span) -> Span {
    let start = e.path.last().map_or(span.start, |p| p.span.end);
    let end = e.children.as_ref().map_or(span.end, |b| b.span.start);
    Span::new(span.file, start, end.max(start))
}

fn element_list(elements: &[Element]) -> String {
    let Some((last, others)) = elements.split_last() else {
        return "no elements".to_owned();
    };
    let mut list = String::new();
    for (index, &element) in others.iter().enumerate() {
        if index != 0 {
            list.push_str(", ");
        }
        list.push('`');
        list.push_str(element.name());
        list.push('`');
    }
    if !others.is_empty() {
        list.push_str(" or ");
    }
    list.push('`');
    list.push_str(last.name());
    list.push('`');
    list
}

fn expr_deps(expr: &Expr) -> Vec<Dep> {
    let mut deps = Vec::new();
    deps::collect(expr, &mut deps);
    deps
}
