mod common;

use common::run;
use spelunker_core::{search, CancelToken, SearchConfig, SearchEvent};
use std::fs;
use std::path::Path;
use std::sync::Mutex;

/// `count` small files named `<prefix><n>.txt` in `folder`.
fn write_files(folder: &Path, prefix: &str, count: usize) {
    fs::create_dir_all(folder).unwrap();
    for number in 0..count {
        fs::write(folder.join(format!("{prefix}{number}.txt")), b"x").unwrap();
    }
}

#[test]
fn roots_are_searched_one_after_another_in_the_order_given() {
    // The same three folders in every order, because a walker that picks its own order would get
    // at least one of them wrong.
    let parent = tempfile::tempdir().unwrap();
    let folders: Vec<_> = ["one", "two", "three"]
        .iter()
        .map(|name| parent.path().join(name))
        .collect();
    for folder in &folders {
        write_files(folder, "f", 60);
    }
    for _ in 0..5 {
        for given in [vec![0, 1, 2], vec![2, 1, 0], vec![1, 2, 0], vec![1, 0, 2]] {
            let roots: Vec<_> = given.iter().map(|&index| folders[index].clone()).collect();
            let outcome = run(&SearchConfig::new(roots));
            let order: Vec<usize> = outcome
                .files
                .iter()
                .map(|file| {
                    folders
                        .iter()
                        .position(|folder| file.path.starts_with(folder))
                        .unwrap()
                })
                .collect();
            // Every result of the first root, then every result of the second, then the third.
            let mut expected: Vec<usize> = Vec::new();
            for &index in &given {
                expected.extend(std::iter::repeat_n(index, 60));
            }
            assert_eq!(order, expected, "roots given as {given:?}");
        }
    }
}

#[test]
fn the_folders_in_a_root_are_searched_one_at_a_time_in_name_order() {
    let root = tempfile::tempdir().unwrap();
    // Made in an order that is not alphabetical, so the walk cannot get it right by accident.
    write_files(root.path(), "top", 40);
    for path in ["b/y", "a/y", "b/x", "a/x", "C"] {
        write_files(&root.path().join(path), "f", 40);
    }
    for _ in 0..5 {
        let outcome = run(&SearchConfig::new(vec![root.path().to_path_buf()]));
        let mut seen: Vec<String> = Vec::new();
        for file in &outcome.files {
            let relative = file.path.strip_prefix(root.path()).unwrap();
            // The first folder on the way down, or nothing for a file directly in the root.
            let top = match relative.components().count() {
                1 => String::new(),
                _ => relative
                    .components()
                    .next()
                    .unwrap()
                    .as_os_str()
                    .to_string_lossy()
                    .into_owned(),
            };
            if seen.last() != Some(&top) {
                seen.push(top);
            }
        }
        // The root's own files, then each top folder in full before the next, in name order
        // that ignores case.
        assert_eq!(seen, ["", "a", "b", "C"]);
    }
}

#[test]
fn a_search_over_several_roots_still_finds_everything_once() {
    let parent = tempfile::tempdir().unwrap();
    let (first, second) = (parent.path().join("a"), parent.path().join("b"));
    write_files(&first, "a", 25);
    write_files(&second.join("deeper"), "b", 25);
    let outcome = run(&SearchConfig::new(vec![first, second]));
    assert_eq!(outcome.files.len(), 50);
    assert_eq!(outcome.summary.files_scanned, 50);
}

#[test]
fn a_cancel_between_roots_stops_before_the_next_one() {
    let parent = tempfile::tempdir().unwrap();
    let (first, second) = (parent.path().join("a"), parent.path().join("b"));
    write_files(&first, "a", 10);
    write_files(&second, "b", 10);
    let cancel = CancelToken::new();
    cancel.cancel();
    let outcome = common::run_with_cancel(&SearchConfig::new(vec![first, second]), &cancel);
    assert!(outcome.files.is_empty(), "{:?}", outcome.names());
    assert!(outcome.summary.cancelled);
}

#[test]
fn progress_names_the_folder_being_searched() {
    let root = tempfile::tempdir().unwrap();
    let busy = root.path().join("busy").join("inner");
    write_files(&busy, "f", 700);
    let progress = std::sync::Arc::new(Mutex::new(Vec::new()));
    let sink = std::sync::Arc::clone(&progress);
    search(
        &SearchConfig::new(vec![root.path().to_path_buf()]),
        &CancelToken::new(),
        move |event| {
            if let SearchEvent::Progress { folder, .. } = event {
                sink.lock().unwrap().push(folder);
            }
        },
    )
    .unwrap();
    let folders = progress.lock().unwrap();
    assert!(folders.len() >= 2, "{folders:?}");
    for folder in folders.iter() {
        assert_eq!(folder, &busy);
    }
}
