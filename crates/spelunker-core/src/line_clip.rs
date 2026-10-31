//! Keeps a line that is too long to show whole as a window of it. A minified file is one line of
//! many megabytes, and without a limit that line would be copied into every result and preview row
//! and sent to the window.

use crate::model::Clip;
use grep_matcher::Matcher;
use grep_regex::RegexMatcher;
use grep_searcher::SinkError;
use std::io;
use std::ops::Range;

/// The most of a line that is kept. Lines up to this length are kept whole, which is every line of
/// ordinary text and code.
pub(crate) const MAX_LINE_BYTES: usize = 64 * 1024;

pub(crate) struct ClippedLine {
    pub(crate) text: String,
    /// Byte ranges into `text`.
    pub(crate) match_ranges: Vec<Range<usize>>,
    pub(crate) clip: Option<Clip>,
}

/// The text of a line, without its terminator and cut to a window of at most `MAX_LINE_BYTES`
/// around its first match, or around its start when `matcher` is `None` or finds nothing. The
/// counts in `clip` are bytes of the UTF-8 text the searcher produced, which for a UTF-16 file is
/// not the size on disk.
pub(crate) fn clip_line(raw: &[u8], matcher: Option<&RegexMatcher>) -> io::Result<ClippedLine> {
    let line = raw.strip_suffix(b"\n").unwrap_or(raw);
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    let (window, clip) = if line.len() <= MAX_LINE_BYTES {
        (line, None)
    } else {
        let anchor = matcher
            .and_then(|matcher| matcher.find(line).ok().flatten())
            .map_or(0, |found| found.start());
        let (start, end) = window_around(line, anchor);
        let clip = Clip {
            before_bytes: start as u64,
            after_bytes: (line.len() - end) as u64,
        };
        (&line[start..end], Some(clip))
    };
    // Ranges come from the final string so they stay valid byte offsets into it.
    let text = String::from_utf8_lossy(window).into_owned();
    let match_ranges = match matcher {
        Some(matcher) => find_ranges(matcher, &text)?,
        None => Vec::new(),
    };
    Ok(ClippedLine {
        text,
        match_ranges,
        clip,
    })
}

/// The bounds of a window of `MAX_LINE_BYTES` that holds `anchor` with as much on each side as
/// there is, moved inward off any character it would otherwise cut in two.
fn window_around(line: &[u8], anchor: usize) -> (usize, usize) {
    let mut start = anchor.saturating_sub(MAX_LINE_BYTES / 2);
    let mut end = (start + MAX_LINE_BYTES).min(line.len());
    start = end.saturating_sub(MAX_LINE_BYTES);
    while start < end && is_continuation(line[start]) {
        start += 1;
    }
    while end > start && end < line.len() && is_continuation(line[end]) {
        end -= 1;
    }
    (start, end)
}

/// A byte in the middle of a UTF-8 character.
fn is_continuation(byte: u8) -> bool {
    byte & 0xC0 == 0x80
}

pub(crate) fn find_ranges(matcher: &RegexMatcher, line: &str) -> io::Result<Vec<Range<usize>>> {
    let mut ranges = Vec::new();
    matcher
        .find_iter(line.as_bytes(), |found_match| {
            ranges.push(found_match.start()..found_match.end());
            true
        })
        .map_err(io::Error::error_message)?;
    Ok(ranges)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_window_is_full_size_wherever_the_anchor_is() {
        let line = vec![b'a'; 10 * MAX_LINE_BYTES];
        for anchor in [0, 1, MAX_LINE_BYTES, 5 * MAX_LINE_BYTES, line.len() - 1] {
            let (start, end) = window_around(&line, anchor);
            assert_eq!(end - start, MAX_LINE_BYTES, "anchor {anchor}");
            assert!((start..end).contains(&anchor), "anchor {anchor}");
        }
    }

    #[test]
    fn a_window_edge_inside_a_character_moves_inward() {
        let line = "é".repeat(MAX_LINE_BYTES).into_bytes();
        let (start, end) = window_around(&line, line.len() / 2 + 1);
        assert!(std::str::from_utf8(&line[start..end]).is_ok());
    }
}
