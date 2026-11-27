import { tick } from "@weft-ui/runtime";
import { resolveConfig } from "vite";
import { expect, test } from "vitest";
import weft from "../src/index.ts";
import { Board } from "./fixtures/Board.weft";

test("validates deep-link schemes", () => {
  for (const scheme of ["a", "weft+app.1-test"]) expect(() => weft({ links: { scheme } })).not.toThrow();
  for (const scheme of ["", "Weft", "1weft", "weft://", "weft app", "weft\n"]) {
    expect(() => weft({ links: { scheme } })).toThrow(`weft: invalid link scheme \`${scheme}\``);
  }
});

test("provides deep-link configuration and the resolved base to web environments", async () => {
  const config = await resolveConfig({
    configFile: false,
    base: "/nested",
    plugins: [weft({ links: { scheme: "weft", hosts: ["example.com"] } })],
  }, "serve");
  expect(config.appType).toBe("spa");
  expect(config.environments.client.define?.__WEFT_BASE__).toBe(JSON.stringify("/nested/"));
  expect(config.environments.client.define?.__WEFT_LINKS__).toBe(JSON.stringify({ scheme: "weft", hosts: ["example.com"] }));
});

test("defaults deep-link configuration and keeps non-web bases independent", async () => {
  const config = await resolveConfig({
    configFile: false,
    base: "/nested/",
    environments: { wechat: {} },
    plugins: [weft()],
  }, "serve");
  expect(config.environments.client.define?.__WEFT_BASE__).toBe(JSON.stringify("/nested/"));
  expect(config.environments.client.define?.__WEFT_LINKS__).toBe("{}");
  expect(config.environments.wechat.define?.__WEFT_BASE__).toBe(JSON.stringify("/"));
  expect(config.environments.wechat.define?.__WEFT_LINKS__).toBe("{}");
});

function mount() {
  const target = document.createElement("div");
  document.body.append(target);
  const app = new Board({
    owner: null,
    note: { text: "note" },
    mode: 0,
    groups: [
      {
        id: 1,
        title: "first",
        items: [
          { id: 10, label: "a", done: false, tags: ["x"] },
          { id: 11, label: "b", done: true, tags: [] },
        ],
      },
      { id: 2, title: "second", items: [{ id: 20, label: "c", done: false, tags: [] }] },
    ],
  });
  const events: string[] = [];
  app.onLoaded(() => events.push("Loaded"));
  app.onShown((_, e) => events.push(`Shown ${e.id}`));
  app.onHidden((_, e) => events.push(`Hidden ${e.id}`));
  app.onToggle((model, e) => {
    events.push(`Toggle ${e.id} ${e.value}`);
    for (const group of model.groups) {
      for (const item of group.items) if (item.id === e.id) item.done = e.value;
    }
  });
  app.mount(target);
  const column = target.firstElementChild!;
  const text = (index: number) => column.children[index].textContent;
  const labels = () => [...column.querySelectorAll(":scope > div > div > span:nth-of-type(1)")].map((s) => s.textContent);
  return { app, target, column, events, text, labels };
}

test("renders nested components, slots and defaults", () => {
  const { column, labels } = mount();
  const cards = column.querySelectorAll(":scope > div");
  expect(cards).toHaveLength(2);
  expect(cards[0].firstElementChild!.textContent).toBe("first");
  expect(cards[0].lastElementChild!.textContent).toBe("end");
  expect((cards[0].firstElementChild as HTMLElement).style.fontWeight).toBe("700");
  expect(labels()).toEqual(["a", "b", "c"]);
  expect(cards[0].querySelector("span[style*=color]")!.textContent).toBe("x");
});

test("lifecycle events fire after mount, children first", async () => {
  const { app, events } = mount();
  expect(events).toEqual([]);
  await tick();
  expect(events).toEqual(["Shown 10", "Shown 11", "Shown 20", "Loaded"]);

  events.length = 0;
  app.model.groups = app.model.groups.filter((g) => g.id !== 1);
  await tick();
  expect(events).toEqual(["Hidden 10", "Hidden 11"]);
});

test("optional models are watched deeply, required ones per field", async () => {
  const { app, text } = mount();
  expect(text(0)).toBe("nobody");
  app.model.owner = { name: "ann" };
  await tick();
  expect(text(0)).toBe("ann");
  app.model.owner!.name = "bob";
  await tick();
  expect(text(0)).toBe("bob");

  const note = app.model.note;
  note.text = "edited";
  await tick();
  expect(text(1)).toBe("edited");
  app.model.note = { text: "replaced" };
  await tick();
  expect(text(1)).toBe("replaced");
  // The old instance is no longer watched.
  note.text = "stale";
  await tick();
  expect(text(1)).toBe("replaced");
});

test("if / else if / else switches branches", async () => {
  const { app, text } = mount();
  expect(text(2)).toBe("zero");
  app.model.mode = 1;
  await tick();
  expect(text(2)).toBe("one");
  app.model.mode = 7;
  await tick();
  expect(text(2)).toBe("many");
});

test("state lambdas update caller content inside slots and loops", async () => {
  const { column, labels } = mount();
  const input = column.querySelector(":scope > input") as HTMLInputElement;
  const before = column.querySelectorAll(":scope > div > div");
  input.value = "> ";
  input.dispatchEvent(new Event("input"));
  await tick();
  expect(column.children[4].textContent).toBe("q: > ");
  expect(labels()).toEqual(["> a", "> b", "> c"]);
  expect(column.querySelectorAll(":scope > div > div")).toEqual(before);

  const button = column.querySelector(":scope > button") as HTMLButtonElement;
  button.click();
  button.click();
  await tick();
  expect(button.textContent).toBe("clicks 2");
});

test("checkbox emits events and follows the model", async () => {
  const { column, events } = mount();
  await tick();
  events.length = 0;
  const box = column.querySelector("input[type=checkbox]") as HTMLInputElement;
  box.click();
  await tick();
  expect(events).toEqual(["Toggle 10 true"]);
  expect(box.checked).toBe(true);
});

test("item changes reach nested loops of child components", async () => {
  const { app, column } = mount();
  const item = app.model.groups[0].items[0];
  item.tags = ["y", "x"];
  await tick();
  const tags = [...column.querySelectorAll("span[style*=color]")].map((s) => s.textContent);
  expect(tags).toEqual(["y", "x"]);

  item.label = "renamed";
  await tick();
  expect(column.querySelector(":scope > div > div > span")!.textContent).toBe("renamed");
});
