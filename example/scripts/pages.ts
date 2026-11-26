import { readFileSync } from "node:fs";

export const platforms = ["web", "wechat", "ios", "macos", "android", "windows", "linux"] as const;
export type Platform = typeof platforms[number];

interface Page {
  id: string;
  title: string;
  component?: string;
  dark?: boolean;
  pending?: Platform[];
  props?: Record<string, string[]>;
}

const manifest: Page[] = JSON.parse(readFileSync(new URL("../pages.json", import.meta.url), "utf8"));

export function pages(platform?: Platform): Page[] {
  return platform === undefined ? manifest : manifest.filter(({ pending }) => !pending?.includes(platform));
}
