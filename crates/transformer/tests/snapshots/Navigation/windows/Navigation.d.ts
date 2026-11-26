import type { Page as $Page } from "@weft-ui/runtime/remote";
import type { Application as $Application } from "@weft-ui/runtime/remote";

export type Action = {};

export interface HomeParams {
}
export declare class Home extends $Page<HomeParams> {
  constructor(params: HomeParams);
  get model(): undefined;
  readonly params: Readonly<HomeParams>;
  onShow(handler: (model: undefined) => void): () => void;
  onHide(handler: (model: undefined) => void): () => void;
}

export interface DetailParams {
  id: string;
}
export declare class Detail extends $Page<DetailParams> {
  constructor(params: DetailParams);
  get model(): undefined;
  readonly params: Readonly<DetailParams>;
  onShow(handler: (model: undefined) => void): () => void;
  onHide(handler: (model: undefined) => void): () => void;
  onAction(handler: (model: undefined, event: Action) => void): () => void;
}
export declare class Notes extends $Application {
  constructor(pages: {
    Home: () => Home;
    Detail: (params: DetailParams) => Detail;
  });
}
