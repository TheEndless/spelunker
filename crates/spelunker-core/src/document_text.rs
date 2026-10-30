//! The text inside Office and OpenDocument files. These are zip archives of XML, so no program
//! that understands them is needed: the parts that hold text are read, the markup is dropped, and
//! what is left is one line per paragraph (or per spreadsheet or table row, its cells separated by
//! tabs). Text that is not words, such as styles, images and relationships, is never read.
//!
//! The text is meant to be searched and shown, not to reproduce the document. Formatting, fields,
//! deleted revisions and text boxes in drawings are not followed.

use crate::cancel::CancelToken;
use quick_xml::events::{BytesRef, BytesStart, Event};
use quick_xml::Reader;
use std::io::{self, BufReader, Read, Seek};
use std::path::Path;
use zip::result::ZipError;
use zip::ZipArchive;

/// How much XML one document may expand to in total. Real documents are far below it. A file that
/// goes past it is a zip bomb or something no one wants searched, and is reported instead.
const MAX_XML_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    Word,
    Sheet,
    Slides,
    OpenDocument,
}

fn kind_of(path: &Path) -> Option<Kind> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "docx" | "docm" | "dotx" | "dotm" => Some(Kind::Word),
        "xlsx" | "xlsm" | "xltx" | "xltm" => Some(Kind::Sheet),
        "pptx" | "pptm" | "potx" | "potm" | "ppsx" | "ppsm" => Some(Kind::Slides),
        "odt" | "ods" | "odp" | "ott" | "ots" | "otp" => Some(Kind::OpenDocument),
        _ => None,
    }
}

/// Whether the file's extension is one of an Office or OpenDocument format whose text can be read.
pub fn is_document(path: &Path) -> bool {
    kind_of(path).is_some()
}

/// The text of a document, one line per paragraph or row, joined by line feeds.
pub fn extract_text(path: &Path, cancel: &CancelToken) -> io::Result<String> {
    extract_with_limit(path, cancel, MAX_XML_BYTES)
}

fn extract_with_limit(path: &Path, cancel: &CancelToken, limit: u64) -> io::Result<String> {
    let kind = kind_of(path).ok_or_else(|| io::Error::other("not an Office or OpenDocument file"))?;
    let mut archive = ZipArchive::new(BufReader::new(std::fs::File::open(path)?)).map_err(zip_problem)?;
    let names: Vec<String> = archive
        .file_names()
        .filter_map(|name| name.ok().map(|name| name.into_owned()))
        .collect();
    let mut budget = limit;
    let mut lines = Vec::new();

    if kind == Kind::Sheet {
        let shared = match names.iter().find(|name| name.as_str() == "xl/sharedStrings.xml") {
            Some(name) => shared_strings(&read_part(&mut archive, name, &mut budget, cancel)?)?,
            None => Vec::new(),
        };
        for name in parts_in_order(&names, "xl/worksheets/sheet") {
            sheet_rows(&read_part(&mut archive, &name, &mut budget, cancel)?, &shared, &mut lines)?;
        }
    } else {
        for name in text_parts(kind, &names) {
            let part = read_part(&mut archive, &name, &mut budget, cancel)?;
            paragraph_lines(&part, dialect_of(kind), &mut lines)?;
        }
    }
    // A NUL would make the searcher call the text binary, and it is never part of a word.
    Ok(lines.join("\n").replace('\0', " "))
}

/// Why a zip could not be read, in words that help: a password protected Office file is not a zip.
fn zip_problem(error: ZipError) -> io::Error {
    match error {
        ZipError::Io(error) => error,
        ZipError::InvalidArchive(_) | ZipError::UnsupportedArchive(_) => io::Error::other(
            "not a readable Office or OpenDocument file (it may be password protected or damaged)",
        ),
        other => io::Error::other(format!("could not read the document: {other}")),
    }
}

