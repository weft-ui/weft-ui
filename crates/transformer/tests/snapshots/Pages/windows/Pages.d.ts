import type { Page as $Page } from "@weft-ui/runtime/remote";

export interface NoteModel {
  title: string;
}

export declare class Heading {
  constructor(title: string);
  /** Value of the first parameter; event handlers receive the same object. */
  readonly model: string;
  $on(name: string, handler: (model: string, event: object) => unknown): () => void;
  /** Renders into a view sink, or a generated mini program view component, e.g. `page.selectComponent("#view")`. */
  mount(view: object): void;
  unmount(): void;
}

export interface DetailParams {
  id: string;
  from?: "feed" | "search";
  draft?: boolean | null;
}
export declare class Detail extends $Page<DetailParams> {
  constructor(model: NoteModel, params: DetailParams);
  get model(): NoteModel;
  readonly params: Readonly<DetailParams>;
  onShow(handler: (model: NoteModel) => void): () => void;
  onHide(handler: (model: NoteModel) => void): () => void;
}

export interface AboutParams {
}
export declare class About extends $Page<AboutParams> {
  constructor(params: AboutParams);
  get model(): undefined;
  readonly params: Readonly<AboutParams>;
  onShow(handler: (model: undefined) => void): () => void;
  onHide(handler: (model: undefined) => void): () => void;
}
