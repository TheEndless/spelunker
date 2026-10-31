mod common;

use common::{utf16le, write, write_zip};
use spelunker_core::{count_lines, read_lines, ContentQuery, FileText};
use std::path::Path;

fn numbered(file: &FileText) -> Vec<(u64, &str)> {
    file.lines
        .iter()
        .map(|line| (line.line_number, line.text.as_str()))
        .collect()
}

fn ten_lines(root: &Path) -> std::path::PathBuf {
    let text: String = (1..=10).map(|number| format!("line {number}\n")).collect();
    write(root, "ten.txt", text.as_bytes())
}

#[test]
fn a_range_of_lines_comes_back_numbered_from_the_file() {
    let root = tempfile::tempdir().unwrap();
    let path = ten_lines(root.path());
    let file = read_lines(&path, None, 3, 2).unwrap();
    assert_eq!(numbered(&file), [(3, "line 3"), (4, "line 4")]);
    assert!(file.truncated, "lines follow the ones returned");
    assert!(!file.binary);
}

#[test]
fn a_range_that_reaches_the_end_says_nothing_follows() {
    let root = tempfile::tempdir().unwrap();
    let path = ten_lines(root.path());
    let file = read_lines(&path, None, 9, 5).unwrap();
    assert_eq!(numbered(&file), [(9, "line 9"), (10, "line 10")]);
    assert!(!file.truncated);
}

#[test]
fn a_range_that_ends_on_the_last_line_says_nothing_follows() {
    let root = tempfile::tempdir().unwrap();
    let path = ten_lines(root.path());
    let file = read_lines(&path, None, 9, 2).unwrap();
    assert_eq!(file.lines.len(), 2);
    assert!(!file.truncated);
}

#[test]
fn a_range_past_the_end_is_empty() {
    let root = tempfile::tempdir().unwrap();
    let path = ten_lines(root.path());
    let file = read_lines(&path, None, 11, 5).unwrap();
    assert!(file.lines.is_empty());
    assert!(!file.truncated);
}

#[test]
fn line_endings_and_a_missing_final_newline_are_handled() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "a.txt", b"one\r\ntwo\nthree");
    let file = read_lines(&path, None, 1, 10).unwrap();
    assert_eq!(numbered(&file), [(1, "one"), (2, "two"), (3, "three")]);
}

#[test]
fn matches_in_the_range_are_marked_with_their_ranges() {
    let root = tempfile::tempdir().unwrap();
    let path = write(
        root.path(),
        "a.txt",
        b"zero\none needle\ntwo\nthree needle\n",
    );
    let query = ContentQuery::literal("needle");
    let file = read_lines(&path, Some(&query), 2, 3).unwrap();
    assert_eq!(
        file.lines[0].match_ranges,
        std::iter::once(4..10).collect::<Vec<_>>()
    );
    assert!(file.lines[0].is_match);
    assert!(!file.lines[1].is_match);
    assert!(file.lines[2].is_match);
}

#[test]
fn utf16_and_windows_1252_files_are_numbered_like_their_text() {
    let root = tempfile::tempdir().unwrap();
    let wide = write(root.path(), "wide.txt", &utf16le("héllo\nworld\nend", true));
    let file = read_lines(&wide, None, 2, 2).unwrap();
    assert_eq!(numbered(&file), [(2, "world"), (3, "end")]);
    let old = write(root.path(), "old.txt", b"caf\xe9\nna\xefve\n");
    let file = read_lines(&old, None, 1, 2).unwrap();
    assert_eq!(numbered(&file), [(1, "café"), (2, "naïve")]);
}

#[test]
fn a_binary_file_has_no_lines() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "data.bin", b"abc\0def\nmore\n");
    let file = read_lines(&path, None, 1, 10).unwrap();
    assert!(file.binary);
    assert!(file.lines.is_empty());
}

#[test]
fn the_text_of_an_archive_is_read_by_line_too() {
    let root = tempfile::tempdir().unwrap();
    let path = write_zip(root.path(), "a.zip", &[("x.txt", "one\ntwo\nthree\n")]);
    let file = read_lines(&path, None, 2, 2).unwrap();
    assert_eq!(numbered(&file), [(2, "one"), (3, "two")]);
    assert!(file.truncated);
    assert_eq!(count_lines(&path).unwrap(), 4);
}

#[test]
fn a_range_deep_in_a_large_file_is_read_without_the_lines_before_it() {
    let root = tempfile::tempdir().unwrap();
    let text: String = (1..=300_000)
        .map(|number| format!("row {number}\n"))
        .collect();
    let path = write(root.path(), "big.txt", text.as_bytes());
    let file = read_lines(&path, None, 250_000, 3).unwrap();
    assert_eq!(
        numbered(&file),
        [
            (250_000, "row 250000"),
            (250_001, "row 250001"),
            (250_002, "row 250002")
        ]
    );
    assert_eq!(count_lines(&path).unwrap(), 300_000);
}

#[test]
fn a_huge_line_in_a_range_is_clipped() {
    let root = tempfile::tempdir().unwrap();
    let mut bytes = b"first\n".to_vec();
    bytes.extend(std::iter::repeat_n(b'x', 1_000_000));
    bytes.extend_from_slice(b"\nlast\n");
    let path = write(root.path(), "min.txt", &bytes);
    let file = read_lines(&path, None, 1, 3).unwrap();
    assert_eq!(file.lines.len(), 3);
    assert!(file.lines[1].text.len() <= 70_000);
    assert!(file.lines[1].clip.is_some());
    assert_eq!(file.lines[2].text, "last");
}

#[test]
fn counting_lines_agrees_with_reading_them() {
    let root = tempfile::tempdir().unwrap();
    let cases: [(&str, Vec<u8>, u64); 6] = [
        ("empty.txt", b"".to_vec(), 0),
        ("one.txt", b"only".to_vec(), 1),
        ("newline.txt", b"a\nb\n".to_vec(), 2),
        ("blank.txt", b"a\n\n\nb".to_vec(), 4),
        ("crlf.txt", b"a\r\nb\r\n".to_vec(), 2),
        ("wide.txt", utf16le("a\nb\nc", true), 3),
    ];
    for (name, bytes, expected) in cases {
        let path = write(root.path(), name, &bytes);
        assert_eq!(count_lines(&path).unwrap(), expected, "{name}");
        let read = read_lines(&path, None, 1, 100).unwrap();
        assert_eq!(read.lines.len() as u64, expected, "{name}");
    }
}

#[test]
fn counting_the_lines_of_a_binary_file_gives_zero() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "data.bin", b"abc\0def\nmore\n");
    assert_eq!(count_lines(&path).unwrap(), 0);
}
