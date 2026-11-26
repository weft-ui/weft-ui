import { cpSync, existsSync, globSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type EnvironmentOptions, type Plugin, defaultClientConditions, defaultServerConditions } from "vite";
import { type AppResult, compileApp } from "@weft-ui/compiler";
import { NATIVE_PLATFORMS, PLATFORMS, type NativePlatform, type Platform } from "@weft-ui/runtime/protocol";
import { HERMES_TARGET, compileBytecode, nativeAdapter } from "./native.ts";
import { checkShellProtocol, nativeShell } from "./shells.ts";
import { type Assets, hasAssets, scanAssets } from "./assets/scan.ts";
import { WEB_ASSETS_ID, RESOLVED_WEB_ASSETS_ID, serveWebAssets, webAssets } from "./assets/web.ts";
import { writeWechatAssets, writeWechatTabIcon } from "./assets/wechat.ts";
import { writeAndroidAssets } from "./assets/android.ts";
import { writeWindowsAssets } from "./assets/windows.ts";
import { writeLinuxAssets } from "./assets/linux.ts";
import { writeAppleAssets } from "./assets/apple.ts";

/** Options of the Weft Vite plugin. */
export interface WeftOptions {
  /** Platforms `vite build --app` builds when `WEFT_PLATFORM` is unset; `WEFT_PLATFORM` must name one of them. Defaults to every platform. */
  platforms?: Platform[];
  /** Directory for platform projects; absolute or relative to the Vite root. Defaults to `./apps`. */
  apps?: string;
  /** Directory for bundled images, icons and fonts, relative to the Vite root. Defaults to `assets`. */
  assets?: string;
  /** Keep root content inside the host's safe area. Defaults to `true`. */
  safeArea?: boolean;
  /** Overrides the installed native shell packages with a directory containing the shells; absolute or relative to the Vite root. */
  native?: string;
  /** Values filled into the project templates copied to `<apps>/<platform>/` on the first build. */
  app?: {
    /** Bundle ID / package name; defaults to `com.example.<name>`. */
    id?: string;
    /** Display name; defaults to the name of the root directory. */
    name?: string;
  };
  /** Glob, relative to the root, of the `.weft` files forming the app-level program of non-Web platforms. */
  include?: string;
  /**
   * Logic entry for non-Web builds, relative to the Vite root. Defaults to the first existing
   * `src/index.{js,ts,mjs,mts,cjs,cts}`, in that order. Web builds start from `index.html`.
   */
  entry?: string;
  /**
   * Writes `X.d.weft.ts` next to every `X.weft`, for TypeScript setups without the content mapper
   * `@weft-ui/content-mapper`; they need `allowArbitraryExtensions`. Defaults to `false`.
   */
  dts?: boolean;
}

function writeDeclarations(path: string, declarations: string) {
  const output = join(dirname(path), `${basename(path, ".weft")}.d.weft.ts`);
  if (!existsSync(output) || readFileSync(output, "utf8") !== declarations) {
    writeFileSync(output, declarations);
  }
}

function* weftFiles(directory: string, appsDir: string): Generator<string> {
  if (directory === appsDir) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* weftFiles(path, appsDir);
    else if (entry.isFile() && entry.name.endsWith(".weft")) yield path.replaceAll("\\", "/");
  }
}

function isPlatform(name: string): name is Platform {
  return (PLATFORMS as readonly string[]).includes(name);
}

function isNativePlatform(platform: Platform): platform is NativePlatform {
  return (NATIVE_PLATFORMS as readonly Platform[]).includes(platform);
}

/**
 * Platforms to build: `WEFT_PLATFORM` (one name or a comma-separated list),
 * else every configured platform for `vite build --app`, else `web`.
 */
function selectPlatforms(configured: readonly Platform[], app: boolean): Platform[] {
  const requested = process.env.WEFT_PLATFORM?.trim();
  if (!requested) return app ? [...configured] : ["web"];
  const names = requested.split(",").map((name) => name.trim()).filter(Boolean);
  for (const name of names) {
    if (!isPlatform(name)) {
      throw new Error(`WEFT_PLATFORM: unknown platform "${name}", expected one of: ${PLATFORMS.join(", ")}`);
    }
    if (!configured.includes(name)) {
      throw new Error(`WEFT_PLATFORM: "${name}" is not in the platforms option of weft(): ${configured.join(", ")}`);
    }
  }
  return [...new Set(names as Platform[])];
}

