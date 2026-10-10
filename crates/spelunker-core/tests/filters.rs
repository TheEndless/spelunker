mod common;

use common::{run, write};
use spelunker_core::{ConfigError, ContentQuery, SearchConfig, SizeRange, TimeRange};
use std::path::Path;
use std::time::{Duration, SystemTime};

fn config_for(root: &Path) -> SearchConfig {
    SearchConfig::new(vec![root.to_path_buf()])
}

fn days_ago(days: u64) -> SystemTime {
    SystemTime::now() - Duration::from_secs(days * 86_400)
}

/// Sets the modified time, and the created time where the platform allows it.
fn set_times(path: &Path, modified: SystemTime, created: SystemTime) {
    use std::fs::FileTimes;
    #[cfg(windows)]
    use std::os::windows::fs::FileTimesExt;

    let times = FileTimes::new().set_modified(modified);
    #[cfg(windows)]
    let times = times.set_created(created);
    #[cfg(not(windows))]
    let _ = created;
    let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
    file.set_times(times).unwrap();
}

fn sized_files(root: &Path) {
    write(root, "tiny.txt", &[b'x'; 10]);
    write(root, "small.txt", &[b'x'; 1_000]);
    write(root, "big.txt", &[b'x'; 100_000]);
}

mod size {
    use super::*;

    #[test]
    fn minimum_only_keeps_files_at_or_above_it() {
        let root = tempfile::tempdir().unwrap();
        sized_files(root.path());
        let mut config = config_for(root.path());
        config.size = SizeRange {
            min: Some(1_000),
            max: None,
        };
        assert_eq!(run(&config).names(), vec!["big.txt", "small.txt"]);
    }

    #[test]
    fn maximum_only_keeps_files_at_or_below_it() {
        let root = tempfile::tempdir().unwrap();
        sized_files(root.path());
        let mut config = config_for(root.path());
        config.size = SizeRange {
            min: None,
            max: Some(1_000),
        };
        assert_eq!(run(&config).names(), vec!["small.txt", "tiny.txt"]);
    }

    #[test]
    fn a_range_is_inclusive_at_both_ends() {
        let root = tempfile::tempdir().unwrap();
        sized_files(root.path());
        let mut config = config_for(root.path());
        config.size = SizeRange {
            min: Some(10),
            max: Some(1_000),
        };
        assert_eq!(run(&config).names(), vec!["small.txt", "tiny.txt"]);
    }

    #[test]
    fn an_empty_range_matches_nothing() {
        let root = tempfile::tempdir().unwrap();
        sized_files(root.path());
        let mut config = config_for(root.path());
        config.size = SizeRange {
            min: Some(5_000),
            max: Some(2_000),
        };
        assert!(run(&config).files.is_empty());
    }

    #[test]
    fn zero_byte_files_match_a_maximum() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "empty.txt", b"");
        let mut config = config_for(root.path());
        config.size = SizeRange {
            min: None,
            max: Some(0),
        };
        assert_eq!(run(&config).names(), vec!["empty.txt"]);
    }

    #[test]
    fn size_combines_with_name_and_content() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "a.log", b"needle and padding padding padding");
        write(root.path(), "b.log", b"needle");
        write(root.path(), "c.txt", b"needle and padding padding padding");
        let mut config = config_for(root.path());
        config.name_patterns = "*.log".into();
        config.content = Some(ContentQuery::literal("needle"));
        config.size = SizeRange {
            min: Some(20),
            max: None,
        };
        assert_eq!(run(&config).names(), vec!["a.log"]);
    }

    #[test]
    fn filtered_out_files_still_count_as_scanned_but_not_matched() {
        let root = tempfile::tempdir().unwrap();
        sized_files(root.path());
        let mut config = config_for(root.path());
        config.size = SizeRange {
            min: Some(1_000),
            max: None,
        };
        let summary = run(&config).summary;
        assert_eq!(summary.files_scanned, 3);
        assert_eq!(summary.files_matched, 2);
    }
}

mod dates {
    use super::*;

    fn dated_files(root: &Path) {
        write(root, "old.txt", b"x");
        write(root, "recent.txt", b"x");
        write(root, "today.txt", b"x");
        set_times(&root.join("old.txt"), days_ago(100), days_ago(200));
        set_times(&root.join("recent.txt"), days_ago(5), days_ago(150));
        set_times(&root.join("today.txt"), days_ago(0), days_ago(1));
    }

    #[test]
    fn modified_after_keeps_newer_files() {
        let root = tempfile::tempdir().unwrap();
        dated_files(root.path());
        let mut config = config_for(root.path());
        config.modified = TimeRange {
            from: Some(days_ago(7)),
            to: None,
        };
        assert_eq!(run(&config).names(), vec!["recent.txt", "today.txt"]);
    }

    #[test]
    fn modified_before_keeps_older_files() {
        let root = tempfile::tempdir().unwrap();
        dated_files(root.path());
        let mut config = config_for(root.path());
        config.modified = TimeRange {
            from: None,
            to: Some(days_ago(50)),
        };
        assert_eq!(run(&config).names(), vec!["old.txt"]);
    }

