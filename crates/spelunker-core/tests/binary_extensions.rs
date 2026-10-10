mod common;

use common::{run, write};
use spelunker_core::{ContentQuery, SearchConfig};
use std::path::Path;

fn content_config(root: &Path) -> SearchConfig {
    let mut config = SearchConfig::new(vec![root.to_path_buf()]);
    config.content = Some(ContentQuery::literal("needle"));
    config
}

/// Plain text saved under binary-looking names. If the engine matches these, it opened them.
fn disguised_files(root: &Path) {
    write(root, "tool.exe", b"needle in an exe");
    write(root, "lib.DLL", b"needle in a dll");
    write(root, "photo.png", b"needle in a png");
    write(root, "bundle.jar", b"needle in a jar");
    write(root, "notes.txt", b"needle in text");
}

#[test]
fn files_with_binary_extensions_are_skipped_without_the_binary_option() {
    let root = tempfile::tempdir().unwrap();
    disguised_files(root.path());
    let outcome = run(&content_config(root.path()));
    assert_eq!(outcome.names(), vec!["notes.txt"]);
    assert_eq!(outcome.summary.binary_skipped, 4);
}

#[test]
fn the_binary_option_searches_them_after_all() {
    let root = tempfile::tempdir().unwrap();
    disguised_files(root.path());
    let mut config = content_config(root.path());
    config.include_binary = true;
    assert_eq!(
        run(&config).names(),
        vec![
            "bundle.jar",
            "lib.DLL",
            "notes.txt",
            "photo.png",
            "tool.exe"
        ]
    );
    assert_eq!(run(&config).summary.binary_skipped, 0);
}

#[test]
fn name_only_searches_still_list_binary_files() {
    let root = tempfile::tempdir().unwrap();
    disguised_files(root.path());
    let config = SearchConfig::new(vec![root.path().to_path_buf()]);
    assert_eq!(run(&config).files.len(), 5);
    assert_eq!(run(&config).summary.binary_skipped, 0);
}

#[test]
fn unknown_extensions_still_get_the_content_check() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "notes.dat", b"needle in plain text");
    write(root.path(), "blob.dat", b"needle\x00\x01\x02");
    write(root.path(), "README", b"needle without an extension");
    let outcome = run(&content_config(root.path()));
    assert_eq!(outcome.names(), vec!["README", "notes.dat"]);
    assert_eq!(
        outcome.summary.binary_skipped, 1,
        "only blob.dat is found binary by content"
    );
}

#[test]
fn files_the_name_filter_rejects_are_not_counted_as_skipped_binaries() {
    let root = tempfile::tempdir().unwrap();
    disguised_files(root.path());
    let mut config = content_config(root.path());
    config.name_patterns = "*.txt".into();
    let outcome = run(&config);
    assert_eq!(outcome.names(), vec!["notes.txt"]);
    assert_eq!(outcome.summary.binary_skipped, 0);
}

#[test]
fn files_the_size_filter_rejects_are_not_counted_as_skipped_binaries() {
    let root = tempfile::tempdir().unwrap();
    disguised_files(root.path());
    let mut config = content_config(root.path());
    config.size = spelunker_core::SizeRange {
        min: Some(1_000_000),
        max: None,
    };
    assert_eq!(run(&config).summary.binary_skipped, 0);
}

#[cfg(windows)]
mod never_opened {
    use super::*;
    use std::os::windows::fs::OpenOptionsExt;

    fn lock_exclusively(path: &Path) -> std::fs::File {
        // share_mode(0) makes any other open fail, so an error proves an open was attempted.
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(path)
            .unwrap()
    }

    #[test]
    fn a_locked_binary_file_is_not_even_opened_by_default() {
        let root = tempfile::tempdir().unwrap();
        let locked = write(root.path(), "locked.exe", b"needle");
        let _lock = lock_exclusively(&locked);
        let outcome = run(&content_config(root.path()));
        assert!(
            outcome.errors.is_empty(),
            "skipping must not touch the file: {:?}",
            outcome.errors
        );
        assert_eq!(outcome.summary.binary_skipped, 1);
    }

    #[test]
    fn with_the_binary_option_the_same_locked_file_is_opened_and_reports_an_error() {
        let root = tempfile::tempdir().unwrap();
        let locked = write(root.path(), "locked.exe", b"needle");
        let _lock = lock_exclusively(&locked);
        let mut config = content_config(root.path());
        config.include_binary = true;
        let outcome = run(&config);
        assert_eq!(outcome.errors.len(), 1);
    }
}
