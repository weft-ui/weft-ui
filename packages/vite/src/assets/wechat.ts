import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fontFaceStart } from "./font.ts";
import type { AssetFile, Assets } from "./scan.ts";

/** Copies a tab-bar image into the main package and returns its manifest path. */
export function writeWechatTabIcon(assets: Assets, generated: string, reference: string): string {
  const name = reference.slice(6);
  const image = assets.images.get(name)?.[0];
  if (!image || ![".png", ".jpg", ".jpeg"].includes(image.ext)) {
    throw new Error(`weft: tab icon \`${name}\` must be a PNG or JPEG image on wechat`);
  }
  const directory = join(generated, "assets", "tab");
  mkdirSync(directory, { recursive: true });
  copyFileSync(image.path, join(directory, image.file));
  return `weft/assets/tab/${image.file}`;
}

/** Copies images/icons and writes their manifest and the embedded font faces. */
export function writeWechatAssets(assets: Assets, generated: string, warn: (message: string) => void, placement?: {
  mainPackageAssets: string[];
  subPackageAssets: Record<string, string[]>;
  mainPackageFonts: string[];
  subPackageFonts: Record<string, string[]>;
  hasDynamicAssets: boolean;
  hasDynamicFonts: boolean;
}): void {
  const manifest: Record<string, readonly [scale: number, url: string][]> = Object.create(null);
  const exclusive = (name: string, main: string[], packages: Record<string, string[]>): string | undefined => {
    const roots = Object.entries(packages).filter(([, names]) => names.includes(name));
    return !main.includes(name) && roots.length === 1 ? roots[0]![0] : undefined;
  };
  if (assets.images.size || assets.icons.size) {
    const copy = (name: string, file: AssetFile, scale: number): [number, string] => {
      const root = placement && !placement.hasDynamicAssets ? exclusive(name, placement.mainPackageAssets, placement.subPackageAssets) : undefined;
      const media = root ? join(dirname(generated), root, "weft/assets") : join(generated, "assets");
      mkdirSync(media, { recursive: true });
      copyFileSync(file.path, join(media, file.file));
      return [scale, `${root ? `/${root}` : ""}/weft/assets/${file.file}`];
    };
    for (const [name, variants] of assets.images) manifest[name] = variants.map((file) => copy(name, file, file.scale));
    for (const [name, file] of assets.icons) manifest[name] = [copy(name, file, 1)];
    // Parse rather than using an object literal, where a resource named __proto__ is special.
    writeFileSync(join(generated, "assets.js"), `module.exports = JSON.parse(${JSON.stringify(JSON.stringify(manifest))});\n`);
  }
  if (assets.fonts.length === 0) return;
  let bytes = 0;
  const rules = new Map<string, string[]>();
  for (const font of assets.fonts) {
    const root = placement && !placement.hasDynamicFonts ? exclusive(font.family, placement.mainPackageFonts, placement.subPackageFonts) : undefined;
    const base64 = readFileSync(font.path).toString("base64");
    if (!root) bytes += base64.length;
    const rule = `${fontFaceStart(font.family, font.weight, font.italic)}"data:font/${font.ext.slice(1)};base64,${base64}"); }`;
    const key = root || "";
    const group = rules.get(key) ?? [];
    group.push(rule);
    rules.set(key, group);
  }
  if (bytes > 512 * 1024) warn(`weft: fonts add ${Math.ceil(bytes / 1024)} KiB to the mini program main package`);
  const mainRules = rules.get("");
  if (mainRules) appendFileSync(join(generated, "index.wxss"), `\n${mainRules.join("\n")}\n`);
  if (!placement) return;
  for (const root of ["", ...Object.keys(placement.subPackageFonts)]) {
    const pages = root ? join(dirname(generated), root, "weft/pages") : join(generated, "pages");
    if (!existsSync(pages)) continue;
    const packageRules = rules.get(root);
    for (const page of readdirSync(pages)) {
      const file = join(pages, page, "index.wxss");
      if (!existsSync(file)) continue;
      const shared = mainRules ? '@import "/weft/index.wxss";\n' : "";
      writeFileSync(file, `${shared}${readFileSync(file, "utf8")}${root && packageRules ? `\n${packageRules.join("\n")}\n` : ""}`);
    }
  }
}