/// Reads one part whole, counting it against what the document is allowed to expand to.
fn read_part<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
    budget: &mut u64,
    cancel: &CancelToken,
) -> io::Result<Vec<u8>> {
    if cancel.is_cancelled() {
        return Err(io::Error::other("search cancelled"));
    }
    let part = archive.by_name(name).map_err(zip_problem)?;
    let mut bytes = Vec::new();
    // One byte past the budget tells a part that fits exactly from one that does not.
    part.take(*budget + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > *budget {
        return Err(io::Error::other(format!(
            "the document holds more than {} MB of text, which is more than is searched",
            MAX_XML_BYTES / (1024 * 1024)
        )));
    }
    *budget -= bytes.len() as u64;
    Ok(bytes)
}

/// The parts of a word, slide or OpenDocument file that hold text, in reading order.
fn text_parts(kind: Kind, names: &[String]) -> Vec<String> {
    match kind {
        Kind::Word => {
            let mut parts: Vec<String> = ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml", "word/comments.xml"]
                .iter()
                .filter(|wanted| names.iter().any(|name| name == *wanted))
                .map(|wanted| wanted.to_string())
                .collect();
            parts.extend(parts_in_order(names, "word/header"));
            parts.extend(parts_in_order(names, "word/footer"));
            parts
        }
        Kind::Slides => {
            let mut parts = parts_in_order(names, "ppt/slides/slide");
            parts.extend(parts_in_order(names, "ppt/notesSlides/notesSlide"));
            parts
        }
        Kind::OpenDocument => names.iter().filter(|name| *name == "content.xml").cloned().collect(),
        Kind::Sheet => Vec::new(),
    }
}

/// Parts named `<prefix><number>.xml` (the number may be missing), by number, so slide2 comes before slide10.
fn parts_in_order(names: &[String], prefix: &str) -> Vec<String> {
    let mut found: Vec<(u64, String)> = names
        .iter()
        .filter_map(|name| {
            let number = name.strip_prefix(prefix)?.strip_suffix(".xml")?;
            if !number.chars().all(|character| character.is_ascii_digit()) {
                return None;
            }
            Some((number.parse().unwrap_or(0), name.clone()))
        })
        .collect();
    found.sort();
    found.into_iter().map(|(_, name)| name).collect()
}

/// Which elements of a flavour of XML hold the text, and which end a line. Names are without their prefix.
struct Dialect {
    /// Elements whose character data is text.
    text: &'static [&'static str],
    /// Elements that end a line.
    paragraphs: &'static [&'static str],
    tabs: &'static [&'static str],
    line_breaks: &'static [&'static str],
    /// OpenDocument writes runs of spaces as `<text:s text:c="3"/>`.
    spaces: &'static [&'static str],
    /// A table row is one line, with the text of each cell separated by tabs. Empty for Word and slides.
    rows: &'static [&'static str],
    cells: &'static [&'static str],
}

const WORD_OR_SLIDE: Dialect = Dialect {
    text: &["t"],
    paragraphs: &["p"],
    tabs: &["tab"],
    line_breaks: &["br", "cr"],
    spaces: &[],
    rows: &[],
    cells: &[],
};

const OPEN_DOCUMENT: Dialect = Dialect {
    text: &["p", "h"],
    paragraphs: &["p", "h"],
    tabs: &["tab"],
    line_breaks: &["line-break"],
    spaces: &["s"],
    rows: &["table-row"],
    cells: &["table-cell", "covered-table-cell"],
};

fn dialect_of(kind: Kind) -> &'static Dialect {
    if kind == Kind::OpenDocument {
        &OPEN_DOCUMENT
    } else {
        &WORD_OR_SLIDE
    }
}

fn is_one_of(name: &str, names: &[&str]) -> bool {
    names.contains(&name)
}

fn malformed(error: quick_xml::Error) -> io::Error {
    io::Error::other(format!("the document holds malformed text: {error}"))
}

/// Adds what an entity or character reference such as `&amp;` or `&#169;` stands for.
fn push_reference(text: &mut String, reference: &BytesRef<'_>) {
    if let Ok(Some(character)) = reference.resolve_char_ref() {
        text.push(character);
        return;
    }
    match reference.as_ref() {
        "lt" => text.push('<'),
        "gt" => text.push('>'),
        "amp" => text.push('&'),
        "apos" => text.push('\''),
        "quot" => text.push('"'),
        _ => {}
    }
}

/// How many spaces `<text:s text:c="n"/>` stands for.
fn space_count(element: &BytesStart<'_>) -> usize {
    element
        .attributes()
        .flatten()
        .find(|attribute| attribute.key.local_name().as_ref() == "c")
        .and_then(|attribute| attribute.value.parse::<usize>().ok())
        .unwrap_or(1)
        .min(1000)
}

/// Collects the lines of a part of a word, slide or OpenDocument file.
struct LineBuilder {
    dialect: &'static Dialect,
    lines: Vec<String>,
    paragraph: String,
    text_depth: usize,
    cell_depth: usize,
    cell: String,
    row: Vec<String>,
}

impl LineBuilder {
    fn new(dialect: &'static Dialect) -> Self {
        Self {
            dialect,
            lines: Vec::new(),
            paragraph: String::new(),
            text_depth: 0,
            cell_depth: 0,
            cell: String::new(),
            row: Vec::new(),
        }
    }

