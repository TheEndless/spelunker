//! Decides whether a file may be handed to the webview for preview. The webview can read a file
//! through the asset protocol only after it has been allowed here, one file at a time.

use std::io::Read;
use std::path::Path;

/// A PDF's header must appear in its first 1024 bytes (the format's own rule).
const PDF_HEADER_WINDOW: usize = 1024;

fn has_pdf_header(start: &[u8]) -> bool {
    start.windows(5).any(|window| window == b"%PDF-")
}

/// Checks that `path` is a file that is safe to show. A file named `.pdf` has to be a real PDF:
/// the asset protocol sniffs the content, and an HTML page with a `.pdf` name would otherwise be
/// served as HTML into the preview frame, where its scripts could run.
pub fn verify_previewable(path: &Path) -> Result<(), String> {
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Only files can be previewed".to_string());
    }
    let is_pdf = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"));
    if is_pdf {
        let mut start = Vec::with_capacity(PDF_HEADER_WINDOW);
        std::fs::File::open(path)
            .and_then(|file| file.take(PDF_HEADER_WINDOW as u64).read_to_end(&mut start))
            .map_err(|error| error.to_string())?;
        if !has_pdf_header(&start) {
            return Err("This file is named like a PDF but is not one".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(folder: &Path, name: &str, content: &[u8]) -> std::path::PathBuf {
        let path = folder.join(name);
        std::fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn a_real_pdf_is_allowed() {
        let folder = tempfile::tempdir().unwrap();
        let path = write(folder.path(), "a.pdf", b"%PDF-1.7\n1 0 obj");
        assert!(verify_previewable(&path).is_ok());
    }

    #[test]
    fn the_extension_check_ignores_case() {
        let folder = tempfile::tempdir().unwrap();
        let path = write(folder.path(), "a.PDF", b"<html><script>alert(1)</script>");
        assert!(verify_previewable(&path).is_err());
    }

    #[test]
    fn an_html_page_named_like_a_pdf_is_refused() {
        let folder = tempfile::tempdir().unwrap();
        let path = write(
            folder.path(),
            "invoice.pdf",
            b"<html><script>steal()</script></html>",
        );
        let error = verify_previewable(&path).unwrap_err();
        assert!(error.contains("not one"), "{error}");
    }

    #[test]
    fn a_pdf_with_junk_before_the_header_is_still_allowed() {
        let folder = tempfile::tempdir().unwrap();
        let mut content = vec![b' '; 600];
        content.extend_from_slice(b"%PDF-1.4");
        let path = write(folder.path(), "a.pdf", &content);
        assert!(verify_previewable(&path).is_ok());
    }

    #[test]
    fn a_header_far_beyond_the_window_does_not_count() {
        let folder = tempfile::tempdir().unwrap();
        let mut content = vec![b' '; 2000];
        content.extend_from_slice(b"%PDF-1.4");
        let path = write(folder.path(), "a.pdf", &content);
        assert!(verify_previewable(&path).is_err());
    }

    #[test]
    fn other_files_are_not_inspected() {
        let folder = tempfile::tempdir().unwrap();
        let path = write(folder.path(), "photo.png", b"not really a png");
        assert!(verify_previewable(&path).is_ok());
    }

    #[test]
    fn a_folder_or_a_missing_path_is_refused() {
        let folder = tempfile::tempdir().unwrap();
        assert!(verify_previewable(folder.path()).is_err());
        assert!(verify_previewable(&folder.path().join("gone.pdf")).is_err());
    }
}
