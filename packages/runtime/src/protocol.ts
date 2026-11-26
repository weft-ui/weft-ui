// Generated from protocol/weft.protocol.json by protocol/generate.ts; do not edit.

/** Protocol version written as the first byte of every batch. */
export const VERSION = 3;

export const Opcode = {
  Create: 1,
  Set: 2,
  Branch: 3,
  Rows: 4,
  Attach: 5,
  Splice: 6,
  Bind: 7,
  Nav: 8,
} as const;

export const ModalStyle = {
  Sheet: 0,
  FullScreen: 1,
} as const;

export const ValueTag = {
  False: 0,
  True: 1,
  Number: 2,
  String: 3,
  Strings: 4,
} as const;

export type OpErrorKind = "truncated" | "version" | "opcode" | "tag" | "utf8";

export const PLATFORMS = ["web", "wechat", "ios", "macos", "android", "windows", "linux"] as const;
export const NATIVE_PLATFORMS = ["ios", "macos", "android", "windows", "linux"] as const;
export const APPLE_PLATFORMS = ["ios", "macos"] as const;

export type Platform = (typeof PLATFORMS)[number];
export type NativePlatform = (typeof NATIVE_PLATFORMS)[number];

export const PLATFORM_MODULES = {
  fetch: ["request"],
  storage: ["get", "set", "remove"],
} as const;

export type PlatformModule = keyof typeof PLATFORM_MODULES;
