/** Copy of the landing page, one entry per site locale. */
export type Lang = "zh-CN" | "en";

interface Text {
  title: string;
  body: string;
}

export interface LandingStrings {
  /** URL prefix of the locale ("" for the root locale, English). */
  prefix: string;
  /** The other locale, for the language switch. */
  other: { lang: Lang; label: string; href: string };
  title: string;
  description: string;
  nav: { guides: string; grammar: string; protocol: string; docs: string };
  pill: string;
  headline: [string, string];
  lead: [string, string];
  start: string;
  copy: string;
  caption: [string, string];
  showcase: {
    eyebrow: string;
    heading: string;
    sub: string;
    /** Name of the WeChat mini program platform. */
    wechat: string;
    /** Alt text of a screenshot, around the platform name. */
    alt: [string, string];
    prev: string;
    next: string;
    pause: string;
    play: string;
  };
  platforms: {
    eyebrow: string;
    heading: string;
    sub: string;
    browser: string;
    miniProgram: string;
    devTools: string;
    protocol: Text;
  };
  features: { eyebrow: string; heading: string; sub: string; items: Text[] };
  steps: { eyebrow: string; heading: string; items: (Text & { code: string })[] };
  final: { heading: string; sub: string; primary: string; secondary: string };
  theme: { label: string; light: string; auto: string; dark: string };
}

