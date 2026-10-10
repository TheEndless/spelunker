mod common;

use common::{build_fixture, run};
use spelunker_core::{ContentQuery, SearchConfig};

fn config_for(root: &std::path::Path, patterns: &str, query: ContentQuery) -> SearchConfig {
    let mut config = SearchConfig::new(vec![root.to_path_buf()]);
    config.name_patterns = patterns.to_string();
    config.content = Some(query);
    config
}

#[test]
fn literal_search_is_case_insensitive_by_default() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&config_for(
        root.path(),
        "readme.txt",
        ContentQuery::literal("needle"),
    ));
    let file = outcome.file("readme.txt");
    let line_numbers: Vec<u64> = file.hits.iter().map(|hit| hit.line_number).collect();
    assert_eq!(line_numbers, vec![2, 4]);
    assert_eq!(file.hits[0].line, "Needle in a haystack");
    assert_eq!(file.hits[0].match_ranges, vec![0..6]);
}

#[test]
fn match_case_restricts_to_exact_case() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let query = ContentQuery {
        match_case: true,
        ..ContentQuery::literal("Needle")
    };
    let outcome = run(&config_for(root.path(), "readme.txt", query));
    let line_numbers: Vec<u64> = outcome
        .file("readme.txt")
        .hits
        .iter()
        .map(|hit| hit.line_number)
        .collect();
    assert_eq!(line_numbers, vec![2]);
}

#[test]
fn whole_word_rejects_partial_words() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let partial = ContentQuery {
        whole_word: true,
        ..ContentQuery::literal("hay")
    };
    assert!(run(&config_for(root.path(), "readme.txt", partial))
        .files
        .is_empty());
    let whole = ContentQuery {
        whole_word: true,
        ..ContentQuery::literal("haystack")
    };
    assert_eq!(
        run(&config_for(root.path(), "readme.txt", whole)).names(),
        vec!["readme.txt"]
    );
}

#[test]
fn whole_word_treats_punctuation_as_a_boundary() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let query = ContentQuery {
        whole_word: true,
        ..ContentQuery::literal("needle")
    };
    assert_eq!(
        run(&config_for(root.path(), "app.min.js", query)).names(),
        vec!["app.min.js"]
    );
}

#[test]
fn regex_search_finds_pattern_matches() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let query = ContentQuery {
        regex: true,
        ..ContentQuery::literal(r"ERR-\d{4}")
    };
    let outcome = run(&config_for(root.path(), "", query));
    assert_eq!(outcome.names(), vec!["app.log"]);
    let hit = &outcome.file("app.log").hits[0];
    assert_eq!(hit.line_number, 2);
    assert_eq!(hit.match_ranges, vec![0..8]);
}

#[test]
fn literal_mode_does_not_interpret_regex_syntax() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&config_for(
        root.path(),
        "special.txt",
        ContentQuery::literal("a.b"),
    ));
    let hit = &outcome.file("special.txt").hits[0];
    assert_eq!(
        hit.match_ranges,
        vec![0..3],
        "must not match the 'axb' later in the line"
    );
}

#[test]
fn invalid_regex_is_rejected_before_searching() {
    let root = tempfile::tempdir().unwrap();
    let query = ContentQuery {
        regex: true,
        ..ContentQuery::literal("(unclosed")
    };
    let config = config_for(root.path(), "", query);
    let result = spelunker_core::search(&config, &spelunker_core::CancelToken::new(), |_| {});
    assert!(matches!(
        result,
        Err(spelunker_core::ConfigError::InvalidContentPattern(_))
    ));
}

#[test]
fn content_and_name_combine_with_and() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let in_logs = run(&config_for(
        root.path(),
        "*.log",
        ContentQuery::literal("failure"),
    ));
    assert_eq!(in_logs.names(), vec!["app.log"]);
    let wrong_name = run(&config_for(
        root.path(),
        "*.md",
        ContentQuery::literal("failure"),
    ));
    assert!(wrong_name.files.is_empty());
}

#[test]
fn files_without_a_match_are_not_reported() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&config_for(
        root.path(),
        "",
        ContentQuery::literal("quarterly"),
    ));
    assert_eq!(outcome.names(), vec!["report-2026.md"]);
}

