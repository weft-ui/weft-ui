import { readFileSync } from "node:fs";

type Doc = { en: string; zh: string };
type Locale = keyof Doc;
type Member = Prop | Event;
type Children = "any" | "none" | string[];
type CssUnit = "px" | "number" | "color" | "percent" | "keyword" | "custom";

interface Css {
  unit: CssUnit;
  property?: string;
  properties?: string[];
  keywords?: Record<string, string>;
  custom?: string;
  target?: "inner";
}
type Level = "no" | "ignored";
type Support = Record<string, Level>;
type Platforms = ReadonlyMap<string, string>;

interface Documented {
  doc: Doc;
  support?: Support;
}

interface Prop extends Documented {
  name: string;
  type: string;
  positional?: boolean;
  required?: boolean;
  controlledBy?: string;
  constant?: boolean;
  default?: unknown;
  css?: Css;
  event?: never;
}

interface Event extends Documented {
  name: string;
  event: true;
  payload?: string | null;
  source?: "runtime";
}

interface Element extends Documented {
  name: string;
  groups?: string[];
  members?: Member[];
  memberSupport?: Record<string, Support>;
  children?: Children;
  parents?: string[];
  content?: string;
  pageRoot?: boolean;
}

interface Schema {
  unions?: Record<string, string[]>;
  groups?: Record<string, Member[]>;
  elements: Element[];
}

interface ExpandedElement extends Element {
  members: Member[];
  main: string | null;
}

interface LocatedMember {
  member: Member;
  path: string;
}

const header = "// Generated from protocol/weft.elements.json by protocol/elements.ts; do not edit.\n";
const propTypes = { Int: true, Float: true, Bool: true, String: true, Color: true, Strings: true };
const payloadTypes = { Int: true, Float: true, Bool: true, String: true };
const rustUnits = { px: "Px", number: "Number", color: "Color", percent: "Percent", font: "Font" };
const rustCustom = { hidden: "Hidden", maxLines: "MaxLines", shadow: "Shadow", grow: "Grow", fill: "Fill", border: "Border", spacer: "Spacer" };
const quote = JSON.stringify;
const pascal = (value: string): string => value[0].toUpperCase() + value.slice(1);
const snake = (value: string): string => value.replace(/(?!^)[A-Z]/g, (letter) => `_${letter}`).toLowerCase();

function invalid(path: string, message: string): never {
  throw new Error(`protocol/weft.elements.json: ${path}: ${message}`);
}

function unique(names: Set<string>, name: string, path: string): void {
  if (names.has(name)) invalid(path, `duplicate name ${quote(name)}`);
  names.add(name);
}

function locate(members: Member[], path: string): LocatedMember[] {
  return members.map((member, i) => ({ member, path: `${path}[${i}]` }));
}

function validateSupport(support: Support | undefined, path: string, platforms: Platforms): void {
  if (support === undefined) return;
  if (support === null || typeof support !== "object" || Array.isArray(support)) {
    invalid(path, "expected an object mapping platforms to support levels");
  }
  for (const [platform, level] of Object.entries(support)) {
    if (!platforms.has(platform)) invalid(`${path}.${platform}`, `unknown platform ${quote(platform)}`);
    if (level !== "no" && level !== "ignored") {
      invalid(`${path}.${platform}`, `expected \"no\" or \"ignored\", got ${quote(level)}`);
    }
  }
}