export const landing: Record<Lang, LandingStrings> = {
  "zh-CN": {
    prefix: "/zh",
    other: { lang: "en", label: "EN", href: "/" },
    title: "Weft UI — 一次编写，处处原生界面",
    description:
      "Weft UI 是一门编译型 UI 语言：用 .weft 描述视图，用 JS/TS 写逻辑，编译成 DOM、微信小程序、SwiftUI、Jetpack Compose、WinUI 3 和 GTK 4 的原生代码。",
    nav: { guides: "指南", grammar: "语法", protocol: "视图协议", docs: "文档" },
    pill: "7 个平台 · 原生视图 · 一份逻辑",
    headline: ["一次编写", "处处原生界面"],
    lead: [
      "Weft UI 是一门编译型 UI 语言。用",
      "描述视图，用 JS/TS 写逻辑，编译成 DOM、微信小程序、SwiftUI、Jetpack Compose、WinUI 3 和 GTK 4 的原生代码。",
    ],
    start: "快速上手",
    copy: "复制命令",
    caption: ["视图声明在", "里，状态和业务逻辑留在 TypeScript。视图想改 model，只能发出事件。"],
    showcase: {
      eyebrow: "效果",
      heading: "同一个应用，七个平台的原生界面",
      sub: "仓库里的 example 应用，分别在七个平台上构建、运行并截图。.weft 文件和 TypeScript 逻辑完全相同，按钮、输入框和复选框都是各平台自己的控件。",
      wechat: "微信小程序",
      alt: ["示例应用在 ", " 上运行的截图"],
      prev: "上一张",
      next: "下一张",
      pause: "暂停轮播",
      play: "继续轮播",
    },
    platforms: {
      eyebrow: "平台",
      heading: "七个平台，一种写法",
      sub: "语言不变，后端换成每个平台自己的视图层。原生平台共享同一个嵌入 Hermes 的 C++ 内核。",
      browser: "浏览器",
      miniProgram: "小程序逻辑层",
      devTools: "开发者工具",
      protocol: { title: "视图协议", body: "JS 逻辑层与各平台视图层之间的 ops 约定 →" },
    },
    features: {
      eyebrow: "特性",
      heading: "编译期做完大部分工作",
      sub: "用 .weft 描述视图，复用样式和随系统切换的深浅主题，并打包本地图片和自定义字体。",
      items: [
        {
          title: "原生视图",
          body: "22 个内置元素，支持富文本、安全区和惰性列表与网格。列表支持分组、下拉刷新和加载更多；页面支持栈、Tab 和模态导航。",
        },
        {
          title: "编译期依赖分析",
          body: "类型检查、依赖分析和模板展开都在编译期完成。没有虚拟 DOM，运行时只做细粒度更新。",
        },
        {
          title: "单向数据流",
          body: "视图只能读 model、只能改组件私有的 state。修改 model 必须发出 event，交给逻辑层处理。",
        },
        {
          title: "一份 JS/TS 逻辑",
          body: "Web 和小程序用平台自带的引擎，其余平台嵌入 Hermes，发布时预编译成字节码。",
        },
        {
          title: "统一平台 API",
          body: "@weft-ui/platform 提供 navigation、ui 和 lifecycle，以及 run、fetch、storage、platform；支持深链、对话框与应用生命周期。不支持的调用以 PlatformError 拒绝。",
        },
        {
          title: "完整工具链",
          body: "weft fmt、weft lsp、tree-sitter 语法和 Zed 扩展；TypeScript content mapper 让类型错误直接落在 .weft 源码上。",
        },
      ],
    },
    steps: {
      eyebrow: "构建",
      heading: "一条命令，从源码到原生工程",
      items: [
        { title: "描述视图", body: "在 .weft 里声明 model、event 和组件。", code: "App.weft" },
        { title: "编写逻辑", body: "在 TypeScript 里处理事件、修改 model。", code: "index.ts" },
        { title: "编译", body: "Vite 插件调用 WASM 编译器，生成逻辑模块、布局和原生视图代码。", code: "@weft-ui/vite" },
        { title: "出包", body: "生成 apps/<platform>/ 原生工程，再调用宿主构建工具。", code: "apps/<platform>/" },
      ],
    },
    final: { heading: "开始用 Weft UI 编织界面", sub: "从指南读起，或者直接看示例工程。", primary: "阅读指南", secondary: "查看示例" },
    theme: { label: "主题", light: "浅色", auto: "跟随系统", dark: "深色" },
  },
  en: {
    prefix: "",
    other: { lang: "zh-CN", label: "中文", href: "/zh/" },
    title: "Weft UI — Write once. Native UI everywhere.",
    description:
      "Weft UI is a compiled UI language: describe views in .weft, write logic in JS/TS, and compile to native code for the DOM, WeChat mini programs, SwiftUI, Jetpack Compose, WinUI 3 and GTK 4.",
    nav: { guides: "Guides", grammar: "Grammar", protocol: "View protocol", docs: "Docs" },
    pill: "7 platforms · Native views · One codebase",
    headline: ["Write once.", "Native UI everywhere."],
    lead: [
      "Weft UI is a compiled UI language. Describe views in",
      ", write logic in JS/TS, and compile to native code for the DOM, WeChat mini programs, SwiftUI, Jetpack Compose, WinUI 3 and GTK 4.",
    ],
    start: "Get started",
    copy: "Copy command",
    caption: [
      "Views are declared in",
      "; state and business logic stay in TypeScript. A view changes the model only by sending events.",
    ],
    showcase: {
      eyebrow: "Showcase",
      heading: "One app, native on all seven",
      sub: "The repository's example app, built, run and captured on each platform. The .weft file and the TypeScript logic are identical; the buttons, inputs and checkboxes are each platform's own controls.",
      wechat: "WeChat",
      alt: ["The example app running on ", ""],
      prev: "Previous screenshot",
      next: "Next screenshot",
      pause: "Pause the slideshow",
      play: "Resume the slideshow",
    },
    platforms: {
      eyebrow: "Platforms",
      heading: "Seven platforms, one way to write",
      sub: "The language stays the same; each backend targets the platform's own view layer. Native platforms share one C++ kernel that embeds Hermes.",
      browser: "Browser",
      miniProgram: "Mini program runtime",
      devTools: "DevTools",
      protocol: { title: "View protocol", body: "The ops contract between the JS logic layer and every view layer →" },
    },
    features: {
      eyebrow: "Features",
      heading: "Most of the work happens at compile time",
      sub: "Describe views in .weft with reusable styles, light and dark themes that follow the system, and bundled images and custom fonts.",
      items: [
        {
          title: "Native views",
          body: "22 built-in elements cover rich text, safe-area layout, and lazy lists and grids. Lists support sections, pull-to-refresh and load-more; pages support stack, tab and modal navigation.",
        },
        {
          title: "Compile-time dependency analysis",
          body: "Type checking, dependency analysis and template expansion happen at compile time. No virtual DOM; the runtime only does fine-grained updates.",
        },
        {
          title: "Unidirectional data flow",
          body: "Views can only read the model and change their component's private state. Changing the model means sending an event to the logic layer.",
        },
        {
          title: "One JS/TS codebase",
          body: "The Web and mini programs use the platform's own engine; every other platform embeds Hermes, with bytecode precompiled for release.",
        },
        {
          title: "One platform API",
          body: "@weft-ui/platform provides navigation, ui and lifecycle alongside run, fetch, storage and platform, including deep links, dialogs and app lifecycle events. Unsupported calls reject with PlatformError.",
        },
        {
          title: "Complete tooling",
          body: "weft fmt, weft lsp, a tree-sitter grammar and a Zed extension; the TypeScript content mapper reports type errors right in the .weft source.",
        },
      ],
    },
    steps: {
      eyebrow: "Build",
      heading: "One command from source to native project",
      items: [
        { title: "Describe views", body: "Declare models, events and components in .weft.", code: "App.weft" },
        { title: "Write logic", body: "Handle events and update the model in TypeScript.", code: "index.ts" },
        {
          title: "Compile",
          body: "The Vite plugin runs the WASM compiler to generate logic modules, the layout and native view code.",
          code: "@weft-ui/vite",
        },
        {
          title: "Ship",
          body: "Generates the native project in apps/<platform>/, then runs the host build tool.",
          code: "apps/<platform>/",
        },
      ],
    },
    final: {
      heading: "Start weaving interfaces with Weft UI",
      sub: "Start with the guides, or jump straight into the example project.",
      primary: "Read the guides",
      secondary: "See the example",
    },
    theme: { label: "Theme", light: "Light", auto: "System", dark: "Dark" },
  },
};
