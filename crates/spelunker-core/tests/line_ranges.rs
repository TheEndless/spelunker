mod common;

use common::{utf16le, write, write_zip};
use spelunker_core::{count_lines, read_lines, ContentQuery, FileText, PreviewBudget};
use std::path::Path;

/// A budget of `lines` lines and no limit on bytes.
fn unlimited(lines: usize) -> PreviewBudget {
    PreviewBudget {
        lines,
        bytes: usize::MAX,
    }
}

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
    let file = read_lines(&path, None, 3, unlimited(2)).unwrap();
    assert_eq!(numbered(&file), [(3, "line 3"), (4, "line 4")]);
    assert!(file.truncated, "lines follow the ones returned");
    assert!(!file.binary);
}

#[test]
fn a_range_that_reaches_the_end_says_nothing_follows() {
    let root = tempfile::tempdir().unwrap();
    let path = ten_lines(root.path());
    let file = read_lines(&path, None, 9, unlimited(5)).unwrap();
    assert_eq!(numbered(&file), [(9, "line 9"), (10, "line 10")]);
    assert!(!file.truncated);
}

#[test]
fn a_range_that_ends_on_the_last_line_says_nothing_follows() {
    let root = tempfile::tempdir().unwrap();
    let path = ten_lines(root.path());
    let file = read_lines(&path, None, 9, unlimited(2)).unwrap();
    assert_eq!(file.lines.len(), 2);
    assert!(!file.truncated);
}

#[test]
fn a_range_past_the_end_is_empty() {
    let root = tempfile::tempdir().unwrap();
    let path = ten_lines(root.path());
    let file = read_lines(&path, None, 11, unlimited(5)).unwrap();
    assert!(file.lines.is_empty());
    assert!(!file.truncated);
}

#[test]
fn line_endings_and_a_missing_final_newline_are_handled() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "a.txt", b"one\r\ntwo\nthree");
    let file = read_lines(&path, None, 1, unlimited(10)).unwrap();
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
    let file = read_lines(&path, Some(&query), 2, unlimited(3)).unwrap();
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
    let file = read_lines(&wide, None, 2, unlimited(2)).unwrap();
    assert_eq!(numbered(&file), [(2, "world"), (3, "end")]);
    let old = write(root.path(), "old.txt", b"caf\xe9\nna\xefve\n");
    let file = read_lines(&old, None, 1, unlimited(2)).unwrap();
    assert_eq!(numbered(&file), [(1, "café"), (2, "naïve")]);
}

#[test]
fn a_binary_file_has_no_lines() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "data.bin", b"abc\0def\nmore\n");
    let file = read_lines(&path, None, 1, unlimited(10)).unwrap();
    assert!(file.binary);
    assert!(file.lines.is_empty());
}

#[test]
fn the_text_of_an_archive_is_read_by_line_too() {
    let root = tempfile::tempdir().unwrap();
    let path = write_zip(root.path(), "a.zip", &[("x.txt", "one\ntwo\nthree\n")]);
    let file = read_lines(&path, None, 2, unlimited(2)).unwrap();
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
    let file = read_lines(&path, None, 250_000, unlimited(3)).unwrap();
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
    let file = read_lines(&path, None, 1, unlimited(3)).unwrap();
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
        let read = read_lines(&path, None, 1, unlimited(100)).unwrap();
        assert_eq!(read.lines.len() as u64, expected, "{name}");
    }
}

#[test]
fn counting_the_lines_of_a_binary_file_gives_zero() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "data.bin", b"abc\0def\nmore\n");
    assert_eq!(count_lines(&path).unwrap(), 0);
}

#[test]
fn a_range_stops_at_the_byte_budget_and_says_more_follows() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "a.txt", &b"0123456789\n".repeat(100));
    let budget = PreviewBudget {
        lines: 100,
        bytes: 35,
    };
    let file = read_lines(&path, None, 1, budget).unwrap();
    assert_eq!(
        file.lines.len(),
        4,
        "the line that reaches 35 bytes is kept"
    );
    assert!(file.truncated);
    let next = read_lines(&path, None, 5, budget).unwrap();
    assert_eq!(
        next.lines[0].line_number, 5,
        "reading goes on where it stopped"
    );
}

#[test]
fn a_range_always_returns_at_least_one_line() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "a.txt", b"a long first line\nsecond\n");
    let budget = PreviewBudget {
        lines: 10,
        bytes: 1,
    };
    let file = read_lines(&path, None, 1, budget).unwrap();
    assert_eq!(file.lines.len(), 1);
    assert!(file.truncated);
}

