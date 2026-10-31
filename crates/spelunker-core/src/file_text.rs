use crate::cancel::CancelToken;
use crate::config::ContentQuery;
use crate::content::{detect_encoding, ContentMatcher};
use crate::document_text::{extract_text, has_readable_text};
use crate::line_clip::preview_line;
use crate::model::PreviewLine;
use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
use grep_regex::RegexMatcher;
use grep_searcher::{Searcher, Sink, SinkMatch};
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

/// A text file read for display, with the lines that match a query flagged.
#[derive(Clone, Debug, Default)]
pub struct FileText {
    pub lines: Vec<PreviewLine>,
    /// The file was longer than the limit, so only its first lines are here.
    pub truncated: bool,
    /// The file is not text (it contains NUL bytes), so no lines are returned.
    pub binary: bool,
}

/// Reads up to `max_bytes` of a text file and splits it into numbered lines. When `query` has
/// text, lines containing it are marked and carry their match ranges.
pub fn read_file_text(
    path: &Path,
    query: Option<&ContentQuery>,
    max_bytes: usize,
) -> io::Result<FileText> {
    if has_readable_text(path) {
        let text = extract_text(path, &CancelToken::new())?;
        let (shown, truncated) = first_lines(&text, max_bytes);
        return build(shown, query, truncated);
    }
    let mut bytes = Vec::new();
    // One byte past the limit tells a file of exactly the limit from a longer one.
    File::open(path)?
        .take(max_bytes as u64 + 1)
        .read_to_end(&mut bytes)?;
    let truncated = bytes.len() > max_bytes;
    bytes.truncate(max_bytes);

    let (encoding, body) = match Encoding::for_bom(&bytes) {
        Some((bom_encoding, bom_length)) => (bom_encoding, &bytes[bom_length..]),
        None => (detect_encoding(&bytes).unwrap_or(UTF_8), &bytes[..]),
    };
    let wide = encoding == UTF_16LE || encoding == UTF_16BE;
    if !wide && body.contains(&0) {
        return Ok(FileText {
            binary: true,
            ..FileText::default()
        });
    }
    if truncated {
        // Cut at the last complete line so the view never ends in half a line.
        let whole_lines = end_of_last_line(body, encoding);
        // A file with no line break at all (minified code) shows what fits instead of nothing.
        let (decoded, _) =
            encoding.decode_without_bom_handling(&body[..whole_lines.unwrap_or(body.len())]);
        // Without a line break to cut at, the cut may have split a character in two.
        let text = match whole_lines {
            Some(_) => &*decoded,
            None => decoded.strip_suffix('\u{FFFD}').unwrap_or(&decoded),
        };
        return build(text, query, true);
    }
    let (decoded, _) = encoding.decode_without_bom_handling(body);
    build(&decoded, query, false)
}

/// The start of `text` that fits in `max_bytes`, cut after a whole line when it has to be cut.
fn first_lines(text: &str, max_bytes: usize) -> (&str, bool) {
    if text.len() <= max_bytes {
        return (text, false);
    }
    let mut end = max_bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let whole_lines = text[..end].rfind('\n').map_or(end, |index| index + 1);
    (&text[..whole_lines], true)
}

/// The byte offset just after the last line break, found on character boundaries. In UTF-16 a
/// byte equal to a newline can be half of another character, so the search steps two bytes at a time.
fn end_of_last_line(body: &[u8], encoding: &'static Encoding) -> Option<usize> {
    if encoding == UTF_16LE {
        body.chunks_exact(2)
            .rposition(|unit| unit == [0x0A, 0x00])
            .map(|index| (index + 1) * 2)
    } else if encoding == UTF_16BE {
        body.chunks_exact(2)
            .rposition(|unit| unit == [0x00, 0x0A])
            .map(|index| (index + 1) * 2)
    } else {
        body.iter()
            .rposition(|&byte| byte == b'\n')
            .map(|index| index + 1)
    }
}

fn build(text: &str, query: Option<&ContentQuery>, truncated: bool) -> io::Result<FileText> {
    let matcher = query
        .filter(|query| !query.text.is_empty())
        .and_then(|query| ContentMatcher::new(query, true).ok());
    let highlight = matcher.as_ref().map(ContentMatcher::regex);
    let lines = text
        .lines()
        .enumerate()
        .map(|(index, line)| preview_line(index as u64 + 1, line.as_bytes(), highlight))
        .collect::<io::Result<_>>()?;
    Ok(FileText {
        lines,
        truncated,
        binary: false,
    })
}

