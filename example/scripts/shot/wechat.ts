import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import automator from "miniprogram-automator";
import { componentName, pages } from "../pages.ts";
import { build, prepareShots, settleMs } from "./cases.ts";
import { compare } from "./compare.ts";

const { shots } = prepareShots("wechat");
if (!shots.length) process.exit(0);

const cliPath = process.env.WEFT_WECHAT_CLI
  ?? (process.platform === "darwin" ? "/Applications/wechatwebdevtools.app/Contents/MacOS/cli" : undefined);
if (!cliPath || !existsSync(cliPath)) {
  throw new Error("Set WEFT_WECHAT_CLI to the WeChat DevTools command-line executable");
}

const projectPath = resolve("apps/wechat");
const hasDarkShots = shots.some(({ scheme }) => scheme === "dark");
function setScheme(scheme: "light" | "dark"): void {
  const executable = process.env.WEFT_WECHAT_IDE_CLI ?? "wechatide";
  const client = process.env.WEFT_WECHAT_IDE_CLIENT ?? "Weft Showcase";
  const args = ["-c", client, "simulator_set_darkmode", "--project", projectPath, "--mode", scheme];
  const token = process.env.WEFT_WECHAT_IDE_TOKEN;
  if (token) args.push("--token", token);
  const { error, status, stdout: output } = spawnSync(executable, args, {
    encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], timeout: 30_000,
  });
  if (error || status !== 0) {
    throw new Error(`Could not run ${executable} to set WeChat simulator appearance: ${error?.message ?? output}`);
  }
  const reply: { ok: boolean; result?: { success: boolean } } = JSON.parse(output);
  if (!reply.ok || reply.result?.success !== true) {
    throw new Error(`Could not set WeChat simulator appearance to ${scheme}: ${output}`);
  }
}

build("wechat");
const miniProgram = await automator.launch({ cliPath, projectPath }).catch((cause) => {
  const help = cause instanceof Error && cause.message.includes("APPID_ERROR")
    ? "Set an AppID your account can use in apps/wechat/project.private.config.json."
    : "Sign in to WeChat DevTools and enable Settings → Security → Service Port.";
  throw new Error(`Could not start WeChat automation. ${help}`, { cause });
});
let activeScheme: "light" | "dark" | undefined;
let failure: unknown;
async function waitForPage(target: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const current = await miniProgram.currentPage();
    if (current?.path.replace(/^\//, "") === target.split("?")[0]!.replace(/^\//, "")) {
      const view = await current.$("#weft");
      if (view && (await view.$$("text")).length) return;
    }
    await setTimeout(100);
  }
  throw new Error(`Timed out rendering ${target}`);
}
try {
  await miniProgram.callWxMethod("clearStorageSync");
  // Finish mounting the application before the first reLaunch to a sub-package.
  await miniProgram.reLaunch("/weft/pages/feed/index");
  await waitForPage("/weft/pages/feed/index");
  for (const { id, link, scheme, path } of shots) {
    if (hasDarkShots && scheme !== activeScheme) {
      setScheme(scheme);
      activeScheme = scheme;
      // Changing the simulator appearance reloads the running mini program.
      await miniProgram.reLaunch("/weft/pages/feed/index");
      await waitForPage("/weft/pages/feed/index");
      await setTimeout(settleMs);
    }
    // Start each route from a clean tab root; reLaunch does not restart DevTools.
    await miniProgram.reLaunch("/weft/pages/feed/index");
    await waitForPage("/weft/pages/feed/index");
    // Mini-program links use generated page paths and query parameters, not app URLs.
    const appRoutes: Record<string, string> = {
      "/": "feed", "/discover": "discover", "/inbox": "inbox", "/me": "me",
      "/settings": "social-settings", "/login": "login", "/publish": "publish",
    };
    let target: string;
    const detail = /^\/notes\/([^/]+)$/.exec(link);
    if (detail) target = `/weft/pages/detail/index?id=${encodeURIComponent(decodeURIComponent(detail[1]!))}`;
    else if (appRoutes[link]) target = `/weft/pages/${appRoutes[link]}/index`;
    else if (link === `/showcase/${id}`) {
      const entry = pages("wechat").find((item) => item.id === id);
      if (!entry) throw new Error(`Unknown WeChat showcase page ${id}`);
      const slug = `${componentName(entry)}Page`.replace(/([A-Z])/g, (letter, _match, offset: number) => `${offset ? "-" : ""}${letter.toLowerCase()}`);
      target = `/showcase/weft/pages/${slug}/index`;
    } else throw new Error(`Unsupported WeChat screenshot link ${link}`);
    const page = await miniProgram.reLaunch(target);
    if (!page) throw new Error(`Could not open ${target}`);
    if (hasDarkShots) {
      const theme = await miniProgram.evaluate("() => wx.getAppBaseInfo().theme");
      if (theme !== scheme) throw new Error(`Expected WeChat appearance ${scheme}, got ${theme}`);
    }
    // reLaunch resolves before the new view is mounted.
    await waitForPage(target);
    await setTimeout(settleMs);
    await miniProgram.screenshot({ path });
  }
} catch (error) {
  failure = error;
  throw error;
} finally {
  try {
    if (activeScheme === "dark") setScheme("light");
  } finally {
    try {
      await miniProgram.close();
    } catch (error) {
      if (!failure) throw error;
      console.error("Could not close WeChat DevTools:", error);
    }
  }
}
compare("wechat", shots);
