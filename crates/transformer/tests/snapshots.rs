//! Generated sources of each fixture, per platform.
//!
//! The snapshots exist to review changes to generated code; behavior is
//! tested end to end in the JS packages. Run the corresponding fixture test
//! with `WEFT_UPDATE_SNAPSHOTS=1` to rewrite its snapshots.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use weft_ui_parser::{MemoryLoader, load};
use weft_ui_transformer::transform::Platform;
use weft_ui_transformer::{AppOutput, compile_app};

struct Fixture {
    name: &'static str,
    source: &'static str,
    natives: &'static [Platform],
    /// Platforms whose logic or layout differ because they ignore a member used in this fixture.
    diverges: &'static [Platform],
}

impl Fixture {
    fn compile(&self, platform: Platform) -> AppOutput {
        let file = format!("{}.weft", self.name);
        let mut loader = MemoryLoader::new();
        loader.insert(&file, self.source);
        let output = compile_app(load(&[&file], &mut loader), platform, &Default::default());
        assert!(
            output.compilation.diagnostics.is_empty(),
            "{}",
            output.compilation.render_diagnostics()
        );
        output
    }

    fn snapshot_dir(&self) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/snapshots")
            .join(self.name)
    }
}

const ALL_NATIVES: &[Platform] = &[
    Platform::Ios,
    Platform::Macos,
    Platform::Android,
    Platform::Windows,
    Platform::Linux,
];
const TODO_LIST: Fixture = Fixture {
    name: "TodoList",
    source: include_str!("fixtures/TodoList.weft"),
    natives: ALL_NATIVES,
    diverges: &[],
};
const GALLERY: Fixture = Fixture {
    name: "Gallery",
    source: include_str!("fixtures/Gallery.weft"),
    natives: ALL_NATIVES,
    diverges: &[],
};
const LANGUAGE: Fixture = Fixture {
    name: "Language",
    source: include_str!("fixtures/Language.weft"),
    natives: ALL_NATIVES,
    diverges: &[],
};

const THEME: Fixture = Fixture {
    name: "Theme",
    source: include_str!("fixtures/Theme.weft"),
    natives: ALL_NATIVES,
    diverges: &[],
};

const LAYOUT: Fixture = Fixture {
    name: "Layout",
    source: include_str!("fixtures/Layout.weft"),
    natives: ALL_NATIVES,
    diverges: &[],
};

const APPEARANCE: Fixture = Fixture {
    name: "Appearance",
    source: include_str!("fixtures/Appearance.weft"),
    natives: ALL_NATIVES,
    diverges: &[],
};

const TYPOGRAPHY: Fixture = Fixture {
    name: "Typography",
    source: include_str!("fixtures/Typography.weft"),
    natives: ALL_NATIVES,
    diverges: &[],
};

const CONTROLS: Fixture = Fixture {
    name: "Controls",
    source: include_str!("fixtures/Controls.weft"),
    natives: ALL_NATIVES,
    diverges: &[],
};

const INPUTS: Fixture = Fixture {
    name: "Inputs",
    source: include_str!("fixtures/Inputs.weft"),
    natives: ALL_NATIVES,
    diverges: &[Platform::Macos, Platform::Windows, Platform::Linux],
};

const TAP: Fixture = Fixture {
    name: "Tap",
    source: include_str!("fixtures/Tap.weft"),
    natives: ALL_NATIVES,
    diverges: &[],
};

const NAVIGATION: Fixture = Fixture {
    name: "Navigation",
    source: include_str!("fixtures/Navigation.weft"),
    natives: &[
        Platform::Ios,
        Platform::Macos,
        Platform::Android,
        Platform::Windows,
        Platform::Linux,
    ],
    diverges: &[
        Platform::Ios,
        Platform::Macos,
        Platform::Android,
        Platform::Windows,
        Platform::Linux,
    ],
};

const PAGES: Fixture = Fixture {
    name: "Pages",
    source: include_str!("fixtures/Pages.weft"),
    natives: ALL_NATIVES,
    diverges: &[],
};

