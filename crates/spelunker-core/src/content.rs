use crate::cancel::CancelToken;
use crate::config::ContentQuery;
use crate::model::{ConfigError, Hit, PreviewLine};
use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, WINDOWS_1252};
use grep_matcher::Matcher;
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{
    BinaryDetection, Encoding as SearcherEncoding, Searcher, SearcherBuilder, Sink, SinkContext,
    SinkError, SinkMatch,
};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::ops::Range;
use std::path::Path;

/// How many leading bytes are inspected to guess a file's encoding.
const ENCODING_SNIFF_BYTES: usize = 8192;

/// Result of searching one file's contents.
pub enum ContentOutcome {
    /// Every matching line. Empty when the file does not match.
    Hits(Vec<Hit>),
    /// A NUL byte was found and binary files are not being searched.
    Binary,
    Cancelled,
}

/// Multi-line mode reads a whole file into memory, so larger files are reported instead.
const MULTI_LINE_MAX_BYTES: u64 = 200 * 1024 * 1024;

pub struct ContentMatcher {
    matcher: RegexMatcher,
    include_binary: bool,
    multi_line: bool,
}

impl ContentMatcher {
    pub fn new(query: &ContentQuery, include_binary: bool) -> Result<Self, ConfigError> {
        let mut builder = RegexMatcherBuilder::new();
        builder
            .case_insensitive(!query.match_case)
            .word(query.whole_word)
            .fixed_strings(!query.regex);
        if !query.multi_line {
            // Tells the regex engine that matches can never contain a line break. Patterns that
            // could match one are rejected at build time instead of silently misbehaving.
            builder.line_terminator(Some(b'\n'));
        }
        let matcher = builder
            .build(&query.text)
            .map_err(|error| ConfigError::InvalidContentPattern(describe_pattern_error(&error)))?;
        Ok(Self {
            matcher,
            include_binary,
            multi_line: query.multi_line,
        })
    }

    pub fn search_file(&self, path: &Path, cancel: &CancelToken) -> io::Result<ContentOutcome> {
        let (mut searcher, file) = self.open(path, 0)?;
        let mut collector = HitCollector {
            matcher: &self.matcher,
            cancel,
            hits: Vec::new(),
            binary_seen: false,
        };
        let reader = CancellableReader {
            inner: file,
            cancel,
        };

        match searcher.search_reader(&self.matcher, reader, &mut collector) {
            Ok(()) if cancel.is_cancelled() => Ok(ContentOutcome::Cancelled),
            Ok(()) if collector.binary_seen => Ok(ContentOutcome::Binary),
            Ok(()) => Ok(ContentOutcome::Hits(collector.hits)),
            Err(_) if cancel.is_cancelled() => Ok(ContentOutcome::Cancelled),
            Err(error) => Err(error),
        }
    }

    /// Every matching line plus `context_lines` of surrounding lines. Empty for binary files
    /// unless binary search is enabled.
    pub fn preview_file(&self, path: &Path, context_lines: usize) -> io::Result<Vec<PreviewLine>> {
        let (mut searcher, file) = self.open(path, context_lines)?;
        let mut collector = PreviewCollector {
            matcher: &self.matcher,
            lines: Vec::new(),
            binary_seen: false,
        };
        searcher
            .search_reader(&self.matcher, file, &mut collector)
            .map_err(io::Error::other)?;
        Ok(if collector.binary_seen {
            Vec::new()
        } else {
            collector.lines
        })
    }

    /// Byte ranges of every match inside one line of text.
    pub(crate) fn ranges_in(&self, line: &str) -> Vec<Range<usize>> {
        find_ranges(&self.matcher, line).unwrap_or_default()
    }

    fn open(&self, path: &Path, context_lines: usize) -> io::Result<(Searcher, File)> {
        let mut file = File::open(path)?;
        if self.multi_line && file.metadata()?.len() > MULTI_LINE_MAX_BYTES {
            return Err(io::Error::other(format!(
                "file is larger than the {} MB limit for multi-line search",
                MULTI_LINE_MAX_BYTES / (1024 * 1024)
            )));
        }
        let encoding = match sniff_encoding(&mut file)? {
            Some(detected) => {
                Some(SearcherEncoding::new(detected.name()).map_err(io::Error::other)?)
            }
            None => None,
        };
        let searcher = SearcherBuilder::new()
            .encoding(encoding)
            .before_context(context_lines)
            .after_context(context_lines)
            .multi_line(self.multi_line)
            .binary_detection(if self.include_binary {
                BinaryDetection::none()
            } else {
                BinaryDetection::quit(b'\0')
            })
            .build();
        Ok((searcher, file))
    }
}