function validateCss(css: Css, path: string): void {
  if (css.unit !== "custom" && css.unit !== "keyword" && !Object.hasOwn(rustUnits, css.unit)) {
    invalid(`${path}.unit`, `unknown CSS unit ${quote(css.unit)}`);
  }
  if (css.target !== undefined && css.target !== "inner") invalid(`${path}.target`, "expected \"inner\"");
  if (css.unit === "custom") {
    if (css.custom === undefined || !Object.hasOwn(rustCustom, css.custom)) {
      invalid(`${path}.custom`, `unknown custom CSS conversion ${quote(css.custom)}`);
    }
    if (css.property !== undefined || css.properties !== undefined) invalid(path, "a custom conversion sets its own CSS properties");
  } else {
    const names = css.property === undefined ? css.properties : [css.property];
    if ((css.property !== undefined && css.properties !== undefined) || !Array.isArray(names) || names.length === 0 ||
      names.some((name) => typeof name !== "string" || !/^[a-z-][a-z0-9-]*$/.test(name))) {
      invalid(path, "expected one CSS property or a nonempty list of CSS properties");
    }
    if (css.custom !== undefined) invalid(`${path}.custom`, "expected the custom CSS unit");
  }
  if (css.unit === "keyword") {
    if (typeof css.keywords !== "object" || css.keywords === null || Array.isArray(css.keywords) ||
      Object.values(css.keywords).some((value) => typeof value !== "string" || /[:;{}\r\n]/.test(value))) {
      invalid(`${path}.keywords`, "expected a map of string keys to single-value CSS keywords");
    }
  } else if (css.keywords !== undefined) invalid(`${path}.keywords`, "expected the keyword CSS unit");
}

function validateMembers(members: LocatedMember[], unions: Record<string, string[]>, platforms: Platforms): void {
  const names = new Set<string>();
  for (const { member, path } of members) {
    unique(names, member.name, `${path}.name`);
    validateSupport(member.support, `${path}.support`, platforms);
    if (member.event) {
      if (member.source !== undefined && member.source !== "runtime") invalid(`${path}.source`, "expected runtime");
      if (member.payload != null && !Object.hasOwn(payloadTypes, member.payload)) {
        invalid(`${path}.payload`, `unknown event payload type ${quote(member.payload)}`);
      }
      continue;
    }
    if (!Object.hasOwn(propTypes, member.type) && !Object.hasOwn(unions, member.type)) {
      invalid(`${path}.type`, `unknown property type ${quote(member.type)}`);
    }
    if (member.css !== undefined) {
      validateCss(member.css, `${path}.css`);
      if (member.css.unit === "keyword" && Object.hasOwn(unions, member.type)) {
        const keywords = member.css.keywords!;
        for (const variant of unions[member.type]!) {
          if (!Object.hasOwn(keywords, variant)) {
            invalid(`${path}.css.keywords`, `missing keyword mapping for union member ${quote(variant)}`);
          }
        }
      }
    }
  }
}

