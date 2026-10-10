//! Tidies the list of folders to search so no file is found twice.
//!
//! The walker visits every root it is given. Listing a folder twice, or a folder and one inside
//! it, would report the files in the inner folder once for each, and the results list needs every
//! path to be unique. A folder inside another is only left out when the outer search really would
//! reach it, because the walk skips some folders (excluded names, hidden ones, junctions).

use std::path::PathBuf;

/// A form of a path for comparing: backslashes, no trailing separator, lower case.
fn comparison_key(root: &str) -> String {
    let mut key = root.trim().replace('/', "\\").to_lowercase();
    while key.len() > 3 && key.ends_with('\\') {
        key.pop();
    }
    key
}

/// True when `inner` is the same folder as `outer` or lies below it.
fn is_inside(inner: &str, outer: &str) -> bool {
    if inner == outer {
        return true;
    }
    let outer_with_separator = if outer.ends_with('\\') {
        outer.to_string()
    } else {
        format!("{outer}\\")
    };
    inner.starts_with(&outer_with_separator)
}

/// Removes empty roots and repeats, in order of first appearance. A root inside another listed
/// root is dropped too when `covers(outer, inner)` says the outer search reaches it, since the
/// outer one then finds the same files. Otherwise the inner root adds files, so it stays.
pub fn tidy_roots(roots: Vec<String>, covers: impl Fn(&str, &str) -> bool) -> Vec<String> {
    let keyed: Vec<(String, String)> = roots
        .into_iter()
        .map(|root| (comparison_key(&root), root))
        .filter(|(key, _)| !key.is_empty())
        .collect();
    let mut kept: Vec<(String, String)> = Vec::new();
    for (key, root) in &keyed {
        if kept.iter().any(|(kept_key, _)| kept_key == key) {
            continue;
        }
        let covered = keyed.iter().any(|(other_key, other_root)| {
            other_key != key && is_inside(key, other_key) && covers(other_root, root)
        });
        if !covered {
            kept.push((key.clone(), root.clone()));
        }
    }
    kept.into_iter().map(|(_, root)| root).collect()
}

const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

