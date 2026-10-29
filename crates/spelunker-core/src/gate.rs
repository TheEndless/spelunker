//! Gates the result callback and the counters so a search can end the moment it is cancelled.
//!
//! Workers that are stuck in a blocking call (an `open` held by antivirus or a stalled network
//! share) cannot be interrupted. Instead of waiting for them, `search()` closes the gate and
//! returns. From then on a straggler can neither emit an event nor change a count, so the
//! summary matches exactly what the caller was sent, and the callback is dropped on return.

use crate::model::SearchEvent;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;

#[derive(Default)]
pub struct Counters {
    pub files_scanned: AtomicU64,
    pub files_matched: AtomicU64,
    pub total_hits: AtomicU64,
    pub errors: AtomicU64,
    pub binary_skipped: AtomicU64,
}

/// The counters as they stood when the gate closed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Counts {
    pub files_scanned: u64,
    pub files_matched: u64,
    pub total_hits: u64,
    pub errors: u64,
    pub binary_skipped: u64,
}

impl Counters {
    fn snapshot(&self) -> Counts {
        Counts {
            files_scanned: self.files_scanned.load(Ordering::Relaxed),
            files_matched: self.files_matched.load(Ordering::Relaxed),
            total_hits: self.total_hits.load(Ordering::Relaxed),
            errors: self.errors.load(Ordering::Relaxed),
            binary_skipped: self.binary_skipped.load(Ordering::Relaxed),
        }
    }
}

pub struct Gate<F> {
    /// `Some` while open. Workers hold a read guard only to count and emit, never across I/O,
    /// so closing (which takes the write lock) is never held up by a blocked open.
    callback: RwLock<Option<F>>,
    counters: Counters,
}

impl<F: Fn(SearchEvent)> Gate<F> {
    pub fn new(callback: F) -> Self {
        Self {
            callback: RwLock::new(Some(callback)),
            counters: Counters::default(),
        }
    }

    /// Runs `action` with the callback and counters if the gate is still open. Returns `None`
    /// when it has closed, which tells a straggling worker that the search is over.
    pub fn when_open<T>(&self, action: impl FnOnce(&F, &Counters) -> T) -> Option<T> {
        let guard = self.callback.read().unwrap();
        guard
            .as_ref()
            .map(|callback| action(callback, &self.counters))
    }

    /// Closes the gate, drops the callback, and returns the counts at that instant. Because it
    /// takes the write lock, no counting or emitting is in progress while the snapshot is taken.
    pub fn close(&self) -> Counts {
        let mut guard = self.callback.write().unwrap();
        let callback = guard.take();
        let counts = self.counters.snapshot();
        drop(guard);
        // Dropped outside the lock, since dropping may run arbitrary code (for example closing a channel).
        drop(callback);
        counts
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::SearchEvent;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};

    fn matched_event() -> SearchEvent {
        SearchEvent::Progress {
            files_scanned: 1,
            folder: Default::default(),
        }
    }

    #[test]
    fn an_open_gate_runs_the_action_with_the_callback_and_counters() {
        let seen = Arc::new(Mutex::new(0));
        let sink = Arc::clone(&seen);
        let gate = Gate::new(move |_event| *sink.lock().unwrap() += 1);
        let ran = gate.when_open(|callback, counters| {
            counters.files_matched.fetch_add(1, Ordering::Relaxed);
            callback(matched_event());
        });
        assert!(ran.is_some());
        assert_eq!(*seen.lock().unwrap(), 1);
        assert_eq!(gate.close().files_matched, 1);
    }

    #[test]
    fn a_closed_gate_ignores_everything() {
        let seen = Arc::new(Mutex::new(0));
        let sink = Arc::clone(&seen);
        let gate = Gate::new(move |_event| *sink.lock().unwrap() += 1);
        gate.close();
        let ran = gate.when_open(|callback, counters| {
            counters.files_matched.fetch_add(1, Ordering::Relaxed);
            callback(matched_event());
        });
        assert!(ran.is_none());
        assert_eq!(*seen.lock().unwrap(), 0);
    }

    #[test]
    fn closing_drops_the_callback_so_whatever_it_owns_is_released() {
        let owned = Arc::new(());
        let held = Arc::clone(&owned);
        let gate = Gate::new(move |_event| {
            let _keep = &held;
        });
        assert_eq!(Arc::strong_count(&owned), 2);
        gate.close();
        assert_eq!(
            Arc::strong_count(&owned),
            1,
            "the callback must be dropped when the gate closes"
        );
    }

    #[test]
    fn closing_twice_is_harmless_and_keeps_the_same_counts() {
        let gate = Gate::new(|_event| {});
        gate.when_open(|_, counters| counters.errors.fetch_add(3, Ordering::Relaxed));
        let first = gate.close();
        let second = gate.close();
        assert_eq!(first, second);
        assert_eq!(first.errors, 3);
    }

    #[test]
    fn counts_taken_at_close_match_exactly_what_was_emitted_even_under_contention() {
        let emitted = Arc::new(AtomicU64::new(0));
        let sink = Arc::clone(&emitted);
        let gate = Arc::new(Gate::new(move |_event| {
            sink.fetch_add(1, Ordering::SeqCst);
        }));

        let workers: Vec<_> = (0..8)
            .map(|_| {
                let gate = Arc::clone(&gate);
                std::thread::spawn(move || {
                    for _ in 0..20_000 {
                        gate.when_open(|callback, counters| {
                            counters.files_matched.fetch_add(1, Ordering::Relaxed);
                            callback(SearchEvent::Progress {
                                files_scanned: 0,
                                folder: Default::default(),
                            });
                        });
                    }
                })
            })
            .collect();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let counts = gate.close();
        let emitted_at_close = emitted.load(Ordering::SeqCst);
        for worker in workers {
            worker.join().unwrap();
        }

        assert_eq!(counts.files_matched, emitted_at_close);
        assert_eq!(
            emitted.load(Ordering::SeqCst),
            emitted_at_close,
            "nothing may be emitted after close returns"
        );
    }
}
