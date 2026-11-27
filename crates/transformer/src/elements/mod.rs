//! The built-in element catalog and its accepted properties.

mod catalog;

pub use catalog::Element;
pub(crate) use catalog::{CSS, CSS_PROPS, ELEMENTS, FEATURES, Level};

use crate::ir::Type;
use crate::protocol::Platform;

/// Value type of an element property.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PropType {
    Int,
    Float,
    Bool,
    String,
    Color,
    Strings,
    Union(&'static [&'static str]),
}

impl PropType {
    pub(crate) fn to_type(self) -> Type {
        match self {
            Self::Int => Type::Int,
            Self::Float => Type::Float,
            Self::Bool => Type::Bool,
            Self::String => Type::String,
            Self::Color => Type::Color,
            Self::Strings => Type::Array(Box::new(Type::String)),
            Self::Union(values) => {
                Type::Union(values.iter().map(|value| (*value).to_owned()).collect())
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PropKind {
    Value(PropType),
    /// Event handler; the payload is the value the element produces.
    Handler {
        payload: Option<PropType>,
    },
    /// `onMount` / `onUnmount`: accepts events only.
    Lifecycle,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct Css<'a> {
    pub properties: &'a [&'a str],
    pub unit: CssUnit<'a>,
    pub target: CssTarget,
}

/// Conversion of a property value to CSS.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CssUnit<'a> {
    Px,
    Number,
    Color,
    Percent,
    Font,
    Keyword(&'a [(&'a str, &'a str)]),
    Custom(CustomCss),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CssTarget {
    Node,
    Inner,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CustomCss {
    Hidden,
    MaxLines,
    Shadow,
    Grow,
    Fill,
    Border,
    Spacer,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct PropSpec {
    pub name: &'static str,
    pub kind: PropKind,
    pub positional: bool,
    pub required: bool,
    pub constant: bool,
    pub css: Option<usize>,
    pub controlled_by: Option<&'static str>,
    pub runtime_event: bool,
    pub support: &'static [(Platform, Level)],
}

impl PropSpec {
    /// Whether a style can supply this property as a default.
    pub(crate) fn is_style_property(&self) -> bool {
        !self.positional && matches!(self.kind, PropKind::Value(_))
    }

    /// Declared value type of a built-in element property.
    pub(crate) fn prop_type(&self) -> PropType {
        let PropKind::Value(ty) = self.kind else {
            unreachable!("`{}` is not a value property", self.name);
        };
        ty
    }
}

/// Lifecycle props accepted by every element and component call.
pub(crate) const LIFECYCLE: [PropSpec; 2] = [
    PropSpec {
        name: "onMount",
        kind: PropKind::Lifecycle,
        positional: false,
        required: false,
        constant: false,
        css: None,
        controlled_by: None,
        runtime_event: false,
        support: &[],
    },
    PropSpec {
        name: "onUnmount",
        kind: PropKind::Lifecycle,
        positional: false,
        required: false,
        constant: false,
        css: None,
        controlled_by: None,
        runtime_event: false,
        support: &[],
    },
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Children {
    Any,
    None,
    #[allow(dead_code, reason = "the catalog may not restrict child element types")]
    Only(&'static [Element]),
}

#[derive(Debug)]
pub(crate) struct ElementSpec {
    pub element: Element,
    pub name: &'static str,
    pub props: &'static [PropSpec],
    pub children: Children,
    pub page_root: bool,
    pub parents: &'static [Element],
    pub content: Option<&'static str>,
    pub support: &'static [(Platform, Level)],
}

impl ElementSpec {
    pub(crate) fn prop(&self, name: &str) -> Option<&'static PropSpec> {
        self.props.iter().find(|prop| prop.name == name)
    }
}

impl Element {
    pub(crate) fn spec(self) -> &'static ElementSpec {
        // The generator emits both the enum and its specs in schema order.
        &ELEMENTS[self as usize]
    }
}

pub(crate) fn element(name: &str) -> Option<&'static ElementSpec> {
    ELEMENTS.iter().find(|e| e.name == name)
}

pub(crate) fn is_style_property(name: &str) -> bool {
    ELEMENTS.iter().any(|element| {
        element
            .props
            .iter()
            .any(|prop| prop.name == name && prop.is_style_property())
    })
}
