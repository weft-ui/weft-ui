// Naming map (schema keys are lower-case):
// - TypeScript: Opcode.Create, ValueTag.False; OpErrorKind is a string union.
// - Rust: Platform::Ios.
// - C++: weft::protocol::{kVersion, Code::Create, Tag::False, kFetchModule, kFetchRequest}.
// - Swift: OpCode.create, ValueTag.false, OpErrorKind.utf8; WeftProtocol.version,
//   WeftProtocol.fetchModule and WeftProtocol.fetchRequest.
// - Kotlin: OpCode.CREATE, ValueTag.FALSE, OpErrorKind.UTF8; WeftProtocol.VERSION,
//   WeftProtocol.FETCH_MODULE and WeftProtocol.FETCH_REQUEST.
// - C#: Weft.WinUI.Protocol holds OpCode.Create, ValueTag.False, OpErrorKind.Utf8,
//   WeftProtocol.Version, WeftProtocol.FetchModule and WeftProtocol.FetchRequest.
// In native bindings, module names use <module>Module and methods use <module><method>.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateElements } from "./elements.ts";

interface Schema {
  version: number;
  opcodes: Record<string, number>;
  modalStyles: Record<string, number>;
  valueTags: Record<string, number>;
  errorKinds: string[];
  platforms: { name: string; native?: boolean; apple?: boolean }[];
  platformModules: Record<string, string[]>;
}

const [mode, ...extra] = process.argv.slice(2);
if (extra.length > 0 || (mode !== undefined && mode !== "--check")) {
  console.error("Usage: node protocol/generate.ts [--check]");
  process.exit(1);
}
const check = mode === "--check";
const root = new URL("../", import.meta.url);
const header = "// Generated from protocol/weft.protocol.json by protocol/generate.ts; do not edit.\n";
const schema: Schema = JSON.parse(readFileSync(new URL("weft.protocol.json", import.meta.url), "utf8"));
const { version, opcodes, modalStyles, valueTags, errorKinds, platforms, platformModules } = schema;

const quote = (text: string): string => JSON.stringify(text);
const pascal = (key: string): string => key[0].toUpperCase() + key.slice(1);
const names = (entries: typeof platforms): string[] => entries.map(({ name }) => name);
const literals = (values: string[]): string => values.map(quote).join(", ");
const errors = Object.fromEntries(errorKinds.map(kind => [kind, kind]));
const modules = Object.entries(platformModules).flatMap(([name, methods]) => [
  { name: `${name}Module`, upper: `${name.toUpperCase()}_MODULE`, value: name },
  ...methods.map(method => ({
    name: name + pascal(method),
    upper: `${name.toUpperCase()}_${method.toUpperCase()}`,
    value: method,
  })),
]);

function tsConstants(name: string, values: Record<string, number>): string {
  return `export const ${name} = {\n${Object.entries(values).map(([key, value]) => `  ${pascal(key)}: ${value},`).join("\n")}\n} as const;`;
}

function typescript(): string {
  return `
/** Protocol version written as the first byte of every batch. */
export const VERSION = ${version};

${tsConstants("Opcode", opcodes)}

${tsConstants("ModalStyle", modalStyles)}

${tsConstants("ValueTag", valueTags)}

export type OpErrorKind = ${errorKinds.map(quote).join(" | ")};

export const PLATFORMS = [${literals(names(platforms))}] as const;
export const NATIVE_PLATFORMS = [${literals(names(platforms.filter(platform => platform.native)))}] as const;
export const APPLE_PLATFORMS = [${literals(names(platforms.filter(platform => platform.apple)))}] as const;

export type Platform = (typeof PLATFORMS)[number];
export type NativePlatform = (typeof NATIVE_PLATFORMS)[number];

export const PLATFORM_MODULES = {
${Object.entries(platformModules).map(([name, methods]) => `  ${name}: [${literals(methods)}],`).join("\n")}
} as const;

export type PlatformModule = keyof typeof PLATFORM_MODULES;
`;
}

function rustMatches(flag: "native" | "apple"): string {
  const cases = platforms.filter(platform => platform[flag]).map(({ name }) => `Self::${pascal(name)}`);
  const pattern = cases.join(" | ");
  const args = `self, ${pattern}`;
  // rustfmt's default fn_call_width also applies to macro arguments.
  return args.length <= 60 ? `        matches!(${args})` : `        matches!(\n            self,\n            ${pattern}\n        )`;
}

function rust(): string {
  return `//! Target names shared with the runtime.

/// Target platform; the string form matches \`WEFT_PLATFORM\`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Platform {
${platforms.map(({ name }) => `    ${pascal(name)},`).join("\n")}
}

impl Platform {
    /// Every platform, in declaration order.
    pub const ALL: [Platform; ${platforms.length}] = [
${platforms.map(({ name }) => `        Platform::${pascal(name)},`).join("\n")}
    ];

    /// Name used by \`WEFT_PLATFORM\` and the Vite environments.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
${platforms.map(({ name }) => `            Platform::${pascal(name)} => ${quote(name)},`).join("\n")}
        }
    }

    /// Whether the platform runs logic in the native kernel.
    #[must_use]
    pub fn is_native(self) -> bool {
${rustMatches("native")}
    }

    /// Whether the platform uses the SwiftUI shell.
    #[must_use]
    pub fn is_apple(self) -> bool {
${rustMatches("apple")}
    }
}
`;
}

