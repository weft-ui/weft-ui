import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { matchesGlob, relative, resolve, sep } from "node:path";

type Rule = { type: string; value: string };

function matches(path: string, rule: Rule): boolean {
  const value = rule.value.replace(/^\/+|\/+$/g, "");
  switch (rule.type) {
    case "file": return path === value;
    case "folder": return path === value || path.startsWith(`${value}/`);
    case "suffix": return path.endsWith(value);
    case "prefix": return path.startsWith(value);
    case "regexp": return new RegExp(rule.value).test(path);
    case "glob": return matchesGlob(path, rule.value);
    default: return false;
  }
}

/** Checks uncompressed package sizes, excluding the developer-tool configuration and ignored files. */
export function checkWechatSize(project: string, roots: readonly string[], warn: (message: string) => void): void {
  const configPath = resolve(project, "project.config.json");
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) as {
    packOptions?: { ignore?: Rule[]; include?: Rule[] };
  } : {};
  const ignore = config.packOptions?.ignore ?? [];
  const include = config.packOptions?.include ?? [];
  const sizes = new Map(roots.map((root) => [root, 0]));
  let main = 0;
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) { visit(file); continue; }
      if (!entry.isFile()) continue;
      const path = relative(project, file).split(sep).join("/");
      if (path === "project.config.json" || path === "project.private.config.json") continue;
      if (ignore.some((rule) => matches(path, rule)) && !include.some((rule) => matches(path, rule))) continue;
      const bytes = statSync(file).size;
      const root = roots.find((name) => path.startsWith(`${name}/`));
      if (root) sizes.set(root, sizes.get(root)! + bytes);
      else main += bytes;
    }
  }
  visit(project);
  const kib = (bytes: number) => Math.ceil(bytes / 1024);
  const limit = (label: string, bytes: number, max: number) => {
    if (bytes > max * 1024) throw new Error(`weft: the mini program ${label} is ${kib(bytes)} KiB, over the ${max} KiB limit`);
  };
  limit("main package", main, 2048);
  for (const [root, bytes] of sizes) limit(`sub-package ${root}`, bytes, 2048);
  limit("total", main + [...sizes.values()].reduce((sum, size) => sum + size, 0), 20 * 1024);
  if (main > 1536 * 1024) warn(`weft: the mini program main package is ${kib(main)} KiB, over the 1536 KiB budget`);
}
