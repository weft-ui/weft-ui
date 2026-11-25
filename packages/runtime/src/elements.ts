// Generated from protocol/weft.elements.json by protocol/elements.ts; do not edit.

import type { Css } from "./css.ts";

export type CrossAlign = "start" | "center" | "end" | "stretch";

export type Justify = "start" | "center" | "end" | "spaceBetween" | "spaceAround" | "spaceEvenly";

export type Alignment = "topStart" | "top" | "topEnd" | "start" | "center" | "end" | "bottomStart" | "bottom" | "bottomEnd";

export type Axis = "vertical" | "horizontal";

export type Shadow = "none" | "small" | "medium" | "large";

export type Weight = "regular" | "light" | "medium" | "semibold" | "bold";

export type TextAlign = "start" | "center" | "end";

export type Decoration = "none" | "underline" | "lineThrough";

export type InputType = "text" | "password" | "number" | "email" | "phone";

export type ReturnKey = "done" | "go" | "next" | "search" | "send";

export type ImageFit = "cover" | "contain" | "fill";

export const ELEMENTS: Record<string, { main: string | null; children: "any" | "none" | readonly string[] }> = {
  Column: { main: null, children: "any" },
  Row: { main: null, children: "any" },
  Text: { main: "value", children: ["Span"] },
  Span: { main: "value", children: "none" },
  Button: { main: null, children: "any" },
  Input: { main: "value", children: "none" },
  Checkbox: { main: "checked", children: "none" },
  Image: { main: "src", children: "none" },
  Stack: { main: null, children: "any" },
  Scroll: { main: null, children: "any" },
  Spacer: { main: null, children: "none" },
  Switch: { main: "checked", children: "none" },
  TextArea: { main: "value", children: "none" },
  Spinner: { main: null, children: "none" },
  Progress: { main: "value", children: "none" },
  Divider: { main: null, children: "none" },
  Slider: { main: "value", children: "none" },
  Picker: { main: "selected", children: "none" },
};

export const CSS_PROPS: readonly Css[] = [
  {"property":"width","unit":"px"},
  {"property":"height","unit":"px"},
  {"unit":"custom","custom":"grow"},
  {"property":"min-width","unit":"px"},
  {"property":"max-width","unit":"px"},
  {"property":"min-height","unit":"px"},
  {"property":"max-height","unit":"px"},
  {"unit":"custom","custom":"fill"},
  {"property":"aspect-ratio","unit":"number"},
  {"properties":["margin-top","margin-right","margin-bottom","margin-left"],"unit":"px"},
  {"properties":["margin-left","margin-right"],"unit":"px"},
  {"properties":["margin-top","margin-bottom"],"unit":"px"},
  {"property":"margin-top","unit":"px"},
  {"property":"margin-bottom","unit":"px"},
  {"property":"margin-left","unit":"px"},
  {"property":"margin-right","unit":"px"},
  {"property":"opacity","unit":"number"},
  {"unit":"custom","custom":"hidden"},
  {"properties":["padding-top","padding-right","padding-bottom","padding-left"],"unit":"px"},
  {"properties":["padding-left","padding-right"],"unit":"px"},
  {"properties":["padding-top","padding-bottom"],"unit":"px"},
  {"property":"padding-top","unit":"px"},
  {"property":"padding-bottom","unit":"px"},
  {"property":"padding-left","unit":"px"},
  {"property":"padding-right","unit":"px"},
  {"property":"background-color","unit":"color"},
  {"property":"border-radius","unit":"px"},
  {"unit":"custom","custom":"border"},
  {"property":"border-color","unit":"color"},
  {"unit":"custom","custom":"shadow"},
  {"property":"overflow","unit":"keyword","keywords":{"true":"hidden","false":"visible"}},
  {"property":"gap","unit":"px"},
  {"property":"align-items","unit":"keyword","keywords":{"start":"flex-start","center":"center","end":"flex-end","stretch":"stretch"}},
  {"property":"justify-content","unit":"keyword","keywords":{"start":"flex-start","center":"center","end":"flex-end","spaceBetween":"space-between","spaceAround":"space-around","spaceEvenly":"space-evenly"}},
  {"property":"color","unit":"color"},
  {"property":"font-size","unit":"px"},
  {"property":"font-weight","unit":"keyword","keywords":{"light":"300","regular":"400","medium":"500","semibold":"600","bold":"700"}},
  {"property":"font-style","unit":"keyword","keywords":{"true":"italic","false":"normal"}},
  {"property":"text-decoration-line","unit":"keyword","keywords":{"none":"none","underline":"underline","lineThrough":"line-through"}},
  {"property":"font-family","unit":"font"},
  {"property":"text-align","unit":"keyword","keywords":{"start":"start","center":"center","end":"end"}},
  {"unit":"custom","custom":"maxLines"},
  {"property":"line-height","unit":"px"},
  {"property":"object-fit","unit":"keyword","keywords":{"cover":"cover","contain":"contain","fill":"fill"}},
  {"property":"--w-image-placeholder","unit":"color"},
  {"property":"place-items","unit":"keyword","keywords":{"topStart":"start start","top":"start center","topEnd":"start end","start":"center start","center":"center center","end":"center end","bottomStart":"end start","bottom":"end center","bottomEnd":"end end"}},
  {"property":"scrollbar-width","unit":"keyword","keywords":{"true":"auto","false":"none"}},
  {"unit":"custom","custom":"spacer"},
  {"property":"width","unit":"percent","target":"inner"},
  {"property":"background-color","unit":"color","target":"inner"},
];

