//! TypeScript host binding: model classes with change-tracking setters, root
//! component classes with handler registration, and their declarations.

use std::collections::HashMap;

use weft_ui_ast::Span;

use crate::ir::{ComponentId, EventId, ModelId, Param, ParamKind, Program, Type};
use crate::transform::MappingKind;

use super::Mode;
use super::expr::{Env, expr};
use super::js::{self, Code, MappedLine};

/// Converter constants (`$c{n}`) turning host values into runtime values.
#[derive(Debug, Default)]
pub(crate) struct Converters {
    defs: Vec<String>,
    ids: HashMap<String, usize>,
}

impl Converters {
    /// JS function converting a host value of `ty`, or `None` for identity.
    fn of(&mut self, program: &Program, ty: &Type) -> Option<String> {
        let def = match ty {
            Type::Model(id) => return Some(format!("{}.from", model_binding(program, *id))),
            Type::Array(elem) => format!("$.arrayOf({})", self.or_id(program, elem)),
            Type::Optional(inner) => format!("$.optional({})", self.or_id(program, inner)),
            _ => return None,
        };
        let next = self.defs.len();
        let id = *self.ids.entry(def.clone()).or_insert(next);
        if id == next {
            self.defs.push(def);
        }
        Some(format!("$c{id}"))
    }

    fn or_id(&mut self, program: &Program, ty: &Type) -> String {
        self.of(program, ty).unwrap_or_else(|| "$.id".to_owned())
    }

    fn apply(&mut self, program: &Program, ty: &Type, value: &str) -> String {
        match self.of(program, ty) {
            Some(conv) => format!("{conv}({value})"),
            None => value.to_owned(),
        }
    }

    pub(crate) fn write(&self, out: &mut Code) {
        for (i, def) in self.defs.iter().enumerate() {
            out.line(format!("const $c{i} = {def};"));
        }
    }
}

fn model_binding(program: &Program, id: ModelId) -> String {
    js::binding(&program.model(id).name)
}

/// `export class` header, or a plain class when the name needs an alias.
fn class_header(name: &str) -> String {
    let local = js::binding(name);
    if local == name {
        format!("export class {name}")
    } else {
        format!("class {local}")
    }
}

pub(crate) fn model_class(program: &Program, id: ModelId, conv: &mut Converters, out: &mut Code) {
    let model = program.model(id);
    let local = js::binding(&model.name);
    out.open(format!("{} extends $.Model {{", class_header(&model.name)));
    let nested: Vec<String> = model
        .fields
        .iter()
        .enumerate()
        .filter(|(_, f)| match &f.ty {
            Type::Model(_) => true,
            Type::Optional(inner) => matches!(**inner, Type::Model(_)),
            _ => false,
        })
        .map(|(i, _)| i.to_string())
        .collect();
    if !nested.is_empty() {
        out.line(format!("static $m = [{}];", nested.join(", ")));
    }
    out.line(format!(
        "static from($v) {{ return $v instanceof {local} ? $v : new {local}($v); }}"
    ));
    let init: Vec<String> = model
        .fields
        .iter()
        .map(|f| {
            let read = if f.name == "__proto__" {
                format!("$v[{}]", js::string(&f.name))
            } else {
                format!("$v.{}", f.name)
            };
            conv.apply(program, &f.ty, &read)
        })
        .collect();
    out.line(format!(
        "constructor($v) {{ super([{}]); }}",
        init.join(", ")
    ));
    for (index, field) in model.fields.iter().enumerate() {
        let name = js::member_name(&field.name);
        out.line(format!("get {name}() {{ return this.$v[{index}]; }}"));
        let set = match conv.of(program, &field.ty) {
            Some(c) => format!("if ($v !== this.$v[{index}]) this.$set({index}, {c}($v));"),
            None => format!("this.$set({index}, $v);"),
        };
        out.line(format!("set {name}($v) {{ {set} }}"));
    }
    if !model.fields.iter().any(|field| field.name == "toJSON") {
        let fields: Vec<String> = model
            .fields
            .iter()
            .enumerate()
            .map(|(index, field)| format!("{}: this.$v[{index}]", js::object_key(&field.name)))
            .collect();
        out.line(format!(
            "toJSON() {{ return {{ {} }}; }}",
            fields.join(", ")
        ));
    }
    out.close("}");
}

pub(crate) fn app_class(
    program: &Program,
    id: ComponentId,
    mode: Mode<'_>,
    conv: &mut Converters,
    out: &mut Code,
) {
    let comp = program.component(id);
    out.open(format!("{} extends $.App {{", class_header(&comp.name)));
    let mut params = Vec::new();
    let mut args = Vec::new();
    for (index, param) in comp.params.iter().enumerate() {
        match &param.kind {
            ParamKind::Children => args.push("undefined".to_owned()),
            ParamKind::Callback { .. } => args.push("null".to_owned()),
            ParamKind::Value(ty) => {
                let name = format!("$p{index}");
                params.push(match &param.default {
                    Some(default) => format!("{name} = {}", expr(default, Env::default())),
                    None => name.clone(),
                });
                args.push(conv.apply(program, ty, &name));
            }
        }
    }
    // Remote views check that they were generated from the same layout.
    let hash = match mode {
        Mode::Dom(_, options) => {
            if !options.safe_area {
                out.line("static safeArea = false;");
            }
            String::new()
        }
        Mode::Remote(layout) => format!(", \"{:016x}\"", layout.hash()),
    };
    out.line(format!(
        "constructor({}) {{ super({}$c, [{}]{hash}); }}",
        params.join(", "),
        comp.name,
        args.join(", ")
    ));
    // Callback slots are internal to the view; the host sees the first value parameter.
    if comp
        .params
        .iter()
        .any(|p| matches!(p.kind, ParamKind::Callback { .. }))
    {
        match comp
            .params
            .iter()
            .position(|p| matches!(p.kind, ParamKind::Value(_)))
        {
            Some(0) => {}
            Some(index) => out.line(format!("get model() {{ return this.$args[{index}]; }}")),
            None => out.line("get model() { return undefined; }"),
        }
    }
    for &event in &comp.reachable_events {
        let name = &program.event(event).name;
        out.line(format!(
            "{}(h) {{ return this.$on({}, h); }}",
            js::handler_method(name),
            js::string(name)
        ));
    }
    out.close("}");
}