function expand(schema: Schema, platforms: Platforms): ExpandedElement[] {
  const unions = schema.unions ?? {};
  for (const [name, values] of Object.entries(unions)) {
    const path = `unions.${name}`;
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) invalid(path, "expected a PascalCase union name");
    if (Object.hasOwn(propTypes, name)) {
      invalid(path, `duplicate name ${quote(name)}`);
    }
    if (!Array.isArray(values) || values.length === 0) invalid(path, "expected a nonempty union");
    const names = new Set<string>();
    for (const [i, value] of values.entries()) {
      const valuePath = `${path}[${i}]`;
      if (typeof value !== "string" || !/^[a-z][A-Za-z0-9]*$/.test(value)) {
        invalid(valuePath, "expected a lowerCamelCase union value");
      }
      unique(names, snake(value), valuePath);
    }
  }
  const groups = new Map<string, LocatedMember[]>();
  for (const [name, members] of Object.entries(schema.groups ?? {})) {
    const located = locate(members, `groups.${name}`);
    validateMembers(located, unions, platforms);
    groups.set(name, located);
  }

  const names = new Set<string>();
  for (const [i, { name }] of schema.elements.entries()) {
    unique(names, name, `elements[${i}].name`);
  }

  return schema.elements.map((element, i) => {
    const path = `elements[${i}]`;
    if (element.pageRoot !== undefined && typeof element.pageRoot !== "boolean") invalid(`${path}.pageRoot`, "expected a boolean");
    const members = (element.groups ?? []).flatMap((name, j) => {
      const group = groups.get(name);
      if (group === undefined) invalid(`${path}.groups[${j}]`, `unknown group ${quote(name)}`);
      return group;
    });
    members.push(...locate(element.members ?? [], `${path}.members`));
    validateSupport(element.support, `${path}.support`, platforms);
    validateMembers(members, unions, platforms);

    const overrides = element.memberSupport ?? {};
    for (const [name, support] of Object.entries(overrides)) {
      const overridePath = `${path}.memberSupport.${name}`;
      if (!members.some(({ member, path: memberPath }) => member.name === name && memberPath.startsWith("groups."))) {
        invalid(overridePath, `unknown group member ${quote(name)}`);
      }
      validateSupport(support, overridePath, platforms);
    }

    let main: Prop | undefined;
    for (const { member, path: memberPath } of members) {
      if (member.event) continue;
      if (member.positional) {
        if (main) invalid(`${memberPath}.positional`, `already has positional property ${quote(main.name)}`);
        main = member;
      }
      if (member.controlledBy !== undefined && !members.some(({ member: event }) =>
        event.event && event.name === member.controlledBy)) {
        invalid(`${memberPath}.controlledBy`, `unknown event ${quote(member.controlledBy)} on ${element.name}`);
      }
    }
    if (element.content !== undefined && element.content !== main?.name) {
      invalid(`${path}.content`, `${quote(element.content)} is not a positional property`);
    }
    for (const field of ["parents", "children"] as const) {
      const list = element[field];
      if (!Array.isArray(list)) continue;
      for (const [j, name] of list.entries()) {
        if (!names.has(name)) invalid(`${path}.${field}[${j}]`, `unknown element ${quote(name)}`);
      }
    }
    return {
      ...element,
      members: members.map(({ member }) => Object.hasOwn(overrides, member.name)
        ? { ...member, support: overrides[member.name] }
        : member),
      main: main?.name ?? null,
    };
  });
}

function rustSupport(support: Support | undefined, platforms: Platforms): string {
  const entries = Array.from(platforms).flatMap(([name, variant]) => {
    const level = support?.[name];
    return level ? [`(Platform::${variant}, Level::${level === "no" ? "No" : "Ignored"})`] : [];
  });
  return entries.length < 2 ? `&[${entries.join("")}]` : `&[\n            ${entries.join(",\n            ")},\n        ]`;
}

function rustMember(member: Member, platforms: Platforms, cssIndices: ReadonlyMap<Css, number>): string {
  const prop = member.event ? undefined : member;
  const kind = member.event
    ? member.payload == null
      ? "PropKind::Handler { payload: None }"
      : `PropKind::Handler {\n            payload: Some(PropType::${member.payload}),\n        }`
    : Object.hasOwn(propTypes, member.type)
      ? `PropKind::Value(PropType::${member.type})`
      : `PropKind::Value(PropType::Union(${snake(member.type).toUpperCase()}))`;
  return `    PropSpec {
        name: ${quote(member.name)},
        kind: ${kind},
        positional: ${prop?.positional ?? false},
        required: ${prop?.required ?? false},
        constant: ${prop?.constant ?? false},
        css: ${prop?.css === undefined ? "None" : `Some(${cssIndices.get(prop.css)})`},
        controlled_by: ${prop?.controlledBy === undefined ? "None" : `Some(${quote(prop.controlledBy)})`},
        runtime_event: ${member.event === true && member.source === "runtime"},
        support: ${rustSupport(member.support, platforms)},
    },`;
}

interface CssCatalog {
  mappings: Css[];
  indices: Map<Css, number>;
}

