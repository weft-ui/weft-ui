//! The WeChat sink's table embedded in `view.js`: for every layout template, the
//! data keys of its value slots, event slots and mount points.
//!
//! Entry fields, all optional:
//!
//! | Field | Value                                                          |
//! | ----- | -------------------------------------------------------------- |
//! | `n`   | WXML template rendering a component body as the view's root     |
//! | `t`   | WXML template of slot content, stored in the scope's data as `t` |
//! | `i`   | branch index of an `if` branch template                        |
//! | `v`   | `[key]` for a raw value slot or `[key, cssIndex]` for CSS declarations |
//! | `e`   | `[key, controlled value slot or -1]` per event slot; the key holds the handler id |
//! | `p`   | key per mount point; `[indexKey, dataKey]` for branches         |
//! | `d`   | constants that cannot be inlined into WXML, by key             |
//! | `q`   | picker bindings: label, selected index, options and optional placeholder keys |

use std::collections::BTreeMap;
use std::fmt;

use crate::bridge::js::{self, Code};
use crate::elements::Element;
use crate::ir::{NodeKind, Program, Prop};
use crate::view::{PointKind, Template, TemplateKind, ViewLayout, ViewNodeKind};

use super::elements::{
    Target, event_key, image_key, image_layout, needs_data, picker_label_key, target, value_key,
};
use super::wxml::{slot_key, slot_template};

/// The table object literal passed to the view runtime.
pub(crate) fn object(program: &Program, layout: &ViewLayout) -> (String, bool) {
    let mut out = Code::default();
    out.open("{");
    out.line(format!("hash: \"{:016x}\",", layout.hash()));
    if !layout.theme().is_empty() {
        let names = fmt::from_fn(|out| {
            for (i, (name, _, _)) in layout.theme().iter().enumerate() {
                if i != 0 {
                    out.write_str(", ")?;
                }
                write!(out, "\"{name}\"")?;
            }
            Ok(())
        });
        out.line(format!("theme: [{names}],"));
    }
    out.open("templates: [");
    let mut needs_assets = false;
    for template in layout.templates() {
        out.line(format!("{},", entry(program, template, &mut needs_assets)));
    }
    out.close("],");
    out.close("}");
    let mut text = String::new();
    out.write_to(&mut text);
    (text, needs_assets)
}

