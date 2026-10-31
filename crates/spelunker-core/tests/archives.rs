mod common;

use common::{run, write, write_zip};
use spelunker_core::{preview_file, read_file_text, ContentQuery, SearchConfig};
use std::io::Write;
use std::path::{Path, PathBuf};

fn with_archives(root: &Path, text: &str) -> SearchConfig {
    let mut config = SearchConfig::new(vec![root.to_path_buf()]);
    config.content = Some(ContentQuery::literal(text));
    config.search_archives = true;
    config
}

fn tar_bytes(entries: &[(&str, &str)]) -> Vec<u8> {
    let mut builder = tar::Builder::new(Vec::new());
    for (name, content) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_size(content.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder
            .append_data(&mut header, name, content.as_bytes())
            .unwrap();
    }
    builder.into_inner().unwrap()
}

fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(bytes).unwrap();
    encoder.finish().unwrap()
}

fn write_tar(root: &Path, name: &str, entries: &[(&str, &str)]) -> PathBuf {
    write(root, name, &tar_bytes(entries))
}

#[test]
fn text_in_a_zip_entry_is_found_under_the_entry_name() {
    let root = tempfile::tempdir().unwrap();
    write_zip(
        root.path(),
        "backup.zip",
        &[
            ("docs/readme.txt", "hello\nthe needle is here\nbye\n"),
            ("src/main.rs", "fn main() {}\n"),
        ],
    );
    let outcome = run(&with_archives(root.path(), "needle"));
    assert_eq!(outcome.names(), vec!["backup.zip"]);
    let hit = &outcome.file("backup.zip").hits[0];
    assert_eq!(hit.line, "the needle is here");
    assert_eq!(
        hit.line_number, 3,
        "after the entry's name line and the line before it"
    );
}

#[test]
fn an_entry_name_is_searchable_too() {
    let root = tempfile::tempdir().unwrap();
    write_zip(
        root.path(),
        "backup.zip",
        &[("reports/invoice-1042.txt", "total due\n")],
    );
    let outcome = run(&with_archives(root.path(), "invoice-1042"));
    assert_eq!(
        outcome.file("backup.zip").hits[0].line,
        ">> reports/invoice-1042.txt"
    );
}

#[test]
fn binary_entries_and_archives_inside_archives_are_not_searched() {
    let root = tempfile::tempdir().unwrap();
    write_zip(
        root.path(),
        "mixed.zip",
        &[
            ("program.bin", "needle\0binary"),
            ("inner.zip", "needle in a nested archive"),
            ("note.txt", "nothing to see\n"),
        ],
    );
    let outcome = run(&with_archives(root.path(), "needle"));
    assert!(outcome.names().is_empty(), "{:?}", outcome.names());
    assert!(outcome.errors.is_empty());
}

#[test]
fn archives_are_only_searched_when_asked_for() {
    let root = tempfile::tempdir().unwrap();
    write_zip(root.path(), "backup.zip", &[("a.txt", "needle\n")]);
    let mut config = with_archives(root.path(), "needle");
    config.search_archives = false;
    let outcome = run(&config);
    assert!(outcome.names().is_empty());
    assert_eq!(
        outcome.summary.binary_skipped, 1,
        "skipped unopened, as a binary file is"
    );
}

#[test]
fn tar_and_gzipped_tar_files_are_searched() {
    let root = tempfile::tempdir().unwrap();
    let entries = [("logs/app.log", "start\nneedle failure\nend\n")];
    write_tar(root.path(), "plain.tar", &entries);
    write(root.path(), "packed.tar.gz", &gzip(&tar_bytes(&entries)));
    write(root.path(), "short.tgz", &gzip(&tar_bytes(&entries)));
    let outcome = run(&with_archives(root.path(), "needle"));
    assert_eq!(
        outcome.names(),
        vec!["packed.tar.gz", "plain.tar", "short.tgz"]
    );
    for name in ["packed.tar.gz", "plain.tar", "short.tgz"] {
        assert_eq!(outcome.file(name).hits[0].line, "needle failure", "{name}");
    }
}

#[test]
fn a_single_gzipped_file_is_searched_as_its_text() {
    let root = tempfile::tempdir().unwrap();
    write(
        root.path(),
        "app.log.gz",
        &gzip(b"start\nneedle failure\nend\n"),
    );
    let outcome = run(&with_archives(root.path(), "needle"));
    let hit = &outcome.file("app.log.gz").hits[0];
    assert_eq!(hit.line, "needle failure");
    assert_eq!(hit.line_number, 3, "after the name line and the first line");
}

#[test]
fn a_damaged_archive_is_reported_and_the_search_goes_on() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "broken.zip", b"this is not a zip file");
    write(root.path(), "broken.tar.gz", b"this is not gzip either");
    write(root.path(), "plain.txt", b"needle");
    let outcome = run(&with_archives(root.path(), "needle"));
    assert_eq!(outcome.names(), vec!["plain.txt"]);
    assert_eq!(outcome.errors.len(), 2);
}

#[test]
fn a_name_search_never_opens_archives() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "broken.zip", b"this is not a zip file");
    let mut config = SearchConfig::new(vec![root.path().to_path_buf()]);
    config.name_patterns = "*.zip".to_string();
    config.search_archives = true;
    let outcome = run(&config);
    assert_eq!(outcome.names(), vec!["broken.zip"]);
    assert!(outcome.errors.is_empty());
}

#[test]
fn the_preview_of_an_archive_shows_its_text_whatever_the_option() {
    let root = tempfile::tempdir().unwrap();
    let path = write_zip(
        root.path(),
        "backup.zip",
        &[("a.txt", "one\ntwo needle\nthree\n")],
    );
    let query = ContentQuery::literal("needle");
    let lines = preview_file(&path, &query, 1, false).unwrap();
    assert!(lines
        .iter()
        .any(|line| line.is_match && line.text == "two needle"));
    let text = read_file_text(&path, Some(&query), 1_000_000).unwrap();
    assert!(text.lines.iter().any(|line| line.text == ">> a.txt"));
}
