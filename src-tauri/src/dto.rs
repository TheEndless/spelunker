//! Wire types between the Rust backend and the webview. Field names are camelCase for JS.

use crate::type_name::type_name_for_path;
use serde::{Deserialize, Serialize};
use spelunker_core::{
    ContentQuery, FileResult, PreviewLine, SearchConfig, SearchSummary, SizeRange, TimeRange,
};
use std::ops::Range;
use std::path::PathBuf;
use std::time::{Duration, UNIX_EPOCH};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRequest {
    pub text: String,
    pub match_case: bool,
    pub whole_word: bool,
    pub regex: bool,
    pub multi_line: bool,
}

impl QueryRequest {
    pub fn into_query(self) -> ContentQuery {
        ContentQuery {
            text: self.text,
            match_case: self.match_case,
            whole_word: self.whole_word,
            regex: self.regex,
            multi_line: self.multi_line,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    /// Start folders. The UI splits its "Look in" box on `;`.
    pub roots: Vec<String>,
    pub name_patterns: String,
    pub query: QueryRequest,
    pub recurse: bool,
    pub max_depth: Option<usize>,
    pub include_hidden: bool,
    pub include_binary: bool,
    pub follow_links: bool,
    /// When set, `name_patterns` is a regex on the file name instead of a wildcard list.
    pub name_is_regex: bool,
    pub min_size: Option<u64>,
    pub max_size: Option<u64>,
    pub modified: MillisRange,
    pub created: MillisRange,
}

/// An absolute time window in milliseconds since the Unix epoch. The UI resolves relative
/// choices such as "last 7 days" into this when the search starts.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MillisRange {
    pub from_ms: Option<u64>,
    pub to_ms: Option<u64>,
}

impl MillisRange {
    fn into_time_range(self) -> TimeRange {
        let at = |millis: u64| UNIX_EPOCH + Duration::from_millis(millis);
        TimeRange {
            from: self.from_ms.map(at),
            to: self.to_ms.map(at),
        }
    }
}

impl SearchRequest {
    pub fn into_config(self) -> SearchConfig {
        let roots = if self
            .roots
            .iter()
            .any(|root| crate::drives::is_all_drives(root))
        {
            crate::drives::expand_roots(self.roots, &crate::drives::fixed_drives())
        } else {
            self.roots
        };
        // No file may be reported twice, which overlapping roots would do.
        let covers_subfolders = self.recurse && self.max_depth.is_none();
        let roots = crate::roots::tidy_roots(roots, |outer, inner| {
            covers_subfolders
                && crate::roots::outer_search_reaches(
                    outer,
                    inner,
                    &spelunker_core::DEFAULT_EXCLUDED_DIRS,
                    self.include_hidden,
                    self.follow_links,
                )
        });
        let mut config = SearchConfig::new(roots.into_iter().map(PathBuf::from).collect());
        if self.name_is_regex {
            config.name_regex = Some(self.name_patterns);
        } else {
            config.name_patterns = self.name_patterns;
        }
        config.size = SizeRange {
            min: self.min_size,
            max: self.max_size,
        };
        config.modified = self.modified.into_time_range();
        config.created = self.created.into_time_range();
        config.content = Some(self.query.into_query());
        config.recurse = self.recurse;
        config.max_depth = self.max_depth;
        config.include_hidden = self.include_hidden;
        config.include_binary = self.include_binary;
        config.follow_links = self.follow_links;
        config
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultRow {
    pub path: String,
    pub size: u64,
    /// Milliseconds since the Unix epoch, or `None` when the file system gave no timestamp.
    pub modified_ms: Option<u64>,
    /// The time as Windows shows it in Explorer, from the user's regional settings. Empty when unknown.
    pub modified_text: String,
    pub hits: u64,
    /// Explorer's description of the file type, for example "Text Document".
    pub type_name: String,
}

impl From<FileResult> for ResultRow {
    fn from(file: FileResult) -> Self {
        let modified_ms = file
            .modified
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|elapsed| elapsed.as_millis() as u64);
        Self {
            type_name: type_name_for_path(&file.path),
            path: file.path.to_string_lossy().into_owned(),
            size: file.size,
            modified_ms,
            modified_text: modified_ms
                .and_then(crate::os_datetime::format_local_short)
                .unwrap_or_default(),
            hits: file.hits.len() as u64,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorRow {
    pub path: String,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryDto {
    pub files_scanned: u64,
    pub files_matched: u64,
    pub total_hits: u64,
    pub errors: u64,
    pub binary_skipped: u64,
    pub elapsed_ms: u64,
    pub cancelled: bool,
}

impl From<SearchSummary> for SummaryDto {
    fn from(summary: SearchSummary) -> Self {
        Self {
            files_scanned: summary.files_scanned,
            files_matched: summary.files_matched,
            total_hits: summary.total_hits,
            errors: summary.errors,
            binary_skipped: summary.binary_skipped,
            elapsed_ms: summary.elapsed.as_millis() as u64,
            cancelled: summary.cancelled,
        }
    }
}

/// Messages streamed to the webview over a channel during one search.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SearchMessage {
    #[serde(rename_all = "camelCase")]
    Batch {
        rows: Vec<ResultRow>,
        errors: Vec<ErrorRow>,
        files_scanned: Option<u64>,
    },
    /// `error` is set instead of `summary` when the search could not start (bad pattern).
    Done {
        summary: Option<SummaryDto>,
        error: Option<String>,
    },
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct Utf16Range {
    pub start: usize,
    pub end: usize,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLineDto {
    pub line_number: u64,
    pub text: String,
    pub is_match: bool,
    /// Offsets in UTF-16 code units, so JavaScript can slice `text` directly.
    pub match_ranges: Vec<Utf16Range>,
}

impl From<PreviewLine> for PreviewLineDto {
    fn from(line: PreviewLine) -> Self {
        let match_ranges = line
            .match_ranges
            .iter()
            .map(|range| utf16_range(&line.text, range))
            .collect();
        Self {
            line_number: line.line_number,
            text: line.text,
            is_match: line.is_match,
            match_ranges,
        }
    }
}

/// A whole text file for the preview. See `spelunker_core::read_file_text`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTextDto {
    pub lines: Vec<PreviewLineDto>,
    pub truncated: bool,
    pub binary: bool,
}

impl From<spelunker_core::FileText> for FileTextDto {
    fn from(file: spelunker_core::FileText) -> Self {
        Self {
            lines: file.lines.into_iter().map(PreviewLineDto::from).collect(),
            truncated: file.truncated,
            binary: file.binary,
        }
    }
}

fn utf16_range(text: &str, byte_range: &Range<usize>) -> Utf16Range {
    let units = |end: usize| text[..end].encode_utf16().count();
    Utf16Range {
        start: units(byte_range.start),
        end: units(byte_range.end),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_ranges_are_converted_from_utf8_bytes_to_utf16_units() {
        // "é" is 2 bytes but 1 UTF-16 unit, and the emoji is 4 bytes but 2 units.
        let line = PreviewLine {
            line_number: 7,
            text: "é\u{1F600}needle".to_string(),
            is_match: true,
            match_ranges: std::iter::once(6..12).collect(),
        };
        let dto = PreviewLineDto::from(line);
        assert_eq!(dto.match_ranges, vec![Utf16Range { start: 3, end: 9 }]);
        assert_eq!(dto.line_number, 7);
    }

    /// A request with these roots, searching subfolders without a depth limit.
    fn config_for_roots(roots: &[String], include_hidden: bool) -> SearchConfig {
        let roots = serde_json::to_string(roots).unwrap();
        let json = format!(
            r#"{{
                "roots": {roots},
                "namePatterns": "",
                "query": {{"text": "", "matchCase": false, "wholeWord": false, "regex": false, "multiLine": false}},
                "recurse": true, "maxDepth": null, "includeHidden": {include_hidden}, "includeBinary": false,
                "followLinks": false, "nameIsRegex": false, "minSize": null, "maxSize": null,
                "modified": {{"fromMs": null, "toMs": null}}, "created": {{"fromMs": null, "toMs": null}}
            }}"#
        );
        serde_json::from_str::<SearchRequest>(&json)
            .unwrap()
            .into_config()
    }

    fn texts(paths: &[&std::path::Path]) -> Vec<String> {
        paths
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn a_folder_listed_twice_or_inside_another_is_searched_once() {
        let base = tempfile::tempdir().unwrap();
        let inner = base.path().join("sub");
        std::fs::create_dir(&inner).unwrap();
        let roots = texts(&[base.path(), base.path(), &inner]);
        let config = config_for_roots(&roots, false);
        assert_eq!(config.roots, [base.path()]);
    }

    #[test]
    fn a_nested_folder_the_outer_search_would_skip_is_still_searched() {
        let base = tempfile::tempdir().unwrap();
        let hidden_by_name = base.path().join("node_modules").join("pkg");
        std::fs::create_dir_all(&hidden_by_name).unwrap();
        let roots = texts(&[base.path(), &hidden_by_name]);
        let config = config_for_roots(&roots, true);
        assert_eq!(
            config.roots.len(),
            2,
            "node_modules is never entered by the outer search"
        );
    }

    #[test]
    fn this_pc_plus_a_folder_on_a_drive_does_not_search_that_folder_twice() {
        let drives = crate::drives::fixed_drives();
        let base = tempfile::tempdir().unwrap();
        let on_a_listed_drive = drives.iter().any(|drive| {
            base.path()
                .to_string_lossy()
                .to_lowercase()
                .starts_with(&drive.to_lowercase())
        });
        if !on_a_listed_drive {
            return; // The temp folder is on a drive "This PC" does not cover, so there is no overlap to test.
        }
        let inner = base.path().join("sub");
        std::fs::create_dir(&inner).unwrap();
        // The temp folder sits under hidden folders, so hidden files are on for the outer walk to reach it.
        let roots = vec!["This PC".to_string(), inner.to_string_lossy().into_owned()];
        let config = config_for_roots(&roots, true);
        assert_eq!(config.roots.len(), drives.len());
    }

    #[test]
    fn a_search_request_from_the_webview_becomes_the_expected_config() {
        let json = r#"{
            "roots": ["C:/data", "D:/more"],
            "namePatterns": "^invoice_[0-9]+$",
            "query": {"text": "needle", "matchCase": true, "wholeWord": false, "regex": true, "multiLine": true},
            "recurse": true,
            "maxDepth": null,
            "includeHidden": false,
            "includeBinary": false,
            "followLinks": true,
            "nameIsRegex": true,
            "minSize": 1000,
            "maxSize": null,
            "modified": {"fromMs": 5000, "toMs": null},
            "created": {"fromMs": null, "toMs": 9000}
        }"#;
        let config = serde_json::from_str::<SearchRequest>(json)
            .unwrap()
            .into_config();
        assert_eq!(config.roots.len(), 2);
        assert_eq!(config.name_regex.as_deref(), Some("^invoice_[0-9]+$"));
        assert_eq!(
            config.name_patterns, "",
            "wildcards stay empty when the name is a regex"
        );
        assert!(config.follow_links);
        assert_eq!(
            config.size,
            SizeRange {
                min: Some(1000),
                max: None
            }
        );
        assert_eq!(
            config.modified.from,
            Some(UNIX_EPOCH + Duration::from_millis(5000))
        );
        assert_eq!(config.modified.to, None);
        assert_eq!(
            config.created.to,
            Some(UNIX_EPOCH + Duration::from_millis(9000))
        );
        let query = config.content.unwrap();
        assert!(query.regex && query.multi_line && query.match_case);
    }

    #[test]
    fn a_wildcard_name_stays_a_wildcard_list() {
        let json = r#"{"roots": ["C:/x"], "namePatterns": "*.log", "query": {"text": "", "matchCase": false, "wholeWord": false, "regex": false, "multiLine": false},
            "recurse": true, "maxDepth": null, "includeHidden": false, "includeBinary": false, "followLinks": false,
            "nameIsRegex": false, "minSize": null, "maxSize": null,
            "modified": {"fromMs": null, "toMs": null}, "created": {"fromMs": null, "toMs": null}}"#;
        let config = serde_json::from_str::<SearchRequest>(json)
            .unwrap()
            .into_config();
        assert_eq!(config.name_patterns, "*.log");
        assert!(config.name_regex.is_none());
    }
}
