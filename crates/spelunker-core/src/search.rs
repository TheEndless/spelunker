use crate::binary_extensions::has_binary_extension;
use crate::cancel::CancelToken;
use crate::config::SearchConfig;
use crate::content::{ContentMatcher, ContentOutcome};
use crate::gate::Gate;
use crate::model::{ConfigError, FileResult, SearchError, SearchEvent, SearchSummary};
use crate::name_filter::NameFilter;
use ignore::{WalkBuilder, WalkState};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const PROGRESS_INTERVAL: u64 = 256;

/// How often the caller of `search` looks at the cancel flag while the walk runs.
const CANCEL_POLL: Duration = Duration::from_millis(10);

/// Everything the worker threads share. Owned by an `Arc`, because after a cancel the workers
/// outlive the `search` call that started them.
struct Shared<F> {
    config: SearchConfig,
    name_filter: NameFilter,
    content_matcher: Option<ContentMatcher>,
    cancel: CancelToken,
    gate: Gate<F>,
}

/// Runs a search and returns its summary, using a pool of worker threads internally.
///
/// `on_event` is called from those worker threads as results are found, so it must be cheap and
/// thread-safe. Returns `Err` only for invalid patterns. Unreadable paths arrive as
/// `SearchEvent::Error` and the search carries on.
///
/// Once `cancel` is set, `search` returns within about 10 ms. Workers stuck inside a blocking
/// call (an `open` held by antivirus, a stalled network share) cannot be interrupted, so they are
/// left to finish on their own. They can no longer emit events or change the counts, and
/// `on_event` is dropped before `search` returns, so the caller owns no state they could touch.
pub fn search<F>(
    config: &SearchConfig,
    cancel: &CancelToken,
    on_event: F,
) -> Result<SearchSummary, ConfigError>
where
    F: Fn(SearchEvent) + Send + Sync + 'static,
{
    let started = Instant::now();
    let name_filter = NameFilter::new(&config.name_patterns, config.name_regex.as_deref())?;
    let content_matcher = match &config.content {
        Some(query) if !query.text.is_empty() => {
            Some(ContentMatcher::new(query, config.include_binary)?)
        }
        _ => None,
    };
    let shared = Arc::new(Shared {
        config: config.clone(),
        name_filter,
        content_matcher,
        cancel: cancel.clone(),
        gate: Gate::new(on_event),
    });

    if !config.roots.is_empty() {
        let (done_sender, done_receiver) = mpsc::channel();
        let walk_shared = Arc::clone(&shared);
        let walk = std::thread::spawn(move || {
            run_walk(&walk_shared);
            let _ = done_sender.send(());
        });
        wait_for_walk(walk, done_receiver, cancel);
    }

    let counts = shared.gate.close();
    Ok(SearchSummary {
        files_scanned: counts.files_scanned,
        files_matched: counts.files_matched,
        total_hits: counts.total_hits,
        errors: counts.errors,
        binary_skipped: counts.binary_skipped,
        elapsed: started.elapsed(),
        cancelled: cancel.is_cancelled(),
    })
}