#[test]
fn a_utf16_byte_that_looks_like_a_newline_is_not_a_line_break() {
    // U+010A is the bytes 0A 01 in UTF-16LE, so its first byte equals "\n" but is not a newline.
    let root = tempfile::tempdir().unwrap();
    let text = "aa\nb\u{010A}bbbbbbbb\nzz\n";
    let path = write(root.path(), "wide.txt", &utf16le(text, true));
    let file = read_lines(&path, None, 1, unlimited(10)).unwrap();
    assert_eq!(
        numbered(&file),
        [(1, "aa"), (2, "b\u{010A}bbbbbbbb"), (3, "zz")]
    );
}

#[test]
fn an_empty_query_flags_nothing() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "m.txt", b"one\n");
    let file = read_lines(&path, Some(&ContentQuery::literal("")), 1, unlimited(10)).unwrap();
    assert!(file.lines.iter().all(|line| !line.is_match));
}

#[test]
fn a_missing_file_is_an_error() {
    let root = tempfile::tempdir().unwrap();
    let missing = root.path().join("nope.txt");
    assert!(read_lines(&missing, None, 1, unlimited(10)).is_err());
    assert!(count_lines(&missing).is_err());
}

#[test]
fn counting_matches_the_numbering_for_the_edge_cases() {
    let root = tempfile::tempdir().unwrap();
    let cases: [(&str, &[u8], u64); 7] = [
        ("empty", b"", 0),
        ("newline", b"\n", 1),
        ("blank_lines", b"\n\n\n", 3),
        ("terminated", b"a\nb\n", 2),
        ("unterminated", b"a\nb", 2),
        ("crlf", b"a\r\nb\r\n", 2),
        ("one_unterminated", b"abc", 1),
    ];
    for (name, bytes, expected) in cases {
        let path = write(root.path(), &format!("{name}.txt"), bytes);
        assert_eq!(count_lines(&path).unwrap(), expected, "{name}");
        let read = read_lines(&path, None, 1, unlimited(100)).unwrap();
        assert_eq!(read.lines.len() as u64, expected, "{name} read");
    }
}

#[test]
fn lines_that_straddle_the_read_buffer_are_counted_and_numbered_once() {
    let root = tempfile::tempdir().unwrap();
    let text: String = (1..=400_000)
        .map(|number| format!("{number:08}\n"))
        .collect();
    let path = write(root.path(), "straddle.txt", text.as_bytes());
    assert_eq!(count_lines(&path).unwrap(), 400_000);
    for first in [116_508, 116_509, 116_510, 232_000, 399_999, 400_000] {
        let file = read_lines(&path, None, first, unlimited(2)).unwrap();
        let expected: Vec<String> = (first..=400_000.min(first + 1))
            .map(|number| format!("{number:08}"))
            .collect();
        let got: Vec<String> = file.lines.iter().map(|line| line.text.clone()).collect();
        assert_eq!(got, expected, "from line {first}");
        assert_eq!(file.lines[0].line_number, first);
        assert_eq!(file.truncated, first + 1 < 400_000, "from line {first}");
    }
}

#[test]
fn a_nul_in_the_lines_skipped_makes_the_file_binary() {
    let root = tempfile::tempdir().unwrap();
    let mut bytes = b"one\ntwo\0\nthree\n".to_vec();
    bytes.extend(std::iter::repeat_n(b"filler\n", 5000).flatten());
    let path = write(root.path(), "late.bin", &bytes);
    let file = read_lines(&path, None, 4000, unlimited(3)).unwrap();
    assert!(file.binary);
    assert!(file.lines.is_empty());
    assert_eq!(count_lines(&path).unwrap(), 0);
}

#[test]
fn a_windows_1252_file_is_numbered_and_decoded_after_the_lines_skipped() {
    let root = tempfile::tempdir().unwrap();
    let mut bytes = b"r\xe9sum\xe9\n".to_vec();
    for _ in 0..2999 {
        bytes.extend_from_slice(b"plain line\n");
    }
    bytes.extend_from_slice(b"caf\xe9\nna\xefve\n");
    let path = write(root.path(), "old.txt", &bytes);
    let file = read_lines(&path, None, 3001, unlimited(2)).unwrap();
    assert_eq!(numbered(&file), [(3001, "café"), (3002, "naïve")]);
    assert_eq!(count_lines(&path).unwrap(), 3002);
}

#[test]
fn a_bomless_utf16_file_is_counted_and_numbered_by_its_text() {
    let root = tempfile::tempdir().unwrap();
    let path = write(
        root.path(),
        "wide.txt",
        &utf16le("one\ntwo\nthree\nfour\n", false),
    );
    assert_eq!(count_lines(&path).unwrap(), 4);
    let file = read_lines(&path, None, 3, unlimited(5)).unwrap();
    assert_eq!(numbered(&file), [(3, "three"), (4, "four")]);
}
