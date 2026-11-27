
export interface Item {
  id: number;
  title: string;
}

export interface ListsModel {
  items: readonly Item[];
}

export declare class Lists {
  constructor(model: ListsModel);
  /** Value of the first parameter; event handlers receive the same object. */
  readonly model: ListsModel;
  $on(name: string, handler: (model: ListsModel, event: object) => unknown): () => void;
  /** Renders into a view sink, or a generated mini program view component, e.g. `page.selectComponent("#view")`. */
  mount(view: object): void;
  unmount(): void;
}
