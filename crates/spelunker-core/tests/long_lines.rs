mod common;

use common::{run, write};
use spelunker_core::{
    preview_file, read_lines, Clip, ContentQuery, PreviewBudget, PreviewLine, SearchConfig,
};
use std::path::Path;

/// More than any line keeps. Cutting at it must leave the match and the surroundings readable.
const LONG: usize = 1_000_000;

fn long_line(before: usize, after: usize) -> Vec<u8> {
    let mut bytes = vec![b'a'; before];
    bytes.extend_from_slice(b"NEEDLE");
    bytes.extend(std::iter::repeat_n(b'b', after));
    bytes.extend_from_slice(b"\nnext line\n");
    bytes
}

fn search(root: &Path) -> SearchConfig {
    let mut config = SearchConfig::new(vec![root.to_path_buf()]);
    config.content = Some(ContentQuery::literal("NEEDLE"));
    config
}

/// The kept text and the two counts of what was cut account for the whole line.
fn assert_adds_up(kept: &str, clip: &Option<Clip>, original: usize) {
    let clip = clip.as_ref().expect("the line should be clipped");
    assert_eq!(
        clip.before_bytes as usize + kept.len() + clip.after_bytes as usize,
        original
    );
}

fn highlighted<'a>(text: &'a str, ranges: &[std::ops::Range<usize>]) -> Vec<&'a str> {
    ranges.iter().map(|range| &text[range.clone()]).collect()
}

#[test]
fn a_search_hit_on_a_huge_line_keeps_a_window_around_the_match() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "min.json", &long_line(LONG, LONG));
    let outcome = run(&search(root.path()));
    let hit = &outcome.file("min.json").hits[0];
    assert!(hit.line.len() <= 70_000, "kept {} bytes", hit.line.len());
    assert_eq!(highlighted(&hit.line, &hit.match_ranges), ["NEEDLE"]);
    assert_adds_up(&hit.line, &hit.clip, 2 * LONG + 6);
    let clip = hit.clip.as_ref().unwrap();
    assert!(clip.before_bytes > 0 && clip.after_bytes > 0);
}

#[test]
fn a_match_at_the_start_of_a_huge_line_cuts_only_the_end() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "min.json", &long_line(0, LONG));
    let outcome = run(&search(root.path()));
    let hit = &outcome.file("min.json").hits[0];
    assert!(hit.line.starts_with("NEEDLE"));
    assert_eq!(hit.clip.as_ref().unwrap().before_bytes, 0);
    assert_adds_up(&hit.line, &hit.clip, LONG + 6);
}

#[test]
fn an_ordinary_line_is_not_clipped() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "a.txt", &long_line(5_000, 5_000));
    let outcome = run(&search(root.path()));
    let hit = &outcome.file("a.txt").hits[0];
    assert_eq!(hit.line.len(), 10_006);
    assert!(hit.clip.is_none());
}

#[test]
fn clipping_never_splits_a_character() {
    let root = tempfile::tempdir().unwrap();
    let mut bytes = "é".repeat(LONG).into_bytes();
    bytes.extend_from_slice(b"NEEDLE");
    bytes.extend_from_slice("é".repeat(LONG).as_bytes());
    bytes.push(b'\n');
    write(root.path(), "wide.txt", &bytes);
    let outcome = run(&search(root.path()));
    let hit = &outcome.file("wide.txt").hits[0];
    assert!(!hit.line.contains('\u{FFFD}'), "a character was cut in two");
    assert_eq!(highlighted(&hit.line, &hit.match_ranges), ["NEEDLE"]);
    assert_adds_up(&hit.line, &hit.clip, 4 * LONG + 6);
}

fn match_line(lines: &[PreviewLine]) -> &PreviewLine {
    lines.iter().find(|line| line.is_match).unwrap()
}

#[test]
fn the_preview_clips_a_huge_match_line_and_a_huge_context_line() {
    let root = tempfile::tempdir().unwrap();
    // The huge line with no match sits next to the match, so it arrives as context.
    let mut bytes = vec![b'c'; LONG];
    bytes.push(b'\n');
    bytes.extend_from_slice(&long_line(LONG, LONG));
    let path = write(root.path(), "min.json", &bytes);
    let lines = preview_file(&path, &ContentQuery::literal("NEEDLE"), 1, false).unwrap();

    let hit = match_line(&lines);
    assert_eq!(highlighted(&hit.text, &hit.match_ranges), ["NEEDLE"]);
    assert_adds_up(&hit.text, &hit.clip, 2 * LONG + 6);

    let context = &lines[0];
    assert!(!context.is_match);
    assert!(context.text.len() <= 70_000);
    assert_eq!(
        context.clip.as_ref().unwrap().before_bytes,
        0,
        "from its start"
    );
    assert_adds_up(&context.text, &context.clip, LONG);
}

#[test]
fn the_whole_file_view_clips_huge_lines_and_numbers_stay_true() {
    let root = tempfile::tempdir().unwrap();
    let path = write(root.path(), "min.json", &long_line(LONG, LONG));
    let query = ContentQuery::literal("NEEDLE");
    let file = read_lines(&path, Some(&query), 1, PreviewBudget::UNLIMITED).unwrap();
    assert_eq!(file.lines.len(), 2);
    let hit = &file.lines[0];
    assert_eq!((hit.line_number, hit.is_match), (1, true));
    assert_eq!(highlighted(&hit.text, &hit.match_ranges), ["NEEDLE"]);
    assert_adds_up(&hit.text, &hit.clip, 2 * LONG + 6);
    assert_eq!(file.lines[1].text, "next line");
    assert!(file.lines[1].clip.is_none());
}
