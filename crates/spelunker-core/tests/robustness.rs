mod common;

use common::{build_fixture, run, run_with_cancel};
use spelunker_core::{search, CancelToken, ContentQuery, SearchConfig, SearchEvent};
use std::sync::atomic::{AtomicUsize, Ordering};

#[test]
fn summary_counts_files_matches_and_hits() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let mut config = SearchConfig::new(vec![root.path().to_path_buf()]);
    config.name_patterns = "readme.txt; report-2026.md".to_string();
    config.content = Some(ContentQuery::literal("needle"));
    let outcome = run(&config);
    let every_visible_file = run(&SearchConfig::new(vec![root.path().to_path_buf()]))
        .files
        .len() as u64;
    assert_eq!(
        outcome.summary.files_scanned, every_visible_file,
        "scanned counts every file the walk examined, not only name matches"
    );
    assert_eq!(outcome.summary.files_matched, 1);
    assert_eq!(outcome.summary.total_hits, 2);
    assert_eq!(outcome.summary.errors, 0);
    assert!(!outcome.summary.cancelled);
}

#[test]
fn a_token_cancelled_before_the_search_stops_it_immediately() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let cancel = CancelToken::new();
    cancel.cancel();
    let outcome = run_with_cancel(&SearchConfig::new(vec![root.path().to_path_buf()]), &cancel);
    assert!(outcome.files.is_empty());
    assert!(outcome.summary.cancelled);
}

#[test]
fn cancelling_from_the_result_callback_stops_the_walk_early() {
    let root = tempfile::tempdir().unwrap();
    for index in 0..3000 {
        common::write(root.path(), &format!("bulk/file_{index:04}.txt"), b"x");
    }
    let cancel = CancelToken::new();
    let delivered = std::sync::Arc::new(AtomicUsize::new(0));
    let (counter, canceller) = (std::sync::Arc::clone(&delivered), cancel.clone());
    let summary = search(
        &SearchConfig::new(vec![root.path().to_path_buf()]),
        &cancel,
        move |event| {
            if let SearchEvent::File(_) = event {
                counter.fetch_add(1, Ordering::SeqCst);
                canceller.cancel();
            }
        },
    )
    .unwrap();
    assert!(summary.cancelled);
    let delivered = delivered.load(Ordering::SeqCst);
    assert!(
        delivered < 3000,
        "walk should stop early, delivered {delivered}"
    );
}

#[test]
fn missing_start_folder_is_reported_as_an_error_not_a_panic() {
    let root = tempfile::tempdir().unwrap();
    let config = SearchConfig::new(vec![root.path().join("does_not_exist")]);
    let outcome = run(&config);
    assert!(outcome.files.is_empty());
    assert_eq!(outcome.errors.len(), 1);
    assert_eq!(outcome.summary.errors, 1);
}

#[cfg(windows)]
#[test]
fn a_locked_file_is_counted_as_an_error_and_the_rest_still_search() {
    use std::os::windows::fs::OpenOptionsExt;

    let root = tempfile::tempdir().unwrap();
    common::write(root.path(), "open.txt", b"needle\n");
    let locked_path = common::write(root.path(), "locked.txt", b"needle\n");
    // share_mode(0) denies every other opener, like an application holding the file exclusively.
    let _lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(0)
        .open(&locked_path)
        .unwrap();

    let mut config = SearchConfig::new(vec![root.path().to_path_buf()]);
    config.content = Some(ContentQuery::literal("needle"));
    let outcome = run(&config);

    assert_eq!(outcome.names(), vec!["open.txt"]);
    assert_eq!(outcome.errors.len(), 1);
    assert!(outcome.errors[0].path.ends_with("locked.txt"));
    assert_eq!(outcome.summary.errors, 1);
}

#[cfg(windows)]
#[test]
fn a_locked_file_still_appears_in_a_name_only_search() {
    use std::os::windows::fs::OpenOptionsExt;

    let root = tempfile::tempdir().unwrap();
    let locked_path = common::write(root.path(), "locked.txt", b"x");
    let _lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(0)
        .open(&locked_path)
        .unwrap();
    let outcome = run(&SearchConfig::new(vec![root.path().to_path_buf()]));
    assert_eq!(outcome.names(), vec!["locked.txt"]);
}

#[test]
fn progress_events_report_files_scanned_every_256_files() {
    let root = tempfile::tempdir().unwrap();
    for index in 0..600 {
        common::write(root.path(), &format!("bulk/file_{index:04}.txt"), b"x");
    }
    let reported = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = std::sync::Arc::clone(&reported);
    let summary = search(
        &SearchConfig::new(vec![root.path().to_path_buf()]),
        &CancelToken::new(),
        move |event| {
            if let SearchEvent::Progress { files_scanned } = event {
                sink.lock().unwrap().push(files_scanned);
            }
        },
    )
    .unwrap();
    let mut reported = reported.lock().unwrap().clone();
    reported.sort();
    assert_eq!(reported, vec![256, 512]);
    assert_eq!(summary.files_scanned, 600);
}

#[test]
fn after_a_cancelled_search_returns_nothing_more_arrives_and_the_callback_is_gone() {
    use std::sync::mpsc::{self, RecvTimeoutError};
    use std::time::Duration;

    let root = tempfile::tempdir().unwrap();
    for index in 0..3000 {
        common::write(root.path(), &format!("bulk/file_{index:04}.txt"), b"x");
    }
    let cancel = CancelToken::new();
    let canceller = cancel.clone();
    let (sender, receiver) = mpsc::channel();
    let sender = std::sync::Mutex::new(sender);
    let summary = search(
        &SearchConfig::new(vec![root.path().to_path_buf()]),
        &cancel,
        move |event| {
            if let SearchEvent::File(_) = &event {
                canceller.cancel();
            }
            let _ = sender.lock().unwrap().send(event);
        },
    )
    .unwrap();
    assert!(summary.cancelled);

    // Drain what was sent before the search returned.
    let mut delivered_files = 0;
    let end = loop {
        match receiver.recv_timeout(Duration::from_millis(400)) {
            Ok(SearchEvent::File(_)) => delivered_files += 1,
            Ok(_) => {}
            Err(error) => break error,
        }
    };
    // Disconnected (not Timeout) proves the callback, and the sender it owned, was dropped.
    assert_eq!(end, RecvTimeoutError::Disconnected);
    assert_eq!(
        delivered_files as u64, summary.files_matched,
        "the summary must match exactly what was delivered"
    );
}