/* ---- declarations ------------------------------------------------------ */

/// TypeScript type of a DSL type.
pub(crate) fn ts_type(program: &Program, ty: &Type) -> String {
    match ty {
        Type::Int | Type::Float => "number".to_owned(),
        Type::Bool => "boolean".to_owned(),
        Type::String | Type::Color => "string".to_owned(),
        Type::Union(members) => {
            let mut out = String::new();
            for (index, member) in members.iter().enumerate() {
                if index != 0 {
                    out.push_str(" | ");
                }
                js::push_string(&mut out, member);
            }
            out
        }
        Type::Model(id) => model_binding(program, *id),
        Type::Array(elem) => match **elem {
            Type::Array(_) | Type::Optional(_) | Type::Union(_) => {
                format!("readonly ({})[]", ts_type(program, elem))
            }
            _ => format!("readonly {}[]", ts_type(program, elem)),
        },
        Type::Optional(inner) => format!("{} | null", ts_type(program, inner)),
        Type::Null | Type::Error => unreachable!("not a declared type"),
    }
}

/// `export {keyword} Name`, or `{keyword} name$` for a renamed binding,
/// exported by an alias list instead.
fn declared(keyword: &str, name: &str, original: Span) -> MappedLine {
    let line = if js::binding(name) == name {
        MappedLine::new().push("export ")
    } else {
        MappedLine::new()
    };
    line.push(keyword).push(" ").binding(name, original)
}

pub(crate) fn model_dts(program: &Program, id: ModelId, out: &mut Code) {
    let model = program.model(id);
    out.open_mapped(declared("interface", &model.name, model.span).push(" {"));
    for field in &model.fields {
        out.mapped_line(
            MappedLine::new()
                .map(&field.name, field.span, MappingKind::Verbatim)
                .push(&format!(": {};", ts_type(program, &field.ty))),
        );
    }
    out.close("}");
}

pub(crate) fn event_dts(program: &Program, id: EventId, out: &mut Code) {
    let event = program.event(id);
    let mut line = declared("type", &event.name, event.span).push(" = {");
    for (index, param) in event.params.iter().enumerate() {
        line = line
            .push(if index == 0 { " " } else { "; " })
            .map(&param.name, param.span, MappingKind::Verbatim)
            .push(&format!(": {}", ts_type(program, &param.ty)));
    }
    let end = if event.params.is_empty() { "};" } else { " };" };
    out.mapped_line(line.push(end));
}

pub(crate) fn app_dts(program: &Program, id: ComponentId, mode: Mode<'_>, out: &mut Code) {
    let comp = program.component(id);
    out.open_mapped(declared("declare class", &comp.name, comp.span).push(" {"));

    let value_params: Vec<(&Param, &Type)> = comp
        .params
        .iter()
        .filter_map(|p| match &p.kind {
            ParamKind::Value(ty) => Some((p, ty)),
            ParamKind::Children | ParamKind::Callback { .. } => None,
        })
        .collect();
    let mut constructor = MappedLine::new().push("constructor(");
    for (i, &(param, ty)) in value_params.iter().enumerate() {
        let ty = ts_type(program, ty);
        let required_later = value_params[i + 1..]
            .iter()
            .any(|(p, _)| p.default.is_none());
        let annotation = match (param.default.is_some(), required_later) {
            (false, _) => format!(": {ty}"),
            (true, false) => format!("?: {ty}"),
            (true, true) => format!(": {ty} | undefined"),
        };
        constructor = constructor
            .push(if i == 0 { "" } else { ", " })
            .binding(&param.name, param.span)
            .push(&annotation);
    }
    out.mapped_line(constructor.push(");"));
    let model = value_params
        .first()
        .map_or_else(|| "undefined".to_owned(), |p| ts_type(program, p.1));
    out.line("/** Value of the first parameter; event handlers receive the same object. */");
    out.line(format!("readonly model: {model};"));
    for &event in &comp.reachable_events {
        let event = program.event(event);
        let method = js::handler_method(&event.name);
        // Mappings stay within the module's own file.
        let line = if event.file == comp.file {
            MappedLine::new().map(&method, event.span, MappingKind::Atom)
        } else {
            MappedLine::new().push(&method)
        };
        out.mapped_line(line.push(&format!(
            "(handler: (model: {model}, event: {}) => void): () => void;",
            js::binding(&event.name)
        )));
    }
    out.line(format!(
        "$on(name: string, handler: (model: {model}, event: object) => unknown): () => void;"
    ));
    match mode {
        Mode::Dom(..) => out.line("mount(target: Node): void;"),
        Mode::Remote(_) => {
            out.line("/** Renders into a view sink, or a generated mini program view component, e.g. `page.selectComponent(\"#view\")`. */");
            out.line("mount(view: object): void;");
        }
    }
    out.line("unmount(): void;");
    out.close("}");
}
