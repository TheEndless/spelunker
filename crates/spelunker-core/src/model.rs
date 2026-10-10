use std::fmt;
use std::ops::Range;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

/// One matching line inside a file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hit {
    pub line_number: u64,
    /// Decoded text of the line without its line terminator.
    pub line: String,
    /// Byte ranges into `line` for each match, ready for highlighting.
    pub match_ranges: Vec<Range<usize>>,
}

/// One line in a file preview: a match or a line of surrounding context.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreviewLine {
    pub line_number: u64,
    pub text: String,
    pub is_match: bool,
    /// Byte ranges into `text`. Empty for context lines.
    pub match_ranges: Vec<Range<usize>>,
}

/// A file that passed every criterion. `hits` is empty for name-only searches.
#[derive(Clone, Debug)]
pub struct FileResult {
    pub path: PathBuf,
    pub size: u64,
    pub modified: Option<SystemTime>,
    pub hits: Vec<Hit>,
}

/// A path that could not be read. Searching continues past these.
#[derive(Clone, Debug)]
pub struct SearchError {
    pub path: PathBuf,
    pub message: String,
}

#[derive(Clone, Debug)]
pub enum SearchEvent {
    File(FileResult),
    Error(SearchError),
    /// Emitted every 256 files examined so a UI can show live progress.
    Progress {
        files_scanned: u64,
    },
}

#[derive(Clone, Debug, Default)]
pub struct SearchSummary {
    /// Every file the walk reached, whether or not its name matched.
    pub files_scanned: u64,
    pub files_matched: u64,
    pub total_hits: u64,
    pub errors: u64,
    pub binary_skipped: u64,
    pub elapsed: Duration,
    pub cancelled: bool,
}

#[derive(Debug)]
pub enum ConfigError {
    InvalidContentPattern(String),
    InvalidNamePattern(String),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidContentPattern(message) => {
                write!(formatter, "invalid content pattern: {message}")
            }
            Self::InvalidNamePattern(message) => {
                write!(formatter, "invalid name pattern: {message}")
            }
        }
    }
}

impl std::error::Error for ConfigError {}