export const CSS = ".w-root{display:flex;flex-direction:column;align-items:flex-start;box-sizing:border-box;width:100%;height:100%;overflow:hidden}\n.w-column{display:flex;flex-direction:column;align-items:flex-start}\n.w-row{display:flex;flex-direction:row;align-items:flex-start}\n.w-stack{display:grid;position:relative;grid-template:minmax(0,1fr)/minmax(0,1fr);place-items:start start}\n.w-in-stack{grid-area:1/1/2/2;position:relative}\n.w-in-stack.w-fill{position:absolute;inset:0}\n.w-scroll-v,.w-scroll-h{display:flex;align-items:flex-start;flex:1 1 0px;align-self:stretch;min-width:0;min-height:0}\n/* A Scroll viewport must keep its scrolling axis even when clip is specified. */\n.w-scroll-v{flex-direction:column;overflow-x:hidden!important;overflow-y:auto!important}\n.w-scroll-h{flex-direction:row;overflow-x:auto!important;overflow-y:hidden!important}\n.w-in-scroll{flex-shrink:0}\n/* A percentage basis falls back to content when the main size is indefinite. */\n.w-grow{flex-basis:0%!important}\n.w-spacer{width:0;height:0;flex:1 1 0px}\n.w-text{display:inline-block;white-space:pre-wrap;overflow-wrap:anywhere}\n.w-span{}\n/* Clamp owns the inline display and overflow; keep hide and clip independent. */\n.w-text-hidden{display:none!important}\n.w-text-clip{overflow:hidden}\n.w-button.w-wx{margin:0}\n.w-input.w-wx{border:1px solid #ccc;padding:4px 8px}\ninput.w-switch{appearance:none;display:inline-flex;align-items:center;box-sizing:border-box;width:51px;height:31px;margin:0;padding:2px;border:0;border-radius:999px;background:#78788052;cursor:pointer}\ninput.w-switch::before{content:\"\";width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #00000026}\ninput.w-switch:checked{justify-content:flex-end;background:#34c759}\ninput.w-switch:disabled{opacity:.45;cursor:default}\n.w-textarea,.w-picker{font:inherit;color:inherit;border:1px solid #78788066;border-radius:6px;padding:4px 8px}\n.w-textarea{line-height:1.4}\n.w-textarea.w-wx{height:4.2em}\n.w-picker.w-wx{min-height:1.4em}\n.w-picker-disabled{opacity:.45}\n.w-spinner{box-sizing:border-box;width:20px;height:20px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:w-spin .8s linear infinite}\n@keyframes w-spin{to{transform:rotate(1turn)}}\n@media (prefers-reduced-motion:reduce){.w-spinner{animation:none}}\n.w-progress{align-self:stretch;height:4px;border-radius:2px;background:#0000001f;overflow:hidden}\n.w-progress-bar{height:100%;border-radius:inherit;background:#007aff}\n.w-divider,.w-divider-v{align-self:stretch;background-color:#0000001f}\n.w-divider{height:1px}\n.w-divider-v{width:1px}\n.w-tap{cursor:pointer;-webkit-tap-highlight-color:transparent}\n/* The filter multiplies the bound opacity, including any inline value. */\n.w-pressed{filter:opacity(.6)}\n.w-wx-tap-image{display:inline-block;width:320px;height:240px}\n.w-wx-tap-image-content{display:block;width:100%;height:100%;border-radius:inherit}\n/* The mini program scroll-view owns its viewport; its child owns the layout. */\n.w-scroll-content-v,.w-scroll-content-h{display:flex;align-items:flex-start;flex:none}\n.w-scroll-content-v{flex-direction:column;width:100%;min-height:100%}\n.w-scroll-content-h{flex-direction:row;width:max-content;min-width:100%;height:100%}\n.w-column,.w-row,.w-stack,.w-scroll-v,.w-scroll-h,.w-text,.w-image{border-color:#0000001f}\n@media (prefers-color-scheme:dark){\n  .w-column,.w-row,.w-stack,.w-scroll-v,.w-scroll-h,.w-text,.w-image{border-color:#ffffff26}\n  .w-divider,.w-divider-v,.w-progress{background-color:#ffffff26}\n}\n";