/// Checks that `query` compiles, without searching anything. An empty query is valid.
pub fn validate_content_query(query: &ContentQuery) -> Result<(), ConfigError> {
    if query.text.is_empty() {
        return Ok(());
    }
    ContentMatcher::new(query, false).map(|_| ())
}

/// The regex engine words some errors for its original command-line tool. Spelunker's option is
/// called Multi-line, so say that instead.
fn describe_pattern_error(error: &grep_regex::Error) -> String {
    let text = error.to_string();
    let lowered = text.to_lowercase();
    // Observed wording: the literal "\n" is not allowed in a regex
    if lowered.contains("not allowed in a regex")
        || lowered.contains("multiline")
        || lowered.contains("line terminator")
    {
        "this pattern can match across line breaks. Turn on Multi-line to allow that".to_string()
    } else {
        text
    }
}

/// Convenience wrapper for one-off previews.
pub fn preview_file(
    path: &Path,
    query: &ContentQuery,
    context_lines: usize,
    include_binary: bool,
) -> io::Result<Vec<PreviewLine>> {
    ContentMatcher::new(query, include_binary)
        .map_err(io::Error::other)?
        .preview_file(path, context_lines)
}

/// Picks an explicit decoder when the file has no BOM but is clearly not plain UTF-8.
/// Files with a BOM return `None` because the searcher already decodes those transparently.
/// BOM-less UTF-16 is only recognised for mostly-ASCII text, which is the common case for logs.
fn sniff_encoding(file: &mut File) -> io::Result<Option<&'static Encoding>> {
    let mut prefix = Vec::with_capacity(ENCODING_SNIFF_BYTES);
    file.by_ref()
        .take(ENCODING_SNIFF_BYTES as u64)
        .read_to_end(&mut prefix)?;
    file.seek(SeekFrom::Start(0))?;
    Ok(detect_encoding(&prefix))
}

pub(crate) fn detect_encoding(prefix: &[u8]) -> Option<&'static Encoding> {
    if prefix.starts_with(&[0xEF, 0xBB, 0xBF])
        || prefix.starts_with(&[0xFF, 0xFE])
        || prefix.starts_with(&[0xFE, 0xFF])
    {
        return None;
    }
    if let Some(utf16) = detect_bomless_utf16(prefix) {
        return Some(utf16);
    }
    match std::str::from_utf8(prefix) {
        // error_len() is None when the prefix merely cuts a multi-byte character in half.
        Err(error) if error.error_len().is_some() => Some(WINDOWS_1252),
        _ => None,
    }
}

fn detect_bomless_utf16(prefix: &[u8]) -> Option<&'static Encoding> {
    let pair_count = prefix.len() / 2;
    if pair_count < 2 {
        return None;
    }
    let (mut even_zeros, mut odd_zeros) = (0, 0);
    for pair in prefix.chunks_exact(2) {
        even_zeros += usize::from(pair[0] == 0);
        odd_zeros += usize::from(pair[1] == 0);
    }
    let nearly_all = |count: usize| count * 10 >= pair_count * 9;
    if nearly_all(odd_zeros) && even_zeros == 0 {
        Some(UTF_16LE)
    } else if nearly_all(even_zeros) && odd_zeros == 0 {
        Some(UTF_16BE)
    } else {
        None
    }
}

/// Fails reads once the search is cancelled, so a multi-GB file with no matches still stops quickly.
struct CancellableReader<'a, R> {
    inner: R,
    cancel: &'a CancelToken,
}

impl<R: Read> Read for CancellableReader<'_, R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.cancel.is_cancelled() {
            return Err(io::Error::other("search cancelled"));
        }
        self.inner.read(buffer)
    }
}

struct HitCollector<'a> {
    matcher: &'a RegexMatcher,
    cancel: &'a CancelToken,
    hits: Vec<Hit>,
    binary_seen: bool,
}

