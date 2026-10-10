mod common;

use common::{utf16le, write};
use spelunker_core::{preview_file, ContentQuery, PreviewLine};

fn numbered_lines(count: usize) -> Vec<u8> {
    (1..=count)
        .map(|number| format!("line {number}\n"))
        .collect::<String>()
        .into_bytes()
}

fn line_numbers(lines: &[PreviewLine]) -> Vec<u64> {
    lines.iter().map(|line| line.line_number).collect()
}

#[test]
fn a_match_comes_with_context_before_and_after() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "ten.txt", &numbered_lines(10));
    let lines = preview_file(&path, &ContentQuery::literal("line 5"), 2, false).unwrap();
    assert_eq!(line_numbers(&lines), vec![3, 4, 5, 6, 7]);
    let flags: Vec<bool> = lines.iter().map(|line| line.is_match).collect();
    assert_eq!(flags, vec![false, false, true, false, false]);
    assert_eq!(lines[2].text, "line 5");
    assert_eq!(lines[2].match_ranges, vec![0..6]);
    assert!(lines[0].match_ranges.is_empty());
}

#[test]
fn zero_context_returns_only_matching_lines() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "ten.txt", &numbered_lines(10));
    let lines = preview_file(&path, &ContentQuery::literal("line 5"), 0, false).unwrap();
    assert_eq!(line_numbers(&lines), vec![5]);
}

#[test]
fn overlapping_context_is_not_duplicated() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "ten.txt", &numbered_lines(10));
    let query = ContentQuery {
        regex: true,
        ..ContentQuery::literal("line (4|6)$")
    };
    let lines = preview_file(&path, &query, 2, false).unwrap();
    assert_eq!(line_numbers(&lines), vec![2, 3, 4, 5, 6, 7, 8]);
}

#[test]
fn distant_matches_leave_a_gap_in_line_numbers() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "ten.txt", &numbered_lines(20));
    let query = ContentQuery {
        regex: true,
        ..ContentQuery::literal("line (3|18)$")
    };
    let lines = preview_file(&path, &query, 1, false).unwrap();
    assert_eq!(line_numbers(&lines), vec![2, 3, 4, 17, 18, 19]);
}

#[test]
fn context_stops_at_the_file_edges() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "ten.txt", &numbered_lines(3));
    let lines = preview_file(&path, &ContentQuery::literal("line 1"), 5, false).unwrap();
    assert_eq!(line_numbers(&lines), vec![1, 2, 3]);
}

#[test]
fn utf16_files_are_decoded_in_previews() {
    let root = tempfile::tempdir().unwrap();
    let path = write(
        root.path(),
        "wide.txt",
        &utf16le("before\nthe needle\nafter\n", true),
    );
    let lines = preview_file(&path, &ContentQuery::literal("needle"), 1, false).unwrap();
    let texts: Vec<&str> = lines.iter().map(|line| line.text.as_str()).collect();
    assert_eq!(texts, vec!["before", "the needle", "after"]);
}

#[test]
fn a_file_without_matches_previews_as_empty() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "ten.txt", &numbered_lines(10));
    let lines = preview_file(&path, &ContentQuery::literal("absent"), 2, false).unwrap();
    assert!(lines.is_empty());
}

#[test]
fn binary_files_preview_as_empty_unless_included() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "blob.bin", b"needle\n\x00\x01\n");
    let query = ContentQuery::literal("needle");
    assert!(preview_file(&path, &query, 1, false).unwrap().is_empty());
    assert!(!preview_file(&path, &query, 1, true).unwrap().is_empty());
}

#[test]
fn an_invalid_regex_is_an_error_not_a_panic() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "ten.txt", &numbered_lines(2));
    let query = ContentQuery {
        regex: true,
        ..ContentQuery::literal("(unclosed")
    };
    assert!(preview_file(&path, &query, 1, false).is_err());
}
