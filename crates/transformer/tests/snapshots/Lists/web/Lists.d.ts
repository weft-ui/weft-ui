
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
  mount(target: Node): void;
  unmount(): void;
}