/// Whether searching `outer` (to any depth) would reach the folder `inner` inside it: none of the
/// folders between them may be one the walk skips. That is a folder with an excluded name, a
/// hidden, system, or dot-named folder when hidden files are off, or a junction or symlink when
/// links are not followed. A folder that cannot be inspected counts as not reached, so it is kept.
pub fn outer_search_reaches(
    outer: &str,
    inner: &str,
    excluded_names: &[&str],
    include_hidden: bool,
    follow_links: bool,
) -> bool {
    use std::os::windows::fs::MetadataExt;
    let outer_path = PathBuf::from(outer.trim().replace('/', "\\"));
    let inner_path = PathBuf::from(inner.trim().replace('/', "\\"));
    let skipped = outer_path.components().count();

    let mut current: PathBuf = outer_path;
    for component in inner_path.components().skip(skipped) {
        current.push(component);
        let name = component.as_os_str().to_string_lossy().to_lowercase();
        if excluded_names
            .iter()
            .any(|excluded| excluded.eq_ignore_ascii_case(&name))
        {
            return false;
        }
        if !include_hidden && name.starts_with('.') {
            return false;
        }
        let Ok(metadata) = std::fs::symlink_metadata(&current) else {
            return false;
        };
        let attributes = metadata.file_attributes();
        if !include_hidden && attributes & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0 {
            return false;
        }
        if !follow_links && attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    fn tidy(roots: &[&str], covers: bool) -> Vec<String> {
        tidy_roots(
            roots.iter().map(|root| root.to_string()).collect(),
            |_, _| covers,
        )
    }

    #[test]
    fn a_folder_listed_twice_is_searched_once() {
        assert_eq!(tidy(&["D:\\x", "D:\\x"], true), ["D:\\x"]);
    }

    #[test]
    fn a_repeat_is_removed_even_when_nothing_counts_as_covered() {
        assert_eq!(tidy(&["D:\\x", "D:\\x"], false), ["D:\\x"]);
    }

    #[test]
    fn case_slashes_and_a_trailing_separator_do_not_make_a_folder_different() {
        assert_eq!(
            tidy(&["D:\\Data", "d:/data/", "D:\\DATA\\"], false),
            ["D:\\Data"]
        );
    }

    #[test]
    fn a_folder_inside_another_is_dropped_when_the_outer_search_reaches_it() {
        assert_eq!(tidy(&["D:\\x\\sub", "D:\\x"], true), ["D:\\x"]);
    }

    #[test]
    fn a_drive_root_covers_everything_it_reaches_on_that_drive() {
        assert_eq!(
            tidy(&["C:\\Users", "C:\\", "D:\\Data"], true),
            ["C:\\", "D:\\Data"]
        );
    }

    #[test]
    fn a_nested_folder_is_kept_when_the_outer_search_would_not_reach_it() {
        assert_eq!(
            tidy(&["D:\\x", "D:\\x\\sub"], false),
            ["D:\\x", "D:\\x\\sub"]
        );
    }

    #[test]
    fn the_predicate_is_asked_about_the_outer_and_inner_spelling() {
        let asked = std::cell::RefCell::new(Vec::new());
        tidy_roots(vec!["D:/x/sub".into(), "D:/x".into()], |outer, inner| {
            asked
                .borrow_mut()
                .push((outer.to_string(), inner.to_string()));
            true
        });
        assert_eq!(
            asked.into_inner(),
            [("D:/x".to_string(), "D:/x/sub".to_string())]
        );
    }

    #[test]
    fn a_folder_whose_name_merely_starts_the_same_is_not_nested() {
        assert_eq!(
            tidy(&["C:\\data", "C:\\database"], true),
            ["C:\\data", "C:\\database"]
        );
    }

    #[test]
    fn empty_entries_are_dropped_and_the_original_spelling_is_kept() {
        assert_eq!(tidy(&["", "  ", "E:\\Work"], true), ["E:\\Work"]);
    }

    #[test]
    fn order_of_first_appearance_is_kept() {
        assert_eq!(tidy(&["F:\\b", "E:\\a", "F:\\b"], true), ["F:\\b", "E:\\a"]);
    }

    fn make(base: &Path, relative: &str) -> PathBuf {
        let folder = base.join(relative);
        fs::create_dir_all(&folder).unwrap();
        folder
    }

    fn reaches(outer: &Path, inner: &Path, include_hidden: bool, follow_links: bool) -> bool {
        outer_search_reaches(
            &outer.to_string_lossy(),
            &inner.to_string_lossy(),
            &["node_modules", ".git"],
            include_hidden,
            follow_links,
        )
    }

    #[test]
    fn an_ordinary_nested_folder_is_reached() {
        let root = tempfile::tempdir().unwrap();
        let inner = make(root.path(), "a\\b\\c");
        assert!(reaches(root.path(), &inner, false, false));
    }

    #[test]
    fn a_folder_inside_an_excluded_name_is_not_reached() {
        let root = tempfile::tempdir().unwrap();
        let inner = make(root.path(), "a\\Node_Modules\\pkg");
        assert!(!reaches(root.path(), &inner, true, true));
    }

    #[test]
    fn a_folder_inside_a_dot_folder_is_reached_only_with_hidden_files_on() {
        let root = tempfile::tempdir().unwrap();
        let inner = make(root.path(), "a\\.config\\x");
        assert!(!reaches(root.path(), &inner, false, false));
        assert!(reaches(root.path(), &inner, true, false));
    }

    #[test]
    fn a_folder_inside_a_hidden_attribute_folder_is_reached_only_with_hidden_files_on() {
        let root = tempfile::tempdir().unwrap();
        let hidden = make(root.path(), "secret");
        let inner = make(root.path(), "secret\\x");
        let status = Command::new("attrib")
            .arg("+h")
            .arg(&hidden)
            .status()
            .unwrap();
        assert!(status.success());
        assert!(!reaches(root.path(), &inner, false, false));
        assert!(reaches(root.path(), &inner, true, false));
    }

    #[test]
    fn a_folder_behind_a_junction_is_reached_only_when_links_are_followed() {
        let root = tempfile::tempdir().unwrap();
        let target = make(root.path(), "real\\deep");
        let link = root.path().join("link");
        let status = Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(root.path().join("real"))
            .status()
            .unwrap();
        assert!(status.success());
        let through_link = link.join("deep");
        assert!(target.exists() && through_link.exists());
        assert!(!reaches(root.path(), &through_link, false, false));
        assert!(reaches(root.path(), &through_link, false, true));
    }

    #[test]
    fn a_folder_that_cannot_be_inspected_is_not_counted_as_reached() {
        let root = tempfile::tempdir().unwrap();
        let missing = root.path().join("gone\\deeper");
        assert!(!reaches(root.path(), &missing, true, true));
    }
}
