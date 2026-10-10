mod common;

use common::{utf16le, write};
use spelunker_core::{read_file_text, ContentQuery};

fn texts(file: &spelunker_core::FileText) -> Vec<&str> {
    file.lines.iter().map(|line| line.text.as_str()).collect()
}

#[test]
fn lines_are_numbered_from_one_and_line_endings_are_removed() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "a.txt", b"first\r\nsecond\nthird");
    let file = read_file_text(&path, None, 1024).unwrap();
    assert_eq!(texts(&file), ["first", "second", "third"]);
    let numbers: Vec<u64> = file.lines.iter().map(|line| line.line_number).collect();
    assert_eq!(numbers, [1, 2, 3]);
    assert!(!file.truncated);
    assert!(!file.binary);
    assert!(file.lines.iter().all(|line| !line.is_match));
}

#[test]
fn a_file_over_the_limit_is_cut_at_a_whole_line_and_flagged() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "long.txt", b"aaaa\nbbbb\ncccc\ndddd\n");
    let file = read_file_text(&path, None, 12).unwrap();
    assert_eq!(texts(&file), ["aaaa", "bbbb"]);
    assert!(file.truncated);
}

#[test]
fn a_file_with_nul_bytes_is_reported_as_binary_without_lines() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "data.bin", b"abc\0def\nmore");
    let file = read_file_text(&path, None, 1024).unwrap();
    assert!(file.binary);
    assert!(file.lines.is_empty());
}

#[test]
fn utf16_with_a_byte_order_mark_is_decoded() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "wide.txt", &utf16le("héllo\nworld", true));
    let file = read_file_text(&path, None, 1024).unwrap();
    assert_eq!(texts(&file), ["héllo", "world"]);
    assert!(!file.binary);
}

#[test]
fn legacy_single_byte_text_is_decoded_as_windows_1252() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "old.txt", b"caf\xe9 au lait\n");
    let file = read_file_text(&path, None, 1024).unwrap();
    assert_eq!(texts(&file), ["café au lait"]);
}

#[test]
fn matches_are_flagged_and_carry_their_ranges() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "m.txt", b"one\ntwo needle two\nthree\n");
    let query = ContentQuery::literal("needle");
    let file = read_file_text(&path, Some(&query), 1024).unwrap();
    assert_eq!(texts(&file), ["one", "two needle two", "three"]);
    assert!(!file.lines[0].is_match);
    assert!(file.lines[1].is_match);
    assert_eq!(file.lines[1].match_ranges, vec![4..10]);
}

#[test]
fn an_empty_query_flags_nothing() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "m.txt", b"one\n");
    let file = read_file_text(&path, Some(&ContentQuery::literal("")), 1024).unwrap();
    assert!(file.lines.iter().all(|line| !line.is_match));
}

#[test]
fn a_missing_file_is_an_error() {
    let root = tempfile::tempdir().unwrap();
    assert!(read_file_text(&root.path().join("nope.txt"), None, 1024).is_err());
}

#[test]
fn a_truncated_utf16_file_ends_on_a_whole_line() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "wide.txt", &utf16le("aa\nbb\ncc\n", true));
    let file = read_file_text(&path, None, 15).unwrap();
    assert_eq!(texts(&file), ["aa", "bb"]);
    assert!(file.truncated);
}

#[test]
fn a_utf16_byte_that_looks_like_a_newline_is_not_a_line_break() {
    // U+010A is the bytes 0A 01 in UTF-16LE, so its first byte equals "\n" but is not a newline.
    let root = tempfile::tempdir().unwrap();
    let path = write(
        root.path(),
        "wide.txt",
        &utf16le("aa\nb\u{010A}bbbbbbbb\nzz\n", true),
    );
    // The limit falls inside the second line.
    let file = read_file_text(&path, None, 2 + 6 + 10).unwrap();
    assert_eq!(texts(&file), ["aa"]);
    assert!(file.truncated);
}

#[test]
fn a_truncated_utf16_file_never_ends_in_a_replacement_character() {
    let root = tempfile::tempdir().unwrap();
    let path = write(
        root.path(),
        "wide.txt",
        &utf16le("aa\nb\u{0A05}bbbbbbbb\nzz\n", true),
    );
    let file = read_file_text(&path, None, 2 + 6 + 9).unwrap();
    assert!(
        file.lines
            .iter()
            .all(|line| !line.text.contains('\u{FFFD}')),
        "{:?}",
        texts(&file)
    );
}

#[test]
fn a_large_file_without_any_line_break_still_shows_its_beginning() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "minified.js", "x".repeat(5000).as_bytes());
    let file = read_file_text(&path, None, 1000).unwrap();
    assert_eq!(file.lines.len(), 1);
    assert_eq!(file.lines[0].text.len(), 1000);
    assert!(file.truncated);
}

#[test]
fn a_cut_inside_a_multibyte_character_leaves_no_replacement_character() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "long.txt", "é".repeat(3000).as_bytes());
    // 1001 bytes ends in the middle of a two-byte character.
    let file = read_file_text(&path, None, 1001).unwrap();
    assert!(!file.lines[0].text.contains('\u{FFFD}'));
}
