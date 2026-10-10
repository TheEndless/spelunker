use std::path::PathBuf;
use std::time::SystemTime;

pub const DEFAULT_EXCLUDED_DIRS: [&str; 4] = [
    ".git",
    "node_modules",
    "$RECYCLE.BIN",
    "System Volume Information",
];

/// What to look for inside files.
#[derive(Clone, Debug)]
pub struct ContentQuery {
    pub text: String,
    pub match_case: bool,
    pub whole_word: bool,
    /// Treat `text` as a Rust regex instead of a literal.
    pub regex: bool,
    /// Let a regex match across line breaks. The whole file is read into memory in this mode, so
    /// files above a size limit are reported as errors instead of searched.
    pub multi_line: bool,
}

impl ContentQuery {
    /// Case-insensitive literal search, the default mode.
    pub fn literal(text: &str) -> Self {
        Self {
            text: text.to_string(),
            match_case: false,
            whole_word: false,
            regex: false,
            multi_line: false,
        }
    }
}

/// Inclusive size bounds in bytes. `None` leaves that side open.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SizeRange {
    pub min: Option<u64>,
    pub max: Option<u64>,
}

impl SizeRange {
    pub fn contains(&self, size: u64) -> bool {
        self.min.is_none_or(|min| size >= min) && self.max.is_none_or(|max| size <= max)
    }
}

/// A time window, start inclusive and end exclusive. `None` leaves that side open.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TimeRange {
    pub from: Option<SystemTime>,
    pub to: Option<SystemTime>,
}

impl TimeRange {
    /// A file whose timestamp is unknown cannot satisfy a bound, so it fails any active range.
    pub fn contains(&self, time: Option<SystemTime>) -> bool {
        if self.from.is_none() && self.to.is_none() {
            return true;
        }
        let Some(time) = time else {
            return false;
        };
        self.from.is_none_or(|from| time >= from) && self.to.is_none_or(|to| time < to)
    }
}

#[derive(Clone, Debug)]
pub struct SearchConfig {
    pub roots: Vec<PathBuf>,
    /// Wildcard list such as `*.log; *.txt; -*.min.js`. Empty matches every file.
    pub name_patterns: String,
    /// A regex matched against the file name instead of `name_patterns`. Case-insensitive unless
    /// the pattern says otherwise. `None` or empty means wildcards are used.
    pub name_regex: Option<String>,
    /// `None` or an empty `text` runs a name-only search.
    pub content: Option<ContentQuery>,
    pub size: SizeRange,
    pub modified: TimeRange,
    pub created: TimeRange,
    pub recurse: bool,
    /// Folder levels below each root to descend into. `None` is unlimited.
    pub max_depth: Option<usize>,
    /// Folder names (case-insensitive) that are never entered.
    pub exclude_dirs: Vec<String>,
    /// Files and folders with the hidden or system attribute (or a leading dot).
    pub include_hidden: bool,
    pub include_binary: bool,
    /// Descend into junctions and symlinked folders. Loops are detected and reported as errors.
    pub follow_links: bool,
}

impl SearchConfig {
    pub fn new(roots: Vec<PathBuf>) -> Self {
        Self {
            roots,
            name_patterns: String::new(),
            name_regex: None,
            content: None,
            size: SizeRange::default(),
            modified: TimeRange::default(),
            created: TimeRange::default(),
            recurse: true,
            max_depth: None,
            exclude_dirs: DEFAULT_EXCLUDED_DIRS
                .iter()
                .map(|name| name.to_string())
                .collect(),
            include_hidden: false,
            include_binary: false,
            follow_links: false,
        }
    }
}
