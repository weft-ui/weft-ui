import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";
import { declarations, type Css } from "../../packages/runtime/src/css.ts";
import { CSS, CSS_PROPS } from "../../packages/runtime/src/elements.ts";
import type { Value } from "../../packages/runtime/src/remote.ts";

type Size = [width: number, height: number];
type Frame = [x: number, y: number, width: number, height: number];
type Insets = [top: number, right: number, bottom: number, left: number];
type Proposal = { exact: number } | { atMost: number } | null;
type Props = Record<string, Value | undefined>;

interface Child {
  intrinsic: Size;
  width?: number;
  height?: number;
  grow?: number;
  fill?: boolean;
  margin?: Insets;
  aspectRatio?: number;
  spacer?: boolean;
  size?: number;
}

interface Case {
  name: string;
  axis: "horizontal" | "vertical";
  padding: Insets;
  proposal: [main: Proposal, cross: Proposal];
  children: Child[];
  size: Size;
  frames: Frame[];
}

type LayoutCase = Case & (
  | { kind: "linear"; gap: number; align: string; justify: string }
  | { kind: "stack"; alignment: string }
);

type Member = { name: string; css?: Css };
interface Schema {
  groups: Record<string, Member[]>;
  elements: { name: string; groups?: string[]; members?: Member[] }[];
}

const { cases } = JSON.parse(
  readFileSync(new URL("../../protocol/corpus/layout.json", import.meta.url), "utf8"),
) as { cases: LayoutCase[] };
const schema = JSON.parse(
  readFileSync(new URL("../../protocol/weft.elements.json", import.meta.url), "utf8"),
) as Schema;
const members = new Map(schema.elements.map(({ name, groups, members }) => [
  name, [...(groups ?? []).flatMap((group) => schema.groups[group]), ...(members ?? [])],
]));

function style(element: string, props: Props): string {
  const styles: string[] = [];
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined) continue;
    const source = members.get(element)?.find((member) => member.name === name)?.css;
    const css = CSS_PROPS.find((candidate) => isDeepStrictEqual(candidate, source));
    if (!css) throw new Error(`No generated CSS mapping for ${element}.${name}`);
    const text = declarations(css, value);
    if (text) styles.push(text);
  }
  return styles.join(";");
}

function edges(prefix: "padding" | "margin", [top, right, bottom, left]: Insets): Props {
  return {
    [`${prefix}Top`]: top,
    [`${prefix}End`]: right,
    [`${prefix}Bottom`]: bottom,
    [`${prefix}Start`]: left,
  };
}

function proposal(axis: "width" | "height", size: Proposal, inset: number): Props {
  if (size === null) return {};
  if ("exact" in size) return { [axis]: size.exact - inset };
  return { [axis === "width" ? "maxWidth" : "maxHeight"]: size.atMost - inset };
}

function renderChild(child: Child, inStack: boolean): string {
  if (child.spacer) return `<div class="w-spacer" style="${style("Spacer", { size: child.size })}"></div>`;
  const css = style("Column", {
    width: child.width,
    height: child.height,
    grow: child.grow,
    fill: child.fill,
    aspectRatio: child.aspectRatio,
    ...(child.margin && edges("margin", child.margin)),
  });
  const [width, height] = child.intrinsic;
  // The fixed inner box provides intrinsic content without fixing the Weft element's size.
  const classes = ["w-column"];
  if (inStack) classes.push("w-in-stack");
  if (child.fill) classes.push("w-fill");
  if (child.grow !== undefined && child.grow > 0) classes.push("w-grow");
  return `<div class="${classes.join(" ")}" style="${css}">`
    + `<div style="width:${width}px;height:${height}px"></div></div>`;
}

function render(fixture: LayoutCase): string {
  const [main, cross] = fixture.proposal;
  const [width, height] = fixture.axis === "vertical" ? [cross, main] : [main, cross];
  const [top, right, bottom, left] = fixture.padding;
  const element = fixture.kind === "stack" ? "Stack" : fixture.axis === "vertical" ? "Column" : "Row";
  const css = style(element, {
    ...proposal("width", width, left + right),
    ...proposal("height", height, top + bottom),
    ...edges("padding", fixture.padding),
    ...(fixture.kind === "stack"
      ? { alignment: fixture.alignment }
      : { gap: fixture.gap, align: fixture.align, justify: fixture.justify }),
  });
  const children = fixture.children.map((child) => renderChild(child, fixture.kind === "stack")).join("");
  // Make unbounded cross sizes shrink-wrap instead of inheriting the browser's block width.
  return `<!doctype html><style>${CSS}</style><body style="display:flex;flex-direction:column;align-items:flex-start;margin:0">`
    + `<div id="layout" class="w-${element.toLowerCase()}" style="${css}">${children}</div></body>`;
}

function expectWithinHalfPixel(actual: number[], expected: number[], label: string, axes: string[]): void {
  expect(actual).toHaveLength(expected.length);
  for (const [i, want] of expected.entries()) {
    const got = actual[i];
    expect(Math.abs(got - want), `${label} ${axes[i]}: expected ${want}, got ${got}`).toBeLessThanOrEqual(0.5);
  }
}

let browser: Browser | undefined;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
}, 15_000);

afterAll(async () => {
  await browser?.close();
});

test("WeChat lazy segments stretch to the scroll content width", async () => {
  // WXML block and template tags do not create boxes; model their rendered views.
  const wxml = readFileSync(new URL("../../crates/transformer/tests/snapshots/Lists/wechat/view.wxml", import.meta.url), "utf8");
  const styles = [...wxml.matchAll(/class="w-lazy-segment [^"]+"[^>]*style="([^"{]*)/g)].map((match) => match[1]);
  expect(styles).toHaveLength(2);
  for (const [index, segmentStyle] of styles.entries()) {
    await page.setContent(`<style>${CSS}</style><div class="w-scroll-content-v" style="width:300px;box-sizing:border-box;padding:20px">`
      + `<div class="w-lazy-segment" style="${segmentStyle}">`
      + `<div class="w-lazy-row">a</div><div class="w-lazy-row">b</div></div></div>`);
    const widths = await page.locator(".w-lazy-segment").evaluate((segment) => ({
      segment: segment.getBoundingClientRect().width,
      rows: Array.from(segment.children, (row) => row.getBoundingClientRect().width),
    }));
    expect(widths.segment).toBe(260);
    // The fixture's Grid has three columns and 4px gaps, including an incomplete row.
    const expected = index === 0 ? 260 : (260 - 8) / 3;
    for (const width of widths.rows) expect(width).toBeCloseTo(expected, 1);
  }
});

test.each(cases)("Chromium layout: $name", async (fixture) => {
  await page.setContent(render(fixture));
  const { size, frames } = await page.locator("#layout").evaluate((container) => {
    const parent = container.getBoundingClientRect();
    return {
      size: [parent.width, parent.height],
      frames: Array.from(container.children, (child) => {
        const { x, y, width, height } = child.getBoundingClientRect();
        return [x - parent.x, y - parent.y, width, height];
      }),
    };
  });
  expectWithinHalfPixel(size, fixture.size, "container", ["width", "height"]);
  expect(frames).toHaveLength(fixture.frames.length);
  for (const [i, frame] of fixture.frames.entries()) {
    expectWithinHalfPixel(frames[i], frame, `child ${i}`, ["x", "y", "width", "height"]);
  }
});
