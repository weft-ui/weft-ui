import { type ExecFileOptions, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { NativePlatform } from "@weft-ui/runtime/protocol";
import { androidAdapter } from "./android.ts";
import { appleAdapter } from "./apple.ts";
import { linuxAdapter } from "./linux.ts";
import { nativeShell, nativeShellPackage } from "./shells.ts";
import { windowsAdapter } from "./windows.ts";

/** Deep-link scheme and HTTPS hosts accepted by the application. */
export interface Links {
  scheme?: string;
  hosts?: string[];
}

export interface NativeAdapter {
  /** Bytecode path relative to the generated directory. */
  readonly bytecode: string;
  /** Host able to run the native build; undefined for any host. */
  readonly host?: NodeJS.Platform;
  /** Warning when the host cannot build, e.g. "xcodebuild needs macOS". */
  readonly hostWarning?: string;
  /** Writes the shell glue (Package.swift, settings.gradle.kts, Weft.targets, CMakeLists.txt) and the deep-link registration files. */
  writeGlue(generated: string, project: string, links: Links): void;
  build(project: string, platform: NativePlatform, release: boolean): Promise<void>;
}

const execute = promisify(execFile);

async function runTool(
  command: string,
  args: string[],
  { lineSeparator = /\r?\n/, ...options }: ExecFileOptions & { lineSeparator?: string | RegExp },
  messages: { missing: string; failed: string },
): Promise<void> {
  try {
    await execute(command, args, { maxBuffer: 256 * 1024 * 1024, ...options });
  } catch (cause) {
    const { stdout, stderr, code } = cause as { stdout?: string; stderr?: string; code?: string | number };
    if (code === "ENOENT") throw new Error(messages.missing);
    const output = `${stdout ?? ""}${stderr ?? ""}`.trim().split(lineSeparator).slice(-60).join("\n");
    throw new Error(`${messages.failed}\n${output || String(cause)}`);
  }
}

export type RunTool = typeof runTool;

export function nativeAdapter(platform: NativePlatform, shell: string): NativeAdapter {
  switch (platform) {
    case "ios":
    case "macos":
      return appleAdapter(runTool, shell);
    case "android":
      return androidAdapter(runTool, shell);
    case "windows":
      return windowsAdapter(runTool, shell);
    case "linux":
      return linuxAdapter(runTool, shell);
  }
}

/**
 * Syntax the bundle keeps for Hermes; newer syntax is lowered by Vite.
 * Measured with the test262 subset in native/core/test262.
 */
export const HERMES_TARGET = "es2022";

/**
 * Flags of `hermesc`. Block scoping and async generators are opt-in in
 * Hermes; without block scoping `let` / `const` bindings in loops would be
 * shared by every iteration. Keep in sync with native/core/tests/CMakeLists.txt.
 */
export const HERMESC_FLAGS = ["-O", "-emit-binary", "-Xes6-block-scoping", "-Xasync-generators", "-w"];

/** `hermesc` of the `hermes-compiler` package, per host. Windows on Arm runs the x64 build under emulation. */
const BINARIES: Partial<Record<string, string>> = {
  "darwin-arm64": "osx-bin/hermesc",
  "darwin-x64": "osx-bin/hermesc",
  "linux-x64": "linux64-bin/hermesc",
  "win32-arm64": "win64-bin/hermesc.exe",
  "win32-x64": "win64-bin/hermesc.exe",
};

/**
 * The shell supplies the compiler that matches its kernel's Hermes release.
 * The Linux shell itself ships the arm64 Linux executable, which
 * `hermes-compiler` does not provide.
 */
function hermesc(platform: NativePlatform, shell: string, nativeRoot?: string): string {
  const override = process.env.WEFT_HERMESC;
  if (override) return override;
  const host = `${process.platform}-${process.arch}`;
  if (host === "linux-arm64") {
    let linuxShell: string;
    try {
      linuxShell = platform === "linux" ? shell : nativeShell("linux", nativeRoot);
    } catch (cause) {
      throw new Error(
        "weft: on Linux arm64 install hermesc with `pnpm add -D @weft-ui/native-linux`, or set WEFT_HERMESC",
        { cause },
      );
    }
    const compiler = join(linuxShell, "build/linux-arm64/bin/hermesc");
    if (existsSync(compiler)) return compiler;
    throw new Error(`weft: hermesc is missing at ${compiler}; reinstall @weft-ui/native-linux or set WEFT_HERMESC`);
  }
  const name = nativeShellPackage(platform);
  const binary = BINARIES[host];
  if (!binary) throw new Error(`weft: ${name} does not supply hermesc for ${host}; set WEFT_HERMESC`);
  try {
    const manifest = createRequire(join(shell, "package.json")).resolve("hermes-compiler/package.json");
    return join(dirname(manifest), "hermesc", binary);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") throw cause;
    throw new Error(`weft: ${name} cannot find hermes-compiler; reinstall the package or set WEFT_HERMESC`);
  }
}

/** Compiles the bundle at `input` to Hermes bytecode at `output`. */
export async function compileBytecode(
  input: string, output: string, platform: NativePlatform, shell: string, nativeRoot?: string,
): Promise<void> {
  const compiler = hermesc(platform, shell, nativeRoot);
  try {
    await execute(compiler, [...HERMESC_FLAGS, `-out=${output}`, input]);
  } catch (cause) {
    const { stderr, code } = cause as { stderr?: string; code?: string };
    if (code === "ENOENT") {
      throw new Error(`weft: hermesc not found at ${compiler}; reinstall ${nativeShellPackage(platform)} or set WEFT_HERMESC`);
    }
    throw new Error(`weft: hermesc failed on ${input}\n${stderr ?? String(cause)}`);
  }
}