/**
 * Imports of `@weft-ui/runtime` resolve from the plugin's own dependency, so an
 * app needs no direct dependency on it, and every module of a build (generated
 * logic, `@weft-ui/platform`, app code) shares the runtime whose protocol
 * version `checkShellProtocol` compared with the native shell.
 */
const RUNTIME = "@weft-ui/runtime";
const RUNTIME_IMPORTER = fileURLToPath(import.meta.url);

function isRuntimeImport(source: string): boolean {
  return source === RUNTIME || source.startsWith(`${RUNTIME}/`);
}

const ENTRY_CANDIDATES = ["src/index.js", "src/index.ts", "src/index.mjs", "src/index.mts", "src/index.cjs", "src/index.cts"];

function resolveEntry(root: string, entry: string | undefined): string {
  if (entry !== undefined) return resolve(root, entry);
  for (const candidate of ENTRY_CANDIDATES) {
    const path = resolve(root, candidate);
    if (existsSync(path)) return path;
  }
  throw new Error(`weft: no non-Web logic entry found in ${root}; expected one of ${ENTRY_CANDIDATES.join(", ")}, or set the entry option of weft()`);
}

/** Vite writes the whole Web project, but only the JS of the other platforms' generated area. */
function outDir(appsDir: string, platform: Platform): string {
  const project = join(appsDir, platform);
  return platform === "web" ? project : join(project, "weft/js");
}

/**
 * How a template file escapes the `__WEFT_APP_NAME__` / `__WEFT_APP_ID__`
 * placeholders it holds, or `undefined` if it is copied verbatim.
 */
