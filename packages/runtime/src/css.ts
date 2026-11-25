import type { Value } from "./remote.ts";

type Properties =
  | { property: string; properties?: never }
  | { properties: readonly string[]; property?: never };

type Custom = "hidden" | "maxLines" | "shadow" | "grow" | "fill" | "border" | "spacer";

export type Css = { target?: "inner" } & (
  | (Properties & { unit: "px" | "number" | "color" | "percent" | "font" })
  | (Properties & { unit: "keyword"; keywords: Readonly<Record<string, string>> })
  | { unit: "custom"; custom: Custom }
);

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})(?![\s\S])/i;
const TOKEN = /^@[a-z_][a-z0-9_]*(?![\s\S])/i;

interface ViteMeta extends ImportMeta {
  readonly env?: { readonly DEV?: boolean };
}

function color(value: Value, tokens: ReadonlySet<string> | null | undefined): string {
  if (typeof value === "string" && HEX_COLOR.test(value)) return value;
  const name = typeof value === "string" && TOKEN.test(value) ? value.slice(1) : undefined;
  if (name !== undefined && (tokens === undefined || tokens?.has(name))) return `var(--weft-${name})`;
  // Vite replaces import.meta.env statically; it is absent outside Vite.
  if ((import.meta as ViteMeta).env?.DEV) {
    console.warn(name !== undefined
      ? `weft: unknown theme token ${JSON.stringify(name)}`
      : `weft: invalid color ${JSON.stringify(value)}, expected #RGB, #RRGGBB or #RRGGBBAA`);
  }
  return "transparent";
}

function customDeclarations(custom: Custom, value: Value): string {
  const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
  switch (custom) {
    case "hidden": return value === true ? "display:none" : "";
    case "maxLines": return number > 0
      ? `display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${number};overflow:hidden`
      : "";
    case "shadow":
      switch (value) {
        case "none": return "box-shadow:none";
        case "small": return "box-shadow:0 1px 3px #0000001f";
        case "medium": return "box-shadow:0 4px 12px #00000026";
        case "large": return "box-shadow:0 12px 32px #0000002e";
        default: return "";
      }
    case "grow": return number > 0 ? `flex:${number} 1 0px;min-width:0;min-height:0` : "flex:0 1 auto";
    case "fill": return value === true ? "align-self:stretch;justify-self:stretch" : "align-self:auto;justify-self:auto";
    case "border": return number > 0 ? `border-style:solid;border-width:${number}px` : "border-style:none";
    case "spacer": return typeof value === "number" && Number.isFinite(value) ? `flex:0 0 ${value}px` : "";
  }
}

/** Converts a slot value into complete semicolon-separated CSS declarations. */
export function declarations(css: Css, value: Value, tokens?: ReadonlySet<string> | null): string {
  if (css.unit === "custom") return customDeclarations(css.custom, value);
  let formatted: string;
  switch (css.unit) {
    case "color": formatted = color(value, tokens); break;
    case "font": {
      if (typeof value !== "string" || value === "") return "";
      // These escapes also keep the result safe in a WXML attribute and as a declaration string.
      const family = value.replace(/[\p{Cc}"'\\;&<>{}]/gu, (c) => `\\${c.charCodeAt(0).toString(16)} `);
      formatted = `'${family}'`;
      break;
    }
    case "keyword": {
      if (typeof value !== "boolean" && typeof value !== "string") return "";
      const key = String(value);
      formatted = Object.prototype.hasOwnProperty.call(css.keywords, key) ? css.keywords[key]! : "";
      break;
    }
    default: {
      if (typeof value !== "number") return "";
      const number = css.unit === "percent" ? value * 100 : value;
      if (!Number.isFinite(number)) return "";
      formatted = `${number}${css.unit === "px" ? "px" : css.unit === "percent" ? "%" : ""}`;
    }
  }
  if (formatted === "") return "";
  return css.property === undefined
    ? css.properties.map((property) => `${property}:${formatted}`).join(";")
    : `${css.property}:${formatted}`;
}