const ASSETS: Fixture = Fixture {
    name: "Assets",
    source: include_str!("fixtures/Assets.weft"),
    natives: ALL_NATIVES,
    diverges: &[],
};

/// Every generated file of the app, as the platform's output directory would
/// hold it: logic modules at `X.js` / `X.d.ts`, then the view files.
fn generated_files(output: AppOutput) -> BTreeMap<String, String> {
    let mut files = BTreeMap::new();
    for module in output.logic {
        let stem = module
            .source
            .strip_suffix(".weft")
            .unwrap_or(&module.source);
        files.insert(format!("{stem}.js"), module.code);
        files.insert(format!("{stem}.d.ts"), module.dts);
    }
    // Asset manifests are tested as Vite output. The compiler emits an empty
    // one for standalone WeChat builds; in this flat snapshot directory its
    // name would collide with the logic for Assets.weft on case-insensitive disks.
    files.extend(
        output
            .views
            .into_iter()
            .filter(|f| f.path != "assets.js")
            .map(|f| (f.path, f.contents)),
    );
    files
}

fn check(fixture: &Fixture, platform: Platform, generated: &BTreeMap<String, String>) {
    let dir = fixture.snapshot_dir().join(platform.as_str());
    if std::env::var_os("WEFT_UPDATE_SNAPSHOTS").is_some() {
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("snapshot directory is writable");
        for (path, contents) in generated {
            let path = dir.join(path);
            let parent = path.parent().expect("snapshot has a parent directory");
            fs::create_dir_all(parent).expect("snapshot directory is writable");
            fs::write(path, contents).expect("snapshot is writable");
        }
        return;
    }
    let mut stored = BTreeMap::new();
    read_snapshots(&dir, "", &mut stored);
    assert_eq!(
        generated.keys().collect::<Vec<_>>(),
        stored.keys().collect::<Vec<_>>(),
        "generated files of {}/{platform}",
        fixture.name
    );
    for (path, contents) in generated {
        assert_eq!(
            contents, &stored[path],
            "{}/{platform}/{path}",
            fixture.name
        );
    }
}

fn read_snapshots(dir: &Path, prefix: &str, stored: &mut BTreeMap<String, String>) {
    for entry in fs::read_dir(dir).unwrap_or_else(|err| panic!("{}: {err}", dir.display())) {
        let entry = entry.expect("snapshot directory is readable");
        let name = entry.file_name();
        let name = name.to_str().expect("snapshot names are UTF-8");
        let path = entry.path();
        let file_type = entry.file_type().expect("snapshot type is readable");
        if file_type.is_dir() {
            read_snapshots(&path, &format!("{prefix}{name}/"), stored);
        } else {
            let contents = fs::read_to_string(&path).expect("snapshot is readable");
            stored.insert(format!("{prefix}{name}"), contents);
        }
    }
}

#[test]
fn todo_list() {
    check_fixture(&TODO_LIST);
}

#[test]
fn gallery() {
    check_fixture(&GALLERY);
}

#[test]
fn language() {
    check_fixture(&LANGUAGE);
}

#[test]
fn theme() {
    check_fixture(&THEME);
}

#[test]
fn layout() {
    check_fixture(&LAYOUT);
}

#[test]
fn appearance() {
    check_fixture(&APPEARANCE);
}

#[test]
fn typography() {
    check_fixture(&TYPOGRAPHY);
}

#[test]
fn controls() {
    check_fixture(&CONTROLS);
}

#[test]
fn inputs() {
    check_fixture(&INPUTS);
}

#[test]
fn tap() {
    check_fixture(&TAP);
}

#[test]
fn assets() {
    check_fixture(&ASSETS);
}

#[test]
fn pages() {
    check_fixture(&PAGES);
}

#[test]
fn navigation() {
    check_fixture(&NAVIGATION);
}