#[test]
fn empty_content_text_means_name_only_search() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&config_for(
        root.path(),
        "readme.txt",
        ContentQuery::literal(""),
    ));
    assert_eq!(outcome.names(), vec!["readme.txt"]);
    assert!(outcome.file("readme.txt").hits.is_empty());
}

#[test]
fn utf8_utf16_and_windows_1252_files_are_all_searchable() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&config_for(
        root.path(),
        "*.txt",
        ContentQuery::literal("needle"),
    ));
    let names = outcome.names();
    for expected in [
        "utf8_bom.txt",
        "utf16le.txt",
        "utf16be.txt",
        "utf16le_nobom.txt",
        "cp1252.txt",
    ] {
        assert!(
            names.contains(&expected.to_string()),
            "{expected} missing from {names:?}"
        );
    }
}

#[test]
fn matched_lines_are_decoded_to_text() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&config_for(
        root.path(),
        "",
        ContentQuery::literal("needle"),
    ));
    assert_eq!(outcome.file("cp1252.txt").hits[0].line, "caf\u{e9} needle");
    assert_eq!(
        outcome.file("utf8_bom.txt").hits[0].line,
        "Caf\u{e9} needle"
    );
    assert_eq!(
        outcome.file("utf16le.txt").hits[0].line,
        "needle in utf16 le"
    );
    assert_eq!(
        outcome.file("utf16be.txt").hits[0].line,
        "needle in utf16 be"
    );
    assert_eq!(
        outcome.file("utf16le_nobom.txt").hits[0].line,
        "needle without bom"
    );
}

#[test]
fn accented_query_matches_both_utf8_and_windows_1252_files() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&config_for(
        root.path(),
        "*.txt",
        ContentQuery::literal("caf\u{e9}"),
    ));
    assert_eq!(outcome.names(), vec!["cp1252.txt", "utf8_bom.txt"]);
}

#[test]
fn match_ranges_index_into_the_decoded_line() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&config_for(
        root.path(),
        "cp1252.txt",
        ContentQuery::literal("needle"),
    ));
    let hit = &outcome.file("cp1252.txt").hits[0];
    assert_eq!(&hit.line[hit.match_ranges[0].clone()], "needle");
}

#[test]
fn binary_files_are_skipped_by_default_including_their_early_matches() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&config_for(
        root.path(),
        "*.bin; *.dat",
        ContentQuery::literal("needle"),
    ));
    assert!(outcome.files.is_empty(), "got {:?}", outcome.names());
    assert_eq!(outcome.summary.binary_skipped, 2);
}

#[test]
fn binary_files_can_be_included() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let mut config = config_for(root.path(), "*.bin; *.dat", ContentQuery::literal("needle"));
    config.include_binary = true;
    assert_eq!(run(&config).names(), vec!["blob.bin", "late_nul.dat"]);
}

#[test]
fn binary_files_still_appear_in_name_only_searches() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let mut config = SearchConfig::new(vec![root.path().to_path_buf()]);
    config.name_patterns = "*.bin".to_string();
    assert_eq!(run(&config).names(), vec!["blob.bin"]);
}

#[test]
fn very_long_lines_are_searched_without_loading_the_file_whole() {
    let root = tempfile::tempdir().unwrap();
    let mut line = "x".repeat(5_000_000);
    line.push_str("needle");
    line.push('\n');
    common::write(root.path(), "minified.js", line.as_bytes());
    let outcome = run(&config_for(
        root.path(),
        "",
        ContentQuery::literal("needle"),
    ));
    assert_eq!(outcome.file("minified.js").hits.len(), 1);
}

#[test]
fn regex_anchors_apply_to_each_line() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let start = ContentQuery {
        regex: true,
        ..ContentQuery::literal("^ERR")
    };
    let hits = &run(&config_for(root.path(), "app.log", start))
        .file("app.log")
        .hits
        .clone();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].line_number, 2);

    let end = ContentQuery {
        regex: true,
        ..ContentQuery::literal("failure$")
    };
    assert_eq!(
        run(&config_for(root.path(), "app.log", end)).names(),
        vec!["app.log"]
    );
}