/// Waits for the walk thread to finish, or gives up on it once `cancel` is set. A walk that
/// finished is joined, and a panic inside it is raised again here instead of being lost.
fn wait_for_walk(walk: JoinHandle<()>, done: Receiver<()>, cancel: &CancelToken) {
    loop {
        match done.recv_timeout(CANCEL_POLL) {
            // Disconnected means the walk thread ended without reporting, which only a panic does.
            Ok(()) | Err(RecvTimeoutError::Disconnected) => {
                if let Err(panic) = walk.join() {
                    std::panic::resume_unwind(panic);
                }
                return;
            }
            Err(RecvTimeoutError::Timeout) if cancel.is_cancelled() => return,
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
}

fn run_walk<F>(shared: &Arc<Shared<F>>)
where
    F: Fn(SearchEvent) + Send + Sync + 'static,
{
    let Some(first_root) = shared.config.roots.first().cloned() else {
        return;
    };
    let walker = build_walker(&first_root, &shared.config).build_parallel();
    walker.run(|| {
        let shared = Arc::clone(shared);
        let first_root = first_root.clone();
        Box::new(move |entry| {
            if shared.cancel.is_cancelled() {
                return WalkState::Quit;
            }
            shared.visit(entry, &first_root);
            WalkState::Continue
        })
    });
}

fn build_walker(first_root: &Path, config: &SearchConfig) -> WalkBuilder {
    let mut builder = WalkBuilder::new(first_root);
    for root in &config.roots[1..] {
        builder.add(root);
    }

    // Spelunker searches everything the user points it at, so ignore files such as .gitignore do not apply.
    builder
        .standard_filters(false)
        .hidden(!config.include_hidden)
        // With links followed, the walker compares each folder against its ancestors and reports
        // a loop as an error instead of descending into it again.
        .follow_links(config.follow_links);

    // ignore counts the root as depth 0, so "levels below the root" is one more than that.
    let folder_levels = if config.recurse {
        config.max_depth
    } else {
        Some(0)
    };
    builder.max_depth(folder_levels.map(|levels| levels + 1));

    let excluded: HashSet<String> = config
        .exclude_dirs
        .iter()
        .map(|name| name.to_lowercase())
        .collect();
    let include_system = config.include_hidden;
    builder.filter_entry(move |entry| {
        if entry.depth() == 0 {
            return true;
        }
        let is_excluded_dir = entry.file_type().is_some_and(|kind| kind.is_dir())
            && excluded.contains(&entry.file_name().to_string_lossy().to_lowercase());
        !is_excluded_dir && (include_system || !has_system_attribute(entry))
    });
    builder
}

/// The walker's hidden filter only looks at the hidden attribute, but the spec treats system
/// files and folders the same way, so they are filtered here.
#[cfg(windows)]
fn has_system_attribute(entry: &ignore::DirEntry) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
    entry
        .metadata()
        .is_ok_and(|metadata| metadata.file_attributes() & FILE_ATTRIBUTE_SYSTEM != 0)
}

#[cfg(not(windows))]
fn has_system_attribute(_entry: &ignore::DirEntry) -> bool {
    false
}

impl<F: Fn(SearchEvent)> Shared<F> {
    /// Examines one walk entry. Every count and every event goes through the gate, and a closed
    /// gate means the search is over, so the worker stops doing anything further.
    fn visit(&self, entry: Result<ignore::DirEntry, ignore::Error>, first_root: &Path) {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                let path = error_path(&error).unwrap_or_else(|| first_root.to_path_buf());
                self.report_error(path, error.to_string());
                return;
            }
        };
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            return;
        }
        // Every file the walk reaches counts as scanned, whether or not its name matches.
        let counted = self.gate.when_open(|callback, counters| {
            let scanned = counters.files_scanned.fetch_add(1, Ordering::Relaxed) + 1;
            if scanned.is_multiple_of(PROGRESS_INTERVAL) {
                callback(SearchEvent::Progress {
                    files_scanned: scanned,
                });
            }
        });
        if counted.is_none() {
            return;
        }
        if !self
            .name_filter
            .is_match(&entry.file_name().to_string_lossy())
        {
            return;
        }

        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(error) => {
                self.report_error(entry.path().to_path_buf(), error.to_string());
                return;
            }
        };
        let modified = metadata.modified().ok();
        // Cheap metadata filters run before the file is opened for content search.
        let config = &self.config;
        if !config.size.contains(metadata.len())
            || !config.modified.contains(modified)
            || !config.created.contains(metadata.created().ok())
        {
            return;
        }
        let mut result = FileResult {
            path: entry.path().to_path_buf(),
            size: metadata.len(),
            modified,
            hits: Vec::new(),
        };

        if let Some(content_matcher) = &self.content_matcher {
            // Skip known binary types without opening them. An open can block on antivirus for
            // seconds and cannot be cancelled, and the content check would discard them anyway.
            if !config.include_binary && has_binary_extension(entry.path()) {
                self.count_binary_skipped();
                return;
            }
            match content_matcher.search_file(entry.path(), &self.cancel) {
                Ok(ContentOutcome::Hits(hits)) if hits.is_empty() => return,
                Ok(ContentOutcome::Hits(hits)) => result.hits = hits,
                Ok(ContentOutcome::Binary) => {
                    self.count_binary_skipped();
                    return;
                }
                Ok(ContentOutcome::Cancelled) => return,
                Err(error) => {
                    self.report_error(result.path, error.to_string());
                    return;
                }
            }
        }

        self.gate.when_open(|callback, counters| {
            counters.files_matched.fetch_add(1, Ordering::Relaxed);
            counters
                .total_hits
                .fetch_add(result.hits.len() as u64, Ordering::Relaxed);
            callback(SearchEvent::File(result));
        });
    }

    fn count_binary_skipped(&self) {
        self.gate.when_open(|_, counters| {
            counters.binary_skipped.fetch_add(1, Ordering::Relaxed);
        });
    }

    fn report_error(&self, path: PathBuf, message: String) {
        self.gate.when_open(|callback, counters| {
            counters.errors.fetch_add(1, Ordering::Relaxed);
            callback(SearchEvent::Error(SearchError { path, message }));
        });
    }
}

fn error_path(error: &ignore::Error) -> Option<PathBuf> {
    match error {
        ignore::Error::WithPath { path, .. } => Some(path.clone()),
        ignore::Error::Loop { child, .. } => Some(child.clone()),
        ignore::Error::WithDepth { err, .. } | ignore::Error::WithLineNumber { err, .. } => {
            error_path(err)
        }
        ignore::Error::Partial(errors) => errors.iter().find_map(error_path),
        _ => None,
    }
}

#[cfg(test)]
mod wait_tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    /// A thread standing in for a walk whose workers are blocked inside a file open.
    fn blocked_walk() -> (
        std::thread::JoinHandle<()>,
        mpsc::Receiver<()>,
        mpsc::Sender<()>,
    ) {
        let (release, released) = mpsc::channel::<()>();
        let (done_sender, done_receiver) = mpsc::channel();
        let walk = std::thread::spawn(move || {
            let _ = released.recv();
            let _ = done_sender.send(());
        });
        (walk, done_receiver, release)
    }

    #[test]
    fn a_blocked_walk_is_abandoned_soon_after_cancel() {
        let (walk, done, release) = blocked_walk();
        let cancel = CancelToken::new();
        let canceller = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            canceller.cancel();
        });

        let started = Instant::now();
        wait_for_walk(walk, done, &cancel);
        assert!(
            started.elapsed() < Duration::from_millis(500),
            "waited {:?} for a blocked walk",
            started.elapsed()
        );
        let _ = release.send(());
    }

    #[test]
    fn a_walk_that_finishes_is_joined_without_waiting_for_cancel() {
        let (walk, done, release) = blocked_walk();
        let _ = release.send(());
        wait_for_walk(walk, done, &CancelToken::new());
    }

    #[test]
    #[should_panic(expected = "worker exploded")]
    fn a_panic_in_the_walk_reaches_the_caller() {
        let (done_sender, done_receiver) = mpsc::channel::<()>();
        let walk = std::thread::spawn(move || {
            let _keep_sender_until_unwind = done_sender;
            panic!("worker exploded");
        });
        wait_for_walk(walk, done_receiver, &CancelToken::new());
    }
}
