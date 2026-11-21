//! The text inside archives: zip files (and the formats that are zip files, such as jar, whl and
//! epub), tar files, gzipped tar files and single gzipped files. The text of each entry that is a
//! text file comes out under a line `>> path/in/archive`, so a hit shows which entry it is in and
//! the name of an entry can be searched too. Nothing is written to disk.
//!
//! Entries that are binary (a NUL in the first 8 KB, or a binary extension), too large, or
//! archives themselves are left out. The text is meant to be searched and shown, not extracted.

use crate::binary_extensions::has_binary_extension;
use crate::bounded_text::{Budgeted, Limits, Lines};
use crate::cancel::CancelToken;
use flate2::read::GzDecoder;
use std::io::{self, BufReader, Read};
use std::path::Path;
use zip::result::ZipError;
use zip::ZipArchive;

/// An entry larger than this is left out. Source, logs and notes are far below it.
const MAX_ENTRY_BYTES: usize = 8 * 1024 * 1024;

/// How much of the start of an entry is looked at for a NUL to tell text from binary.
const SNIFF_BYTES: u64 = 8 * 1024;

/// How much an archive may be read through in total. Higher than for a document, since an archive
/// is meant to hold many files and only their text is kept, which has its own limit.
const MAX_ARCHIVE_READ_BYTES: u64 = 1024 * 1024 * 1024;

/// Marks the line that names an entry.
const ENTRY_MARK: &str = ">> ";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    Zip,
    Tar,
    GzippedTar,
    Gzip,
}

fn kind_of(path: &Path) -> Option<Kind> {
    let name = path.file_name()?.to_str()?.to_ascii_lowercase();
    if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        return Some(Kind::GzippedTar);
    }
    match name.rsplit_once('.')?.1 {
        "zip" | "jar" | "war" | "ear" | "nupkg" | "vsix" | "whl" | "epub" => Some(Kind::Zip),
        "tar" => Some(Kind::Tar),
        "gz" => Some(Kind::Gzip),
        _ => None,
    }
}

/// Whether the file's name is one of an archive format whose text can be read.
pub fn is_archive(path: &Path) -> bool {
    kind_of(path).is_some()
}

/// The text of an archive's text entries, each after a line with its name.
pub fn extract(path: &Path, cancel: &CancelToken, text_bytes: usize) -> io::Result<String> {
    let kind = kind_of(path).ok_or_else(|| io::Error::other("not an archive"))?;
    let limits = Limits {
        read_bytes: MAX_ARCHIVE_READ_BYTES,
        text_bytes,
    };
    let mut budget = limits.read_bytes;
    let mut lines = Lines::new(limits.text_bytes);
    let file = BufReader::new(std::fs::File::open(path)?);
    let outcome = match kind {
        Kind::Zip => read_zip(file, &mut budget, cancel, &mut lines, limits.read_bytes),
        Kind::Tar => read_tar(
            Budgeted::new(file, &mut budget, cancel, limits.read_bytes),
            &mut lines,
        ),
        Kind::GzippedTar => read_tar(
            Budgeted::new(GzDecoder::new(file), &mut budget, cancel, limits.read_bytes),
            &mut lines,
        ),
        Kind::Gzip => {
            let name = path
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_default();
            add_entry(
                &name,
                Budgeted::new(GzDecoder::new(file), &mut budget, cancel, limits.read_bytes),
                &mut lines,
            )
        }
    };
    outcome.map_err(damaged)?;
    lines.into_text()
}

/// An error that says the archive could not be read, unless it already says something else (the
/// search was cancelled, or the archive went past a limit).
fn damaged(error: io::Error) -> io::Error {
    if error.kind() == io::ErrorKind::Other {
        return error;
    }
    io::Error::other("not a readable archive (it may be damaged or password protected)")
}

fn zip_problem(error: ZipError) -> io::Error {
    match error {
        ZipError::Io(error) => error,
        other => io::Error::new(io::ErrorKind::InvalidData, other.to_string()),
    }
}

fn read_zip(
    file: BufReader<std::fs::File>,
    budget: &mut u64,
    cancel: &CancelToken,
    lines: &mut Lines,
    read_bytes: u64,
) -> io::Result<()> {
    let mut archive = ZipArchive::new(file).map_err(zip_problem)?;
    for index in 0..archive.len() {
        if cancel.is_cancelled() {
            return Err(io::Error::other("search cancelled"));
        }
        // An entry that cannot be opened (encrypted, or an unsupported compression) is left out.
        let Ok(entry) = archive.by_index(index) else {
            continue;
        };
        let Ok(name) = entry.name().map(|name| name.into_owned()) else {
            continue;
        };
        if !entry.is_file() || has_binary_extension(Path::new(&name)) {
            continue;
        }
        add_entry(
            &name,
            Budgeted::new(entry, budget, cancel, read_bytes),
            lines,
        )?;
    }
    Ok(())
}

fn read_tar(reader: impl Read, lines: &mut Lines) -> io::Result<()> {
    let mut archive = tar::Archive::new(reader);
    for entry in archive.entries()? {
        let entry = entry?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let name = entry.path()?.to_string_lossy().replace('\\', "/");
        if has_binary_extension(Path::new(&name)) {
            continue;
        }
        add_entry(&name, entry, lines)?;
    }
    Ok(())
}

/// Adds the entry's name and text lines, unless it is binary or too large.
fn add_entry(name: &str, mut reader: impl Read, lines: &mut Lines) -> io::Result<()> {
    let mut bytes = Vec::new();
    (&mut reader).take(SNIFF_BYTES).read_to_end(&mut bytes)?;
    if bytes.contains(&0) {
        return Ok(());
    }
    let room = (MAX_ENTRY_BYTES + 1 - bytes.len()) as u64;
    (&mut reader).take(room).read_to_end(&mut bytes)?;
    if bytes.len() > MAX_ENTRY_BYTES {
        return Ok(());
    }
    lines.push(&format!("{ENTRY_MARK}{name}"));
    for line in String::from_utf8_lossy(&bytes).lines() {
        if !line.trim().is_empty() {
            lines.push(line);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_names_are_recognised_whatever_their_case() {
        for name in [
            "a.zip", "B.ZIP", "c.jar", "d.whl", "e.epub", "f.tar", "g.tar.gz", "h.TGZ", "i.log.gz",
        ] {
            assert!(is_archive(Path::new(name)), "{name}");
        }
        for name in ["a.docx", "b.7z", "c.txt", "zip", ".gz.bak", "d.rar"] {
            assert!(!is_archive(Path::new(name)), "{name}");
        }
    }

    #[test]
    fn an_entry_past_the_size_limit_is_left_out_and_the_others_are_kept() {
        let mut lines = Lines::new(100 * 1024 * 1024);
        let big = vec![b'a'; MAX_ENTRY_BYTES + 1];
        add_entry("big.txt", big.as_slice(), &mut lines).unwrap();
        add_entry("small.txt", "needle\n".as_bytes(), &mut lines).unwrap();
        assert_eq!(lines.into_text().unwrap(), ">> small.txt\nneedle");
    }

    #[test]
    fn an_entry_with_a_nul_early_on_is_binary() {
        let mut lines = Lines::new(1024);
        add_entry("a.dat", "text\0more".as_bytes(), &mut lines).unwrap();
        assert_eq!(lines.into_text().unwrap(), "");
    }
}
