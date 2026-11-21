use crate::cancel::CancelToken;
use crate::config::ContentQuery;
use crate::content::{has_single_byte_line_ends, ContentMatcher};
use crate::document_text::{extract_text, has_readable_text};
use crate::line_clip::preview_line;
use crate::model::PreviewLine;
use grep_regex::RegexMatcher;
use grep_searcher::{Searcher, Sink, SinkMatch};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

/// Bytes read at a time when scanning a file for line ends.
const SCAN_BUFFER_BYTES: usize = 1 << 20;

/// How much one preview call may return. Lines are cut to a window when they are very long, so
/// a count of lines alone does not bound the size of the answer.
#[derive(Clone, Copy, Debug)]
pub struct PreviewBudget {
    /// Most lines returned.
    pub lines: usize,
    /// Stop once the text returned reaches this many bytes. At least one line is always returned.
    pub bytes: usize,
}

impl PreviewBudget {
    pub const UNLIMITED: PreviewBudget = PreviewBudget {
        lines: usize::MAX,
        bytes: usize::MAX,
    };
}

/// Lines of a text file read for display, with the lines that match a query flagged.
#[derive(Clone, Debug, Default)]
pub struct FileText {
    pub lines: Vec<PreviewLine>,
    /// More lines follow the ones returned: the budget ran out before the file did.
    pub truncated: bool,
    /// The file is not text (it contains NUL bytes), so no lines are returned.
    pub binary: bool,
}

/// A matcher that matches every line, so the searcher hands over each line in turn, decoded and
/// numbered, with the same binary detection as everywhere else.
fn every_line() -> io::Result<ContentMatcher> {
    ContentMatcher::new(&ContentQuery::literal(""), false).map_err(io::Error::other)
}

/// Lines starting at line `first_line` (the first line is 1) as far as `budget` allows, with the
/// lines that match `query` marked. The lines before it are read past but not kept, so a range deep
/// in a large file costs time and no memory. `truncated` says lines follow the ones returned.
pub fn read_lines(
    path: &Path,
    query: Option<&ContentQuery>,
    first_line: u64,
    budget: PreviewBudget,
) -> io::Result<FileText> {
    let first_line = first_line.max(1);
    let matcher = highlight_matcher(query);
    let mut window = LineWindow {
        first_line,
        end: first_line.saturating_add(budget.lines as u64),
        max_bytes: budget.bytes,
        bytes: 0,
        highlight: matcher.as_ref().map(ContentMatcher::regex),
        line_offset: 0,
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
        let (mut searcher, mut file) = every_line.open(path, 0)?;
        if first_line > 1 && has_single_byte_line_ends(&mut file)? {
            match skip_lines(&mut file, first_line - 1)? {
                Skipped::Binary => {
                    window.binary = true;
                    return Ok(window.into_file_text());
                }
                Skipped::PastTheEnd => return Ok(window.into_file_text()),
                Skipped::Reached => window.line_offset = first_line - 1,
            }
        }
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
    let (mut searcher, mut file) = every_line.open(path, 0)?;
    if has_single_byte_line_ends(&mut file)? {
        return count_line_ends(&mut file);
    }
    let mut counter = LineCounter::default();
    searcher.search_reader(every_line.regex(), file, &mut counter)?;
    Ok(if counter.binary { 0 } else { counter.lines })
}

/// Counts the lines of a file by its 0x0A bytes, which is what the searcher numbers them by.
/// Zero for a file with a NUL byte.
fn count_line_ends(file: &mut File) -> io::Result<u64> {
    let mut buffer = vec![0; SCAN_BUFFER_BYTES];
    let mut lines = 0;
    let mut last_byte = b'\n';
    loop {
        let read = read_some(file, &mut buffer)?;
        if read == 0 {
            break;
        }
        let chunk = &buffer[..read];
        if memchr::memchr(0, chunk).is_some() {
            return Ok(0);
        }
        lines += memchr::memchr_iter(b'\n', chunk).count() as u64;
        last_byte = chunk[read - 1];
    }
    Ok(if last_byte == b'\n' { lines } else { lines + 1 })
}

/// Where `skip_lines` left the file.
enum Skipped {
    /// A NUL byte is in the lines skipped.
    Binary,
    /// The file has no more lines than were skipped.
    PastTheEnd,
    /// The file is at the start of the line after the ones skipped.
    Reached,
}

/// Moves the file past its first `count` lines (at least one) by looking for their 0x0A bytes, so
/// reading deep into a large file does not match each line on the way.
fn skip_lines(file: &mut File, count: u64) -> io::Result<Skipped> {
    let mut buffer = vec![0; SCAN_BUFFER_BYTES];
    let mut remaining = count;
    loop {
        let read = read_some(file, &mut buffer)?;
        if read == 0 {
            return Ok(Skipped::PastTheEnd);
        }
        let chunk = &buffer[..read];
        let mut scanned = read;
        for position in memchr::memchr_iter(b'\n', chunk) {
            remaining -= 1;
            if remaining == 0 {
                scanned = position + 1;
                break;
            }
        }
        if memchr::memchr(0, &chunk[..scanned]).is_some() {
            return Ok(Skipped::Binary);
        }
        if remaining == 0 {
            file.seek(SeekFrom::Current(scanned as i64 - read as i64))?;
            return Ok(Skipped::Reached);
        }
    }
}

/// One read that is retried when it is interrupted.
fn read_some(file: &mut File, buffer: &mut [u8]) -> io::Result<usize> {
    loop {
        match file.read(buffer) {
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            result => return result,
        }
    }
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
    max_bytes: usize,
    /// Bytes of text in `lines`.
    bytes: usize,
    highlight: Option<&'a RegexMatcher>,
    /// Lines the reader began past, which its own numbering does not count.
    line_offset: u64,
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
        if line_number >= self.end || (self.bytes >= self.max_bytes && !self.lines.is_empty()) {
            self.more = true;
            return Ok(false);
        }
        let line = preview_line(line_number, raw, self.highlight)?;
        self.bytes += line.text.len();
        self.lines.push(line);
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
        self.accept(
            found.line_number().unwrap_or(0) + self.line_offset,
            found.bytes(),
        )
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