function numericMembers(values: Record<string, number>, indent: string): string {
  return Object.entries(values).map(([key, value]) => `${indent}${pascal(key)} = ${value},`).join("\n");
}

function cpp(): string {
  return `
#pragma once

#include <cstdint>
#include <string_view>

namespace weft::protocol {

inline constexpr std::uint8_t kVersion = ${version};

enum class Code : std::uint8_t {
${numericMembers(opcodes, "  ")}
};

enum class ModalStyle : std::uint32_t {
${numericMembers(modalStyles, "  ")}
};

enum class Tag : std::uint8_t {
${numericMembers(valueTags, "  ")}
};

${modules.map(({ name, value }) => `inline constexpr std::string_view k${pascal(name)} = ${quote(value)};`).join("\n")}

}  // namespace weft::protocol
`;
}

function swiftEnum(name: string, type: string, values: Record<string, string | number>): string {
  const cases = Object.entries(values).map(([key, value]) => {
    const identifier = key === "false" || key === "true" ? `\`${key}\`` : key;
    return `    case ${identifier} = ${JSON.stringify(value)}`;
  });
  return `enum ${name}: ${type} {\n${cases.join("\n")}\n}`;
}

function swift(): string {
  return `
enum WeftProtocol {
    static let version: UInt8 = ${version}

${modules.map(({ name, value }) => `    static let ${name} = ${quote(value)}`).join("\n")}
}

${swiftEnum("OpCode", "UInt8", opcodes)}

${swiftEnum("ModalStyle", "UInt32", modalStyles)}

${swiftEnum("ValueTag", "UInt8", valueTags)}

${swiftEnum("OpErrorKind", "String", errors)}
`;
}

function kotlinObject(name: string, values: Record<string, string | number>): string {
  return `internal object ${name} {\n${Object.entries(values).map(([key, value]) => `    const val ${key.toUpperCase()} = ${JSON.stringify(value)}`).join("\n")}\n}`;
}

function kotlin(): string {
  return `
package net.mioyi.weftui

internal object WeftProtocol {
    const val VERSION = ${version}

${modules.map(({ upper, value }) => `    const val ${upper} = ${quote(value)}`).join("\n")}
}

${kotlinObject("OpCode", opcodes)}

${kotlinObject("ModalStyle", modalStyles)}

${kotlinObject("ValueTag", valueTags)}

${kotlinObject("OpErrorKind", errors)}
`;
}

function csharp(): string {
  // The separate namespace lets this coexist with the reader's original OpCode until migration.
  return `
namespace Weft.WinUI.Protocol;

internal static class WeftProtocol
{
    internal const byte Version = ${version};

${modules.map(({ name, value }) => `    internal const string ${pascal(name)} = ${quote(value)};`).join("\n")}
}

internal enum OpCode : byte
{
${numericMembers(opcodes, "    ")}
}

internal enum ModalStyle : uint
{
${numericMembers(modalStyles, "    ")}
}

internal enum ValueTag : byte
{
${numericMembers(valueTags, "    ")}
}

internal static class OpErrorKind
{
${errorKinds.map(kind => `    internal const string ${pascal(kind)} = ${quote(kind)};`).join("\n")}
}
`;
}

const outputs = {
  "packages/runtime/src/protocol.ts": header + typescript(),
  "crates/transformer/src/protocol.rs": header + rust(),
  "native/core/include/weft/protocol.hpp": header + cpp(),
  "native/apple/Sources/WeftKit/Protocol.swift": header + swift(),
  "native/android/src/main/kotlin/net/mioyi/weftui/Protocol.kt": header + kotlin(),
  "native/windows/Weft.WinUI/Protocol.cs": header + csharp(),
  ...generateElements(new Map(platforms.map(({ name }) => [name, pascal(name)]))),
};

const stale: string[] = [];
for (const [path, content] of Object.entries(outputs)) {
  const file = new URL(path, root);
  const generated = Buffer.from(content);
  if (existsSync(file) && readFileSync(file).equals(generated)) continue;
  if (check) stale.push(path);
  else {
    mkdirSync(new URL(".", file), { recursive: true });
    writeFileSync(file, generated);
  }
}
// Keep the rest of each hand-maintained package manifest intact.
for (const target of ["apple", "android", "windows", "linux"]) {
  const path = `native/${target}/package.json`;
  const file = new URL(path, root);
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (manifest.weft?.protocol === version) continue;
  if (check) stale.push(path);
  else {
    manifest.weft = { ...manifest.weft, protocol: version };
    writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  }
}
if (stale.length > 0) {
  console.error(`Generated protocol files differ:\n${stale.join("\n")}\nRun pnpm gen:protocol.`);
  process.exitCode = 1;
}