fn entry(program: &Program, template: &Template, needs_assets: &mut bool) -> String {
    let comp = program.component(template.component);
    let props_of = |local: u32| -> (&[Prop], _) {
        let source = template.nodes[local as usize].source;
        match &comp.node(source).kind {
            NodeKind::Element { element, props, .. } => (props.as_slice(), (*element, source)),
            _ => unreachable!("slots and events belong to elements"),
        }
    };
    let index_of = |props: &[Prop], name: &str| {
        props
            .iter()
            .position(|p| p.name == name)
            .expect("layout properties exist in the IR")
    };

    let mut fields = Vec::new();
    match template.kind {
        TemplateKind::Component | TemplateKind::Page => {
            fields.push(format!("n: {}", js::string(&comp.name)));
        }
        TemplateKind::SlotContent { node, param } => {
            fields.push(format!(
                "t: {}",
                js::string(&slot_template(program, comp, node, param))
            ));
        }
        TemplateKind::Branch { index, .. } => fields.push(format!("i: {index}")),
        TemplateKind::Row { .. } => {}
    }
    if matches!(template.kind, TemplateKind::Page) {
        for (local, node) in template.nodes.iter().enumerate() {
            let ViewNodeKind::Element {
                element: Element::NavBar,
                props,
                ..
            } = &node.kind
            else {
                continue;
            };
            if let Some(slot) = template
                .values
                .iter()
                .find(|slot| slot.node as usize == local && slot.prop == "title")
            {
                let (ir_props, (_, source)) = props_of(slot.node);
                let key = value_key(source, index_of(ir_props, "title"));
                fields.push(format!("bar: {{ key: \"{key}\" }}"));
            } else if let Some(prop) = props.iter().find(|prop| prop.name == "title") {
                fields.push(format!("bar: {{ title: {} }}", prop.value));
            }
            break;
        }
    }
    let mut picker_indices = BTreeMap::new();
    let mut pickers = Vec::new();
    for node in &template.nodes {
        let NodeKind::Element {
            element: Element::Picker,
            props,
            ..
        } = &comp.node(node.source).kind
        else {
            continue;
        };
        let label = picker_label_key(node.source);
        let selected = value_key(node.source, index_of(props, "selected"));
        let options = value_key(node.source, index_of(props, "options"));
        let placeholder = fmt::from_fn(|out| {
            if let Some(index) = props.iter().position(|prop| prop.name == "placeholder") {
                write!(out, ", \"{}\"", value_key(node.source, index))
            } else {
                Ok(())
            }
        });
        picker_indices.insert(node.source.0, pickers.len());
        pickers.push(format!(
            "[\"{label}\", \"{selected}\", \"{options}\"{placeholder}]"
        ));
    }
    if !pickers.is_empty() {
        fields.push(format!("q: [{}]", pickers.join(", ")));
    }
    if !template.values.is_empty() {
        let values: Vec<String> = template
            .values
            .iter()
            .map(|slot| {
                let (props, (element, source)) = props_of(slot.node);
                let key = value_key(source, index_of(props, slot.prop));
                let target = target(element, slot.prop);
                if let Target::Style(index) = target {
                    format!("[\"{key}\", {index}]")
                } else if matches!(target, Target::ImageSource) {
                    *needs_assets = true;
                    if image_layout(props).is_some() {
                        format!("[\"{key}\", \"src\", \"{}\"]", image_key(source))
                    } else {
                        format!("[\"{key}\", \"src\"]")
                    }
                } else if matches!(target, Target::ImageFit) {
                    format!("[\"{key}\", \"fit\"]")
                } else if element == Element::Picker
                    && matches!(slot.prop, "selected" | "options" | "placeholder")
                {
                    let picker = picker_indices[&source.0];
                    format!("[\"{key}\", null, {picker}]")
                } else {
                    format!("[\"{key}\"]")
                }
            })
            .collect();
        fields.push(format!("v: [{}]", values.join(", ")));
    }
    if !template.events.is_empty() {
        let events: Vec<String> = template
            .events
            .chunk_by(|left, right| left.node == right.node)
            .flat_map(|slots| {
                let (_, (element, node)) = props_of(slots[0].node);
                slots.iter().enumerate().map(move |(k, slot)| {
                    let key = event_key(node, k);
                    let controls = slot.controls.map_or(-1, i64::from);
                    let hint = match element {
                        Element::TextArea => ", \"textarea\"",
                        Element::Picker => ", \"number\"",
                        _ => "",
                    };
                    format!("[\"{key}\", {controls}{hint}]")
                })
            })
            .collect();
        fields.push(format!("e: [{}]", events.join(", ")));
    }
    if !template.points.is_empty() {
        let points: Vec<String> = template
            .points
            .iter()
            .map(|point| {
                let node = template.nodes[point.node as usize].source;
                let n = node.0;
                match point.kind {
                    PointKind::Branch { .. } => format!("[\"i{n}\", \"b{n}\"]"),
                    PointKind::List { .. } => format!("\"l{n}\""),
                    PointKind::Instance { .. } => format!("\"c{n}\""),
                    PointKind::Slot => {
                        let NodeKind::Slot { param } = comp.node(node).kind else {
                            unreachable!("slot point belongs to a slot node");
                        };
                        js::string(&slot_key(comp, node, param))
                    }
                }
            })
            .collect();
        fields.push(format!("p: [{}]", points.join(", ")));
    }
    let mut data = Vec::new();
    let mut local_assets = Vec::new();
    let mut tracks_images = false;
    for (local, node) in template.nodes.iter().enumerate() {
        let ViewNodeKind::Element { element, props, .. } = &node.kind else {
            continue;
        };
        let local = u32::try_from(local).expect("node indices fit in u32");
        let (ir_props, (_, source)) = props_of(local);
        tracks_images |= *element == Element::Image && image_layout(ir_props).is_some();
        for prop in props {
            let target = target(*element, prop.name);
            if !needs_data(target, &prop.value) {
                continue;
            }
            let key = value_key(source, index_of(ir_props, prop.name));
            if matches!(target, Target::ImageSource)
                && matches!(&prop.value, crate::view::Constant::String(s) if s.starts_with("asset:"))
            {
                local_assets.push(format!("{key}: {}", prop.value));
            } else {
                data.push(format!("{key}: {}", prop.value));
            }
        }
    }
    if !data.is_empty() {
        fields.push(format!("d: {{ {} }}", data.join(", ")));
    }
    if !local_assets.is_empty() {
        *needs_assets = true;
        fields.push(format!("a: {{ {} }}", local_assets.join(", ")));
    }
    if tracks_images {
        fields.push("m: true".to_owned());
    }
    format!("{{ {} }}", fields.join(", "))
}