/// A matcher that matches every line, so the searcher hands over each line in turn, decoded and
/// numbered, with the same binary detection as everywhere else.
fn every_line() -> io::Result<ContentMatcher> {
    ContentMatcher::new(&ContentQuery::literal(""), false).map_err(io::Error::other)
}

/// Up to `count` lines starting at line `first_line` (the first line is 1), with the lines that
/// match `query` marked. The lines before it are read past but not kept, so a range deep in a large
/// file costs time and no memory. `truncated` says lines follow the ones returned.
pub fn read_lines(
    path: &Path,
    query: Option<&ContentQuery>,
    first_line: u64,
    count: usize,
) -> io::Result<FileText> {
    let first_line = first_line.max(1);
    let matcher = highlight_matcher(query);
    let mut window = LineWindow {
        first_line,
        end: first_line.saturating_add(count as u64),
        highlight: matcher.as_ref().map(ContentMatcher::regex),
        lines: Vec::new(),
        more: false,
        binary: false,
    };
    if has_readable_text(path) {
        let text = extract_text(path, &CancelToken::new())?;
        for (index, line) in text.lines().enumerate() {
            if !window.accept(index as u64 + 1, line.as_bytes())? {
                break;
            }
        }
    } else {
        let every_line = every_line()?;
        let (mut searcher, file) = every_line.open(path, 0)?;
        searcher.search_reader(every_line.regex(), file, &mut window)?;
    }
    Ok(window.into_file_text())
}

/// How many lines a file has, counted the way `read_lines` numbers them. Zero for a binary file.
pub fn count_lines(path: &Path) -> io::Result<u64> {
    if has_readable_text(path) {
        let text = extract_text(path, &CancelToken::new())?;
        return Ok(text.lines().count() as u64);
    }
    let every_line = every_line()?;
    let (mut searcher, file) = every_line.open(path, 0)?;
    let mut counter = LineCounter::default();
    searcher.search_reader(every_line.regex(), file, &mut counter)?;
    Ok(if counter.binary { 0 } else { counter.lines })
}

fn highlight_matcher(query: Option<&ContentQuery>) -> Option<ContentMatcher> {
    query
        .filter(|query| !query.text.is_empty())
        .and_then(|query| ContentMatcher::new(query, true).ok())
}

/// Collects the lines from `first_line` up to (not including) `end`, then stops the search.
struct LineWindow<'a> {
    first_line: u64,
    end: u64,
    highlight: Option<&'a RegexMatcher>,
    lines: Vec<PreviewLine>,
    /// A line at or past `end` exists.
    more: bool,
    binary: bool,
}

impl LineWindow<'_> {
    /// Takes the line if it is in the window. False once the window has been passed.
    fn accept(&mut self, line_number: u64, raw: &[u8]) -> io::Result<bool> {
        if line_number < self.first_line {
            return Ok(true);
        }
        if line_number >= self.end {
            self.more = true;
            return Ok(false);
        }
        self.lines
            .push(preview_line(line_number, raw, self.highlight)?);
        Ok(true)
    }

    fn into_file_text(self) -> FileText {
        if self.binary {
            return FileText {
                binary: true,
                ..FileText::default()
            };
        }
        FileText {
            lines: self.lines,
            truncated: self.more,
            binary: false,
        }
    }
}

impl Sink for LineWindow<'_> {
    type Error = io::Error;

    fn matched(&mut self, _searcher: &Searcher, found: &SinkMatch<'_>) -> Result<bool, io::Error> {
        self.accept(found.line_number().unwrap_or(0), found.bytes())
    }

    fn binary_data(&mut self, _searcher: &Searcher, _offset: u64) -> Result<bool, io::Error> {
        self.binary = true;
        Ok(false)
    }
}

#[derive(Default)]
struct LineCounter {
    lines: u64,
    binary: bool,
}

impl Sink for LineCounter {
    type Error = io::Error;

    fn matched(&mut self, _searcher: &Searcher, _found: &SinkMatch<'_>) -> Result<bool, io::Error> {
        self.lines += 1;
        Ok(true)
    }

    fn binary_data(&mut self, _searcher: &Searcher, _offset: u64) -> Result<bool, io::Error> {
        self.binary = true;
        Ok(false)
    }
}
