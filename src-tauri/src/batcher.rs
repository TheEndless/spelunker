//! Groups the engine's per-file events into small batches so the webview is not flooded.

use crate::dto::{ErrorRow, ResultRow, SearchMessage};
use spelunker_core::SearchEvent;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender};
use std::time::{Duration, Instant};

pub const BATCH_INTERVAL: Duration = Duration::from_millis(50);

/// How many events may wait between the engine and `forward_batches`. Turning an event into what the
/// window shows costs more than finding it, so an unbounded queue grows for as long as the search
/// runs, and a Stop then waits for all of it to drain. Bounded, the engine's threads wait for room
/// instead, so a Stop is only ever a few thousand events behind.
const EVENT_QUEUE_CAPACITY: usize = 4096;

/// The queue between the engine and `forward_batches`: it holds at most `EVENT_QUEUE_CAPACITY`
/// events, and the engine's threads wait in `send` while it is full.
pub fn event_queue() -> (SyncSender<SearchEvent>, Receiver<SearchEvent>) {
    mpsc::sync_channel(EVENT_QUEUE_CAPACITY)
}

/// Drains `events` until every sender is dropped, calling `send` with at most one batch per
/// `interval`. Anything still pending when the channel closes is flushed before returning.
pub fn forward_batches(
    events: Receiver<SearchEvent>,
    interval: Duration,
    mut send: impl FnMut(SearchMessage),
) {
    let mut rows = Vec::new();
    let mut errors = Vec::new();
    // The newest progress report: how many files were scanned and the folder the walk was in.
    let mut progress: Option<(u64, String)> = None;
    let mut last_flush = Instant::now();

    let mut flush = |rows: &mut Vec<ResultRow>,
                     errors: &mut Vec<ErrorRow>,
                     progress: &mut Option<(u64, String)>| {
        if rows.is_empty() && errors.is_empty() && progress.is_none() {
            return;
        }
        let (files_scanned, folder) = match progress.take() {
            Some((count, folder)) => (Some(count), Some(folder)),
            None => (None, None),
        };
        send(SearchMessage::Batch {
            rows: std::mem::take(rows),
            errors: std::mem::take(errors),
            files_scanned,
            folder,
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
                folder,
            }) => progress = Some((count, folder.to_string_lossy().into_owned())),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if last_flush.elapsed() >= interval {
            flush(&mut rows, &mut errors, &mut progress);
            last_flush = Instant::now();
        }
    }
    flush(&mut rows, &mut errors, &mut progress);
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
                SearchEvent::Progress {
                    files_scanned: 256,
                    folder: PathBuf::from(r"C:\Work\a"),
                },
            ],
            Duration::from_secs(60),
        );
        assert_eq!(messages.len(), 1);
        match &messages[0] {
            SearchMessage::Batch {
                rows,
                errors,
                files_scanned,
                folder,
            } => {
                assert_eq!(rows.len(), 1);
                assert_eq!(errors.len(), 1);
                assert_eq!(*files_scanned, Some(256));
                assert_eq!(folder.as_deref(), Some(r"C:\Work\a"));
            }
            SearchMessage::Done { .. } => panic!("unexpected done message"),
        }
    }

    #[test]
    fn the_queue_from_the_engine_is_bounded() {
        let (sender, _receiver) = event_queue();
        for _ in 0..EVENT_QUEUE_CAPACITY {
            sender
                .try_send(file("a"))
                .expect("room while under the capacity");
        }
        assert!(
            matches!(sender.try_send(file("b")), Err(mpsc::TrySendError::Full(_))),
            "a queue with no limit lets a Stop wait for the whole backlog"
        );
    }

    #[test]
    fn a_fast_sender_waits_for_the_forwarder_and_loses_nothing() {
        let (sender, receiver) = event_queue();
        let total = EVENT_QUEUE_CAPACITY * 3;
        let producer = std::thread::spawn(move || {
            for _ in 0..total {
                sender.send(file("a")).unwrap();
            }
        });
        let mut delivered = 0;
        forward_batches(receiver, Duration::from_millis(1), |message| {
            if let SearchMessage::Batch { rows, .. } = message {
                delivered += rows.len();
            }
        });
        producer.join().unwrap();
        assert_eq!(delivered, total);
    }

    #[test]
    fn the_latest_progress_wins_within_a_batch() {
        let progress = |scanned: u64, folder: &str| SearchEvent::Progress {
            files_scanned: scanned,
            folder: PathBuf::from(folder),
        };
        let messages = collect(
            vec![progress(256, r"C:\a"), progress(512, r"C:\b")],
            Duration::from_secs(60),
        );
        match &messages[..] {
            [SearchMessage::Batch {
                files_scanned,
                folder,
                ..
            }] => {
                assert_eq!(*files_scanned, Some(512));
                assert_eq!(folder.as_deref(), Some(r"C:\b"));
            }
            other => panic!("expected one batch, got {} messages", other.len()),
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
