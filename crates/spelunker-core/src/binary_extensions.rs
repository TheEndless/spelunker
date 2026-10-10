//! File extensions that are binary in practice. When binary files are not being searched, a file
//! with one of these extensions is skipped without being opened. Opening is the expensive part:
//! on Windows, real-time antivirus can hold an `open` of an executable for seconds, and a blocked
//! open cannot be cancelled. Extensions not listed here still get the content check (a NUL byte).

use std::path::Path;

/// Lowercase, without the dot. Kept to extensions that are binary in essentially every case, so
/// ambiguous ones such as `bin`, `dat`, `db`, and `svg` are left to the content check.
#[rustfmt::skip]
const BINARY_EXTENSIONS: &[&str] = &[
    // Programs and libraries
    "exe", "dll", "sys", "msi", "msp", "msu", "ocx", "scr", "cpl", "drv", "efi", "lib", "obj", "o",
    "a", "so", "dylib", "pdb", "ilk", "exp", "res", "pyc", "pyd", "class", "jar", "war", "ear",
    "nupkg", "vsix", "apk", "aab", "dex", "wasm",
    // Archives and disk images
    "zip", "7z", "rar", "gz", "tgz", "bz2", "xz", "zst", "lz", "lzma", "cab", "iso", "img", "vhd",
    "vhdx", "vmdk", "wim", "dmg", "tar",
    // Images
    "png", "jpg", "jpeg", "gif", "bmp", "ico", "cur", "webp", "tif", "tiff", "psd", "heic", "heif",
    "avif", "raw", "cr2", "nef", "dng",
    // Audio and video
    "mp3", "mp4", "m4a", "m4v", "mkv", "avi", "mov", "wav", "flac", "ogg", "oga", "ogv", "webm",
    "wmv", "wma", "aac", "opus", "mpg", "mpeg", "flv",
    // Documents and fonts that are containers or binary formats
    "pdf", "doc", "dot", "xls", "xlt", "ppt", "pot", "pps", "docx", "dotx", "docm", "xlsx", "xlsm",
    "xlsb", "xltx", "pptx", "potx", "ppsx", "pptm", "odt", "ods", "odp", "ttf", "otf", "woff",
    "woff2", "eot",
    // Databases and dumps
    "sqlite", "sqlite3", "mdb", "accdb", "dmp", "hdmp",
];

pub fn has_binary_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            BINARY_EXTENSIONS
                .iter()
                .any(|known| known.eq_ignore_ascii_case(extension))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_binary(name: &str) -> bool {
        has_binary_extension(Path::new(name))
    }

    #[test]
    fn common_binary_types_are_recognised_whatever_their_case() {
        for name in [
            "setup.exe",
            "lib.DLL",
            "Photo.JPG",
            "movie.Mp4",
            "a.zip",
            "x.pdf",
            "m.jar",
        ] {
            assert!(is_binary(name), "{name}");
        }
    }

    #[test]
    fn legacy_and_macro_office_types_are_recognised() {
        for name in [
            "talk.pot",
            "talk.pps",
            "talk.ppsx",
            "form.dot",
            "form.dotx",
            "form.docm",
            "calc.xlsm",
            "calc.xlsb",
            "calc.xlt",
            "deck.pptm",
            "deck.potx",
        ] {
            assert!(is_binary(name), "{name}");
        }
    }

    #[test]
    fn source_and_text_types_are_not_binary() {
        for name in [
            "main.rs",
            "index.ts",
            "notes.txt",
            "data.json",
            "page.html",
            "style.css",
            "log.log",
            "script.ps1",
            "config.toml",
            "image.svg",
            "README.md",
            "Makefile",
        ] {
            assert!(!is_binary(name), "{name}");
        }
    }

    #[test]
    fn ambiguous_extensions_are_left_to_the_content_check() {
        for name in ["blob.bin", "state.dat", "cache.db", "data.sav", "core.dump"] {
            assert!(!is_binary(name), "{name}");
        }
    }

    #[test]
    fn only_the_final_extension_counts() {
        assert!(is_binary("archive.tar.gz"));
        assert!(!is_binary("tool.exe.txt"));
        assert!(!is_binary("report.pdf.md"));
    }

    #[test]
    fn dotfiles_and_missing_extensions_are_not_binary() {
        assert!(!is_binary(".gitignore"));
        assert!(!is_binary(".exe"));
        assert!(!is_binary("noextension"));
        assert!(!is_binary("trailing."));
    }

    #[test]
    fn the_list_is_lowercase_and_has_no_duplicates() {
        let mut seen = std::collections::HashSet::new();
        for extension in BINARY_EXTENSIONS {
            assert_eq!(*extension, extension.to_lowercase());
            assert!(seen.insert(*extension), "duplicate: {extension}");
        }
    }
}