    #[test]
    fn modified_between_keeps_the_window() {
        let root = tempfile::tempdir().unwrap();
        dated_files(root.path());
        let mut config = config_for(root.path());
        config.modified = TimeRange {
            from: Some(days_ago(120)),
            to: Some(days_ago(50)),
        };
        assert_eq!(run(&config).names(), vec!["old.txt"]);
    }

    #[test]
    fn the_end_of_a_range_is_exclusive_and_the_start_inclusive() {
        let root = tempfile::tempdir().unwrap();
        let path = write(root.path(), "edge.txt", b"x");
        let instant = days_ago(10);
        set_times(&path, instant, instant);

        let mut config = config_for(root.path());
        config.modified = TimeRange {
            from: Some(instant),
            to: None,
        };
        assert_eq!(run(&config).names(), vec!["edge.txt"], "start is inclusive");

        config.modified = TimeRange {
            from: None,
            to: Some(instant),
        };
        assert!(run(&config).files.is_empty(), "end is exclusive");
    }

    #[cfg(windows)]
    #[test]
    fn created_date_is_filtered_independently_of_modified() {
        let root = tempfile::tempdir().unwrap();
        dated_files(root.path());
        let mut config = config_for(root.path());
        config.created = TimeRange {
            from: Some(days_ago(160)),
            to: Some(days_ago(140)),
        };
        assert_eq!(run(&config).names(), vec!["recent.txt"]);
    }

    #[cfg(windows)]
    #[test]
    fn modified_and_created_filters_combine_with_and() {
        let root = tempfile::tempdir().unwrap();
        dated_files(root.path());
        let mut config = config_for(root.path());
        config.modified = TimeRange {
            from: Some(days_ago(7)),
            to: None,
        };
        config.created = TimeRange {
            from: None,
            to: Some(days_ago(100)),
        };
        assert_eq!(run(&config).names(), vec!["recent.txt"]);
    }

    #[test]
    fn dates_combine_with_size_and_name() {
        let root = tempfile::tempdir().unwrap();
        dated_files(root.path());
        let mut config = config_for(root.path());
        config.name_patterns = "*.txt; -today.txt".into();
        config.modified = TimeRange {
            from: Some(days_ago(7)),
            to: None,
        };
        config.size = SizeRange {
            min: Some(1),
            max: None,
        };
        assert_eq!(run(&config).names(), vec!["recent.txt"]);
    }
}

mod name_regex {
    use super::*;

    fn invoice_files(root: &Path) {
        write(root, "invoice_2026.pdf", b"x");
        write(root, "INVOICE_7.PDF", b"x");
        write(root, "invoice_final.pdf", b"x");
        write(root, "my_invoice_1.pdf", b"x");
        write(root, "notes.txt", b"x");
    }

    #[test]
    fn a_regex_is_matched_against_the_file_name() {
        let root = tempfile::tempdir().unwrap();
        invoice_files(root.path());
        let mut config = config_for(root.path());
        config.name_regex = Some(r"^invoice_\d+\.pdf$".into());
        assert_eq!(
            run(&config).names(),
            vec!["INVOICE_7.PDF", "invoice_2026.pdf"]
        );
    }

    #[test]
    fn matching_is_case_insensitive_unless_the_pattern_says_otherwise() {
        let root = tempfile::tempdir().unwrap();
        invoice_files(root.path());
        let mut config = config_for(root.path());
        config.name_regex = Some(r"(?-i)^invoice_\d+\.pdf$".into());
        assert_eq!(run(&config).names(), vec!["invoice_2026.pdf"]);
    }

    #[test]
    fn the_regex_replaces_the_wildcard_patterns() {
        let root = tempfile::tempdir().unwrap();
        invoice_files(root.path());
        let mut config = config_for(root.path());
        config.name_patterns = "*.txt".into();
        config.name_regex = Some("^notes".into());
        assert_eq!(run(&config).names(), vec!["notes.txt"]);
        config.name_patterns = "*.zzz".into();
        assert_eq!(
            run(&config).names(),
            vec!["notes.txt"],
            "wildcards are ignored when a regex is set"
        );
    }

    #[test]
    fn an_unanchored_regex_matches_anywhere_in_the_name() {
        let root = tempfile::tempdir().unwrap();
        invoice_files(root.path());
        let mut config = config_for(root.path());
        config.name_regex = Some("invoice".into());
        assert_eq!(run(&config).files.len(), 4);
    }

    #[test]
    fn an_empty_regex_is_treated_as_no_name_filter() {
        let root = tempfile::tempdir().unwrap();
        invoice_files(root.path());
        let mut config = config_for(root.path());
        config.name_regex = Some(String::new());
        assert_eq!(run(&config).files.len(), 5);
    }