fn check_fixture(fixture: &Fixture) {
    let web = generated_files(fixture.compile(Platform::Web));
    check(fixture, Platform::Web, &web);

    let wechat = fixture.compile(Platform::Wechat);
    let layout = wechat
        .layout
        .as_ref()
        .expect("wechat has a layout")
        .to_json();
    check_layout(fixture, &layout);
    let wechat = generated_files(wechat);
    check(fixture, Platform::Wechat, &wechat);

    check_native(fixture, &wechat, &layout);
}

#[test]
fn web_imports_the_theme_declaration_even_when_the_token_folds_to_a_number() {
    let mut loader = MemoryLoader::new();
    loader.insert("Palette.weft", "theme { gap = 8 }");
    loader.insert(
        "App.weft",
        "import \"./Palette.weft\"\ncomponent App() { Column(gap = theme.gap) }",
    );
    let output = compile_app(
        load(&["App.weft"], &mut loader),
        Platform::Web,
        &Default::default(),
    );
    assert!(
        output.compilation.diagnostics.is_empty(),
        "{}",
        output.compilation.render_diagnostics()
    );
    assert!(output.logic[0].code.contains("import \"./Palette.weft\";"));
    assert!(output.logic[0].code.contains("gap:8px"));
}

#[test]
fn changing_only_the_dark_color_updates_the_layout_hash() {
    let compile = |source: &str| {
        let mut loader = MemoryLoader::new();
        loader.insert("Theme.weft", source);
        let output = compile_app(
            load(&["Theme.weft"], &mut loader),
            Platform::Wechat,
            &Default::default(),
        );
        output
            .layout
            .unwrap_or_else(|| panic!("{}", output.compilation.render_diagnostics()))
    };
    let layout = compile(THEME.source);
    let alternate = compile(&THEME.source.replace("#409cff", "#123"));
    assert_eq!(layout.templates(), alternate.templates());
    assert_eq!(layout.theme().len(), 1);
    assert_ne!(layout.hash(), alternate.hash());
}

#[test]
fn color_transform_and_unified_wechat_view() {
    let src = r##"
component C(color: String) {
  Column(background = color) {
    Row(background = "#AbC") {
      Text("x", color = color)
      Text("y", color = "#12345680")
    }
  }
}
"##;
    let mut loader = MemoryLoader::new();
    loader.insert("ui/C.weft", src);
    let mut css_indices = None;
    for platform in [Platform::Web, Platform::Wechat] {
        let output = compile_app(
            load(&["ui/C.weft"], &mut loader),
            platform,
            &Default::default(),
        );
        assert!(
            output.compilation.diagnostics.is_empty(),
            "{}",
            output.compilation.render_diagnostics()
        );
        let code = &output.logic[0].code;
        if platform == Platform::Web {
            assert_eq!(code.matches("$.style(").count(), 4);
            assert!(code.contains("background-color:#aabbcc"));
            assert!(code.contains("color:#12345680"));
            assert_eq!(code.matches("w-column").count(), 1);
            assert_eq!(code.matches("w-row").count(), 1);
            let index_for = |node| {
                let (_, binding) = code
                    .split_once(&format!("$.style({node}, "))
                    .expect("dynamic color has a CSS binding");
                let (index, _) = binding.split_once(',').expect("binding has a CSS index");
                index.parse::<usize>().expect("CSS index is numeric")
            };
            let indices = [index_for("n3"), index_for("n0")];
            assert_ne!(
                indices[0], indices[1],
                "background and color map differently"
            );
            css_indices = Some(indices);
            continue;
        }
        assert!(code.starts_with("import * as $ from \"@weft-ui/runtime/remote\";"));
        let files: BTreeMap<&str, &str> = output
            .views
            .iter()
            .map(|file| (file.path.as_str(), file.contents.as_str()))
            .collect();
        assert_eq!(
            files.keys().copied().collect::<Vec<_>>(),
            [
                "index.js",
                "index.json",
                "index.wxml",
                "index.wxss",
                "view.js",
                "view.json",
                "view.wxml",
                "view.wxss"
            ]
        );
        assert!(files["view.js"].starts_with("Component(getApp().weft.view({\n"));
        assert!(files["view.js"].ends_with("}));\n"));
        let [background, color] = css_indices.expect("the Web bindings were checked first");
        assert!(files["view.js"].contains(&format!(
            "v: [[\"n3_0\", {background}], [\"n0_0\", {color}]]"
        )));
        assert!(!files["view.js"].contains("import "));
        assert!(!files["view.js"].contains("require("));
        assert!(files["view.wxml"].contains("background-color:#aabbcc"));
        assert!(files["view.wxml"].contains("color:#12345680"));
        assert_eq!(files["view.wxml"].matches("w-column").count(), 1);
        assert_eq!(files["view.wxml"].matches("w-row").count(), 1);
        assert!(files["view.wxss"].contains(".w-column{"));
        assert!(files["view.wxss"].contains(".w-row{"));
        assert!(
            files["index.js"].contains("getApp().weft.mount(this.selectComponent(\"#weft\"));")
        );
        assert!(files["index.js"].contains("getApp().weft.unmount();"));
    }
}

