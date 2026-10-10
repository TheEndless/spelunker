//! Spelunker search core: parallel folder walk, name filtering, and streaming content search.
//! No UI and no global state. Callers pass a config, a cancel token, and an event callback.

mod binary_extensions;
mod cancel;
mod config;
mod content;
mod file_text;
mod gate;
mod model;
mod name_filter;
mod search;

pub use cancel::CancelToken;
pub use config::{ContentQuery, SearchConfig, SizeRange, TimeRange, DEFAULT_EXCLUDED_DIRS};
pub use content::{preview_file, validate_content_query};
pub use file_text::{read_file_text, FileText};
pub use model::{
    ConfigError, FileResult, Hit, PreviewLine, SearchError, SearchEvent, SearchSummary,
};
pub use name_filter::validate_name_regex;
pub use search::search;
