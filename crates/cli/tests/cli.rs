use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(prefix: &str) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock is after unix epoch")
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("weft-cli-{prefix}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn weft() -> Command {
    Command::new(env!("CARGO_BIN_EXE_weft"))
}

#[test]
fn help_version_and_usage_errors() {
    let help = weft().arg("--help").output().expect("run weft --help");
    assert!(help.status.success());
    assert!(String::from_utf8_lossy(&help.stdout).contains("Usage: weft"));

    let version = weft()
        .arg("--version")
        .output()
        .expect("run weft --version");
    assert!(version.status.success());
    assert!(String::from_utf8_lossy(&version.stdout).starts_with("weft "));

    let missing = weft().output().expect("run weft with no args");
    assert_eq!(missing.status.code(), Some(2));

    let bad_flag = weft()
        .args(["fmt", "--bogus"])
        .output()
        .expect("run weft fmt --bogus");
    assert_eq!(bad_flag.status.code(), Some(2));

    let conflict = weft()
        .args(["fmt", "--stdin", "--check"])
        .output()
        .expect("run weft fmt --stdin --check");
    assert_eq!(conflict.status.code(), Some(2));
}

#[test]
fn fmt_stdin_formats_valid_and_reports_invalid_with_path() {
    let mut valid = weft()
        .args(["fmt", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn weft fmt --stdin");
    valid
        .stdin
        .take()
        .expect("stdin pipe")
        .write_all(b"component C(){Text(\"hi\")}\n")
        .expect("write stdin");
    let output = valid.wait_with_output().expect("wait weft fmt --stdin");
    assert!(output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        "component C() {\n    Text(\"hi\")\n}\n"
    );

    let mut invalid = weft()
        .args(["fmt", "--stdin", "--path", "Broken.weft"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn invalid weft fmt --stdin");
    invalid
        .stdin
        .take()
        .expect("stdin pipe")
        .write_all(b"component C( {\n")
        .expect("write invalid stdin");
    let output = invalid
        .wait_with_output()
        .expect("wait invalid weft fmt --stdin");
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stderr).contains("Broken.weft"));
}

#[test]
fn fmt_check_and_in_place_honor_gitignore_and_skip_hidden() {
    let dir = TempDir::new("fmt");
    let root = dir.path();
    fs::create_dir_all(root.join(".git")).expect("create .git");
    fs::write(root.join(".gitignore"), "ignored.weft\nignored_dir/\n").expect("write .gitignore");
    fs::create_dir_all(root.join("ignored_dir")).expect("create ignored_dir");
    fs::create_dir_all(root.join(".hidden")).expect("create .hidden");

    let unformatted = "component C(){Text(\"hi\")}\n";
    let formatted = "component C() {\n    Text(\"hi\")\n}\n";

    let main_file = root.join("App.weft");
    let ignored_file = root.join("ignored.weft");
    let ignored_dir_file = root.join("ignored_dir/Skip.weft");
    let hidden_file = root.join(".hidden/Hidden.weft");
    let explicit_other = root.join("Custom.txt");

    fs::write(&main_file, unformatted).expect("write App.weft");
    fs::write(&ignored_file, unformatted).expect("write ignored.weft");
    fs::write(&ignored_dir_file, unformatted).expect("write Skip.weft");
    fs::write(&hidden_file, unformatted).expect("write Hidden.weft");
    fs::write(&explicit_other, unformatted).expect("write Custom.txt");

    let check = weft()
        .args(["fmt", "--check"])
        .arg(root)
        .output()
        .expect("run weft fmt --check");
    assert_eq!(check.status.code(), Some(1));
    let stdout = String::from_utf8_lossy(&check.stdout);
    assert!(stdout.contains("App.weft"), "{stdout}");
    assert!(!stdout.contains("ignored.weft"), "{stdout}");
    assert!(!stdout.contains("Skip.weft"), "{stdout}");
    assert!(!stdout.contains("Hidden.weft"), "{stdout}");
    assert!(!stdout.contains("Custom.txt"), "{stdout}");

    let write = weft().arg("fmt").arg(root).output().expect("run weft fmt");
    assert!(write.status.success());
    assert_eq!(
        fs::read_to_string(&main_file).expect("read App.weft"),
        formatted
    );
    assert_eq!(
        fs::read_to_string(&ignored_file).expect("read ignored.weft"),
        unformatted
    );
    assert_eq!(
        fs::read_to_string(&ignored_dir_file).expect("read Skip.weft"),
        unformatted
    );
    assert_eq!(
        fs::read_to_string(&hidden_file).expect("read Hidden.weft"),
        unformatted
    );
    assert_eq!(
        fs::read_to_string(&explicit_other).expect("read Custom.txt"),
        unformatted
    );

    let recheck = weft()
        .args(["fmt", "--check"])
        .arg(root)
        .output()
        .expect("run weft fmt --check after format");
    assert!(recheck.status.success());

    // Explicitly named files are formatted regardless of extension.
    let explicit = weft()
        .args(["fmt"])
        .arg(&explicit_other)
        .output()
        .expect("format explicit non-.weft file");
    assert!(explicit.status.success());
    assert_eq!(
        fs::read_to_string(&explicit_other).expect("read Custom.txt"),
        formatted
    );
}

fn send_lsp(stdin: &mut impl Write, body: &str) {
    write!(stdin, "Content-Length: {}\r\n\r\n{body}", body.len()).expect("write LSP frame");
    stdin.flush().expect("flush LSP frame");
}

fn read_lsp(reader: &mut BufReader<impl Read>) -> String {
    let mut len = None;
    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line).expect("read LSP header");
        assert!(read > 0, "unexpected EOF reading LSP header");
        if line == "\r\n" || line == "\n" {
            break;
        }
        if let Some(rest) = line.strip_prefix("Content-Length:") {
            len = Some(rest.trim().parse::<usize>().expect("valid Content-Length"));
        }
    }
    let mut buf = vec![0u8; len.expect("Content-Length header")];
    reader.read_exact(&mut buf).expect("read LSP body");
    String::from_utf8(buf).expect("UTF-8 LSP body")
}

#[test]
fn lsp_initialize_shutdown_exit() {
    let mut child = weft()
        .arg("lsp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn weft lsp");

    let mut stdin = child.stdin.take().expect("LSP stdin");
    let mut stdout = BufReader::new(child.stdout.take().expect("LSP stdout"));

    send_lsp(
        &mut stdin,
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"capabilities":{}}}"#,
    );
    let init_resp = read_lsp(&mut stdout);
    assert!(init_resp.contains(r#""id":1"#), "{init_resp}");
    assert!(init_resp.contains(r#""capabilities""#), "{init_resp}");

    send_lsp(
        &mut stdin,
        r#"{"jsonrpc":"2.0","method":"initialized","params":{}}"#,
    );
    send_lsp(
        &mut stdin,
        r#"{"jsonrpc":"2.0","id":2,"method":"shutdown","params":null}"#,
    );
    let shutdown_resp = read_lsp(&mut stdout);
    assert!(shutdown_resp.contains(r#""id":2"#), "{shutdown_resp}");

    send_lsp(
        &mut stdin,
        r#"{"jsonrpc":"2.0","method":"exit","params":null}"#,
    );
    drop(stdin);

    let status = child.wait().expect("wait weft lsp");
    assert!(status.success(), "weft lsp exited with {status}");
}
