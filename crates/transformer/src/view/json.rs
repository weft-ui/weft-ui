use std::fmt::{self, Write as _};

use super::{Constant, PointKind, Template, TemplateKind, ViewLayout, ViewNode, ViewNodeKind};

impl ViewLayout {
    /// Hash of the layout, compared at startup by the logic and view layers
    /// so a mismatched JS bundle and native project fail loudly.
    #[must_use]
    pub fn hash(&self) -> u64 {
        self.hash
    }

    /// Whether the app asks the host to keep root content inside the safe area.
    #[must_use]
    pub fn safe_area(&self) -> bool {
        self.safe_area
    }

    /// The layout as JSON, consumed by JS tools such as the headless renderer.
    #[must_use]
    pub fn to_json(&self) -> String {
        self.templates_json(Some(self.hash))
    }

    pub(super) fn templates_json(&self, hash: Option<u64>) -> String {
        let mut out = Json::default();
        out.open('{');
        if let Some(hash) = hash {
            out.key("hash");
            out.string(&format!("{hash:016x}"));
        }
        if let Some(start) = self.app {
            out.key("app");
            out.inline(&format!("{{\"start\": {}}}", start.0));
        }
        out.key("safeArea");
        out.inline(if self.safe_area { "true" } else { "false" });
        if let Some(colors) = &self.theme {
            out.key("theme");
            out.open('{');
            for (name, light, dark) in colors {
                out.key(name);
                out.inline(&format!(
                    "[\"{}\", \"{}\"]",
                    light.rgba_hex(),
                    dark.rgba_hex()
                ));
            }
            out.close('}');
        }
        out.key("templates");
        out.open('[');
        for template in &self.templates {
            out.item();
            template.write_json(&mut out);
        }
        out.close(']');
        out.close('}');
        out.text.push('\n');
        out.text
    }
}

impl Template {
    fn write_json(&self, out: &mut Json) {
        out.open('{');
        out.key("label");
        out.string(&self.label);
        out.key("kind");
        out.string(match self.kind {
            TemplateKind::Component => "component",
            TemplateKind::Page => "page",
            TemplateKind::Branch { .. } => "branch",
            TemplateKind::Row { .. } => "row",
            TemplateKind::SlotContent { .. } => "slot",
        });
        out.key("roots");
        out.inline(&numbers(&self.roots));
        out.key("nodes");
        out.open('[');
        for node in &self.nodes {
            out.item();
            out.inline(&node.json());
        }
        out.close(']');
        out.key("values");
        out.open('[');
        for slot in &self.values {
            out.item();
            out.inline(&format!(
                "{{\"node\": {}, \"prop\": {}, \"type\": {}}}",
                slot.node,
                quote(slot.prop),
                quote(slot.ty.as_str())
            ));
        }
        out.close(']');
        out.key("events");
        out.open('[');
        for slot in &self.events {
            out.item();
            let payload = slot
                .payload
                .map_or("null".to_owned(), |t| quote(t.as_str()));
            let controls = slot.controls.map_or("null".to_owned(), |c| c.to_string());
            out.inline(&format!(
                "{{\"node\": {}, \"event\": {}, \"payload\": {payload}, \"controls\": {controls}}}",
                slot.node,
                quote(slot.event)
            ));
        }
        out.close(']');
        out.key("points");
        out.open('[');
        for point in &self.points {
            out.item();
            let kind = match &point.kind {
                PointKind::Branch { templates } => {
                    let ids: Vec<u32> = templates.iter().map(|t| t.0).collect();
                    format!("\"kind\": \"branch\", \"templates\": {}", numbers(&ids))
                }
                PointKind::List { template } => {
                    format!("\"kind\": \"list\", \"template\": {}", template.0)
                }
                PointKind::Instance { template } => {
                    format!("\"kind\": \"instance\", \"template\": {}", template.0)
                }
                PointKind::Slot => "\"kind\": \"slot\"".to_owned(),
            };
            out.inline(&format!("{{\"node\": {}, {kind}}}", point.node));
        }
        out.close(']');
        out.close('}');
    }
}

impl ViewNode {
    fn json(&self) -> String {
        match &self.kind {
            ViewNodeKind::Element {
                element,
                props,
                children,
            } => {
                let props: Vec<String> = props
                    .iter()
                    .map(|p| format!("{}: {}", quote(p.name), p.value))
                    .collect();
                format!(
                    "{{\"element\": {}, \"props\": {{{}}}, \"children\": {}}}",
                    quote(element.name()),
                    props.join(", "),
                    numbers(children)
                )
            }
            ViewNodeKind::Point(index) => format!("{{\"point\": {index}}}"),
        }
    }
}

impl fmt::Display for Constant {
    /// JSON form of the constant.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Constant::Int(v) => write!(f, "{v}"),
            Constant::Float(v) => write!(f, "{v:?}"),
            Constant::Bool(v) => write!(f, "{v}"),
            Constant::String(s) => f.write_str(&quote(s)),
            Constant::Color(color) => write!(f, "\"{color}\""),
            Constant::Token(name) => write!(f, "\"@{name}\""),
        }
    }
}

/// Minimal pretty JSON writer: objects and arrays nest by indentation,
/// scalars and small records are written inline.
#[derive(Default)]
struct Json {
    text: String,
    depth: usize,
    /// Whether the current container already has an entry.
    started: Vec<bool>,
}

impl Json {
    fn open(&mut self, bracket: char) {
        self.text.push(bracket);
        self.depth += 1;
        self.started.push(false);
    }

    fn close(&mut self, bracket: char) {
        self.depth -= 1;
        if self.started.pop() == Some(true) {
            self.newline();
        }
        self.text.push(bracket);
    }

    fn newline(&mut self) {
        self.text.push('\n');
        for _ in 0..self.depth {
            self.text.push_str("  ");
        }
    }

    /// Starts an array entry.
    fn item(&mut self) {
        let started = self.started.last_mut().expect("inside a container");
        if *started {
            self.text.push(',');
        }
        *started = true;
        self.newline();
    }

    fn key(&mut self, key: &str) {
        self.item();
        self.text.push_str(&quote(key));
        self.text.push_str(": ");
    }

    fn string(&mut self, value: &str) {
        self.text.push_str(&quote(value));
    }

    fn inline(&mut self, json: &str) {
        self.text.push_str(json);
    }
}

fn numbers(values: &[u32]) -> String {
    let items: Vec<String> = values.iter().map(u32::to_string).collect();
    format!("[{}]", items.join(", "))
}

/// A JSON string literal.
fn quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if u32::from(c) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", u32::from(c));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// 64-bit FNV-1a: stable across platforms and toolchains.
pub(super) fn fnv1a(bytes: &[u8]) -> u64 {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    bytes
        .iter()
        .fold(OFFSET, |hash, &b| (hash ^ u64::from(b)).wrapping_mul(PRIME))
}
