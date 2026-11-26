import { style, tick } from "@weft-ui/runtime";
import { CSS_PROPS } from "../../packages/runtime/src/elements.ts";
import { Window } from "happy-dom";
import { expect, test, vi } from "vitest";
import { Layout } from "../../crates/transformer/tests/fixtures/Layout.weft";
import { About, Detail } from "../fixtures/Pages.weft";

test("generated pages mount as roots with route parameters", async () => {
  const doc = new Window().document as unknown as Document;
  vi.stubGlobal("document", doc);
  const target = doc.createElement("main");
  doc.body.append(target);
  const page = new Detail({ title: "A note" }, { id: "42" });
  const about = new About({});
  try {
    expect(page.params).toEqual({ id: "42", from: "feed", draft: null });
    page.mount(target);
    expect(target.textContent).toBe("A note42");
    page.model.title = "Updated";
    await tick();
    expect(target.textContent).toBe("Updated42");
    page.unmount();
    about.mount(target);
    expect(target.textContent).toBe("About");
  } finally {
    page.unmount();
    about.unmount();
    vi.unstubAllGlobals();
  }
});

test("generated DOM applies layout styles and context through reactive updates", async () => {
  const doc = new Window().document as unknown as Document;
  vi.stubGlobal("document", doc);
  const app = new Layout({
    width: 120, inset: 7, gap: 4, grow: 2, ratio: 1.5, fill: false,
    align: "start", justify: "start", alignment: "topStart", indicators: true,
    spacer: 16, labels: ["alpha", "beta"],
  });
  const target = doc.createElement("main");
  doc.body.append(target);

  try {
    expect(doc.head.querySelector("style[data-weft]")).toBeNull();
    app.mount(target);
    expect(doc.head.querySelector("style[data-weft]")?.textContent).toContain(":root{color-scheme:light dark}");

    const row = target.querySelector<HTMLElement>(".w-row")!;
    const flexible = row.querySelector<HTMLElement>(".w-row")!;
    expect(row.style.paddingTop).toBe("5px");
    expect(row.style.paddingBottom).toBe("7px");
    expect(row.style.paddingLeft).toBe("6px");
    expect(flexible.style.minWidth).toBe("12px");
    expect(flexible.style.minHeight).toMatch(/^0(px)?$/);
    expect(flexible.classList.contains("w-fill")).toBe(false);
    expect(flexible.classList.contains("w-grow")).toBe(true);

    // Check both the component root and the slot root inside it.
    expect(target.querySelector(".w-stack > .w-stack.w-in-stack > .w-text.w-in-stack")?.textContent).toBe("projected");
    expect(target.querySelector(".w-stack > .w-image.w-in-stack")).not.toBeNull();
    const vertical = target.querySelector(".w-scroll-v")!;
    const horizontal = target.querySelector(".w-scroll-h")!;
    const nestedText = horizontal.querySelector(".w-button.w-in-scroll > .w-text")!;
    expect(nestedText.classList.contains("w-in-scroll")).toBe(false);
    const scrollTextSelector = ".w-text.w-in-scroll";
    const [label, alpha, beta] = vertical.querySelectorAll(scrollTextSelector);
    expect([label?.textContent, alpha?.textContent, beta?.textContent]).toEqual(["vertical", "alpha", "beta"]);

    app.model.inset = 11;
    app.model.grow = 0;
    app.model.fill = true;
    app.model.labels = ["beta", "alpha", "new"];
    await tick();

    expect(row.style.paddingTop).toBe("5px");
    expect(row.style.paddingBottom).toBe("11px");
    expect(flexible.style.minWidth).toBe("12px");
    expect(flexible.style.minHeight).toBe("");
    expect(flexible.classList.contains("w-fill")).toBe(true);
    expect(flexible.classList.contains("w-grow")).toBe(false);
    expect(target.querySelector(".w-stack > .w-text.w-in-stack.w-fill")?.textContent).toBe("overlay");
    const [sameLabel, movedBeta, movedAlpha, added] = vertical.querySelectorAll(scrollTextSelector);
    expect(sameLabel).toBe(label);
    expect(movedBeta).toBe(beta);
    expect(movedAlpha).toBe(alpha);
    expect(added?.textContent).toBe("new");

    app.unmount();
    app.mount(target);
    expect(doc.head.querySelectorAll("style[data-weft]")).toHaveLength(1);
  } finally {
    app.unmount();
    vi.unstubAllGlobals();
  }
});

test("style() rejects injected keyword strings and clears the property without looping", () => {
  const doc = new Window().document as unknown as Document;
  const el = doc.createElement("div") as unknown as HTMLElement;
  const alignIndex = CSS_PROPS.findIndex((p) => "property" in p && p.property === "text-align");
  expect(alignIndex).toBeGreaterThanOrEqual(0);

  style(el, alignIndex, "center");
  expect(el.style.textAlign).toBe("center");

  style(el, alignIndex, "end;color:red");
  expect(el.style.textAlign).toBe("");
  expect(el.style.color).toBe("");

  // Even a property whose keyword mapping is empty clears cleanly without hanging.
  style(el, alignIndex, ";");
  expect(el.style.textAlign).toBe("");
});
