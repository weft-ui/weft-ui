import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
export function writeWechatAssets(assets: Assets, generated: string, warn: (message: string) => void): void {
  const media = join(generated, "assets");
  const manifest: Record<string, readonly [scale: number, url: string][]> = Object.create(null);
  if (assets.images.size || assets.icons.size) {
    mkdirSync(media, { recursive: true });
    const copy = (file: AssetFile, scale: number): [number, string] => {
      copyFileSync(file.path, join(media, file.file));
      return [scale, `/weft/assets/${file.file}`];
    };
    for (const [name, variants] of assets.images) manifest[name] = variants.map((file) => copy(file, file.scale));
    for (const [name, file] of assets.icons) manifest[name] = [copy(file, 1)];
    // Parse rather than using an object literal, where a resource named __proto__ is special.
    writeFileSync(join(generated, "assets.js"), `module.exports = JSON.parse(${JSON.stringify(JSON.stringify(manifest))});\n`);
  }
  if (assets.fonts.length === 0) return;
  let bytes = 0;
  const rules = assets.fonts.map((font) => {
    const base64 = readFileSync(font.path).toString("base64");
    bytes += base64.length;
    const rule = fontFaceStart(font.family, font.weight, font.italic);
    return `${rule}"data:font/${font.ext.slice(1)};base64,${base64}"); }`;
  });
  if (bytes > 512 * 1024) warn(`weft: fonts add ${Math.ceil(bytes / 1024)} KiB to the mini program main package`);
  appendFileSync(join(generated, "index.wxss"), `\n${rules.join("\n")}\n`);
}
