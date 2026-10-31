mod common;

use common::{run, write, write_zip};
use spelunker_core::{preview_file, read_file_text, ContentQuery, SearchConfig};
use std::path::Path;

const WORD_NS: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main""#;
const SHEET_NS: &str = r#"xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main""#;
const SLIDE_NS: &str = r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main""#;
const ODF_NS: &str = r#"xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0""#;

fn word(body: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><w:document {WORD_NS}><w:body>{body}</w:body></w:document>"#
    )
}

fn paragraph(runs: &[&str]) -> String {
    let runs: String = runs
        .iter()
        .map(|text| format!(r#"<w:r><w:t xml:space="preserve">{text}</w:t></w:r>"#))
        .collect();
    format!("<w:p>{runs}</w:p>")
}

fn docx(root: &Path, name: &str, body: &str) -> std::path::PathBuf {
    write_zip(root, name, &[("word/document.xml", &word(body))])
}

fn with_documents(root: &Path, text: &str) -> SearchConfig {
    let mut config = SearchConfig::new(vec![root.to_path_buf()]);
    config.content = Some(ContentQuery::literal(text));
    config.search_documents = true;
    config
}

#[test]
fn text_in_a_word_document_is_found_with_its_paragraph() {
    let root = tempfile::tempdir().unwrap();
    docx(
        root.path(),
        "report.docx",
        &(paragraph(&["Quarterly summary"])
            + &paragraph(&["Payment of the ", "invoice", " is late"])),
    );
    let outcome = run(&with_documents(root.path(), "invoice"));
    assert_eq!(outcome.names(), vec!["report.docx"]);
    let hit = &outcome.file("report.docx").hits[0];
    assert_eq!(hit.line, "Payment of the invoice is late");
    assert_eq!(hit.line_number, 2);
    assert_eq!(hit.match_ranges, vec![15..22]);
}

#[test]
fn a_word_split_across_runs_is_one_word() {
    let root = tempfile::tempdir().unwrap();
    docx(
        root.path(),
        "split.docx",
        &paragraph(&["Hel", "lo wor", "ld"]),
    );
    assert_eq!(
        run(&with_documents(root.path(), "hello world")).names(),
        vec!["split.docx"]
    );
}

#[test]
fn the_markup_around_the_text_is_not_searched() {
    let root = tempfile::tempdir().unwrap();
    docx(root.path(), "plain.docx", &paragraph(&["nothing to see"]));
    for markup in ["document", "w:body", "preserve", "wordprocessingml"] {
        assert!(
            run(&with_documents(root.path(), markup)).names().is_empty(),
            "{markup}"
        );
    }
}

#[test]
fn entities_tabs_and_breaks_become_the_characters_they_stand_for() {
    let root = tempfile::tempdir().unwrap();
    docx(
        root.path(),
        "marks.docx",
        r#"<w:p><w:r><w:t>Fish &amp; chips &#169; &lt;tag&gt;</w:t><w:tab/><w:t>after tab</w:t><w:br/><w:t>second line</w:t></w:r></w:p>"#,
    );
    let outcome = run(&with_documents(root.path(), "chips"));
    let hits = &outcome.file("marks.docx").hits;
    assert_eq!(hits[0].line, "Fish & chips \u{a9} <tag>\tafter tab");
    let second = run(&with_documents(root.path(), "second"));
    assert_eq!(second.file("marks.docx").hits[0].line, "second line");
}

#[test]
fn headers_footers_and_footnotes_are_searched_too() {
    let root = tempfile::tempdir().unwrap();
    write_zip(
        root.path(),
        "parts.docx",
        &[
            ("word/document.xml", &word(&paragraph(&["body text"]))),
            ("word/header1.xml", &word(&paragraph(&["HEADERWORD"]))),
            ("word/footer1.xml", &word(&paragraph(&["FOOTERWORD"]))),
            ("word/footnotes.xml", &word(&paragraph(&["NOTEWORD"]))),
            ("word/media/image1.png", "NOTIMAGEWORD"),
            ("word/styles.xml", &word(&paragraph(&["STYLEWORD"]))),
        ],
    );
    for found in ["HEADERWORD", "FOOTERWORD", "NOTEWORD"] {
        assert_eq!(
            run(&with_documents(root.path(), found)).names(),
            vec!["parts.docx"],
            "{found}"
        );
    }
    for missing in ["NOTIMAGEWORD", "STYLEWORD"] {
        assert!(
            run(&with_documents(root.path(), missing))
                .names()
                .is_empty(),
            "{missing}"
        );
    }
}

#[test]
fn a_spreadsheet_row_is_a_line_with_its_cells_separated_by_tabs() {
    let root = tempfile::tempdir().unwrap();
    let shared = format!(
        r#"<sst {SHEET_NS}><si><t>Customer</t></si><si><r><t>Acme </t></r><r><t>Corp</t></r></si><si><t>Total</t><rPh><t>PHONETIC</t></rPh></si></sst>"#
    );
    let sheet = format!(
        r#"<worksheet {SHEET_NS}><sheetData>
            <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c></row>
            <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>1250.5</v></c></row>
            <row r="3"><c r="A3" t="inlineStr"><is><t>typed in place</t></is></c><c r="B3" t="str"><f>A3</f><v>formula text</v></c></row>
            <row r="4"></row>
        </sheetData></worksheet>"#
    );
    write_zip(
        root.path(),
        "book.xlsx",
        &[
            ("xl/sharedStrings.xml", &shared),
            ("xl/worksheets/sheet1.xml", &sheet),
        ],
    );
    let acme = run(&with_documents(root.path(), "acme corp"));
    assert_eq!(acme.file("book.xlsx").hits[0].line, "Acme Corp\t1250.5");
    assert_eq!(acme.file("book.xlsx").hits[0].line_number, 2);
    assert_eq!(
        run(&with_documents(root.path(), "typed in place")).names(),
        vec!["book.xlsx"]
    );
    assert_eq!(
        run(&with_documents(root.path(), "formula text")).names(),
        vec!["book.xlsx"]
    );
    assert_eq!(
        run(&with_documents(root.path(), "1250.5")).names(),
        vec!["book.xlsx"]
    );
    assert!(
        run(&with_documents(root.path(), "PHONETIC"))
            .names()
            .is_empty(),
        "phonetic guides are not the text of the cell"
    );
}

#[test]
fn slides_are_read_in_order_with_their_notes() {
    let root = tempfile::tempdir().unwrap();
    let slide = |text: &str| {
        format!(r#"<p:sld {SLIDE_NS}><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:sld>"#)
    };
    write_zip(
        root.path(),
        "deck.pptx",
        &[
            ("ppt/slides/slide10.xml", &slide("tenth slide")),
            ("ppt/slides/slide2.xml", &slide("second slide")),
            ("ppt/slides/slide1.xml", &slide("first slide")),
            ("ppt/notesSlides/notesSlide1.xml", &slide("speaker notes")),
        ],
    );
    let outcome = run(&with_documents(root.path(), "slide"));
    let lines: Vec<&str> = outcome
        .file("deck.pptx")
        .hits
        .iter()
        .map(|hit| hit.line.as_str())
        .collect();
    assert_eq!(lines, vec!["first slide", "second slide", "tenth slide"]);
    assert_eq!(
        run(&with_documents(root.path(), "speaker notes")).names(),
        vec!["deck.pptx"]
    );
}

#[test]
fn an_opendocument_text_keeps_spaces_tabs_and_headings() {
    let root = tempfile::tempdir().unwrap();
    let content = format!(
        r#"<office:document-content {ODF_NS}><office:body><office:text>
            <text:h text:outline-level="1">Title here</text:h>
            <text:p>one<text:s text:c="3"/>two<text:tab/>three<text:line-break/>four <text:span>bold</text:span> end</text:p>
        </office:text></office:body></office:document-content>"#
    );
    write_zip(root.path(), "letter.odt", &[("content.xml", &content)]);
    let outcome = run(&with_documents(root.path(), "title"));
    assert_eq!(outcome.file("letter.odt").hits[0].line, "Title here");
    let lines: Vec<String> = run(&with_documents(root.path(), "end"))
        .file("letter.odt")
        .hits
        .iter()
        .map(|hit| hit.line.clone())
        .collect();
    assert_eq!(lines, vec!["four bold end"]);
    assert_eq!(
        run(&with_documents(root.path(), "one   two\tthree")).names(),
        vec!["letter.odt"]
    );
}

#[test]
fn an_opendocument_spreadsheet_row_is_a_line_and_repeated_empty_rows_cost_nothing() {
    let root = tempfile::tempdir().unwrap();
    let content = format!(
        r#"<office:document-content {ODF_NS}><office:body><office:spreadsheet><table:table>
            <table:table-row><table:table-cell><text:p>Name</text:p></table:table-cell><table:table-cell><text:p>Amount</text:p></table:table-cell></table:table-row>
            <table:table-row><table:table-cell><text:p>Globex</text:p></table:table-cell><table:table-cell/><table:table-cell><text:p>77</text:p><text:p>units</text:p></table:table-cell></table:table-row>
            <table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>
        </table:table></office:spreadsheet></office:body></office:document-content>"#
    );
    write_zip(root.path(), "sheet.ods", &[("content.xml", &content)]);
    let outcome = run(&with_documents(root.path(), "globex"));
    assert_eq!(outcome.file("sheet.ods").hits[0].line, "Globex\t77 units");
    assert_eq!(outcome.file("sheet.ods").hits[0].line_number, 2);
}

#[test]
fn documents_are_only_searched_when_asked_for() {
    let root = tempfile::tempdir().unwrap();
    docx(root.path(), "report.docx", &paragraph(&["the invoice"]));
    let mut config = with_documents(root.path(), "invoice");
    config.search_documents = false;
    let outcome = run(&config);
    assert!(outcome.names().is_empty());
    assert_eq!(
        outcome.summary.binary_skipped, 1,
        "skipped unopened, as a binary file is"
    );
    config.search_documents = true;
    let outcome = run(&config);
    assert_eq!(outcome.names(), vec!["report.docx"]);
    assert_eq!(outcome.summary.binary_skipped, 0);
}

#[test]
fn a_name_search_never_opens_documents() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "broken.docx", b"this is not a zip file");
    let mut config = SearchConfig::new(vec![root.path().to_path_buf()]);
    config.name_patterns = "*.docx".to_string();
    config.search_documents = true;
    let outcome = run(&config);
    assert_eq!(outcome.names(), vec!["broken.docx"]);
    assert!(outcome.errors.is_empty());
}

#[test]
fn an_unreadable_document_is_reported_and_the_search_goes_on() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "broken.docx", b"this is not a zip file");
    docx(root.path(), "fine.docx", &paragraph(&["needle"]));
    write(root.path(), "plain.txt", b"needle");
    let outcome = run(&with_documents(root.path(), "needle"));
    assert_eq!(outcome.names(), vec!["fine.docx", "plain.txt"]);
    assert_eq!(outcome.errors.len(), 1);
    assert!(outcome.errors[0].path.ends_with("broken.docx"));
    assert!(
        outcome.errors[0]
            .message
            .contains("password protected or damaged"),
        "{}",
        outcome.errors[0].message
    );
}

