//! The text of a PDF file. A PDF stores where each piece of text is drawn rather than paragraphs,
//! so the text comes back in the order and line breaks a reader would see, which is good enough
//! to search and to show but not to copy from. Pages that are pictures (a scan) hold no text.

use crate::bounded_text::Lines;
use crate::cancel::CancelToken;
use std::io;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;

/// The largest PDF read. The whole file is held in memory while it is read and several files are
/// read at once, so a file past this is reported instead.
const MAX_PDF_BYTES: u64 = 64 * 1024 * 1024;

/// One line per line of text on the page, without blank lines.
pub fn extract(path: &Path, cancel: &CancelToken, text_limit: usize) -> io::Result<String> {
    let size = std::fs::metadata(path)?.len();
    if size > MAX_PDF_BYTES {
        return Err(io::Error::other(format!(
            "the PDF is larger than {} MB, which is more than is searched",
            MAX_PDF_BYTES / (1024 * 1024)
        )));
    }
    if cancel.is_cancelled() {
        return Err(io::Error::other("search cancelled"));
    }
    let bytes = std::fs::read(path)?;
    // The reader is written against the well formed PDF and can panic on a damaged one.
    let extracted = catch_unwind(AssertUnwindSafe(|| {
        pdf_extract::extract_text_from_mem(&bytes)
    }))
    .map_err(|_| unreadable("it could not be interpreted"))?
    .map_err(|error| unreadable(&error.to_string()))?;
    drop(bytes);
    let mut lines = Lines::new(text_limit);
    for line in extracted.lines() {
        let line = line.trim();
        if !line.is_empty() {
            lines.push(line);
        }
    }
    lines.into_text()
}

fn unreadable(reason: &str) -> io::Error {
    io::Error::other(format!(
        "not a readable PDF (it may be password protected or damaged): {reason}"
    ))
}
