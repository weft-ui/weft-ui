import { readFileSync } from "node:fs";

export const platforms = ["web", "wechat", "ios", "macos", "android", "windows", "linux"] as const;
export type Platform = typeof platforms[number];

interface Page {
  id: string;
  title: string;
  component?: string;
  link?: string;
  dark?: boolean;
  pending?: Platform[];
  props?: Record<string, string[]>;
}

const manifest: Page[] = JSON.parse(readFileSync(new URL("../pages.json", import.meta.url), "utf8"));

export function componentName({ id, component }: Page): string {
  return component ?? id.split(/[-_]/).map((word) => word[0]!.toUpperCase() + word.slice(1)).join("");
}

export type ResolvedPage = Page & { link: string };

function resolvePages(entries: Page[], platform?: Platform): ResolvedPage[] {
  return entries.filter(({ pending }) => platform === undefined || !pending?.includes(platform))
    .map((page) => ({ ...page, link: page.link ?? `/showcase/${page.id}` }));
}

export function pages(platform?: Platform): ResolvedPage[] {
  return resolvePages(manifest, platform);
}

export function showcasePages(platform?: Platform): ResolvedPage[] {
  return resolvePages(manifest.filter(({ link }) => link === undefined), platform);
}
