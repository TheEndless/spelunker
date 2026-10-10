//! The file type description Explorer shows in its Type column, such as "Text Document".

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

/// Descriptions depend only on the extension, so each one is asked of the shell once.
static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

/// Explorer's description of the file type of `path`, based on its extension alone. The file is
/// not opened or even checked for existence. Unregistered extensions get Explorer's own
/// fallback, for example "ZZQ File".
pub fn type_name_for_path(path: &Path) -> String {
    let extension = path
        .extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mut cache = CACHE.get_or_init(Default::default).lock().unwrap();
    if let Some(known) = cache.get(&extension) {
        return known.clone();
    }
    let name = shell_type_name(&extension).unwrap_or_else(|| fallback_type_name(&extension));
    cache.insert(extension, name.clone());
    name
}

/// What Explorer shows when the shell has no description: the extension plus "File".
fn fallback_type_name(extension: &str) -> String {
    if extension.is_empty() {
        "File".to_string()
    } else {
        format!("{} File", extension.to_uppercase())
    }
}

/// Asks the Windows shell. `None` when the call fails or returns nothing.
fn shell_type_name(extension: &str) -> Option<String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL;
    use windows_sys::Win32::UI::Shell::{
        SHGetFileInfoW, SHFILEINFOW, SHGFI_TYPENAME, SHGFI_USEFILEATTRIBUTES,
    };

    // A made-up name is enough: with USEFILEATTRIBUTES the shell only looks at the extension.
    let dummy_name = if extension.is_empty() {
        "file".to_string()
    } else {
        format!("file.{extension}")
    };
    let wide_name: Vec<u16> = std::ffi::OsStr::new(&dummy_name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    // SAFETY: `wide_name` is NUL-terminated and outlives the call, and `info` is a plain-data
    // struct that the call fills in. Zeroed is a valid initial state for SHFILEINFOW.
    let (result, info) = unsafe {
        let mut info: SHFILEINFOW = std::mem::zeroed();
        let result = SHGetFileInfoW(
            wide_name.as_ptr(),
            FILE_ATTRIBUTE_NORMAL,
            &mut info,
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_TYPENAME | SHGFI_USEFILEATTRIBUTES,
        );
        (result, info)
    };
    if result == 0 {
        return None;
    }
    let length = info
        .szTypeName
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(info.szTypeName.len());
    let name = String::from_utf16_lossy(&info.szTypeName[..length]);
    (!name.is_empty()).then_some(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn type_name(name: &str) -> String {
        type_name_for_path(Path::new(name))
    }

    // Windows localizes these descriptions, so the tests avoid asserting exact registered names.

    #[test]
    fn registered_extensions_get_the_shells_description_not_the_fallback() {
        assert_ne!(type_name("notes.txt"), fallback_type_name("txt"));
        assert!(!type_name("notes.txt").is_empty());
    }

    #[test]
    fn unregistered_extensions_get_extension_plus_file() {
        assert_eq!(type_name("data.zzqx"), "ZZQX File");
    }

    #[test]
    fn files_without_an_extension_are_described_as_a_file() {
        assert!(!type_name("Makefile").is_empty());
        assert_eq!(fallback_type_name(""), "File");
    }

    #[test]
    fn extension_case_does_not_matter() {
        assert_eq!(type_name("A.TXT"), type_name("a.txt"));
        assert_eq!(type_name("a.ZZQX"), "ZZQX File");
    }

    #[test]
    fn the_file_does_not_need_to_exist() {
        assert!(!type_name(r"Z:\no\such\folder\report.txt").is_empty());
    }

    #[test]
    fn only_the_final_extension_counts() {
        assert_eq!(type_name("archive.zzqx.txt"), type_name("other.txt"));
    }

    #[test]
    fn repeated_lookups_agree() {
        assert_eq!(type_name("one.txt"), type_name("two.txt"));
    }
}
