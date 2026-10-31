use crate::cancel::CancelToken;
use crate::config::ContentQuery;
use crate::content::ContentMatcher;
use crate::document_text::{extract_text, has_readable_text};
use crate::line_clip::preview_line;
use crate::model::PreviewLine;
use grep_regex::RegexMatcher;
use grep_searcher::{Searcher, Sink, SinkMatch};
use std::io;
use std::path::Path;

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
    max_bytes: usize,
    /// Bytes of text in `lines`.
    bytes: usize,
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
