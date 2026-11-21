mod common;

use common::{run, write};
use spelunker_core::{ContentQuery, SearchConfig};
use std::fs;
use std::path::Path;

/// A folder that looks like a git repository to the walker: a `.git` folder, a `.gitignore`, and
/// files both kept and ignored, at the top and below it.
fn repository(root: &Path) {
    fs::create_dir_all(root.join(".git")).unwrap();
    write(root, ".gitignore", b"*.log\nbuild/\n!keep.log\n");
    write(root, "readme.txt", b"needle");
    write(root, "debug.log", b"needle");
    write(root, "keep.log", b"needle");
    write(root, "build/output.txt", b"needle");
    write(root, "src/main.rs", b"needle");
    write(root, "src/trace.log", b"needle");
}

fn config(root: &Path) -> SearchConfig {
    SearchConfig::new(vec![root.to_path_buf()])
}

#[test]
fn ignore_files_are_not_applied_unless_asked_for() {
    let root = tempfile::tempdir().unwrap();
    repository(root.path());
    let names = run(&config(root.path())).names();
    for found in [
        "debug.log",
        "keep.log",
        "output.txt",
        "trace.log",
        "main.rs",
    ] {
        assert!(names.contains(&found.to_string()), "{found} in {names:?}");
    }
}

#[test]
fn files_a_gitignore_names_are_skipped_when_asked_for() {
    let root = tempfile::tempdir().unwrap();
    repository(root.path());
    let mut config = config(root.path());
    config.respect_gitignore = true;
    assert_eq!(
        run(&config).names(),
        vec!["keep.log", "main.rs", "readme.txt"]
    );
}

#[test]
fn a_content_search_skips_ignored_files_too() {
    let root = tempfile::tempdir().unwrap();
    repository(root.path());
    let mut config = config(root.path());
    config.respect_gitignore = true;
    config.content = Some(ContentQuery::literal("needle"));
    let outcome = run(&config);
    assert_eq!(outcome.names(), vec!["keep.log", "main.rs", "readme.txt"]);
    assert_eq!(outcome.summary.files_matched, 3);
}

#[test]
fn a_folder_inside_the_repository_still_follows_the_gitignore_above_it() {
    let root = tempfile::tempdir().unwrap();
    repository(root.path());
    let mut config = SearchConfig::new(vec![root.path().join("src")]);
    config.respect_gitignore = true;
    assert_eq!(run(&config).names(), vec!["main.rs"]);
}

#[test]
fn every_repository_under_the_start_folder_keeps_its_own_rules() {
    let root = tempfile::tempdir().unwrap();
    repository(&root.path().join("first"));
    let second = root.path().join("second");
    fs::create_dir_all(second.join(".git")).unwrap();
    write(&second, ".gitignore", b"*.txt\n");
    write(&second, "notes.txt", b"needle");
    write(&second, "code.rs", b"needle");
    let mut config = config(root.path());
    config.respect_gitignore = true;
    assert_eq!(
        run(&config).names(),
        vec!["code.rs", "keep.log", "main.rs", "readme.txt"]
    );
}

#[test]
fn a_gitignore_outside_any_repository_is_left_alone_as_git_does() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), ".gitignore", b"*.log\n");
    write(root.path(), "app.log", b"needle");
    let mut config = config(root.path());
    config.respect_gitignore = true;
    assert_eq!(run(&config).names(), vec!["app.log"]);
}

#[test]
fn a_folder_inside_the_start_folder_is_reached_unless_a_gitignore_names_it() {
    let root = tempfile::tempdir().unwrap();
    repository(root.path());
    let ignored = root.path().join("build");
    let kept = root.path().join("src");
    assert!(!search_reaches(root.path(), &ignored));
    assert!(search_reaches(root.path(), &kept));
    // Case and the way the path is spelled do not matter on Windows.
    let shouting = kept.to_string_lossy().to_uppercase();
    assert!(search_reaches(root.path(), Path::new(&shouting)));
}

#[test]
fn a_folder_that_is_not_below_the_start_folder_is_not_reached() {
    let root = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    repository(root.path());
    assert!(!search_reaches(root.path(), other.path()));
}

fn search_reaches(outer: &Path, inner: &Path) -> bool {
    spelunker_core::gitignore_reaches(outer, inner, false, false)
}

#[test]
fn hidden_files_still_need_the_hidden_option_when_ignore_files_are_respected() {
    let root = tempfile::tempdir().unwrap();
    repository(root.path());
    write(root.path(), ".env", b"needle");
    let mut config = config(root.path());
    config.respect_gitignore = true;
    assert!(!run(&config).names().contains(&".env".to_string()));
    config.include_hidden = true;
    assert!(run(&config).names().contains(&".env".to_string()));
}
