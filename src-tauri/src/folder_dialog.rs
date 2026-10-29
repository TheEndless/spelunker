//! The native "choose a folder" dialog, with This PC as a choice.
//!
//! The stock dialog plugin only returns file system paths, so choosing This PC (which is not a
//! folder) came back as nothing. This one asks the shell for any item and sorts out what it is.
//!
//! It runs on the window's thread, inside the OLE apartment that thread already has, like the
//! system menu does.

use crate::drives;
use std::ffi::c_void;
use windows::core::{HRESULT, PWSTR};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_INPROC_SERVER};
use windows::Win32::UI::Shell::{
    FileOpenDialog, IFileOpenDialog, IShellItem, FOS_ALLNONSTORAGEITEMS, FOS_PICKFOLDERS, SIGDN,
    SIGDN_DESKTOPABSOLUTEPARSING, SIGDN_FILESYSPATH,
};

/// The parsing name the shell gives This PC.
const THIS_PC_PARSING_NAME: &str = "::{20D04FE0-3AEA-1069-A2D8-08002B30309D}";

/// `HRESULT_FROM_WIN32(ERROR_CANCELLED)`, which Show returns when the user closes the dialog.
const CANCELLED: HRESULT = HRESULT(0x800704C7_u32 as i32);

/// What the user chose.
#[derive(Debug, PartialEq, Eq)]
enum Choice {
    Folder(String),
    ThisPc,
    /// Something in the shell that is neither a folder nor This PC, such as Network or Control Panel.
    Unsupported,
}

/// Sorts a chosen shell item by its parsing name and, when it has one, its file system path.
fn classify(parsing_name: &str, file_system_path: Option<String>) -> Choice {
    if parsing_name.eq_ignore_ascii_case(THIS_PC_PARSING_NAME) {
        return Choice::ThisPc;
    }
    match file_system_path {
        Some(path) if !path.is_empty() => Choice::Folder(path),
        _ => Choice::Unsupported,
    }
}

/// The text of a shell item in one of its name forms, or None when it has none in that form.
fn display_name(item: &IShellItem, form: SIGDN) -> Option<String> {
    // SAFETY: a plain COM call on a valid interface. The string it returns belongs to us and is
    // freed with the COM allocator once copied.
    unsafe {
        let name: PWSTR = item.GetDisplayName(form).ok()?;
        let text = name.to_string().ok();
        CoTaskMemFree(Some(name.0 as *const c_void));
        text
    }
}

/// Shows the dialog over `parent` and returns the folder to search: its path, or the This PC label
/// listing the local drives. None when the dialog was cancelled or the choice cannot be searched.
pub fn pick(parent: HWND) -> Result<Option<String>, String> {
    // SAFETY: COM calls on interfaces this function creates and owns, on the thread that owns the
    // parent window and its apartment.
    let item: IShellItem = unsafe {
        let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)
            .map_err(|error| format!("The folder dialog could not be created: {error}"))?;
        let options = dialog
            .GetOptions()
            .map_err(|error| format!("The folder dialog could not be set up: {error}"))?;
        dialog
            .SetOptions(options | FOS_PICKFOLDERS | FOS_ALLNONSTORAGEITEMS)
            .map_err(|error| format!("The folder dialog could not be set up: {error}"))?;
        match dialog.Show(Some(parent)) {
            Ok(()) => {}
            Err(error) if error.code() == CANCELLED => return Ok(None),
            Err(error) => return Err(format!("The folder dialog failed: {error}")),
        }
        dialog
            .GetResult()
            .map_err(|error| format!("The folder dialog gave no answer: {error}"))?
    };
    let parsing_name = display_name(&item, SIGDN_DESKTOPABSOLUTEPARSING).unwrap_or_default();
    let path = display_name(&item, SIGDN_FILESYSPATH);
    Ok(match classify(&parsing_name, path) {
        Choice::Folder(path) => Some(path),
        Choice::ThisPc => Some(drives::this_pc_label(&drives::fixed_drives())),
        Choice::Unsupported => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn this_pc_is_known_by_its_parsing_name_in_any_case() {
        assert_eq!(classify(THIS_PC_PARSING_NAME, None), Choice::ThisPc);
        assert_eq!(
            classify(&THIS_PC_PARSING_NAME.to_lowercase(), None),
            Choice::ThisPc
        );
    }

    #[test]
    fn a_folder_is_its_file_system_path() {
        assert_eq!(
            classify("C:\\Work", Some("C:\\Work".to_string())),
            Choice::Folder("C:\\Work".to_string())
        );
    }

    #[test]
    fn a_drive_root_is_a_folder() {
        assert_eq!(
            classify("D:\\", Some("D:\\".to_string())),
            Choice::Folder("D:\\".to_string())
        );
    }

    #[test]
    fn a_shell_item_with_no_path_cannot_be_searched() {
        assert_eq!(
            classify("::{F02C1A0D-BE21-4350-88B0-7367FC96EF3C}", None),
            Choice::Unsupported
        );
        assert_eq!(
            classify("anything", Some(String::new())),
            Choice::Unsupported
        );
    }
}
