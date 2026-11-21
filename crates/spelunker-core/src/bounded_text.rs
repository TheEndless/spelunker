//! What reading the text out of a document, PDF or archive may cost. Such a file can expand to far
//! more than its size on disk (a zip bomb), the text is held whole in memory while it is searched,
//! and many files are read at once, so both what is read and what is kept have a limit.

use crate::cancel::CancelToken;
use std::io::{self, Read};

/// How much a file may expand to in total (XML, or the contents of an archive's entries). Real
/// files are far below it. A file that goes past it is a zip bomb or something no one wants
/// searched, and is reported instead.
const MAX_READ_BYTES: u64 = 128 * 1024 * 1024;

/// How much text one file may hold. It is far lower than what may be read because it is kept whole
/// in memory, once for each file being read.
const MAX_TEXT_BYTES: usize = 64 * 1024 * 1024;

/// What one file may grow to while it is read.
#[derive(Clone, Copy)]
pub(crate) struct Limits {
    /// Bytes read from all the parts or entries together.
    pub(crate) read_bytes: u64,
    /// Bytes of text kept.
    pub(crate) text_bytes: usize,
}

impl Limits {
    pub(crate) const STANDARD: Limits = Limits {
        read_bytes: MAX_READ_BYTES,
        text_bytes: MAX_TEXT_BYTES,
    };
}

/// The error for a file that holds more than `limit_bytes`.
pub(crate) fn too_much_text(limit_bytes: u64) -> io::Error {
    io::Error::other(format!(
        "the file holds more than {} MB of text, which is more than is searched",
        limit_bytes / (1024 * 1024)
    ))
}

/// The lines of a file in one string, so the text is held once. Once a line would pass the limit
/// nothing more is added, and `into_text` reports it.
pub(crate) struct Lines {
    text: String,
    limit: usize,
    overflowed: bool,
}

impl Lines {
    pub(crate) fn new(limit: usize) -> Self {
        Self {
            text: String::new(),
            limit,
            overflowed: false,
        }
    }

    pub(crate) fn push(&mut self, line: &str) {
        if self.overflowed {
            return;
        }
        if self.text.len() + line.len() + 1 > self.limit {
            self.overflowed = true;
            return;
        }
        if !self.text.is_empty() {
            self.text.push('\n');
        }
        // A NUL would make the searcher call the text binary, and it is never part of a word.
        if line.contains('\0') {
            self.text.push_str(&line.replace('\0', " "));
        } else {
            self.text.push_str(line);
        }
    }

    pub(crate) fn into_text(self) -> io::Result<String> {
        if self.overflowed {
            return Err(too_much_text(self.limit as u64));
        }
        Ok(self.text)
    }
}

/// Counts what is read against what the file is allowed to expand to, and stops reading when the
/// search is cancelled.
pub(crate) struct Budgeted<'a, R> {
    inner: R,
    remaining: &'a mut u64,
    cancel: &'a CancelToken,
    limit: u64,
}

impl<'a, R> Budgeted<'a, R> {
    pub(crate) fn new(
        inner: R,
        remaining: &'a mut u64,
        cancel: &'a CancelToken,
        limit: u64,
    ) -> Self {
        Self {
            inner,
            remaining,
            cancel,
            limit,
        }
    }
}

impl<R: Read> Read for Budgeted<'_, R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.cancel.is_cancelled() {
            return Err(io::Error::other("search cancelled"));
        }
        let count = self.inner.read(buffer)?;
        if count as u64 > *self.remaining {
            *self.remaining = 0;
            return Err(too_much_text(self.limit));
        }
        *self.remaining -= count as u64;
        Ok(count)
    }
}