function collectCss(elements: ExpandedElement[]): CssCatalog {
  const mappings: Css[] = [];
  const indices = new Map<Css, number>();
  const seen = new Map<string, number>();
  for (const element of elements) {
    for (const member of element.members) {
      if (member.event || member.css === undefined || indices.has(member.css)) continue;
      const css = member.css;
      // Key order in schema objects is not meaningful. Property array order is.
      const key = quote([
        css.unit, css.property ?? css.properties, css.custom, css.target,
        css.keywords && Object.keys(css.keywords).sort().map((name) => [name, css.keywords![name]]),
      ]);
      let index = seen.get(key);
      if (index === undefined) {
        index = mappings.length;
        mappings.push(css);
        seen.set(key, index);
      }
      indices.set(css, index);
    }
  }
  return { mappings, indices };
}

function rustCss(css: Css): string {
  const properties = css.properties ?? (css.property === undefined ? [] : [css.property]);
  const props = properties.map((p) => quote(p)).join(", ");
  const list = props.length <= 60 ? `&[${props}]`
    : `&[\n${properties.map((p) => `            ${quote(p)},`).join("\n")}\n        ]`;
  let unit: string;
  if (css.unit === "keyword") {
    const keywords = Object.entries(css.keywords!).map(([name, value]) => `(${quote(name)}, ${quote(value)})`);
    unit = keywords.join(", ").length <= 70 ? `Keyword(&[${keywords.join(", ")}])`
      : `Keyword(&[\n${keywords.map((pair) => `            ${pair},`).join("\n")}\n        ])`;
  } else if (css.unit === "custom") unit = `Custom(CustomCss::${rustCustom[css.custom as keyof typeof rustCustom]})`;
  else unit = rustUnits[css.unit as keyof typeof rustUnits];
  return `    Css {
        properties: ${list},
        unit: CssUnit::${unit},
        target: CssTarget::${css.target === "inner" ? "Inner" : "Node"},
    },`;
}

function rustChildren(children: Children = "none"): string {
  if (children === "none") return "Children::None";
  if (children === "any") return "Children::Any";
  return `Children::Only(&[${children.map((name) => `Element::${name}`).join(", ")}])`;
}

function rust(
  elements: ExpandedElement[], platforms: Platforms,
  unions: Record<string, string[]>, css: CssCatalog, sheet: string,
): string {
  // Elements with identical expanded members share one slice.
  const shared = new Map<string, string>();
  function props(members: Member[]): string {
    if (members.length === 0) return "&[]";
    const rendered = members.map((member) => rustMember(member, platforms, css.indices)).join("\n");
    const name = shared.get(rendered) ?? `PROPS_${shared.size}`;
    shared.set(rendered, name);
    return name;
  }
  const specs = elements.map((element) => `    ElementSpec {
        element: Element::${element.name},
        name: ${quote(element.name)},
        props: ${props(element.members)},
        children: ${rustChildren(element.children)},
        page_root: ${element.pageRoot ?? false},
        parents: &[${(element.parents ?? []).map((name) => `Element::${name}`).join(", ")}],
        content: ${element.content === undefined ? "None" : `Some(${quote(element.content)})`},
        support: ${rustSupport(element.support, platforms)},
    },`).join("\n");
  const members = [...shared].map(([rendered, name]) => {
    if (rendered.indexOf("    PropSpec {") === rendered.lastIndexOf("    PropSpec {")) {
      const single = rendered.replace(/^ {4}/gm, "").slice(0, -1);
      return `const ${name}: &[PropSpec] = &[${single}];`;
    }
    return `const ${name}: &[PropSpec] = &[\n${rendered}\n];`;
  }).join("\n\n");
  const platformImport = "use crate::protocol::Platform;\n";
  const unionSpecs = Object.entries(unions).map(([name, values]) => {
    const list = values.map((value) => quote(value)).join(", ");
    const prefix = `const ${snake(name).toUpperCase()}: &[&str] = &`;
    return list.length <= 60
      ? `${prefix}[${list}];`
      : `${prefix}[\n${values.map((value) => `    ${quote(value)},`).join("\n")}\n];`;
  }).join("\n");
  const customImport = css.mappings.some((mapping) => mapping.unit === "custom") ? "CustomCss, " : "";
  return `${header}
use super::{
    Children, Css, CssTarget, CssUnit, ${customImport}ElementSpec, PropKind, PropSpec, PropType,
};
${platformImport}
/// Support exceptions for a target platform; omitted entries are supported.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Level {
    No,
    #[allow(dead_code, reason = "the catalog may omit ignored entries")]
    Ignored,
}

/// Built-in elements available in Weft views.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Element {
${elements.map(({ name }) => `    ${name},`).join("\n")}
}

impl Element {
    /// The element's name in a Weft view.
    #[must_use]
    pub fn name(self) -> &'static str {
        self.spec().name
    }
}

${unionSpecs ? `${unionSpecs}\n\n` : ""}pub(crate) const CSS_PROPS: &[Css<'static>] = &[
${css.mappings.map(rustCss).join("\n")}
];

pub(crate) const CSS: &str = r#"${sheet}"#;

${members}

pub(crate) const ELEMENTS: [ElementSpec; ${elements.length}] = [
${specs}
];
`;
}