#[test]
fn remote_imports_preserve_weft_extensions() {
    let mut loader = MemoryLoader::new();
    loader.insert("ui/C.weft", "import \"./D.weft\"\ncomponent C() { D() }");
    loader.insert("ui/D.weft", "component D() { Text(\"x\") }");
    let output = compile_app(
        load(&["ui/C.weft"], &mut loader),
        Platform::Wechat,
        &Default::default(),
    );
    assert!(
        output.compilation.diagnostics.is_empty(),
        "{}",
        output.compilation.render_diagnostics()
    );
    assert!(output.logic[0].code.contains("from \"./D.weft\""));
}

/// The view protocol layout is the same for every non-Web platform.
fn check_layout(fixture: &Fixture, json: &str) {
    let path = fixture.snapshot_dir().join("layout.json");
    if std::env::var_os("WEFT_UPDATE_SNAPSHOTS").is_some() {
        fs::write(&path, json).expect("snapshot is writable");
        return;
    }
    let stored =
        fs::read_to_string(&path).unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    assert_eq!(json, stored, "{}/layout.json", fixture.name);
}

/// Native platforms run the mini program's logic modules with another sink,
/// next to the layout and the views of their backend.
fn check_native(fixture: &Fixture, wechat: &BTreeMap<String, String>, layout: &str) {
    let name = fixture.name;
    let js = format!("{name}.js");
    let dts = format!("{name}.d.ts");
    let shared_apple = [Platform::Ios, Platform::Macos]
        .iter()
        .all(|platform| fixture.natives.contains(platform) && !fixture.diverges.contains(platform));
    for &platform in fixture.natives {
        let view = match platform {
            Platform::Ios if shared_apple => continue,
            Platform::Ios | Platform::Macos => "Generated.swift",
            Platform::Android => "src/main/kotlin/Generated.kt",
            Platform::Windows => "Generated.cs",
            Platform::Linux => "Generated.cpp",
            Platform::Web | Platform::Wechat => panic!("{platform} is not native"),
        };
        let native = generated_files(fixture.compile(platform));
        let mut expected = [js.as_str(), dts.as_str(), "layout.json", view];
        expected.sort_unstable();
        assert_eq!(
            native.keys().collect::<Vec<_>>(),
            expected,
            "{name}/{platform}"
        );
        if !fixture.diverges.contains(&platform) {
            assert_eq!(native[&js], wechat[&js], "{name}/{platform}/{js}");
            assert_eq!(native[&dts], wechat[&dts], "{name}/{platform}/{dts}");
            assert_eq!(
                native["layout.json"], layout,
                "{name}/{platform}/layout.json"
            );
        }
        // iOS and macOS share one SwiftUI backend; differences live in WeftKit.
        if platform == Platform::Macos && shared_apple {
            let ios = generated_files(fixture.compile(Platform::Ios));
            assert_eq!(ios, native, "{name}/ios differs from macos");
        }
        check(fixture, platform, &native);
    }
}
