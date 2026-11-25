//! Style generation shared by the Web and WeChat backends.

use std::fmt::{self, Write};

use crate::color::Color;
use crate::elements::{Css, CssUnit, CustomCss};
use crate::view::Constant;

/// Color references in static markup use the same variable as dynamic values.
pub(crate) fn theme_color(name: &str) -> impl fmt::Display + '_ {
    fmt::from_fn(move |out| write!(out, "var(--weft-{name})"))
}

/// CSS variables on the mini program view component, with system dark overrides.
pub(crate) fn theme_styles(colors: &[(String, Color, Color)]) -> String {
    if colors.is_empty() {
        return String::new();
    }
    fn declarations(
        out: &mut String,
        colors: &[(String, Color, Color)],
        color: impl Fn(Color, Color) -> Color,
    ) {
        // The page imports the stylesheet and styles the component host by class.
        // WXSS lifts `:host` declarations out of their media query.
        out.push_str(".w-root{");
        for (name, light, dark) in colors {
            let _ = write!(out, "--weft-{name}:{};", color(*light, *dark).rgba_hex());
        }
        out.push('}');
    }
    let mut out = String::new();
    declarations(&mut out, colors, |light, _| light);
    out.push_str("\n@media (prefers-color-scheme: dark){");
    declarations(&mut out, colors, |_, dark| dark);
    out.push_str("}\n");
    out
}

/// Clamp owns the inline display and overflow, so competing flags use classes.
pub(crate) fn text_clamp_class(has_clamp: bool, name: &str) -> Option<&'static str> {
    match (has_clamp, name) {
        (true, "hidden") => Some("w-text-hidden"),
        (true, "clip") => Some("w-text-clip"),
        _ => None,
    }
}

/// Converts a property into complete semicolon-separated CSS declarations.
pub(crate) fn declarations(css: Css<'_>, value: &Constant) -> String {
    let properties = css.properties;
    match css.unit {
        CssUnit::Custom(custom) => custom_declarations(custom, value),
        CssUnit::Px | CssUnit::Number | CssUnit::Percent => {
            let Some(mut number) = number(value) else {
                return String::new();
            };
            let suffix = match css.unit {
                CssUnit::Px => "px",
                CssUnit::Percent => {
                    number *= 100.0;
                    "%"
                }
                _ => "",
            };
            if !number.is_finite() {
                return String::new();
            }
            repeated(properties, format_args!("{}{suffix}", css_number(number)))
        }
        CssUnit::Keyword(keywords) => {
            let key = match value {
                Constant::Bool(true) => "true",
                Constant::Bool(false) => "false",
                Constant::String(key) => key.as_str(),
                _ => return String::new(),
            };
            let Some((_, mapped)) = keywords.iter().find(|(name, _)| *name == key) else {
                return String::new();
            };
            if mapped.is_empty() {
                String::new()
            } else {
                repeated(properties, mapped)
            }
        }
        CssUnit::Font => match value {
            Constant::String(family) if !family.is_empty() => repeated(
                properties,
                fmt::from_fn(|out| {
                    out.write_char('\'')?;
                    for c in family.chars() {
                        if c.is_control() || "\"'\\;&<>{}".contains(c) {
                            write!(out, "\\{:x} ", u32::from(c))?;
                        } else {
                            out.write_char(c)?;
                        }
                    }
                    out.write_char('\'')
                }),
            ),
            _ => String::new(),
        },
        CssUnit::Color => match value {
            Constant::Color(color) => repeated(properties, color),
            Constant::Token(name) => repeated(properties, theme_color(name)),
            Constant::String(color) if Color::parse(color).is_some() => repeated(properties, color),
            Constant::String(token) if token.strip_prefix('@').is_some_and(is_token_name) => {
                repeated(properties, theme_color(&token[1..]))
            }
            _ => repeated(properties, "transparent"),
        },
    }
}

fn repeated(properties: &[&str], value: impl fmt::Display) -> String {
    let Some((first, rest)) = properties.split_first() else {
        return String::new();
    };
    let mut out = format!("{first}:{value}");
    let value = first.len() + 1..out.len();
    for property in rest {
        let _ = write!(out, ";{property}:");
        out.extend_from_within(value.clone());
    }
    out
}

fn is_token_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn number(value: &Constant) -> Option<f64> {
    match value {
        Constant::Int(value) => Some(*value as f64),
        Constant::Float(value) if value.is_finite() => Some(*value),
        _ => None,
    }
}

fn css_number(value: f64) -> impl fmt::Display {
    fmt::from_fn(move |out| {
        let abs = value.abs();
        if value == 0.0 {
            out.write_char('0')
        } else if abs < 1e-6 {
            write!(out, "{value:e}")
        } else if abs >= 1e21 {
            // JavaScript includes the + on positive exponents.
            struct PositiveExponent<'a, 'b>(&'a mut fmt::Formatter<'b>);
            impl Write for PositiveExponent<'_, '_> {
                fn write_str(&mut self, text: &str) -> fmt::Result {
                    if let Some((significand, exponent)) = text.split_once('e') {
                        write!(self.0, "{significand}e+{exponent}")
                    } else {
                        self.0.write_str(text)
                    }
                }
            }
            write!(PositiveExponent(out), "{value:e}")
        } else {
            write!(out, "{value}")
        }
    })
}