function typescript(elements: ExpandedElement[], unions: Record<string, string[]>, css: Css[], sheet: string): string {
  const types = Object.entries(unions).map(([name, values]) =>
    `export type ${name} = ${values.map((value) => quote(value)).join(" | ")};\n\n`).join("");
  const entries = elements.map(({ name, main, children = "none" }) =>
    `  ${name}: { main: ${quote(main)}, children: ${quote(children)} },`).join("\n");
  return `${header}
import type { Css } from "./css.ts";

${types}export const ELEMENTS: Record<string, { main: string | null; children: "any" | "none" | readonly string[] }> = {
${entries}
};

export const CSS_PROPS: readonly Css[] = [
${css.map((mapping) => `  ${quote(mapping)},`).join("\n")}
];

export const CSS = ${quote(sheet)};
`;
}

function nativeUnions(unions: Record<string, string[]>): Record<string, string> {
  const entries = Object.entries(unions);
  const swift = entries.map(([name, values]) => `public enum Weft${name}: String, Sendable {
${values.map((value) => `    case ${value}`).join("\n")}

    public init(weft: String) {
        if let value = Self(rawValue: weft) {
            self = value
        } else {
            #if DEBUG
            NSLog("weft: invalid ${name} value: %@", weft)
            #endif
            self = .${values[0]}
        }
    }
}`).join("\n\n");
  const kotlin = entries.map(([name, values]) => `enum class Weft${name} {
${values.map((value) => `    ${snake(value).toUpperCase()}`).join(",\n")};

    companion object {
        fun parse(value: String): Weft${name} = when (value) {
${values.slice(1).map((value) => `            ${quote(value)} -> ${snake(value).toUpperCase()}\n`).join("")}            else -> ${snake(values[0]).toUpperCase()}
        }
    }
}`).join("\n\n");
  const csharp = entries.map(([name, values]) => `public enum Weft${name}
{
${values.map((value) => `    ${pascal(value)},`).join("\n")}
}`).join("\n\n");
  const csharpParse = entries.map(([name, values]) => `    public static Weft${name} Parse${name}(string value) => value switch
    {
${values.slice(1).map((value) => `        ${quote(value)} => Weft${name}.${pascal(value)},\n`).join("")}        _ => Weft${name}.${pascal(values[0])},
    };`).join("\n\n");
  const cpp = entries.map(([name, values]) => `enum class ${name} { ${values.map(pascal).join(", ")} };

[[nodiscard]] constexpr ${name} parse_${snake(name)}(std::string_view value) noexcept {
${values.slice(1).map((value) => `    if (value == ${quote(value)}) return ${name}::${pascal(value)};\n`).join("")}    return ${name}::${pascal(values[0])};
}`).join("\n\n");
  return {
    "native/apple/Sources/WeftKit/Elements.swift": `${header}\nimport Foundation\n\n${swift}\n`,
    "native/android/src/main/kotlin/net/mioyi/weftui/Elements.kt": `${header}\npackage net.mioyi.weftui\n\n${kotlin}\n`,
    "native/windows/Weft.WinUI/Elements.Generated.cs": `${header}\nnamespace Weft.WinUI;\n\n${csharp}\n\npublic static class WeftUnions\n{\n${csharpParse}\n}\n`,
    "native/linux/include/weft/elements.hpp": `${header}\n#pragma once\n\n#include <string_view>\n\nnamespace weft {\n\n${cpp}\n\n} // namespace weft\n`,
  };
}

