#![allow(dead_code)]

use spelunker_core::{
    search, CancelToken, FileResult, SearchConfig, SearchError, SearchEvent, SearchSummary,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Outcome {
    pub files: Vec<FileResult>,
    pub errors: Vec<SearchError>,
    pub summary: SearchSummary,
}

impl Outcome {
    /// Sorted file names (not full paths) of every result.
    pub fn names(&self) -> Vec<String> {
        let mut names: Vec<String> = self
            .files
            .iter()
            .map(|file| {
                file.path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }

    pub fn file(&self, name: &str) -> &FileResult {
        self.files
            .iter()
            .find(|file| file.path.file_name().unwrap().to_string_lossy() == name)
            .unwrap_or_else(|| panic!("no result named {name}, got {:?}", self.names()))
    }
}

pub fn run(config: &SearchConfig) -> Outcome {
    run_with_cancel(config, &CancelToken::new())
}

pub fn run_with_cancel(config: &SearchConfig, cancel: &CancelToken) -> Outcome {
    let (sender, receiver) = std::sync::mpsc::channel();
    let sender = Mutex::new(sender);
    let summary = search(config, cancel, move |event| {
        let _ = sender.lock().unwrap().send(event);
    })
    .expect("search config should be valid");
    // search() drops the callback (and so the sender) before returning, so this drain ends.
    let (mut files, mut errors) = (Vec::new(), Vec::new());
    while let Ok(event) = receiver.recv_timeout(std::time::Duration::from_secs(5)) {
        match event {
            SearchEvent::File(file) => files.push(file),
            SearchEvent::Error(error) => errors.push(error),
            SearchEvent::Progress { .. } => {}
        }
    }
    Outcome {
        files,
        errors,
        summary,
    }
}

pub fn write(root: &Path, relative: &str, bytes: &[u8]) -> PathBuf {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, bytes).unwrap();
    path
}

pub fn utf16le(text: &str, with_bom: bool) -> Vec<u8> {
    let mut bytes = if with_bom { vec![0xFF, 0xFE] } else { vec![] };
    for unit in text.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    bytes
}

pub fn utf16be(text: &str, with_bom: bool) -> Vec<u8> {
    let mut bytes = if with_bom { vec![0xFE, 0xFF] } else { vec![] };
    for unit in text.encode_utf16() {
        bytes.extend_from_slice(&unit.to_be_bytes());
    }
    bytes
}

/// Builds the shared fixture tree under `root`. Contents are deterministic.
pub fn build_fixture(root: &Path) {
    write(
        root,
        "notes/readme.txt",
        b"hello world\nNeedle in a haystack\nanother line\nneedle again\n",
    );
    write(
        root,
        "notes/report-2026.md",
        b"Quarterly report\nNo match here\n",
    );
    write(
        root,
        "logs/app.log",
        b"INFO start\nERR-1234 failure\nINFO end\n",
    );
    write(root, "logs/app.min.js", b"var needle=1;");
    write(root, "src/app.js", b"let value = 2;\n");
    write(root, "special.txt", b"a.b and axb\n");

    let mut utf8_bom = vec![0xEF, 0xBB, 0xBF];
    utf8_bom.extend_from_slice("Caf\u{e9} needle\n".as_bytes());
    write(root, "encodings/utf8_bom.txt", &utf8_bom);
    write(
        root,
        "encodings/utf16le.txt",
        &utf16le("needle in utf16 le\n", true),
    );
    write(
        root,
        "encodings/utf16be.txt",
        &utf16be("needle in utf16 be\n", true),
    );
    write(
        root,
        "encodings/utf16le_nobom.txt",
        &utf16le("needle without bom\n", false),
    );
    write(root, "encodings/cp1252.txt", b"caf\xe9 needle\n");

    write(root, "binary/blob.bin", b"\x00\x01\x02needle\x00\x00");
    write(
        root,
        "binary/late_nul.dat",
        b"needle first line\nthen a \x00 nul\n",
    );

    write(root, ".git/config", b"needle\n");
    write(root, "node_modules/pkg/index.js", b"needle\n");
    write(root, "$RECYCLE.BIN/trash.txt", b"needle\n");
    write(root, ".hidden.txt", b"needle\n");
}

/// Creates a directory junction at `link` pointing to `target`. Junctions need no privileges.
#[cfg(windows)]
pub fn make_junction(link: &Path, target: &Path) {
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .stdout(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(status.success(), "mklink /J failed");
}

/// Sets a Windows file attribute (for example "+H" or "+S") on a file or folder.
#[cfg(windows)]
pub fn set_attribute(path: &Path, flag: &str) {
    let status = std::process::Command::new("attrib")
        .arg(flag)
        .arg(path)
        .status()
        .unwrap();
    assert!(status.success(), "attrib {flag} failed");
}

/// Creates a file whose absolute path is longer than 260 characters.
pub fn write_long_path_file(root: &Path, file_name: &str, bytes: &[u8]) -> PathBuf {
    let mut dir = root.to_path_buf();
    for level in 0..8 {
        dir.push(format!("long_directory_name_segment_{level:02}_padding"));
    }
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join(file_name);
    assert!(
        path.as_os_str().len() > 260,
        "fixture path must exceed MAX_PATH"
    );
    fs::write(&path, bytes).unwrap();
    path
}
