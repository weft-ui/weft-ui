import type { Platform, PlatformModule } from "@weft-ui/runtime/protocol";
import type { PageClass } from "@weft-ui/runtime/navigation";

declare global {
  /** The platform being built, defined by `@weft-ui/vite` in every environment. */
  const __WEFT_PLATFORM__: Platform;
}

/** An API unavailable on the current platform. Async APIs reject with this error. */
export class PlatformError extends Error {
  /** The unsupported capability. */
  readonly api: PlatformModule;
  constructor(api: PlatformModule, os: Platform);
}

/** The lifecycle shared by generated root components on every platform. */
export interface App {
  /** Mounts into the platform-specific target supplied by run. */
  mount(target: never): void;
  /** Releases the mounted app. */
  unmount(): void;
}

/** Starts an app using the selected platform's host lifecycle. */
export function run(app: App): void;

/** A page and its route parameters. */
export interface Route { readonly page: string; readonly params: Readonly<Record<string, string | number | boolean | null>> }
type ParamsArg<P> = {} extends P ? [params?: P] : [params: P];
/** Stack navigation for a mounted application. */
export const navigation: {
  readonly stack: readonly Route[];
  push<P>(page: PageClass<P>, ...params: ParamsArg<P>): void;
  replace<P>(page: PageClass<P>, ...params: ParamsArg<P>): void;
  pop(count?: number): void;
  popToRoot(): void;
  onChange(listener: () => void): () => void;
};

/** Portable HTTP request options. */
export interface RequestInit {
  /** HTTP method; the host defaults to GET. */
  method?: string;
  /** Request headers. */
  headers?: Record<string, string>;
  /** Request payload. */
  body?: string | ArrayBuffer;
}

/** An HTTP response whose body can be read in any of the portable formats. */
export interface Response {
  /** Whether the HTTP status is in the range 200–299. */
  readonly ok: boolean;
  /** HTTP status code. */
  readonly status: number;
  /** Reads the body as UTF-8 text. */
  text(): Promise<string>;
  /** Parses the body as JSON. */
  json(): Promise<unknown>;
  /** Reads the raw response bytes. */
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Sends a request, rejecting with PlatformError if fetch is unsupported. */
export function fetch(url: string, init?: RequestInit): Promise<Response>;

/** Persistent string storage; methods reject with PlatformError when unsupported. */
export const storage: {
  /** Reads a key, returning null when it does not exist. */
  get(key: string): Promise<string | null>;
  /** Stores a string value. */
  set(key: string, value: string): Promise<void>;
  /** Removes a key. */
  remove(key: string): Promise<void>;
};

/** Queued dialogs and action sheets, plus independently replacing toast messages. */
export const ui: {
  alert(options: { title?: string; message?: string; confirmText?: string }): Promise<void>;
  confirm(options: { title?: string; message?: string; confirmText?: string; cancelText?: string; destructive?: boolean }): Promise<boolean>;
  actionSheet(options: { title?: string; options: readonly string[]; destructiveIndex?: number; cancelText?: string }): Promise<number | null>;
  toast(message: string, options?: { icon?: "none" | "success" | "error"; duration?: "short" | "long" }): void;
};

/** Window content size in logical pixels and its physical pixel density. */
export interface Screen { readonly width: number; readonly height: number; readonly scale: number }

/** Insets from the window edges in logical pixels. */
export interface Insets { readonly top: number; readonly bottom: number; readonly start: number; readonly end: number }

export type ColorScheme = "light" | "dark";

/** Current operating platform, host version and window environment. */
export const platform: {
  readonly os: Platform;
  /** The user agent on the web. */
  readonly version: string;
  readonly colorScheme: ColorScheme;
  readonly screen: Screen;
  readonly safeArea: Insets;
  readonly orientation: "portrait" | "landscape";
  /** Calls `listener` after any environment value changes; returns a function that removes it. */
  onChange(listener: () => void): () => void;
};

/** Reports current host capability availability, without invoking the API. */
export function isSupported(api: PlatformModule): boolean;