    #[test]
    fn an_invalid_regex_is_rejected_before_searching() {
        let root = tempfile::tempdir().unwrap();
        let mut config = config_for(root.path());
        config.name_regex = Some("(unclosed".into());
        let result = spelunker_core::search(&config, &spelunker_core::CancelToken::new(), |_| {});
        assert!(matches!(result, Err(ConfigError::InvalidNamePattern(_))));
    }

    #[test]
    fn name_regex_combines_with_content_search() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "a1.log", b"needle");
        write(root.path(), "a2.log", b"nothing");
        write(root.path(), "b1.log", b"needle");
        let mut config = config_for(root.path());
        config.name_regex = Some(r"^a\d\.log$".into());
        config.content = Some(ContentQuery::literal("needle"));
        assert_eq!(run(&config).names(), vec!["a1.log"]);
    }
}

mod multi_line {
    use super::*;

    fn multi_line_query(pattern: &str) -> ContentQuery {
        ContentQuery {
            regex: true,
            multi_line: true,
            ..ContentQuery::literal(pattern)
        }
    }

    #[test]
    fn a_pattern_can_span_line_breaks() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "doc.txt", b"first\nalpha\nbeta\nlast\n");
        let mut config = config_for(root.path());
        config.content = Some(multi_line_query(r"alpha\nbeta"));
        let outcome = run(&config);
        let hit = &outcome.file("doc.txt").hits[0];
        assert_eq!(hit.line_number, 2, "line number is where the match starts");
        assert_eq!(hit.line, "alpha\nbeta");
        assert_eq!(&hit.line[hit.match_ranges[0].clone()], "alpha\nbeta");
    }

    #[test]
    fn crlf_files_match_a_plain_newline_pattern() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "win.txt", b"alpha\r\nbeta\r\n");
        let mut config = config_for(root.path());
        config.content = Some(multi_line_query(r"alpha\s+beta"));
        assert_eq!(run(&config).names(), vec!["win.txt"]);
    }

    #[test]
    fn dot_does_not_cross_lines_unless_asked() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "doc.txt", b"alpha\nbeta\n");
        let mut config = config_for(root.path());
        config.content = Some(multi_line_query("alpha.beta"));
        assert!(run(&config).files.is_empty());
        config.content = Some(multi_line_query("(?s)alpha.beta"));
        assert_eq!(run(&config).names(), vec!["doc.txt"]);
    }

    #[test]
    fn single_line_patterns_still_work_in_multi_line_mode() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "doc.txt", b"one\ntwo needle\nthree\n");
        let mut config = config_for(root.path());
        config.content = Some(multi_line_query("needle"));
        let hits = &run(&config).file("doc.txt").hits.clone();
        assert_eq!(hits[0].line_number, 2);
    }

    #[test]
    fn a_newline_pattern_without_multi_line_is_a_clear_config_error() {
        let query = ContentQuery {
            regex: true,
            ..ContentQuery::literal(r"alpha\nbeta")
        };
        let error = spelunker_core::validate_content_query(&query).unwrap_err();
        let message = error.to_string();
        assert!(matches!(error, ConfigError::InvalidContentPattern(_)));
        assert!(
            message.to_lowercase().contains("multi-line"),
            "message should point at the multi-line option, got: {message}"
        );
        assert!(
            !message.contains("--multiline"),
            "must not mention another tool's flag: {message}"
        );
    }

    #[test]
    fn multi_line_matching_works_on_utf16_files() {
        let root = tempfile::tempdir().unwrap();
        write(
            root.path(),
            "wide.txt",
            &common::utf16le("alpha\nbeta\n", true),
        );
        let mut config = config_for(root.path());
        config.content = Some(multi_line_query(r"alpha\nbeta"));
        assert_eq!(run(&config).names(), vec!["wide.txt"]);
    }
}

mod validation {
    use super::*;
    use spelunker_core::{validate_content_query, validate_name_regex};

    #[test]
    fn valid_patterns_pass() {
        let query = ContentQuery {
            regex: true,
            ..ContentQuery::literal(r"ERR-\d{4}")
        };
        assert!(validate_content_query(&query).is_ok());
        assert!(validate_name_regex(r"^invoice_\d+\.pdf$").is_ok());
    }

    #[test]
    fn invalid_patterns_report_a_message() {
        let query = ContentQuery {
            regex: true,
            ..ContentQuery::literal("(unclosed")
        };
        assert!(
            validate_content_query(&query)
                .unwrap_err()
                .to_string()
                .contains("unclosed")
                || !validate_content_query(&query)
                    .unwrap_err()
                    .to_string()
                    .is_empty()
        );
        assert!(validate_name_regex("[bad").is_err());
    }

    #[test]
    fn a_literal_query_is_always_valid_whatever_it_contains() {
        assert!(validate_content_query(&ContentQuery::literal("(unclosed [")).is_ok());
    }

    #[test]
    fn empty_patterns_are_valid() {
        let query = ContentQuery {
            regex: true,
            ..ContentQuery::literal("")
        };
        assert!(validate_content_query(&query).is_ok());
        assert!(validate_name_regex("").is_ok());
    }
}