    /// A mark inside a paragraph: a tab, a line break or a run of spaces.
    fn mark(&mut self, name: &str, element: &BytesStart<'_>) {
        if is_one_of(name, self.dialect.tabs) {
            self.paragraph.push('\t');
        } else if is_one_of(name, self.dialect.line_breaks) {
            self.end_paragraph();
        } else if is_one_of(name, self.dialect.spaces) {
            self.paragraph.push_str(&" ".repeat(space_count(element)));
        }
    }

    fn open(&mut self, name: &str, element: &BytesStart<'_>) {
        if is_one_of(name, self.dialect.text) {
            self.text_depth += 1;
        }
        if is_one_of(name, self.dialect.cells) {
            self.cell_depth += 1;
            if self.cell_depth == 1 {
                self.cell.clear();
            }
        }
        self.mark(name, element);
    }

    fn close(&mut self, name: &str) {
        if is_one_of(name, self.dialect.text) {
            self.text_depth = self.text_depth.saturating_sub(1);
        }
        if is_one_of(name, self.dialect.paragraphs) {
            self.end_paragraph();
        }
        if is_one_of(name, self.dialect.cells) {
            self.cell_depth = self.cell_depth.saturating_sub(1);
            if self.cell_depth == 0 && !self.cell.is_empty() {
                self.row.push(std::mem::take(&mut self.cell));
            }
        }
        if is_one_of(name, self.dialect.rows) {
            if !self.row.is_empty() {
                self.lines.push(self.row.join("\t"));
            }
            self.row.clear();
        }
    }

    fn end_paragraph(&mut self) {
        let text = std::mem::take(&mut self.paragraph);
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        if self.cell_depth > 0 {
            if !self.cell.is_empty() {
                self.cell.push(' ');
            }
            self.cell.push_str(text);
        } else {
            self.lines.push(text.to_string());
        }
    }
}

/// Appends the lines of one XML part of a word, slide or OpenDocument file to `lines`.
fn paragraph_lines(xml: &[u8], dialect: &'static Dialect, lines: &mut Vec<String>) -> io::Result<()> {
    let mut builder = LineBuilder::new(dialect);
    let mut reader = Reader::from_reader(xml);
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer).map_err(malformed)? {
            Event::Start(element) => builder.open(element.local_name().as_ref(), &element),
            Event::Empty(element) => {
                let name = element.local_name();
                builder.open(name.as_ref(), &element);
                builder.close(name.as_ref());
            }
            Event::End(element) => builder.close(element.local_name().as_ref()),
            Event::Text(text) if builder.text_depth > 0 => builder.paragraph.push_str(&text),
            Event::CData(text) if builder.text_depth > 0 => builder.paragraph.push_str(&text),
            Event::GeneralRef(reference) if builder.text_depth > 0 => push_reference(&mut builder.paragraph, &reference),
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    builder.end_paragraph();
    lines.append(&mut builder.lines);
    Ok(())
}

/// The strings of a spreadsheet's shared string table, which cells refer to by number. Phonetic
/// guides (`rPh`) are not part of the text of a string.
fn shared_strings(xml: &[u8]) -> io::Result<Vec<String>> {
    let mut strings = Vec::new();
    let mut current = String::new();
    let (mut in_string, mut in_phonetic, mut in_text) = (false, false, false);
    let mut reader = Reader::from_reader(xml);
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer).map_err(malformed)? {
            Event::Start(element) => match element.local_name().as_ref() {
                "si" => {
                    in_string = true;
                    current.clear();
                }
                "rPh" => in_phonetic = true,
                "t" => in_text = in_string && !in_phonetic,
                _ => {}
            },
            Event::Empty(element) if element.local_name().as_ref() == "si" => strings.push(String::new()),
            Event::End(element) => match element.local_name().as_ref() {
                "si" => {
                    in_string = false;
                    strings.push(std::mem::take(&mut current));
                }
                "rPh" => in_phonetic = false,
                "t" => in_text = false,
                _ => {}
            },
            Event::Text(text) if in_text => current.push_str(&text),
            Event::CData(text) if in_text => current.push_str(&text),
            Event::GeneralRef(reference) if in_text => push_reference(&mut current, &reference),
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    Ok(strings)
}