#[test]
fn an_office_file_that_holds_no_text_part_is_a_file_without_matches() {
    let root = tempfile::tempdir().unwrap();
    write_zip(
        root.path(),
        "empty.docx",
        &[("[Content_Types].xml", "<Types/>")],
    );
    let outcome = run(&with_documents(root.path(), "needle"));
    assert!(outcome.names().is_empty());
    assert!(outcome.errors.is_empty());
}

#[test]
fn the_other_search_options_apply_to_document_text() {
    let root = tempfile::tempdir().unwrap();
    docx(
        root.path(),
        "mixed.docx",
        &(paragraph(&["Needle upper"]) + &paragraph(&["a needle lower"])),
    );
    let mut config = with_documents(root.path(), "needle");
    config.content.as_mut().unwrap().match_case = true;
    let hits = &run(&config).file("mixed.docx").hits.len();
    assert_eq!(*hits, 1);
    let mut regex = with_documents(root.path(), r"n\w+e\b");
    regex.content.as_mut().unwrap().regex = true;
    assert_eq!(run(&regex).names(), vec!["mixed.docx"]);
}

#[test]
fn the_preview_shows_matches_with_context_from_the_document_text() {
    let root = tempfile::tempdir().unwrap();
    let path = docx(
        root.path(),
        "long.docx",
        &(1..=9)
            .map(|number| paragraph(&[&format!("paragraph {number}")]))
            .collect::<String>(),
    );
    let lines = preview_file(&path, &ContentQuery::literal("paragraph 5"), 1, false).unwrap();
    let texts: Vec<&str> = lines.iter().map(|line| line.text.as_str()).collect();
    assert_eq!(texts, vec!["paragraph 4", "paragraph 5", "paragraph 6"]);
    assert!(lines[1].is_match);
}

