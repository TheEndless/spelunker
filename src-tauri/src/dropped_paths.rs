//! Turns paths dropped onto the window into folders to search.

use std::path::{Path, PathBuf};

/// For each dropped path, the folder to search: a folder stands for itself and a file stands for
/// the folder it is in. Paths that do not exist are ignored. Duplicates are dropped, keeping the
/// first of each, so dropping a folder and a file from inside it gives one folder.
pub fn folders_from_paths(paths: &[String]) -> Vec<String> {
    let mut folders: Vec<PathBuf> = Vec::new();
    for dropped in paths {
        let path = Path::new(dropped);
        let folder = if path.is_dir() {
            path.to_path_buf()
        } else if path.is_file() {
            match path.parent() {
                Some(parent) => parent.to_path_buf(),
                None => continue,
            }
        } else {
            continue;
        };
        if !folders.contains(&folder) {
            folders.push(folder);
        }
    }
    folders
        .into_iter()
        .map(|folder| folder.to_string_lossy().into_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn as_strings(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn a_folder_stands_for_itself() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("projects");
        fs::create_dir(&folder).unwrap();
        assert_eq!(
            folders_from_paths(&[as_strings(&folder)]),
            vec![as_strings(&folder)]
        );
    }

    #[test]
    fn a_file_stands_for_the_folder_it_is_in() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("notes.txt");
        fs::write(&file, "x").unwrap();
        assert_eq!(
            folders_from_paths(&[as_strings(&file)]),
            vec![as_strings(root.path())]
        );
    }

    #[test]
    fn paths_that_do_not_exist_are_ignored() {
        let root = tempfile::tempdir().unwrap();
        let missing = root.path().join("gone");
        assert!(folders_from_paths(&[as_strings(&missing)]).is_empty());
    }

    #[test]
    fn duplicates_collapse_and_the_first_occurrence_keeps_its_place() {
        let root = tempfile::tempdir().unwrap();
        let first = root.path().join("a");
        let second = root.path().join("b");
        fs::create_dir(&first).unwrap();
        fs::create_dir(&second).unwrap();
        let file_in_first = first.join("x.txt");
        fs::write(&file_in_first, "x").unwrap();
        let result = folders_from_paths(&[
            as_strings(&first),
            as_strings(&second),
            as_strings(&file_in_first),
        ]);
        assert_eq!(result, vec![as_strings(&first), as_strings(&second)]);
    }

    #[test]
    fn an_empty_drop_gives_nothing() {
        assert!(folders_from_paths(&[]).is_empty());
    }
}
