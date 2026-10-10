//! Groups the engine's per-file events into small batches so the webview is not flooded.

use crate::dto::{ErrorRow, ResultRow, SearchMessage};
use spelunker_core::SearchEvent;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

pub const BATCH_INTERVAL: Duration = Duration::from_millis(50);

/// Drains `events` until every sender is dropped, calling `send` with at most one batch per
/// `interval`. Anything still pending when the channel closes is flushed before returning.
pub fn forward_batches(
    events: Receiver<SearchEvent>,
    interval: Duration,
    mut send: impl FnMut(SearchMessage),
) {
    let mut rows = Vec::new();
    let mut errors = Vec::new();
    let mut files_scanned = None;
    let mut last_flush = Instant::now();

    let mut flush =
        |rows: &mut Vec<ResultRow>, errors: &mut Vec<ErrorRow>, files_scanned: &mut Option<u64>| {
            if rows.is_empty() && errors.is_empty() && files_scanned.is_none() {
                return;
            }
            send(SearchMessage::Batch {
                rows: std::mem::take(rows),
                errors: std::mem::take(errors),
                files_scanned: files_scanned.take(),
            });
        };

    loop {
        let wait = interval.saturating_sub(last_flush.elapsed());
        match events.recv_timeout(wait) {
            Ok(SearchEvent::File(file)) => rows.push(file.into()),
            Ok(SearchEvent::Error(error)) => errors.push(ErrorRow {
                path: error.path.to_string_lossy().into_owned(),
                message: error.message,
            }),
            Ok(SearchEvent::Progress {
                files_scanned: count,
            }) => files_scanned = Some(count),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if last_flush.elapsed() >= interval {
            flush(&mut rows, &mut errors, &mut files_scanned);
            last_flush = Instant::now();
        }
    }
    flush(&mut rows, &mut errors, &mut files_scanned);
}

#[cfg(test)]
mod tests {
    use super::*;
    use spelunker_core::{FileResult, SearchError};
    use std::path::PathBuf;
    use std::sync::mpsc;

    fn file(name: &str) -> SearchEvent {
        SearchEvent::File(FileResult {
            path: PathBuf::from(name),
            size: 1,
            modified: None,
            hits: Vec::new(),
        })
    }

    fn collect(events: Vec<SearchEvent>, interval: Duration) -> Vec<SearchMessage> {
        let (sender, receiver) = mpsc::channel();
        for event in events {
            sender.send(event).unwrap();
        }
        drop(sender);
        let mut messages = Vec::new();
        forward_batches(receiver, interval, |message| messages.push(message));
        messages
    }

    #[test]
    fn everything_is_delivered_when_the_channel_closes() {
        let messages = collect(
            vec![
                file("a"),
                SearchEvent::Error(SearchError {
                    path: PathBuf::from("b"),
                    message: "denied".into(),
                }),
                SearchEvent::Progress { files_scanned: 256 },
            ],
            Duration::from_secs(60),
        );
        assert_eq!(messages.len(), 1);
        match &messages[0] {
            SearchMessage::Batch {
                rows,
                errors,
                files_scanned,
            } => {
                assert_eq!(rows.len(), 1);
                assert_eq!(errors.len(), 1);
                assert_eq!(*files_scanned, Some(256));
            }
            SearchMessage::Done { .. } => panic!("unexpected done message"),
        }
    }

    #[test]
    fn no_message_is_sent_when_there_was_nothing_to_report() {
        assert!(collect(Vec::new(), Duration::from_millis(1)).is_empty());
    }

    #[test]
    fn a_zero_interval_still_delivers_every_row_exactly_once() {
        let events = (0..20).map(|index| file(&format!("f{index}"))).collect();
        let delivered: usize = collect(events, Duration::ZERO)
            .iter()
            .map(|message| match message {
                SearchMessage::Batch { rows, .. } => rows.len(),
                SearchMessage::Done { .. } => 0,
            })
            .sum();
        assert_eq!(delivered, 20);
    }
}
