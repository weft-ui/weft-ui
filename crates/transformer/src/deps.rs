//! Dependency analysis: which model fields, states and loop items each binding
//! reads, and the dirty-bit layout that maps them to update triggers.

use weft_ui_ast::span::offset;

use crate::ir::{
    Component, Dep, DepRoot, Expr, ExprKind, FieldId, InterpPart, LoopId, Model, ModelId, ParamId,
    ParamKind, SlotRef, StateId, Type,
};

/// Appends every dependency of `expr` to `out` (unnormalized).
pub(crate) fn collect(expr: &Expr, out: &mut Vec<Dep>) {
    if let Some(path) = path(expr) {
        out.push(path.dep);
        return;
    }
    match &expr.kind {
        ExprKind::Int(_)
        | ExprKind::Float(_)
        | ExprKind::Bool(_)
        | ExprKind::Null
        | ExprKind::Str(_)
        | ExprKind::Theme(_)
        | ExprKind::LambdaArg
        | ExprKind::Error => {}
        // Roots and fields are always handled by `path`.
        ExprKind::Param(_) | ExprKind::State(_) | ExprKind::Item(_) => {
            unreachable!("roots always form a path")
        }
        ExprKind::Field { base, .. } => collect(base, out),
        ExprKind::Interp(parts) => {
            for part in parts {
                if let InterpPart::Expr(e) = part {
                    collect(e, out);
                }
            }
        }
        ExprKind::Member { recv, args, .. } => {
            collect(recv, out);
            for arg in args {
                collect(arg, out);
            }
        }
        ExprKind::Unary { expr, .. } | ExprKind::Coerce { expr, .. } => collect(expr, out),
        ExprKind::Binary { lhs, rhs, .. } => {
            collect(lhs, out);
            collect(rhs, out);
        }
        ExprKind::If { cond, then, else_ } => {
            collect(cond, out);
            collect(then, out);
            collect(else_, out);
        }
    }
}

struct Path {
    dep: Dep,
    /// The path may still be extended by a field access (it ends at a
    /// non-optional model).
    open: bool,
}

/// The longest trackable path an expression reads, if it is a field chain.
fn path(expr: &Expr) -> Option<Path> {
    let root = match &expr.kind {
        ExprKind::Param(p) => DepRoot::Param(*p),
        ExprKind::State(s) => DepRoot::State(*s),
        ExprKind::Item(l) => DepRoot::Item(*l),
        ExprKind::Field { base, field, safe } => {
            let mut base = path(base)?;
            if base.open && !safe {
                base.dep.path.push(*field);
                base.open = matches!(expr.ty, Type::Model(_));
            } else {
                base.open = false;
            }
            return Some(base);
        }
        _ => return None,
    };
    Some(Path {
        dep: Dep {
            root,
            path: Vec::new(),
        },
        open: matches!(expr.ty, Type::Model(_)),
    })
}

/// Sorts, deduplicates, and drops dependencies covered by a shorter prefix.
pub(crate) fn normalize(deps: &mut Vec<Dep>) {
    deps.sort();
    deps.dedup();
    // After sorting, a prefix sorts directly before the paths it covers.
    let mut kept: Vec<Dep> = Vec::with_capacity(deps.len());
    for dep in deps.drain(..) {
        let covered = kept
            .last()
            .is_some_and(|k| k.root == dep.root && dep.path.starts_with(&k.path));
        if !covered {
            kept.push(dep);
        }
    }
    *deps = kept;
}

/// Expands a root of type `ty` into its leaf slots: fields of non-optional
/// models are flattened, everything else is a single slot.
///
/// `visiting` breaks cycles on invalid recursive models (reported separately by
/// semantic analysis) so dependency layout never overflows the stack.
fn flatten(dep: Dep, ty: &Type, models: &[Model], visiting: &mut Vec<ModelId>, out: &mut Vec<Dep>) {
    match ty {
        Type::Model(id) if !models[id.index()].fields.is_empty() && !visiting.contains(id) => {
            visiting.push(*id);
            for (index, field) in models[id.index()].fields.iter().enumerate() {
                let mut child = dep.clone();
                child.path.push(FieldId(offset(index)));
                flatten(child, &field.ty, models, visiting, out);
            }
            visiting.pop();
        }
        _ => out.push(dep),
    }
}

/// Assigns dirty-bit slots to the component and each loop, then resolves every
/// binding's dependencies to the bits that trigger it.
pub(crate) fn layout(component: &mut Component, models: &[Model]) {
    let mut visiting = Vec::new();
    let roots = component
        .params
        .iter()
        .enumerate()
        .filter_map(|(i, param)| match &param.kind {
            ParamKind::Value(ty) if *ty != Type::Error => {
                Some((DepRoot::Param(ParamId(offset(i))), ty))
            }
            _ => None,
        })
        .chain(
            component
                .states
                .iter()
                .enumerate()
                .map(|(i, state)| (DepRoot::State(StateId(offset(i))), &state.ty)),
        );
    let mut slots = Vec::new();
    for (root, ty) in roots {
        flatten(
            Dep {
                root,
                path: Vec::new(),
            },
            ty,
            models,
            &mut visiting,
            &mut slots,
        );
    }
    component.slots = slots;

    for index in 0..component.loops.len() {
        let root = DepRoot::Item(LoopId(offset(index)));
        let mut slots = Vec::new();
        let ty = component.loops[index].item_ty.clone();
        flatten(
            Dep {
                root,
                path: Vec::new(),
            },
            &ty,
            models,
            &mut visiting,
            &mut slots,
        );
        component.loops[index].slots = slots;
    }

    let mut bindings = std::mem::take(&mut component.bindings);
    for binding in &mut bindings {
        let mut bits = Vec::new();
        for dep in &binding.deps {
            let (table, make): (&[Dep], &dyn Fn(u32) -> SlotRef) = match dep.root {
                DepRoot::Item(l) => (&component.loops[l.index()].slots, &move |i| {
                    SlotRef::Loop(l, i)
                }),
                _ => (&component.slots, &SlotRef::Component),
            };
            bits.extend(
                table
                    .iter()
                    .enumerate()
                    .filter(|(_, slot)| slot.root == dep.root && slot.path.starts_with(&dep.path))
                    .map(|(i, _)| make(offset(i))),
            );
        }
        bits.sort();
        bits.dedup();
        binding.bits = bits;
    }
    component.bindings = bindings;
}