/// Appends one line per non-empty row of a worksheet to `lines`, the cells separated by tabs.
/// A cell shows its string, or its number as stored. Booleans and errors are left out.
fn sheet_rows(xml: &[u8], shared: &[String], lines: &mut Vec<String>) -> io::Result<()> {
    let mut cells: Vec<String> = Vec::new();
    let mut kind = String::new();
    let (mut value, mut inline) = (String::new(), String::new());
    let (mut in_value, mut in_inline, mut in_text, mut in_phonetic) = (false, false, false, false);
    let mut reader = Reader::from_reader(xml);
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer).map_err(malformed)? {
            Event::Start(element) => match element.local_name().as_ref() {
                "row" => cells.clear(),
                "c" => {
                    kind = element
                        .attributes()
                        .flatten()
                        .find(|attribute| attribute.key.local_name().as_ref() == "t")
                        .map(|attribute| attribute.value.to_string())
                        .unwrap_or_default();
                    value.clear();
                    inline.clear();
                }
                "v" => in_value = true,
                "is" => in_inline = true,
                "rPh" => in_phonetic = true,
                "t" => in_text = in_inline && !in_phonetic,
                _ => {}
            },
            Event::End(element) => match element.local_name().as_ref() {
                "c" => {
                    let shown = match kind.as_str() {
                        "s" => value.trim().parse::<usize>().ok().and_then(|index| shared.get(index)).cloned().unwrap_or_default(),
                        "inlineStr" => std::mem::take(&mut inline),
                        "b" | "e" => String::new(),
                        _ => std::mem::take(&mut value),
                    };
                    if !shown.trim().is_empty() {
                        cells.push(shown);
                    }
                }
                "row" => {
                    if !cells.is_empty() {
                        lines.push(cells.join("\t"));
                    }
                    cells.clear();
                }
                "v" => in_value = false,
                "is" => in_inline = false,
                "rPh" => in_phonetic = false,
                "t" => in_text = false,
                _ => {}
            },
            Event::Text(text) if in_value => value.push_str(&text),
            Event::Text(text) if in_text => inline.push_str(&text),
            Event::GeneralRef(reference) if in_value => push_reference(&mut value, &reference),
            Event::GeneralRef(reference) if in_text => push_reference(&mut inline, &reference),
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn archive_with(path: &Path, parts: &[(&str, &[u8])]) {
        let mut archive = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, content) in parts {
            archive.start_file(*name, options).unwrap();
            archive.write_all(content).unwrap();
        }
        archive.finish().unwrap();
    }

    #[test]
    fn only_office_and_opendocument_extensions_are_documents() {
        for name in ["a.docx", "A.XLSX", "b.pptx", "c.odt", "d.ods", "e.odp", "f.docm", "g.potx"] {
            assert!(is_document(Path::new(name)), "{name}");
        }
        for name in ["a.doc", "b.xls", "c.pdf", "d.zip", "docx", ".docx.bak", "e.txt"] {
            assert!(!is_document(Path::new(name)), "{name}");
        }
    }

    #[test]
    fn parts_come_in_numeric_order() {
        let names: Vec<String> = ["ppt/slides/slide10.xml", "ppt/slides/slide2.xml", "ppt/slides/slide1.xml", "ppt/slides/_rels/slide1.xml.rels", "ppt/slides/slideLayout1.xml"]
            .iter()
            .map(|name| name.to_string())
            .collect();
        assert_eq!(
            parts_in_order(&names, "ppt/slides/slide"),
            vec!["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide10.xml"]
        );
    }

    #[test]
    fn a_document_that_expands_past_the_limit_is_refused() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("bomb.docx");
        let big = format!("<w:document xmlns:w=\"w\"><w:p><w:t>{}</w:t></w:p></w:document>", "a".repeat(5000));
        archive_with(&path, &[("word/document.xml", big.as_bytes())]);
        let refused = extract_with_limit(&path, &CancelToken::new(), 1000).unwrap_err();
        assert!(refused.to_string().contains("more than"), "{refused}");
        assert!(extract_with_limit(&path, &CancelToken::new(), 100_000).is_ok());
    }

    #[test]
    fn the_limit_counts_every_part_together() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("two.docx");
        let part = format!("<w:document xmlns:w=\"w\"><w:p><w:t>{}</w:t></w:p></w:document>", "b".repeat(600));
        archive_with(&path, &[("word/document.xml", part.as_bytes()), ("word/footer1.xml", part.as_bytes())]);
        assert!(extract_with_limit(&path, &CancelToken::new(), 1000).is_err());
        assert!(extract_with_limit(&path, &CancelToken::new(), 2000).is_ok());
    }

    #[test]
    fn a_cancelled_search_stops_before_reading_a_part() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("a.docx");
        archive_with(&path, &[("word/document.xml", b"<w:document xmlns:w=\"w\"/>")]);
        let cancel = CancelToken::new();
        cancel.cancel();
        assert!(extract_with_limit(&path, &cancel, MAX_XML_BYTES).is_err());
    }
}
