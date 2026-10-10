use crate::config::ContentQuery;
use crate::content::{detect_encoding, ContentMatcher};
use crate::model::PreviewLine;
use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
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
        return Ok(build(text, query, true));
    }
    let (decoded, _) = encoding.decode_without_bom_handling(body);
    Ok(build(&decoded, query, false))
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

fn build(text: &str, query: Option<&ContentQuery>, truncated: bool) -> FileText {
    let matcher = query
        .filter(|query| !query.text.is_empty())
        .and_then(|query| ContentMatcher::new(query, true).ok());
    let lines = text
        .lines()
        .enumerate()
        .map(|(index, line)| {
            let match_ranges = matcher
                .as_ref()
                .map(|matcher| matcher.ranges_in(line))
                .unwrap_or_default();
            PreviewLine {
                line_number: index as u64 + 1,
                text: line.to_string(),
                is_match: !match_ranges.is_empty(),
                match_ranges,
            }
        })
        .collect();
    FileText {
        lines,
        truncated,
        binary: false,
    }
}