const markdownHeader = "<!-- Generated from protocol/weft.elements.json by protocol/elements.ts; do not edit. -->";
const locales: Record<Locale, {
  title: string;
  introduction: string;
  lifecycle: string;
  properties: string[];
  events: string[];
  summary: string[];
  required: string;
  positional: string;
  children: Record<"none" | "any", string>;
  directChildren: string;
  directParents: string;
  support: string;
  levels: Record<Level, string>;
  reference: string;
}> = {
  en: {
    title: "Built-in elements",
    introduction: "Elements, properties, and events are supported on all target platforms unless noted. Unsupported uses cause a compilation error; ignored uses are accepted but have no effect.",
    lifecycle: "All elements also accept `onMount` and `onUnmount`, which have no payload.",
    properties: ["Property", "Type", "Default", "Description", "Platform exceptions"],
    events: ["Event", "Payload", "Description", "Platform exceptions"],
    summary: ["Element", "Positional property", "Events", "Children"],
    required: "Required",
    positional: "positional",
    children: { none: "None", any: "Any" },
    directChildren: "Only these direct child elements are accepted:",
    directParents: "Must be a direct child of:",
    support: "Platform exceptions",
    levels: { no: "Unsupported", ignored: "Ignored" },
    reference: "See the [element reference](https://weftui.mioyi.net/reference/elements/) for full properties, events, and platform support.",
  },
  zh: {
    title: "内置元素",
    introduction: "除非另有说明，所有平台都支持列出的元素、属性和事件。使用标为「不支持」的功能会导致编译错误；标为「忽略」的功能可以编译，但没有效果。",
    lifecycle: "所有元素还接受 `onMount` 和 `onUnmount`，这两个事件都没有载荷。",
    properties: ["属性", "类型", "默认值", "说明", "平台例外"],
    events: ["事件", "载荷", "说明", "平台例外"],
    summary: ["元素", "位置属性", "事件", "子节点"],
    required: "必填",
    positional: "位置参数",
    children: { none: "无", any: "不限" },
    directChildren: "仅接受以下直接子元素：",
    directParents: "必须是以下元素之一的直接子元素：",
    support: "平台例外",
    levels: { no: "不支持", ignored: "忽略" },
    reference: "完整的属性、事件及各平台的支持情况见[元素参考](https://weftui.mioyi.net/zh/reference/elements/)。",
  },
};

const code = (text: string): string => `\`${text}\``;
const codeList = (items: string[]): string => items.map(code).join(", ");
const isEvent = (member: Member): member is Event => member.event === true;
const isProp = (member: Member): member is Prop => !isEvent(member);

function table(header: string[], rows: string[][]): string {
  return [header, header.map(() => "---"), ...rows]
    .map((row) => `| ${row.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`)
    .join("\n");
}

function childrenLabel(children: Children = "none", locale: Locale): string {
  return Array.isArray(children) ? codeList(children) : locales[locale].children[children];
}

