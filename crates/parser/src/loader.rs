//! Source loading abstraction. The compiler core never touches the file system;
//! hosts (build scripts, the CLI, the WASM bindings) supply a [`SourceLoader`].

use std::collections::HashMap;
use std::io;

/// Supplies source text for normalized, `/`-separated module paths.
pub trait SourceLoader {
    /// Returns the text of the module at `path`.
    ///
    /// # Errors
    ///
    /// Returns an error if the module does not exist or cannot be read; the
    /// message is shown to the user at the offending `import`.
    fn load(&mut self, path: &str) -> io::Result<String>;
}

/// In-memory loader, used by tests and by hosts that already hold the sources.
#[derive(Debug, Clone, Default)]
pub struct MemoryLoader {
    files: HashMap<String, String>,
}

impl MemoryLoader {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds or replaces a module; `path` is normalized first.
    pub fn insert(&mut self, path: &str, text: impl Into<String>) {
        self.files.insert(normalize(path), text.into());
    }
}

impl SourceLoader for MemoryLoader {
    fn load(&mut self, path: &str) -> io::Result<String> {
        self.files.get(path).cloned().ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, format!("no such module `{path}`"))
        })
    }
}

/// Resolves `spec` (as written in an `import`) relative to the importing module.
#[must_use]
pub fn resolve_import(importer: &str, spec: &str) -> String {
    if spec.contains("://") {
        return normalize(spec);
    }
    if let Some((prefix, path)) = split_uri_prefix(importer) {
        let resolved = if spec.starts_with('/') {
            normalize(spec)
        } else {
            match path.rfind('/') {
                Some(slash) => normalize(&format!("{}/{spec}", &path[..slash])),
                None => normalize(spec),
            }
        };
        return format!("{prefix}{}", resolved.trim_start_matches('/'));
    }
    if spec.starts_with('/') {
        return normalize(spec);
    }
    match importer.rfind('/') {
        Some(slash) => normalize(&format!("{}/{spec}", &importer[..slash])),
        None => normalize(spec),
    }
}

/// Splits `<scheme>://<authority>/` (or `inmemory:///`) from its path, keeping
/// empty authorities intact.
fn split_uri_prefix(path: &str) -> Option<(&str, &str)> {
    let scheme_end = path.find("://")?;
    let after_scheme = scheme_end + 3;
    match path[after_scheme..].find('/') {
        Some(slash) => {
            let path_start = after_scheme + slash + 1;
            Some((&path[..path_start], &path[path_start..]))
        }
        None => Some((path, "")),
    }
}

/// Collapses `.` and `..` segments and duplicate separators.
///
/// Leading `..` segments that would climb above the root are kept, so the
/// result stays meaningful for relative paths. URI prefixes such as
/// `inmemory:///` and `vscode-vfs://authority/` are preserved.
#[must_use]
pub fn normalize(path: &str) -> String {
    if let Some((prefix, rest)) = split_uri_prefix(path) {
        let normalized = normalize_path(rest, true);
        if prefix.ends_with('/') {
            return format!("{prefix}{}", normalized.trim_start_matches('/'));
        }
        return format!("{prefix}{normalized}");
    }
    normalize_path(path, path.starts_with('/'))
}

fn normalize_path(path: &str, absolute: bool) -> String {
    let mut segments: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." if segments.last().is_some_and(|s| *s != "..") => {
                segments.pop();
            }
            ".." if absolute => {}
            _ => segments.push(segment),
        }
    }
    let joined = segments.join("/");
    if absolute {
        format!("/{joined}")
    } else {
        joined
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_relative_to_importer_directory() {
        assert_eq!(
            resolve_import("ui/app.weft", "./models.weft"),
            "ui/models.weft"
        );
        assert_eq!(resolve_import("ui/a/b.weft", "../c.weft"), "ui/c.weft");
        assert_eq!(resolve_import("app.weft", "../x.weft"), "../x.weft");
        assert_eq!(resolve_import("ui/app.weft", "/lib/x.weft"), "/lib/x.weft");
        assert_eq!(normalize("/../a//./b"), "/a/b");
        assert_eq!(
            resolve_import("inmemory:///ui/app.weft", "../models.weft"),
            "inmemory:///models.weft"
        );
        assert_eq!(
            resolve_import("vscode-vfs://github/org/repo/ui/app.weft", "../models.weft"),
            "vscode-vfs://github/org/repo/models.weft"
        );
        assert_eq!(normalize("inmemory:///../a//./b"), "inmemory:///a/b");
    }
}
