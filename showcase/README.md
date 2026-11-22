# Weft Showcase

The showcase is a reference app built from the `.weft` pages in `src/pages/`. Run `pnpm --filter showcase build:<platform>` from the workspace root for `web`, `wechat`, `ios`, `macos`, `android`, `windows`, or `linux`. All platforms use the same catalog, generated from `pages.json`. Build one platform at a time in a checkout. To add a page, add its kebab-case `id` and `title` to the manifest, and use the ID converted to PascalCase for the filename and component (`my-page` → `MyPage.weft`, `component MyPage()`). Set `component` to override the exported name if the derived name is reserved. Use `props` to supply component arguments as an object in parameter order, for example `"props": { "regions": ["Local", "Remote"] }`. Values must be string arrays, and field names must be unique across all pages. `dark: true` adds a dark screenshot where supported.

See [Screenshot regression](../CONTRIBUTING.md#screenshot-regression) for platform setup; Web screenshots are recorded in a Docker container. `pnpm --filter showcase shot:<platform>` launches each page and saves its screenshot under `screenshots/actual/<platform>/`. Web, iOS, Android and WeChat also compare against `screenshots/baseline/<platform>/`; failing comparisons write `screenshots/diff/<platform>/`. To record an intentional change, run the same command with `WEFT_UPDATE_SNAPSHOTS=1`, then review the new screenshots before committing them. macOS, Windows and Linux captures are for manual review only. Set `WEFT_SHOT_PAGES` to a comma-separated list of page ids (for example `WEFT_SHOT_PAGES=inputs,text`) to capture only those pages.

If WeChat DevTools rejects the template's `touristappid`, set `appid` to an AppID your signed-in account can use in `apps/wechat/project.private.config.json`. That file stays local. Dark shots use the `wechatide` CLI to switch the simulator's appearance. Set `WEFT_WECHAT_IDE_CLI` if it isn't on `PATH`; authorize the CLI client `Weft Showcase` or set `WEFT_WECHAT_IDE_CLIENT` to an authorized name. If DevTools requires a CLI token, pass it in `WEFT_WECHAT_IDE_TOKEN`.

## Fieldnotes reference screens

The six `feed`, `detail`, `profile`, `form`, `settings`, and `empty` pages are independent snapshots of an outdoor journal. They share the screen layout, card styles, and settings rows in `src/Fieldnotes.weft`. All content and artwork ship with the showcase. Controls update local state only; registration does not send data, and Settings follows the system’s light or dark appearance.

## 中文

`feed`、`detail`、`profile`、`form`、`settings` 和 `empty` 是户外手记应用 Fieldnotes 的六个独立页面，共用 `src/Fieldnotes.weft` 中的页面布局、卡片样式和设置行。内容和插图随应用打包。控件只修改本地状态，注册表单不发送数据，设置页的深浅配色跟随系统。

从仓库根目录运行 `pnpm --filter showcase build:<平台>`，生成目录并构建对应平台。`pages.json` 的 `id` 用短横线连接单词，页面文件及组件默认用对应的 PascalCase（例如 `my-page` 对应 `MyPage.weft` 和 `component MyPage()`）。若默认名称是保留字，可用 `component` 指定导出的组件名。要给组件传参，可用 `props` 按参数顺序列出字段，例如 `"props": { "regions": ["本地", "远程"] }`。值必须是字符串数组，字段名不能与其他页面重复。`dark: true` 会额外生成支持深色模式的平台截图。

按[截图回归](../CONTRIBUTING.md#screenshot-regression)准备运行环境。`pnpm --filter showcase shot:<平台>` 的截图在 `screenshots/actual/`，差异图在 `screenshots/diff/`。Web、iOS、Android 和微信小程序比对基线；其余桌面平台只做人工检查。设置 `WEFT_SHOT_PAGES` 为逗号分隔的页面 id（例如 `WEFT_SHOT_PAGES=inputs,text`），可以只截取这些页面。确认界面变化是预期行为后，可加 `WEFT_UPDATE_SNAPSHOTS=1` 更新基线，提交前逐张检查。

若微信开发者工具不接受 `touristappid`，请在本地的 `apps/wechat/project.private.config.json` 中设置 `appid`，使用已登录账号有权限的 AppID，不要提交此文件。深色截图用 `wechatide` 命令行切换模拟器外观。若 `PATH` 中没有该命令，请设置 `WEFT_WECHAT_IDE_CLI`；授权 `Weft Showcase` 客户端，或通过 `WEFT_WECHAT_IDE_CLIENT` 指定已授权的名称。若开发者工具要求 CLI 令牌，请通过 `WEFT_WECHAT_IDE_TOKEN` 提供。