fn custom_declarations(custom: CustomCss, value: &Constant) -> String {
    match custom {
        CustomCss::Hidden => {
            if matches!(value, Constant::Bool(true)) { "display:none" } else { "" }.to_owned()
        }
        CustomCss::MaxLines => number(value).filter(|number| *number > 0.0).map_or_else(String::new, |number| {
            format!("display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:{};overflow:hidden", css_number(number))
        }),
        CustomCss::Shadow => match value {
            Constant::String(size) => match size.as_str() {
                "none" => "box-shadow:none",
                "small" => "box-shadow:0 1px 3px #0000001f",
                "medium" => "box-shadow:0 4px 12px #00000026",
                "large" => "box-shadow:0 12px 32px #0000002e",
                _ => "",
            },
            _ => "",
        }.to_owned(),
        CustomCss::Grow => number(value).filter(|number| *number > 0.0).map_or_else(
            || "flex:0 1 auto".to_owned(),
            |number| format!("flex:{} 1 0px;min-width:0;min-height:0", css_number(number)),
        ),
        CustomCss::Fill => {
            if matches!(value, Constant::Bool(true)) {
                "align-self:stretch;justify-self:stretch"
            } else {
                "align-self:auto;justify-self:auto"
            }.to_owned()
        }
        CustomCss::Border => number(value).filter(|number| *number > 0.0).map_or_else(
            || "border-style:none".to_owned(),
            |number| format!("border-style:solid;border-width:{}px", css_number(number)),
        ),
        CustomCss::Spacer => number(value).map_or_else(String::new, |number| {
            format!("flex:0 0 {}px", css_number(number))
        }),
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum Edge {
    Padding,
    Margin,
}

impl Edge {
    /// The CSS longhands in top, right, bottom, left order.
    pub(crate) fn properties(self) -> &'static [&'static str; 4] {
        match self {
            Self::Padding => &[
                "padding-top",
                "padding-right",
                "padding-bottom",
                "padding-left",
            ],
            Self::Margin => &["margin-top", "margin-right", "margin-bottom", "margin-left"],
        }
    }
}

/// Winning Weft property for each edge, from the most specific to the shorthand.
pub(crate) fn edges(present: impl Fn(&str) -> bool, family: Edge) -> [&'static str; 4] {
    let (sides, axes, all) = match family {
        Edge::Padding => (
            ["paddingTop", "paddingEnd", "paddingBottom", "paddingStart"],
            ["paddingY", "paddingX"],
            "padding",
        ),
        Edge::Margin => (
            ["marginTop", "marginEnd", "marginBottom", "marginStart"],
            ["marginY", "marginX"],
            "margin",
        ),
    };
    std::array::from_fn(|i| {
        if present(sides[i]) {
            sides[i]
        } else if present(axes[i % 2]) {
            axes[i % 2]
        } else {
            all
        }
    })
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;
    use crate::elements::CssTarget;

    #[test]
    fn shared_css_corpus() {
        let corpus: Value = serde_json::from_str(include_str!("../../../protocol/corpus/css.json"))
            .expect("valid shared CSS corpus JSON");
        for case in corpus["cases"].as_array().expect("CSS corpus cases") {
            let source = &case["css"];
            let properties = if let Some(property) = source["property"].as_str() {
                vec![property]
            } else {
                source["properties"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|value| value.as_str().expect("CSS property name"))
                    .collect()
            };
            let keywords = source["keywords"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(key, value)| (key.as_str(), value.as_str().expect("CSS keyword mapping")))
                .collect::<Vec<_>>();
            let unit = match source["unit"].as_str().expect("CSS unit") {
                "px" => CssUnit::Px,
                "color" => CssUnit::Color,
                "number" => CssUnit::Number,
                "percent" => CssUnit::Percent,
                "font" => CssUnit::Font,
                "keyword" => CssUnit::Keyword(&keywords),
                "custom" => {
                    CssUnit::Custom(match source["custom"].as_str().expect("CSS custom name") {
                        "hidden" => CustomCss::Hidden,
                        "maxLines" => CustomCss::MaxLines,
                        "shadow" => CustomCss::Shadow,
                        "grow" => CustomCss::Grow,
                        "fill" => CustomCss::Fill,
                        "border" => CustomCss::Border,
                        "spacer" => CustomCss::Spacer,
                        name => panic!("unexpected CSS conversion {name}"),
                    })
                }
                unit => panic!("unexpected CSS unit {unit}"),
            };
            let css = Css {
                properties: &properties,
                unit,
                target: if source["target"] == "inner" {
                    CssTarget::Inner
                } else {
                    CssTarget::Node
                },
            };
            let value = match &case["value"] {
                Value::Bool(value) => Constant::Bool(*value),
                Value::String(value) => Constant::String(value.clone()),
                Value::Number(value) => value.as_i64().map_or_else(
                    || Constant::Float(value.as_f64().expect("CSS number")),
                    Constant::Int,
                ),
                value => panic!("unexpected CSS input {value}"),
            };
            assert_eq!(
                declarations(css, &value),
                case["out"].as_str().expect("CSS output"),
                "{case}"
            );
        }
    }

    #[test]
    fn uses_the_most_specific_edge_from_each_family() {
        let padding = [
            "padding",
            "paddingX",
            "paddingY",
            "paddingEnd",
            "paddingTop",
        ];
        assert_eq!(
            edges(|prop| padding.contains(&prop), Edge::Padding),
            ["paddingTop", "paddingEnd", "paddingY", "paddingX"]
        );
        let margin = ["margin", "marginBottom", "marginStart"];
        assert_eq!(
            edges(|prop| margin.contains(&prop), Edge::Margin),
            ["margin", "margin", "marginBottom", "marginStart"]
        );
    }
}
