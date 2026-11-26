import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import automator from "miniprogram-automator";
import type Element from "miniprogram-automator/out/Element.js";
import type { ScrollViewElement } from "miniprogram-automator/out/Element.js";
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
try {
  for (const { id, scheme, path } of shots) {
    if (hasDarkShots && scheme !== activeScheme) {
      setScheme(scheme);
      activeScheme = scheme;
    }
    const page = await miniProgram.reLaunch("/weft/index");
    if (!page) throw new Error("Could not open /weft/index");
    if (hasDarkShots) {
      const theme = await miniProgram.evaluate("() => wx.getAppBaseInfo().theme");
      if (theme !== scheme) throw new Error(`Expected WeChat appearance ${scheme}, got ${theme}`);
    }
    await page.waitFor("#weft");
    const view = await page.$("#weft");
    if (!view) throw new Error("Could not find the Weft view on /weft/index");
    let button: Element | undefined;
    const deadline = Date.now() + 5000;
    do {
      const buttons: Element[] = await view.$$("button");
      const labels = await Promise.all(buttons.map((element) => element.text()));
      button = buttons[labels.indexOf(`page:${id}`)];
      if (button) break;
      await setTimeout(100);
    } while (Date.now() < deadline);
    if (!button) throw new Error(`No catalog button page:${id}`);

    const viewport = await view.$("scroll-view") as ScrollViewElement | null;
    if (!viewport) throw new Error("Could not find the catalog Scroll");
    const top = Number((await button.offset()).top) - Number((await viewport.offset()).top);
    if (top < 0 || top + Number((await button.size()).height) > Number((await viewport.size()).height)) {
      await viewport.scrollTo(0, top);
    }
    await button.tap();
    await setTimeout(settleMs);
    await miniProgram.screenshot({ path });
  }
} finally {
  try {
    if (activeScheme === "dark") setScheme("light");
  } finally {
    await miniProgram.close();
  }
}
compare("wechat", shots);
