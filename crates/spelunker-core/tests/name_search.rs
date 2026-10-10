mod common;

use common::{build_fixture, run};
use spelunker_core::SearchConfig;

fn config_for(root: &std::path::Path, patterns: &str) -> SearchConfig {
    let mut config = SearchConfig::new(vec![root.to_path_buf()]);
    config.name_patterns = patterns.to_string();
    config
}

#[test]
fn star_wildcard_matches_extension() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&config_for(root.path(), "*.md"));
    assert_eq!(outcome.names(), vec!["report-2026.md"]);
}

#[test]
fn question_mark_matches_exactly_one_character() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&config_for(root.path(), "app.??"));
    assert_eq!(outcome.names(), vec!["app.js"]);
}

#[test]
fn matching_is_case_insensitive() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&config_for(root.path(), "README.TXT"));
    assert_eq!(outcome.names(), vec!["readme.txt"]);
}

#[test]
fn multiple_patterns_split_on_semicolon_and_comma() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let semicolons = run(&config_for(root.path(), "*.log; *.md"));
    assert_eq!(semicolons.names(), vec!["app.log", "report-2026.md"]);
    let commas = run(&config_for(root.path(), "*.log, *.md"));
    assert_eq!(commas.names(), vec!["app.log", "report-2026.md"]);
}

#[test]
fn leading_dash_excludes_matches() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&config_for(root.path(), "*.js; -*.min.js"));
    assert_eq!(outcome.names(), vec!["app.js"]);
}

#[test]
fn only_exclusions_means_everything_else() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let everything = run(&config_for(root.path(), ""));
    let without_js = run(&config_for(root.path(), "-*.js"));
    assert_eq!(without_js.files.len(), everything.files.len() - 2);
    assert!(!without_js.names().iter().any(|name| name.ends_with(".js")));
}

#[test]
fn plain_word_matches_anywhere_in_the_name() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&config_for(root.path(), "report"));
    assert_eq!(outcome.names(), vec!["report-2026.md"]);
}

#[test]
fn name_pattern_never_matches_against_the_folder() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&config_for(root.path(), "logs"));
    assert!(outcome.files.is_empty(), "got {:?}", outcome.names());
}

#[test]
fn regex_metacharacters_in_a_wildcard_are_literal() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&config_for(root.path(), "app(1).log"));
    assert!(outcome.files.is_empty());
    let dot = run(&config_for(root.path(), "app.log"));
    assert_eq!(dot.names(), vec!["app.log"]);
}

#[test]
fn name_only_results_carry_size_and_no_hits() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&config_for(root.path(), "app.log"));
    let file = outcome.file("app.log");
    assert_eq!(file.size, 37);
    assert!(file.modified.is_some());
    assert!(file.hits.is_empty());
}