impl Sink for HitCollector<'_> {
    type Error = io::Error;

    fn matched(&mut self, _searcher: &Searcher, found: &SinkMatch<'_>) -> Result<bool, io::Error> {
        if self.cancel.is_cancelled() {
            return Ok(false);
        }
        let line = decode_line(found.bytes());
        let match_ranges = find_ranges(self.matcher, &line)?;

        self.hits.push(Hit {
            line_number: found.line_number().unwrap_or(0),
            line,
            match_ranges,
        });
        Ok(true)
    }

    fn binary_data(&mut self, _searcher: &Searcher, _offset: u64) -> Result<bool, io::Error> {
        self.binary_seen = true;
        Ok(false)
    }
}

fn decode_line(raw: &[u8]) -> String {
    let trimmed = raw.strip_suffix(b"\n").unwrap_or(raw);
    let trimmed = trimmed.strip_suffix(b"\r").unwrap_or(trimmed);
    String::from_utf8_lossy(trimmed).into_owned()
}

/// Ranges come from the final string so they stay valid byte offsets into it.
fn find_ranges(matcher: &RegexMatcher, line: &str) -> io::Result<Vec<Range<usize>>> {
    let mut ranges = Vec::new();
    matcher
        .find_iter(line.as_bytes(), |found_match| {
            ranges.push(found_match.start()..found_match.end());
            true
        })
        .map_err(io::Error::error_message)?;
    Ok(ranges)
}

struct PreviewCollector<'a> {
    matcher: &'a RegexMatcher,
    lines: Vec<PreviewLine>,
    binary_seen: bool,
}

impl Sink for PreviewCollector<'_> {
    type Error = io::Error;

    fn matched(&mut self, _searcher: &Searcher, found: &SinkMatch<'_>) -> Result<bool, io::Error> {
        let text = decode_line(found.bytes());
        let match_ranges = find_ranges(self.matcher, &text)?;
        self.lines.push(PreviewLine {
            line_number: found.line_number().unwrap_or(0),
            text,
            is_match: true,
            match_ranges,
        });
        Ok(true)
    }

    fn context(
        &mut self,
        _searcher: &Searcher,
        context: &SinkContext<'_>,
    ) -> Result<bool, io::Error> {
        self.lines.push(PreviewLine {
            line_number: context.line_number().unwrap_or(0),
            text: decode_line(context.bytes()),
            is_match: false,
            match_ranges: Vec::new(),
        });
        Ok(true)
    }

    fn binary_data(&mut self, _searcher: &Searcher, _offset: u64) -> Result<bool, io::Error> {
        self.binary_seen = true;
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_ascii_needs_no_explicit_encoding() {
        assert!(detect_encoding(b"hello world\n").is_none());
    }

    #[test]
    fn invalid_utf8_falls_back_to_windows_1252() {
        assert_eq!(detect_encoding(b"caf\xe9 au lait"), Some(WINDOWS_1252));
    }

    #[test]
    fn a_prefix_cut_inside_a_multibyte_character_is_still_utf8() {
        let mut bytes = "caf\u{e9}".as_bytes().to_vec();
        bytes.pop();
        assert!(detect_encoding(&bytes).is_none());
    }

    #[test]
    fn bom_files_are_left_to_the_searcher() {
        assert!(detect_encoding(&[0xFF, 0xFE, b'a', 0]).is_none());
        assert!(detect_encoding(&[0xEF, 0xBB, 0xBF, b'a']).is_none());
    }

    #[test]
    fn bomless_utf16_is_detected_in_both_byte_orders() {
        assert_eq!(
            detect_encoding(&[b'h', 0, b'i', 0, b'!', 0]),
            Some(UTF_16LE)
        );
        assert_eq!(
            detect_encoding(&[0, b'h', 0, b'i', 0, b'!']),
            Some(UTF_16BE)
        );
    }

    #[test]
    fn mostly_zero_binary_is_not_mistaken_for_utf16() {
        assert!(detect_encoding(&[0, 0, 0, 0, 0, 0, 0, 0]).is_none());
    }

    #[test]
    fn cancelled_reader_refuses_to_read() {
        let cancel = CancelToken::new();
        cancel.cancel();
        let mut reader = CancellableReader {
            inner: &b"data"[..],
            cancel: &cancel,
        };
        assert!(reader.read(&mut [0u8; 4]).is_err());
    }
}
