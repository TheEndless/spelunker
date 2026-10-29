//! Which paths the page may ask the backend about: only those inside the folders the latest search
//! looked in. Every file a person can see in the results lives there, so previewing, opening,
//! revealing, dragging and the system menu all work, while a page that has been taken over cannot
//! use the same commands on files elsewhere on the disk.
//!
//! The comparison is by text only. It never touches the disk, so a slow share cannot stall it.

use std::path::{Component, Path, PathBuf, Prefix};
use std::sync::Mutex;

/// A path as lower-case parts, drive or share first, or `None` when it is not a plain absolute
/// path: it has a `..` part, or no drive. Windows compares names without regard to case, and
/// `\\?\C:\` and `C:\` name the same place.
fn parts_of(path: &Path) -> Option<Vec<String>> {
    let absolute = std::path::absolute(path).ok()?;
    let mut parts = Vec::new();
    for component in absolute.components() {
        match component {
            Component::Prefix(prefix) => parts.push(match prefix.kind() {
                Prefix::VerbatimDisk(letter) | Prefix::Disk(letter) => {
                    format!("{}:", (letter as char).to_ascii_lowercase())
                }
                Prefix::VerbatimUNC(server, share) | Prefix::UNC(server, share) => format!(
                    "\\\\{}\\{}",
                    server.to_string_lossy().to_lowercase(),
                    share.to_string_lossy().to_lowercase()
                ),
                _ => prefix.as_os_str().to_string_lossy().to_lowercase(),
            }),
            Component::RootDir | Component::CurDir => {}
            Component::ParentDir => return None,
            Component::Normal(name) => parts.push(name.to_string_lossy().to_lowercase()),
        }
    }
    (!parts.is_empty()).then_some(parts)
}

/// The folders of the latest search, which the commands that take a path check against.
#[derive(Default)]
pub struct SearchScope(Mutex<Vec<Vec<String>>>);

impl SearchScope {
    /// Replaces the folders. Called when a search starts.
    pub fn set(&self, roots: &[PathBuf]) {
        let parts = roots.iter().filter_map(|root| parts_of(root)).collect();
        *self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = parts;
    }

    /// Fails unless `path` is a folder of the latest search or inside one.
    pub fn check(&self, path: &str) -> Result<(), String> {
        let permitted = parts_of(Path::new(path)).is_some_and(|parts| {
            self.0
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .iter()
                .any(|root| parts.starts_with(root))
        });
        if permitted {
            Ok(())
        } else {
            Err("That file is not in the folders of the current search".to_string())
        }
    }

    /// Fails unless every path passes `check`.
    pub fn check_all(&self, paths: &[String]) -> Result<(), String> {
        paths.iter().try_for_each(|path| self.check(path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope_of(roots: &[&str]) -> SearchScope {
        let scope = SearchScope::default();
        scope.set(&roots.iter().map(PathBuf::from).collect::<Vec<_>>());
        scope
    }

    #[test]
    fn a_file_inside_a_folder_of_the_search_is_allowed() {
        let scope = scope_of(&[r"C:\Work"]);
        assert!(scope.check(r"C:\Work\a.txt").is_ok());
        assert!(scope.check(r"C:\Work\deep\er\b.rs").is_ok());
        assert!(scope.check(r"C:\Work").is_ok(), "the folder itself");
    }

    #[test]
    fn a_file_outside_every_folder_is_refused() {
        let scope = scope_of(&[r"C:\Work"]);
        assert!(scope.check(r"C:\Windows\System32\cmd.exe").is_err());
        assert!(scope.check(r"D:\Work\a.txt").is_err());
    }

    #[test]
    fn a_folder_that_merely_starts_with_the_same_letters_is_outside() {
        let scope = scope_of(&[r"C:\Work"]);
        assert!(scope.check(r"C:\Work2\a.txt").is_err());
        assert!(scope.check(r"C:\Workshop").is_err());
    }

    #[test]
    fn case_and_the_verbatim_prefix_do_not_matter() {
        let scope = scope_of(&[r"C:\Work"]);
        assert!(scope.check(r"c:\WORK\A.TXT").is_ok());
        assert!(scope.check(r"\\?\C:\Work\a.txt").is_ok());
        let verbatim = scope_of(&[r"\\?\D:\Data"]);
        assert!(verbatim.check(r"d:\data\x").is_ok());
    }

    #[test]
    fn dots_that_climb_out_of_the_folder_are_refused() {
        let scope = scope_of(&[r"C:\Work"]);
        assert!(scope.check(r"C:\Work\..\Windows\win.ini").is_err());
        assert!(scope.check(r"C:\Work\sub\..\..\Windows").is_err());
    }

    #[test]
    fn a_drive_root_allows_the_whole_drive() {
        let scope = scope_of(&[r"C:\", r"D:\"]);
        assert!(scope.check(r"C:\anything\at\all.txt").is_ok());
        assert!(scope.check(r"D:\x").is_ok());
        assert!(scope.check(r"E:\x").is_err());
    }

    #[test]
    fn a_network_share_is_matched_by_server_and_share() {
        let scope = scope_of(&[r"\\server\share\docs"]);
        assert!(scope.check(r"\\SERVER\Share\docs\a.txt").is_ok());
        assert!(scope.check(r"\\server\other\docs\a.txt").is_err());
        assert!(scope.check(r"\\server\share\private\a.txt").is_err());
    }

    #[test]
    fn nothing_is_allowed_before_a_search_has_been_started() {
        let scope = SearchScope::default();
        assert!(scope.check(r"C:\Work\a.txt").is_err());
    }

    #[test]
    fn a_new_search_replaces_the_folders_of_the_last() {
        let scope = scope_of(&[r"C:\Old"]);
        scope.set(&[PathBuf::from(r"C:\New")]);
        assert!(scope.check(r"C:\Old\a.txt").is_err());
        assert!(scope.check(r"C:\New\a.txt").is_ok());
    }

    #[test]
    fn an_empty_or_relative_path_is_not_a_result() {
        let scope = scope_of(&[r"C:\Work"]);
        assert!(scope.check("").is_err());
        assert!(scope.check(r"a.txt").is_err());
    }

    #[test]
    fn check_all_fails_if_any_path_is_outside() {
        let scope = scope_of(&[r"C:\Work"]);
        assert!(scope
            .check_all(&[r"C:\Work\a".into(), r"C:\Work\b".into()])
            .is_ok());
        assert!(scope
            .check_all(&[r"C:\Work\a".into(), r"C:\Other\b".into()])
            .is_err());
    }
}