function placeholderEscape(name: string): ((value: string) => string) | undefined {
  // JSON, Xcode project, C# and C++ files hold placeholders inside double-quoted strings with the same escapes.
  if (name.endsWith(".json") || name.endsWith(".pbxproj") || name.endsWith(".cs") || name.endsWith(".cpp")) {
    return (value) => JSON.stringify(value).slice(1, -1);
  }
  // Kotlin strings are JSON strings in which `$` starts a template.
  if (name.endsWith(".kts") || name.endsWith(".kt")) {
    return (value) => JSON.stringify(value).slice(1, -1).replaceAll("$", "\\$");
  }
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
  const xml = (value: string) => value.replace(/[&<>"']/g, (c) => entities[c]!);
  if (name.endsWith(".xcscheme")) return xml;
  // Android string resources give quotes, backslashes and leading `@` / `?` meaning; a backslash escapes them.
  if (name === "strings.xml") return (value) => xml(value.replace(/[\\'"@?]/g, (c) => `\\${c}`));
  // MSBuild expands `$(…)`, `@(…)` and `%(…)` and splits on `;` in project files; `%XX` escapes them.
  if (name.endsWith(".csproj")) {
    return (value) => xml(value.replace(/[%$@;?*']/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`));
  }
  return undefined;
}

function defaultAppId(name: string): string {
  const segment = name.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/^[0-9]+/, "");
  return `com.example.${segment || "app"}`;
}

/**
 * Copies the platform's template into the project directory unless it
 * already holds anything besides the generated area: after the first
 * build the template belongs to the user. Returns `false` if the platform
 * has no template yet.
 */
function copyTemplate(project: string, platform: Platform, app: { id: string; name: string }): boolean {
  const template = fileURLToPath(new URL(`../templates/${platform}/`, import.meta.url));
  if (!existsSync(template)) return false;
  if (existsSync(project) && readdirSync(project).some((name) => name !== "weft")) return true;
  for (const file of globSync("**/*", { cwd: template, withFileTypes: true })) {
    if (!file.isFile()) continue;
    const source = join(file.parentPath, file.name);
    // npm drops `.gitignore` files from packages, so templates store them as `_gitignore`.
    const path = relative(template, source).replace(/(^|[\\/])_gitignore$/, "$1.gitignore");
    const target = join(project, path);
    mkdirSync(dirname(target), { recursive: true });
    const escape = placeholderEscape(file.name);
    if (!escape) {
      cpSync(source, target);
      continue;
    }
    writeFileSync(target, readFileSync(source, "utf8")
      .replaceAll("__WEFT_APP_NAME__", escape(app.name))
      .replaceAll("__WEFT_APP_ID__", escape(app.id)));
  }
  return true;
}

/** Rewrites the generated area apart from the bundle that Vite wrote into `js/`. */
function writeGenerated(generated: string, result: AppResult) {
  for (const name of readdirSync(generated)) {
    if (name !== "js") rmSync(join(generated, name), { recursive: true, force: true });
  }
  for (const file of result.views) {
    const path = join(generated, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.contents);
  }
}

/**
 * Compiles `.weft` imports and builds one Vite environment per platform.
 *
 * `vite build` builds the platforms named by `WEFT_PLATFORM` (default `web`;
 * `vite build --app` without it builds every configured platform). The `apps`
 * option sets the project directory (defaults to `./apps`); Web is a plain
 * Vite app written to `<apps>/web/`. Every other platform compiles all `.weft`
 * files matched by `include` as one program, bundles `entry` (or the first
 * existing `src/index.{js,ts,mjs,mts,cjs,cts}`) into a single file in
 * `<apps>/<platform>/weft/js/`, writes the generated views next to it, and
 * copies the project template into `<apps>/<platform>/` on the first build.
 * Native platforms also compile the bundle to Hermes
 * bytecode (`weft/bundle.hbc`); iOS and macOS then write `weft/Package.swift`
 * and build the Xcode project with `xcodebuild` on macOS hosts, Android
 * makes `weft/` a Gradle module (bytecode in its assets) and builds the APK
 * with the Gradle wrapper, Windows writes `weft/Weft.targets` and runs
 * `dotnet build` on Windows hosts, Linux writes `weft/CMakeLists.txt` and
 * builds the CMake project on Linux hosts; `WEFT_NATIVE=0` skips the native
 * builds.
 * Environments not named after a platform (dev server, Vitest) compile for
 * the Web.
 */
export default function weft(options: WeftOptions = {}): Plugin {
  const configured = options.platforms ?? PLATFORMS;
  const include = options.include ?? "src/**/*.weft";
  const { safeArea } = options;
  const appOptions = safeArea === undefined ? undefined : { safeArea };
  let root = process.cwd();
  let appsDir: string;
  let assetsDir: string;
  let building: boolean;
  let catalog: Assets | undefined;
  let dtsGenerated = false;
  const assets = () => catalog ??= scanAssets(assetsDir);
  let nativeRoot: string | undefined;
  const shells = new Map<NativePlatform, string>();
  let entry: string | undefined;
  let selected: Platform[] = [];
  /** App-level compilation of each non-Web environment; inline plugins are shared by every environment. */
  const apps = new Map<string, AppResult>();

  const platformOf = (name: string): Platform => (isPlatform(name) ? name : "web");

  return {
    name: "weft",
    enforce: "pre",
    config(config, env) {
      // Module ids are real paths; `.weft` sources are matched against them.
      root = realpathSync(resolve(config.root ?? process.cwd()));
      appsDir = resolve(root, options.apps ?? "./apps");
      assetsDir = resolve(root, options.assets ?? "assets");
      catalog = undefined;
      dtsGenerated = false;
      building = env.command === "build";
      if (!building) return;
      nativeRoot = options.native === undefined ? undefined : resolve(root, options.native);
      // The CLI passes `builder: {}` for `--app`; the plugin's own builder below makes plain `vite build` an app build.
      selected = selectPlatforms(configured, config.builder !== undefined);
      shells.clear();
      for (const platform of selected) {
        if (!isNativePlatform(platform)) continue;
        const shell = nativeShell(platform, nativeRoot);
        checkShellProtocol(platform, shell);
        shells.set(platform, shell);
      }
      entry = selected.some((platform) => platform !== "web") ? resolveEntry(root, options.entry) : undefined;
      return {
        builder: {},
        environments: Object.fromEntries(selected.map((platform) => [platform, {}])),
      };
    },
    configEnvironment(name, config) {
      const platform = platformOf(name);
      if (!isPlatform(name)) {
        // Vite makes every environment except `client` a server consumer by default.
        const server = (config.consumer ?? (name === "client" ? "client" : "server")) === "server";
        return {
          resolve: { conditions: [`weft-${platform}`, ...(server ? defaultServerConditions : defaultClientConditions)] },
          define: { __WEFT_PLATFORM__: JSON.stringify(platform) },
        };
      }
      // Platform apps run in a browser, a mini program logic layer or Hermes: never a server.
      const native = isNativePlatform(platform);
      const environment: EnvironmentOptions = {
        consumer: "client",
        resolve: {
          conditions: [`weft-${platform}`, ...(native ? ["weft-native"] : []), ...defaultClientConditions],
        },
        define: { __WEFT_PLATFORM__: JSON.stringify(platform) },
      };
      if (platform === "web") return { ...environment, build: { outDir: outDir(appsDir, platform) } };
      return {
        ...environment,
        build: {
          outDir: outDir(appsDir, platform),
          emptyOutDir: true,
          copyPublicDir: false,
          // Mini program logic layers run ES2020.
          target: native ? HERMES_TARGET : "es2020",
          rolldownOptions: {
            input: entry,
            output: {
              format: platform === "wechat" ? "cjs" : "iife",
              entryFileNames: "index.js",
              codeSplitting: false,
            },
          },
        },
      };
    },
    configureServer(server) {
      server.middlewares.use(serveWebAssets(server.config.base, assets));
      server.watcher.add(assetsDir);
      server.watcher.on("all", (event, file) => {
        if (event !== "change" && event !== "add" && event !== "unlink" && event !== "addDir" && event !== "unlinkDir") return;
        const path = relative(assetsDir, resolve(file)).replaceAll("\\", "/");
        if (path === ".." || path.startsWith("../") || isAbsolute(path)) return;
        catalog = undefined;
        for (const environment of Object.values(server.environments)) {
          const graph = environment.moduleGraph;
          const module = graph.getModuleById(RESOLVED_WEB_ASSETS_ID);
          if (module) graph.invalidateModule(module);
        }
        server.ws.send({ type: "full-reload", path: "*" });
      });
    },
    resolveId(source, _importer, resolveOptions) {
      if (source === WEB_ASSETS_ID && platformOf(this.environment.name) === "web") return RESOLVED_WEB_ASSETS_ID;
      if (!isRuntimeImport(source)) return;
      return this.resolve(source, RUNTIME_IMPORTER, { ...resolveOptions, skipSelf: true });
    },
    load(id) {
      if (id !== RESOLVED_WEB_ASSETS_ID) return;
      return webAssets(assets(), (file, output) => {
        if (!building) {
          const path = output.split("/").map((name) => encodeURIComponent(name).replaceAll("%40", "@")).join("/");
          return JSON.stringify(`${this.environment.config.base}${path}`);
        }
        this.addWatchFile(file.path);
        const reference = this.emitFile({ type: "asset", fileName: output, source: readFileSync(file.path) });
        return `import.meta.ROLLDOWN_FILE_URL_${reference}`;
      });
    },
    async buildApp(builder) {
      for (const platform of selected) await builder.build(builder.environments[platform]!);
    },
    async buildStart() {
      if (building) assets();
      if (options.dts && !dtsGenerated) {
        dtsGenerated = true;
        const outputPath = existsSync(appsDir) ? realpathSync(appsDir) : appsDir;
        for (const file of weftFiles(root, outputPath)) {
          const output = await compileApp([file], "web", (path) => readFileSync(path, "utf8"), appOptions);
          const logic = output.logic.find((module) => module.source === file);
          if (!output.hasErrors && logic) writeDeclarations(file, logic.dts);
        }
      }
      const platform = platformOf(this.environment.name);
      if (platform === "web") return;
      const entries = globSync(include, { cwd: root }).map((path) => resolve(root, path).replaceAll("\\", "/"));
      if (entries.length === 0) this.error(`weft: no .weft files match ${include} in ${root}`);
      const app = await compileApp(entries, platform, (path) => readFileSync(path, "utf8"), appOptions);
      apps.set(this.environment.name, app);
      for (const file of app.files) this.addWatchFile(file);
      if (app.hasErrors) this.error(app.diagnostics);
      if (app.diagnostics) this.warn(app.diagnostics);
    },
    async transform(code, id) {
      const file = id.split("?", 1)[0]!.replaceAll("\\", "/");
      if (!file.endsWith(".weft")) return;
      const platform = platformOf(this.environment.name);
      if (platform !== "web") {
        const logic = apps.get(this.environment.name)?.logic.find((module) => module.source === file);
        if (!logic) this.error(`${file} is not part of the app; include it with the include option (${include})`);
        return { code: logic.code, map: null };
      }
      const output = await compileApp([file], "web", (path) => (path === file ? code : readFileSync(path, "utf8")), appOptions);
      for (const loaded of output.files) this.addWatchFile(loaded);
      if (output.hasErrors) this.error(output.diagnostics);
      if (output.diagnostics) this.warn(output.diagnostics);
      const logic = output.logic.find((module) => module.source === file)!;
      if (options.dts) writeDeclarations(file, logic.dts);
      const withAssets = !building || hasAssets(assets());
      return { code: withAssets ? `import ${JSON.stringify(WEB_ASSETS_ID)};\n${logic.code}` : logic.code, map: null };
    },
    async writeBundle() {
      const platform = platformOf(this.environment.name);
      const app = apps.get(this.environment.name);
      if (platform === "web" || !app) return;
      const project = join(appsDir, platform);
      const generated = join(project, "weft");
      const name = options.app?.name ?? basename(root);
      const templated = copyTemplate(project, platform, {
        id: options.app?.id ?? defaultAppId(name),
        name,
      });
      writeGenerated(generated, app);
      if (platform === "wechat") {
        const pages = app.views
          .map((file) => file.path)
          .filter((path) => /^pages\/[^/]+\/index\.js$/.test(path))
          .map((path) => `weft/${path.slice(0, -3)}`);
        if (pages.length) {
          const manifestPath = join(project, "app.json");
          const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
          const layout = JSON.parse(app.layout) as {
            templates: { label: string }[];
            app?: { tabs?: { page: number; title: string; icon: string; activeIcon: string }[] };
          };
          const tabs = layout.app?.tabs;
          if (tabs?.length) {
            const list = tabs.map((tab) => {
              const name = layout.templates[tab.page]!.label;
              const slug = name.replace(/([A-Z])/g, (letter, _match, offset: number) => `${offset ? "-" : ""}${letter.toLowerCase()}`);
              return {
                pagePath: `weft/pages/${slug}/index`,
                text: tab.title,
                iconPath: writeWechatTabIcon(assets(), generated, tab.icon),
                selectedIconPath: writeWechatTabIcon(assets(), generated, tab.activeIcon),
              };
            });
            const first = list[0]!.pagePath;
            pages.splice(pages.indexOf(first), 1);
            pages.unshift(first);
            const existingBar = manifest.tabBar as Record<string, unknown> | undefined;
            manifest.tabBar = { color: "#808080", selectedColor: "#007aff", backgroundColor: "#ffffff", ...existingBar, list };
          } else if (manifest.tabBar && typeof manifest.tabBar === "object") {
            delete (manifest.tabBar as Record<string, unknown>).list;
            if (!Object.keys(manifest.tabBar).length) delete manifest.tabBar;
          }
          const existing = Array.isArray(manifest.pages) ? manifest.pages as string[] : [];
          manifest.pages = [...pages, ...existing.filter((page) => page !== "weft/index" && !page.startsWith("weft/pages/"))];
          writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        } else if (app.views.some((file) => file.path === "index.js")) {
          const manifestPath = join(project, "app.json");
          const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
          const existing = Array.isArray(manifest.pages) ? manifest.pages as string[] : [];
          if (existing.some((page) => page.startsWith("weft/pages/"))) {
            manifest.pages = ["weft/index", ...existing.filter((page) => page !== "weft/index" && !page.startsWith("weft/pages/"))];
            if (manifest.tabBar && typeof manifest.tabBar === "object") {
              delete (manifest.tabBar as Record<string, unknown>).list;
              if (!Object.keys(manifest.tabBar).length) delete manifest.tabBar;
            }
            writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
          }
        }
        writeWechatAssets(assets(), generated, (message) => this.warn(message));
        return;
      }
      if (!isNativePlatform(platform)) return;
      if (platform === "android") await writeAndroidAssets(assets(), generated);
      if (platform === "windows") writeWindowsAssets(assets(), generated);
      if (platform === "linux") writeLinuxAssets(assets(), generated);
      if (platform === "ios" || platform === "macos") writeAppleAssets(assets(), generated);
      const shell = shells.get(platform)!;
      const adapter = nativeAdapter(platform, shell);
      const projectPath = relative(root, project).replaceAll("\\", "/") || ".";
      const bytecode = join(generated, adapter.bytecode);
      try {
        mkdirSync(dirname(bytecode), { recursive: true });
        await compileBytecode(join(generated, "js/index.js"), bytecode, platform, shell, nativeRoot);
      } catch (error) {
        this.error(error as Error);
      }
      if (!templated) {
        this.warn(`there is no ${platform} project template yet; generated ${projectPath}/weft/ only`);
        return;
      }
      adapter.writeGlue(generated, project);
      if (process.env.WEFT_NATIVE === "0") return;
      if (adapter.host !== undefined && process.platform !== adapter.host) {
        this.warn(`${adapter.hostWarning}; generated ${projectPath}/ without building it`);
        return;
      }
      try {
        await adapter.build(project, platform, this.environment.config.mode === "release");
      } catch (error) {
        this.error(error as Error);
      }
    },
  };
}