function supportLabel(support: Support | undefined, locale: Locale, platforms: Platforms): string {
  return Array.from(platforms.keys()).flatMap((platform) => {
    const level = support?.[platform];
    return level ? [`${locales[locale].levels[level]}: ${code(platform)}`] : [];
  }).join("; ");
}

function reference(
  elements: ExpandedElement[], locale: Locale, platforms: Platforms,
): string {
  const text = locales[locale];
  const out = [
    `---\ntitle: ${text.title}\n---\n${markdownHeader}`,
    text.introduction,
    text.lifecycle,
  ];
  for (const element of elements) {
    out.push(`## ${element.name}`, element.doc[locale]);
    const support = supportLabel(element.support, locale, platforms);
    if (support) out.push(`**${text.support}:** ${support}.`);
    out.push(Array.isArray(element.children)
      ? `${text.directChildren} ${codeList(element.children)}.`
      : `**${text.summary[3]}:** ${childrenLabel(element.children, locale)}.`);
    if (element.parents) out.push(`${text.directParents} ${codeList(element.parents)}.`);
    if (element.pageRoot) out.push(locale === "en" ? "Must be the first top-level node of a page, outside conditional and loop blocks." : "必须是页面的第一个顶层节点，不能放在条件或循环中。");
    const props = element.members.filter(isProp);
    if (props.length > 0) {
      out.push(table(text.properties, props.map((prop) => [
        prop.positional ? `${code(prop.name)} (${text.positional})` : code(prop.name),
        code(prop.type),
        prop.default !== undefined ? code(quote(prop.default)) : prop.required ? text.required : "—",
        prop.doc[locale],
        supportLabel(prop.support, locale, platforms) || "—",
      ])));
    }
    const events = element.members.filter(isEvent);
    if (events.length > 0) {
      out.push(table(text.events, events.map((event) => [
        code(event.name),
        event.payload ? code(event.payload) : "—",
        event.doc[locale],
        supportLabel(event.support, locale, platforms) || "—",
      ])));
    }
  }
  return out.join("\n\n") + "\n";
}

function grammar(path: string, elements: ExpandedElement[], locale: Locale): string {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const block = /(<!-- elements:begin -->)[\s\S]*?(<!-- elements:end -->)/;
  if (!block.test(source)) throw new Error(`${path}: missing elements:begin/end markers`);
  const text = locales[locale];
  const summary = table(text.summary, elements.map((element) => [
    code(element.name),
    element.main === null ? "—" : code(element.main),
    element.members.filter(isEvent).map((event) =>
      code(event.payload ? `${event.name}(${event.payload})` : event.name)).join(", ") || "—",
    childrenLabel(element.children, locale),
  ]));
  return source.replace(block, (_match, begin, end) =>
    `${begin}\n${markdownHeader}\n\n${summary}\n\n${text.reference}\n${end}`);
}

export function generateElements(platforms: Platforms): Record<string, string> {
  const schema: Schema = JSON.parse(readFileSync(new URL("weft.elements.json", import.meta.url), "utf8"));
  const elements = expand(schema, platforms);
  const unions = schema.unions ?? {};
  const css = collectCss(elements);
  const sheet = readFileSync(new URL("weft.css", import.meta.url), "utf8");
  const outputs: Record<string, string> = {
    "crates/transformer/src/elements/catalog.rs": rust(elements, platforms, unions, css, sheet),
    "packages/runtime/src/elements.ts": typescript(elements, unions, css.mappings, sheet),
    ...nativeUnions(unions),
  };
  for (const locale of ["en", "zh"] as const) {
    const prefix = locale === "zh" ? "zh/" : "";
    outputs[`docs/src/content/docs/${prefix}reference/elements.md`] = reference(elements, locale, platforms);
    const grammarPath = `crates/parser/GRAMMAR${locale === "zh" ? ".zh-CN" : ""}.md`;
    outputs[grammarPath] = grammar(grammarPath, elements, locale);
  }
  return outputs;
}
