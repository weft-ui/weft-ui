---
title: Logic and events
description: Handle Weft UI events in JavaScript or TypeScript, update the model, and control what inputs display.
sidebar:
  order: 3
---

The `.weft` view reads the app model to render. Its inline event handlers can change local `state`, but they cannot assign to model fields. To change the model, emit an event from the view and handle it in JavaScript or TypeScript. Weft UI then updates the parts of the view that read the changed fields. See [Views](/guides/views/) for when to use local state.

## Create the app

This todo app binds a text input to `model.draft` and a checkbox to each todo's `done` field. Save the view as `App.weft`:

```weft
model Todo {
    id: Int,
    name: String,
    done: Bool
}

model Model {
    clicked: Bool,
    draft: String,
    todos: Todo[]
}

event Click
event Draft(value: String)
event Add
event Toggle(id: Int)
event Mount
event Unmount

component App(model: Model) {
    Column(onMount = Mount, onUnmount = Unmount) {
        Button(onClick = Click) {
            Text(if (model.clicked) "You clicked!" else "Click me")
        }
        Input(model.draft, onChange = Draft)
        Button(onClick = Add, disabled = model.draft.trim().isEmpty) {
            Text("Add")
        }
        for (todo in model.todos; key = todo.id) {
            Row {
                Checkbox(todo.done, onChange = Toggle(todo.id))
                Text(todo.name)
            }
        }
    }
}
```

In `index.ts`, import the component by name and pass the initial model to its constructor:

```ts
import { App } from "./App.weft";
import type { Model } from "./App.weft";
import { run, storage } from "@weft-ui/platform";

const initial: Model = { clicked: false, draft: "", todos: [] };
const app = new App(initial);
let nextId = 1;
```

TypeScript gets the constructor, model and event types from the `.weft` declarations. You can import `Model` as a type, as above, or let the constructor check an inline object. See [Tooling](/guides/tooling/) for how to enable these types. The constructor converts the plain data to reactive model instances. Update the model passed to a handler (also available as `app.model`), not the original `initial` object.

## Handle events and update the model

Weft UI generates a registration method for each event the component or its children can emit. The method adds `on` and capitalizes the first letter of the event name: `Toggle` becomes `app.onToggle`. The name comes from the declared event, not the element property that emits it. The callback receives the model first, then an object keyed by the event's field names. `Toggle(id: Int)` yields `{ id: number }`; events without fields pass `{}`, which you can ignore.

```ts
app.onClick((model) => {
  model.clicked = true;
  void storage.set("clicked", "true");
});

app.onAdd((model) => {
  model.todos = [...model.todos, { id: nextId++, name: model.draft.trim(), done: false }];
  model.draft = "";
});

app.onToggle((model, { id }) => {
  const todo = model.todos.find((item) => item.id === id);
  if (todo) todo.done = !todo.done;
});
```

Weft UI tracks assignments through generated setters, not proxies. This includes assigning to `todo.done` on an item. Arrays are typed as readonly and frozen at runtime: to add or remove an item, assign a new array rather than calling `push` or writing to an index. The model objects inside the array are still mutable.

Assignments change the model immediately. Weft UI normally batches view updates in a microtask. When an event comes through the view protocol, the runtime flushes pending updates synchronously before replying to the view. Weft UI does not await a handler's promise, but a write after `await` is tracked just like a synchronous write.

## Accept or reject input edits

`Input.value` and `Checkbox.checked` are controlled: an edit proposes a new value, but the bound expression decides what the control displays. In `onChange = Draft`, the bare event name forwards the input's proposed string to the event's sole field, `value`. In `onChange = Toggle(todo.id)`, the explicit arguments ignore the checkbox's proposed boolean and send the todo ID instead. The handler above flips that todo's `done` field.

```ts
const MAX_LENGTH = 12;

app.onDraft((model, { value }) => {
  if (value.length <= MAX_LENGTH) model.draft = value;
});
```

If the draft is too long, the handler leaves `model.draft` unchanged and the input goes back to the last bound value. The same rule applies to a checkbox. A handler can also write a different value, for example to normalize text; the control displays that value instead of the proposed edit. Make the decision before any `await` so the edit can be applied or rejected in the current update. Returning `true` or `false` from your handler does not control acceptance.

On the web, the runtime restores the bound value after the flush if the DOM value differs. In protocol-based views, the runtime compares the proposed value with the bound value after the synchronous flush and tells the view whether to restore it. For details, see the [grammar's event arguments](https://github.com/weft-ui/weft-ui/blob/master/crates/parser/GRAMMAR.md#event-arguments) and the [view protocol's event rules](https://github.com/weft-ui/weft-ui/blob/master/protocol/SPEC.md#events).

## Respond to mount and unmount

Bind `onMount` and `onUnmount` in `.weft` to named events, not inline handlers. The `Column` above emits `Mount` when its subtree is built and `Unmount` when it is removed. Register them with `app.onMount` and `app.onUnmount` because the events themselves are named `Mount` and `Unmount`. The runtime delivers these lifecycle events after the flush, so writes from them go into a later update.

```ts
app.onMount(async (model) => {
  model.clicked = (await storage.get("clicked")) === "true";
});

app.onUnmount((model) => {
  model.draft = "";
});
```

The storage read can finish after the initial render; assigning to `model.clicked` then updates the button. The unmount handler clears the draft so it does not carry over if the same app is mounted again.

## Run the app

Call `run(app)` from [`@weft-ui/platform`](/guides/platform-api/) after registering the handlers so they are in place before the first mount.

```ts
run(app);
```

On the web, `run` mounts into the element with `id="app"`. Native builds mount through the platform shell, and WeChat Mini Programs register the app with the host so it can mount the view when ready.