#[test]
fn the_whole_text_view_shows_document_text_not_a_binary_notice() {
    let root = tempfile::tempdir().unwrap();
    let path = docx(
        root.path(),
        "view.docx",
        &(paragraph(&["first"]) + &paragraph(&["second needle"])),
    );
    let text = read_file_text(&path, Some(&ContentQuery::literal("needle")), 1024 * 1024).unwrap();
    assert!(!text.binary && !text.truncated);
    assert_eq!(text.lines.len(), 2);
    assert_eq!(text.lines[1].text, "second needle");
    assert!(text.lines[1].is_match);
}

#[test]
fn a_long_document_is_cut_at_a_whole_line_in_the_text_view() {
    let root = tempfile::tempdir().unwrap();
    let body: String = (1..=500)
        .map(|number| paragraph(&[&format!("paragraph number {number}")]))
        .collect();
    let path = docx(root.path(), "long.docx", &body);
    let text = read_file_text(&path, None, 1000).unwrap();
    assert!(text.truncated);
    let last = text.lines.last().unwrap();
    assert!(last.text.starts_with("paragraph number "), "{}", last.text);
    assert!(text.lines.len() > 10 && text.lines.len() < 500);
}

#[test]
fn the_preview_of_a_document_does_not_depend_on_the_search_option() {
    let root = tempfile::tempdir().unwrap();
    let path = docx(root.path(), "report.docx", &paragraph(&["the invoice"]));
    let lines = preview_file(&path, &ContentQuery::literal("invoice"), 0, false).unwrap();
    assert_eq!(lines.len(), 1);
}
