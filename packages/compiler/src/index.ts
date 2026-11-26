import { readFileSync } from "node:fs";
import type { Platform } from "@weft-ui/runtime/protocol";
import type * as WasmCompiler from "../wasm/weft_ui_wasm.js";

export type { Platform } from "@weft-ui/runtime/protocol";

let compiler: Promise<typeof WasmCompiler> | undefined;

function loadCompiler() {
  compiler ??= (async () => {
    let bytes: Buffer;
    try {
      bytes = readFileSync(new URL("../wasm/weft_ui_wasm_bg.wasm", import.meta.url));
    } catch (cause) {
      throw new Error("Weft compiler WASM is unavailable. Run `pnpm build:wasm` from the workspace root.", { cause });
    }
    // Generated glue may not exist before build:wasm; defer loading so the error above explains the fix.
    const module = await import("../wasm/weft_ui_wasm.js");
    module.initSync({ module: bytes });
    return module;
  })();
  return compiler;
}

/** Generated JS logic module of one `.weft` file. */
export interface LogicModule {
  /** Normalized source path, as the compiler loaded it. */
  source: string;
  code: string;
  dts: string;
}

/** Generated view file, relative to the platform's output root. */
export interface OutputFile {
  path: string;
  contents: string;
}

/** App-wide compiler settings. */
export interface AppOptions {
  /** Keep root content inside the host's safe area. Defaults to `true`. */
  safeArea?: boolean;
  /** WeChat package roots and their page names. */
  subPackages?: Record<string, string[]>;
}

export interface AppResult {
  /** One module per `.weft` file, entries first; empty on errors. */
  logic: LogicModule[];
  /** Empty on errors and for `web`, whose DOM code lives in the logic modules. */
  views: OutputFile[];
  /** View protocol layout as JSON (see protocol/SPEC.md); empty on errors and for `web`. */
  layout: string;
  /** Hexadecimal hash of the layout; empty when there is no layout. */
  layoutHash: string;
  /** Static asset names, without the asset: prefix, reachable from main pages. */
  mainPackageAssets: string[];
  /** Static asset names reachable from each subpackage. */
  subPackageAssets: Record<string, string[]>;
  mainPackageFonts: string[];
  subPackageFonts: Record<string, string[]>;
  /** Dynamic references require keeping all potentially referenced resources in the main package. */
  hasDynamicAssets: boolean;
  hasDynamicFonts: boolean;
  /** Rendered diagnostics; empty when there are none. */
  diagnostics: string;
  hasErrors: boolean;
  /** Normalized paths of every loaded source. */
  files: string[];
}

/** Unit of content mapper positions: UTF-8 bytes or UTF-16 code units. */
export type PositionEncoding = "utf-8" | "utf-16";

/** TypeScript content mapper `SpanMapping`: virtual start and length, original start and length, kind, feature bits. */
export type SpanMapping = [number, number, number, number, number, number];

/** TypeScript text of one `.weft` file for TypeScript's content mappers. */
export interface ContentMapping {
  /** Declarations of the file's Web logic module, parsed as a `.ts` file. */
  text: string;
  mappings: SpanMapping[];
  /** Errors located in the file. */
  diagnostics: { message: string; start: number; length: number }[];
}

/**
 * Maps the `.weft` file at `path`, whose unsaved text is `content`, to TypeScript with positions in `encoding`.
 * `load` reads the files it imports. Copies the result before releasing its WASM allocation.
 */
export async function mapContent(
  path: string,
  content: string,
  encoding: PositionEncoding,
  load: (path: string) => string,
): Promise<ContentMapping> {
  const module = await loadCompiler();
  const output = module.mapContent(path, content, encoding, load);
  try {
    const flat = output.mappings;
    const mappings: SpanMapping[] = [];
    for (let i = 0; i < flat.length; i += 6) {
      mappings.push([flat[i]!, flat[i + 1]!, flat[i + 2]!, flat[i + 3]!, flat[i + 4]!, flat[i + 5]!]);
    }
    const spans = output.diagnosticSpans;
    return {
      text: output.text,
      mappings,
      diagnostics: output.diagnosticMessages.map((message, index) => ({
        message,
        start: spans[2 * index]!,
        length: spans[2 * index + 1]!,
      })),
    };
  } finally {
    output.free();
  }
}

/**
 * Compiles `entries` and their imports as one app-level program, so names must be unique across the app.
 * Native platforms get the remote mode logic, `layout.json` and the generated view source of their backend
 * (SwiftUI for `ios` and `macos`, Jetpack Compose for `android`, WinUI for `windows`, GTK for `linux`).
 * Copies the result before releasing its WASM allocation.
 */
export async function compileApp(
  entries: string[],
  platform: Platform,
  load: (path: string) => string,
  options?: AppOptions,
): Promise<AppResult> {
  const module = await loadCompiler();
  const output = module.compileApp(entries, platform, load, options);
  try {
    const code = output.logicCode;
    const dts = output.logicDts;
    const contents = output.viewContents;
    type Usage = { assets: string[]; fonts: string[]; dynamicAssets: boolean; dynamicFonts: boolean };
    const usage = JSON.parse(output.packageUsage) as { main: Usage; subPackages: Record<string, Usage> };
    const packages = Object.entries(usage.subPackages);
    return {
      logic: output.logicSources.map((source, index) => ({ source, code: code[index]!, dts: dts[index]! })),
      views: output.viewPaths.map((path, index) => ({ path, contents: contents[index]! })),
      layout: output.layout,
      layoutHash: output.layoutHash,
      mainPackageAssets: usage.main.assets,
      subPackageAssets: Object.fromEntries(packages.map(([root, value]) => [root, value.assets])),
      mainPackageFonts: usage.main.fonts,
      subPackageFonts: Object.fromEntries(packages.map(([root, value]) => [root, value.fonts])),
      hasDynamicAssets: usage.main.dynamicAssets || packages.some(([, value]) => value.dynamicAssets),
      hasDynamicFonts: usage.main.dynamicFonts || packages.some(([, value]) => value.dynamicFonts),
      diagnostics: output.diagnostics,
      hasErrors: output.hasErrors,
      files: output.files,
    };
  } finally {
    output.free();
  }
}
