import { readFileSync } from "node:fs";

export type Platform = "web" | "wechat" | "ios" | "macos" | "android" | "windows" | "linux";

interface Page {
  id: string;
  title: string;
  component?: string;
  dark?: boolean;
  props?: Record<string, string[]>;
}

export const pages: Page[] = JSON.parse(readFileSync(new URL("../pages.json", import.meta.url), "utf8"));
