export type RouteValue = string | number | boolean | null;
export interface Route { readonly page: string; readonly params: Readonly<Record<string, RouteValue>> }
export interface RouteInfo { name: string; path: readonly string[]; params: readonly { name: string; type: string; optional: boolean; values?: readonly string[]; default?: RouteValue }[] }
export interface PageClass<P = unknown> { readonly $route: RouteInfo; readonly prototype: { readonly params: Readonly<P> } }

export function routeURL(page: PageClass, params: Readonly<Record<string, RouteValue>>): string {
  const route = page.$route;
  const used = new Set<string>();
  const path = route.path.map(segment => {
    if (!segment.startsWith("{") || !segment.endsWith("}")) return segment;
    const name = segment.slice(1, -1); used.add(name);
    return encodeURIComponent(String(params[name]));
  });
  const query: string[] = [];
  for (const param of route.params) {
    const value = params[param.name];
    if (!used.has(param.name) && value != null && value !== param.default) query.push(`${encodeURIComponent(param.name)}=${encodeURIComponent(String(value))}`);
  }
  return `/${path.join("/")}${query.length ? `?${query.join("&")}` : ""}`;
}

export function matchRoute(pages: readonly PageClass[], url: string): { page: PageClass; params: Record<string, RouteValue> } | null {
  const [path, query = ""] = url.split("?", 2);
  const segments = path.split("/").slice(1);
  for (const page of pages) {
    const info = page.$route;
    if (segments.length !== info.path.length) continue;
    try {
      const raw = new Map<string, string>();
      let matches = true;
      for (let i = 0; i < segments.length; i++) {
        const segment = info.path[i]!, value = decodeURIComponent(segments[i]!);
        if (segment.startsWith("{") && segment.endsWith("}")) raw.set(segment.slice(1, -1), value);
        else if (segment !== value) { matches = false; break; }
      }
      if (!matches) continue;
      for (const part of query.split("&")) if (part) { const [key, value = ""] = part.split("=", 2); raw.set(decodeURIComponent(key!.replace(/\+/g, " ")), decodeURIComponent(value.replace(/\+/g, " "))); }
      const params: Record<string, RouteValue> = {};
      for (const param of info.params) {
        const value = raw.get(param.name);
        if (value === undefined) { if (param.default !== undefined) params[param.name] = param.default; else if (param.optional) params[param.name] = null; else { matches = false; break; } continue; }
        if (param.type === "Int" || param.type === "Float") {
          const number = Number(value);
          if (!value || value.trim() !== value || !Number.isFinite(number) || (param.type === "Int" && (!/^-?[0-9]+$/.test(value) || !Number.isSafeInteger(number)))) { matches = false; break; }
          params[param.name] = number;
        } else if (param.type === "Bool") {
          if (value !== "true" && value !== "false") { matches = false; break; }
          params[param.name] = value === "true";
        } else if (param.type === "Union" && !param.values?.includes(value)) { matches = false; break; }
        else params[param.name] = value;
      }
      if (matches) return { page, params };
    } catch { continue; }
  }
  return null;
}
