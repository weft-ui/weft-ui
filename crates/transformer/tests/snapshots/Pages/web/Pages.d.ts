import type { Page as $Page } from "@weft-ui/runtime";

export interface NoteModel {
  title: string;
}

export declare class Heading {
  constructor(title: string);
  /** Value of the first parameter; event handlers receive the same object. */
  readonly model: string;
  $on(name: string, handler: (model: string, event: object) => unknown): () => void;
  mount(target: Node): void;
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
}

export interface AboutParams {
}
export declare class About extends $Page<AboutParams> {
  constructor(params: AboutParams);
  get model(): undefined;
  readonly params: Readonly<AboutParams>;
}
