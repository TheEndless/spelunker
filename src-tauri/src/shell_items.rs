//! Shell objects for many files or folders at once, which may live in different folders.
//!
//! The system menu and the native drag both start from a list of paths. This module turns the
//! paths into absolute shell item ids, then, through the shell's item array, into its own
//! multi-item objects: a data object (CF_HDROP and the shell formats) and a context menu object.
//!
//! Threading: everything here is created and used on the window thread, inside the COM (OLE)
//! apartment that thread already has. The types are not `Send` (they hold raw item id pointers and
//! apartment-bound COM interfaces), so the compiler keeps them on that thread.

use std::collections::HashSet;
use std::ffi::c_void;
use std::mem::ManuallyDrop;
use windows::core::{IUnknown, Interface, PCWSTR};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{CoTaskMemFree, IDataObject};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    BHID_DataObject, BHID_SFUIObject, IContextMenu, IQueryAssociations, IShellFolder,
    IShellItemArray, SHBindToParent, SHCreateDefaultContextMenu, SHCreateShellItemArrayFromIDLists,
    SHGetDesktopFolder, SHParseDisplayName, DEFCONTEXTMENU,
};

/// The most items one request may name. Parsing touches the disk for every item and can stall on
/// offline shares, so a larger request is refused before any of it is parsed.
pub const MAX_ITEMS: usize = 5000;

/// A NUL-terminated UTF-16 copy of `text`, for Win32 calls.
pub fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Frees a shell item id list when it goes out of scope.
pub struct ItemIdList(*mut ITEMIDLIST);
impl ItemIdList {
    /// Takes ownership of `item_id`.
    ///
    /// # Safety
    /// `item_id` must be null or an id list allocated with the COM task allocator (as
    /// SHParseDisplayName returns it) that nothing else frees.
    pub unsafe fn from_raw(item_id: *mut ITEMIDLIST) -> Self {
        ItemIdList(item_id)
    }

    pub fn as_ptr(&self) -> *mut ITEMIDLIST {
        self.0
    }
}
impl Drop for ItemIdList {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: `from_raw` requires a COM task allocation that only this owner frees.
            unsafe { CoTaskMemFree(Some(self.0 as *const c_void)) };
        }
    }
}

/// The absolute item ids of the paths that still exist, in order, with the paths that were skipped.
///
/// Create and use it on the window thread, inside its COM apartment. It is not `Send`.
pub struct ParsedPaths {
    item_ids: Vec<ItemIdList>,
    pub skipped: Vec<String>,
}

/// A shell object together with the item ids it was made from.
///
/// Whether the shell copies the item ids it is given is not verified for every route, so the ids
/// live exactly as long as the object. Fields drop in order, so the object is released before the
/// ids are freed. Create and use it on the window thread, inside its COM apartment, and never move
/// it to another thread (it is not `Send`).
pub struct ShellObject<T> {
    object: T,
    items: ParsedPaths,
}
impl<T> ShellObject<T> {
    /// The shell object. A clone of it must not outlive this wrapper.
    pub fn object(&self) -> &T {
        &self.object
    }

    /// The requested paths that the shell did not know, so the object leaves them out.
    pub fn skipped(&self) -> &[String] {
        &self.items.skipped
    }
}

const LONG_PATH_PREFIX: &str = r"\\?\";
const LONG_UNC_PREFIX: &str = r"\\?\unc\";

/// The key two spellings of one path share: separators unified, case folded, the long-path prefix
/// dropped, and a trailing separator trimmed. `pathKey` in src/lib/fileDrag.ts does the same, and
/// both are tested with the same cases.
fn duplicate_key(path: &str) -> String {
    let unified = path.replace('/', "\\").to_lowercase();
    let without_prefix =
        if unified.starts_with(LONG_PATH_PREFIX) && !unified.starts_with(LONG_UNC_PREFIX) {
            &unified[LONG_PATH_PREFIX.len()..]
        } else {
            unified.as_str()
        };
    // A drive root keeps its separator (`c:\`), since `c:` is the current folder of that drive.
    if without_prefix.len() > 3 {
        without_prefix.trim_end_matches('\\').to_string()
    } else {
        without_prefix.to_string()
    }
}

/// Parses `paths` into absolute item ids. A repeated path (ignoring case and the separator style)
/// is kept once, at its first position. A path the shell does not know (for example one that was
/// deleted since the search) is skipped and reported. Fails when no paths are given, when none
/// are left, or when there are more than `MAX_ITEMS`.
///
/// Call it on the window thread, inside its COM apartment.
pub fn parse_paths(paths: &[String]) -> Result<ParsedPaths, String> {
    if paths.is_empty() {
        return Err("No items were given.".to_string());
    }
    let mut seen = HashSet::with_capacity(paths.len());
    let unique: Vec<&String> = paths
        .iter()
        .filter(|path| seen.insert(duplicate_key(path)))
        .collect();
    if unique.len() > MAX_ITEMS {
        return Err(format!(
            "{} items is too many at once. The limit is {MAX_ITEMS}.",
            unique.len()
        ));
    }
    let mut item_ids = Vec::with_capacity(unique.len());
    let mut skipped = Vec::new();
    for path in unique {
        let wide_path = wide(path);
        let mut item_id = std::ptr::null_mut();
        // SAFETY: `wide_path` is NUL-terminated and outlives the call, and `item_id` is a valid
        // out pointer. SHParseDisplayName allocates the id list with the COM task allocator and
        // hands it to us, as `from_raw` requires.
        let parsed =
            unsafe { SHParseDisplayName(PCWSTR(wide_path.as_ptr()), None, &mut item_id, 0, None) };
        match parsed {
            // SAFETY: see above.
            Ok(()) => item_ids.push(unsafe { ItemIdList::from_raw(item_id) }),
            Err(_) => skipped.push(path.clone()),
        }
    }
    if item_ids.is_empty() {
        return Err("None of the items exist any more.".to_string());
    }
    Ok(ParsedPaths { item_ids, skipped })
}

impl ParsedPaths {
    /// A shell data object (CF_HDROP and the shell formats) for all the items, even across folders.
    ///
    /// Call it on the window thread, inside its COM apartment.
    pub fn data_object(self) -> Result<ShellObject<IDataObject>, String> {
        let array = self.create_item_array()?;
        // SAFETY: a plain COM call on a valid interface, with no bind context.
        let data = unsafe { array.BindToHandler(None, &BHID_DataObject) }
            .map_err(|error| format!("The shell could not package the items: {error}"))?;
        Ok(self.wrap(data))
    }

    /// The shell's context menu object for all the items.
    ///
    /// The item array gives the full menu when the items share a folder, but fails with E_FAIL
    /// when they do not. Then the default menu is built on the desktop folder, which accepts
    /// absolute item ids from anywhere (see `menu_across_folders`).
    ///
    /// Call it on the window thread, inside its COM apartment.
    pub fn context_menu(self) -> Result<ShellObject<IContextMenu>, String> {
        let array = self.create_item_array()?;
        // SAFETY: a plain COM call on a valid interface, with no bind context.
        let from_array: windows::core::Result<IContextMenu> =
            unsafe { array.BindToHandler(None, &BHID_SFUIObject) };
        let menu = match from_array {
            Ok(menu) => menu,
            Err(array_error) => self.menu_across_folders().map_err(|fallback_error| {
                format!(
                    "The shell has no menu for these items: {array_error}, then {fallback_error}"
                )
            })?,
        };
        Ok(self.wrap(menu))
    }

    fn wrap<T>(self, object: T) -> ShellObject<T> {
        ShellObject {
            object,
            items: self,
        }
    }

    fn create_item_array(&self) -> Result<IShellItemArray, String> {
        let item_ids = self.item_id_pointers();
        // SAFETY: every pointer is a valid absolute id list owned by `self` and alive for the
        // call. The caller keeps `self` alive as long as the array (see `ShellObject`).
        unsafe { SHCreateShellItemArrayFromIDLists(&item_ids) }
            .map_err(|error| format!("The shell could not group the items: {error}"))
    }

    /// The default menu on the desktop folder for items in different folders. On its own it only
    /// knows the generic entries, so it is given the first item's file associations, which add
    /// that type's verbs and handlers (Open with, Send to, Share, and so on). A mixed selection
    /// gets the first item's type.
    fn menu_across_folders(&self) -> Result<IContextMenu, String> {
        let item_ids = self.item_id_pointers();
        let associations = self.first_item_associations();
        // SAFETY: the item ids are valid absolute id lists owned by `self`. Whether the menu
        // copies them is not verified, so the caller keeps `self` alive as long as the menu (see
        // `ShellObject`). The pointer array itself is only needed during the call, and the shell
        // only reads it, so a pointer from a shared slice is sound. The two interfaces moved into
        // the definition are released right after the call.
        unsafe {
            let desktop = SHGetDesktopFolder()
                .map_err(|error| format!("the desktop folder is unavailable ({error})"))?;
            let definition = DEFCONTEXTMENU {
                hwnd: HWND::default(),
                pcmcb: ManuallyDrop::new(None),
                pidlFolder: std::ptr::null_mut(),
                psf: ManuallyDrop::new(Some(desktop)),
                cidl: item_ids.len() as u32,
                apidl: item_ids.as_ptr() as *mut *mut ITEMIDLIST,
                punkAssociationInfo: ManuallyDrop::new(associations),
                cKeys: 0,
                aKeys: std::ptr::null(),
            };
            let menu = SHCreateDefaultContextMenu::<IContextMenu>(&definition)
                .map_err(|error| format!("the default menu failed ({error})"));
            drop(ManuallyDrop::into_inner(definition.psf));
            drop(ManuallyDrop::into_inner(definition.punkAssociationInfo));
            menu
        }
    }

    /// The file associations of the first item, from its own folder, or None when it has none.
    fn first_item_associations(&self) -> Option<IUnknown> {
        let first = self.item_ids.first()?;
        let mut child: *mut ITEMIDLIST = std::ptr::null_mut();
        // SAFETY: `first` is a valid absolute id list owned by `self`. `child` points inside it
        // and is only used while `first` is alive.
        unsafe {
            let parent: IShellFolder = SHBindToParent(first.as_ptr(), Some(&mut child)).ok()?;
            let associations: IQueryAssociations = parent
                .GetUIObjectOf(HWND::default(), &[child as *const ITEMIDLIST], None)
                .ok()?;
            associations.cast().ok()
        }
    }

    fn item_id_pointers(&self) -> Vec<*const ITEMIDLIST> {
        self.item_ids
            .iter()
            .map(|item_id| item_id.as_ptr() as *const ITEMIDLIST)
            .collect()
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::path::Path;
    use std::sync::{Mutex, MutexGuard};
    use windows::core::HRESULT;
    use windows::Win32::Foundation::S_OK;
    use windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, DVASPECT_CONTENT, FORMATETC,
        TYMED_HGLOBAL,
    };
    use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    use windows::Win32::System::Ole::{ReleaseStgMedium, CF_HDROP};
    use windows::Win32::UI::Shell::{CFSTR_SHELLIDLIST, CMF_NORMAL, DROPFILES};
    use windows::Win32::UI::WindowsAndMessaging::{CreatePopupMenu, DestroyMenu, GetMenuItemCount};

    /// The same cases as `pathKey` in src/lib/fileDrag.test.ts.
    #[test]
    fn duplicate_key_matches_the_pages_path_key() {
        let cases = [
            ("C:/Data/One.TXT", r"c:\data\one.txt"),
            (r"\\?\C:\Data\One.txt", r"c:\data\one.txt"),
            (r"C:\Data\Folder\", r"c:\data\folder"),
            (r"C:\", r"c:\"),
            (r"\\?\UNC\server\share\a.txt", r"\\?\unc\server\share\a.txt"),
            (r"\\server\share\a.txt", r"\\server\share\a.txt"),
        ];
        for (path, key) in cases {
            assert_eq!(duplicate_key(path), key, "{path}");
        }
    }

    /// Held by every test while it has an apartment, so the tests take turns.
    ///
    /// Verified on the development machine: without this, running the context menu tests in
    /// parallel (each in its own apartment, with no freed item ids anywhere) crashed the test
    /// process in 10 of 15 runs, and every crash in the event log was in Beyond Compare's
    /// BCShellEx64.dll (a shell extension the menu loads) or its Delphi exception 0x0eedfade.
    /// With it, 0 of 15. Not verified: why the extension fails, and whether other extensions
    /// would. The app builds its menus on its one window thread, so it never does this.
    static ONE_APARTMENT_AT_A_TIME: Mutex<()> = Mutex::new(());

    /// COM in a single-threaded apartment for the test thread, left again when dropped. Declare it
    /// first so every COM object of the test is released before the apartment closes.
    struct ComApartment {
        _turn: MutexGuard<'static, ()>,
    }
    impl ComApartment {
        fn enter() -> Self {
            let turn = ONE_APARTMENT_AT_A_TIME
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            // SAFETY: plain COM initialization of the current thread, balanced in `drop`.
            let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            assert!(result.is_ok(), "CoInitializeEx failed: {result:?}");
            ComApartment { _turn: turn }
        }
    }
    impl Drop for ComApartment {
        fn drop(&mut self) {
            // SAFETY: balances the successful CoInitializeEx in `enter` on the same thread. The
            // turn is released after this, when the field drops.
            unsafe { CoUninitialize() };
        }
    }

    /// Three files, each in its own folder, under one temporary root.
    fn files_in_three_folders(root: &Path) -> Vec<String> {
        ["alpha", "beta", "gamma"]
            .iter()
            .map(|folder_name| {
                let folder = root.join(folder_name);
                std::fs::create_dir(&folder).unwrap();
                let file = folder.join(format!("{folder_name}.txt"));
                std::fs::write(&file, folder_name.as_bytes()).unwrap();
                file.to_string_lossy().into_owned()
            })
            .collect()
    }

    fn hglobal_format(format_id: u16) -> FORMATETC {
        FORMATETC {
            cfFormat: format_id,
            ptd: std::ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
        }
    }

    /// The file list of the data object's CF_HDROP block, in order.
    fn dropped_file_list(data: &IDataObject) -> Vec<String> {
        let format = hglobal_format(CF_HDROP.0);
        // SAFETY: the medium returned by GetData is ours to release, and is released below after
        // the last read. The block is locked while it is read and every read stays inside the
        // list, which DROPFILES says starts at `pFiles` and ends with an empty string.
        unsafe {
            let mut medium = data.GetData(&format).expect("GetData(CF_HDROP)");
            let block = GlobalLock(medium.u.hGlobal) as *const u8;
            assert!(!block.is_null(), "the CF_HDROP block could not be locked");
            let header = &*(block as *const DROPFILES);
            assert!(header.fWide.as_bool(), "the file list is not UTF-16");
            let mut cursor = block.add(header.pFiles as usize) as *const u16;
            let mut files = Vec::new();
            loop {
                let mut length = 0;
                while *cursor.add(length) != 0 {
                    length += 1;
                }
                if length == 0 {
                    break;
                }
                let name = std::slice::from_raw_parts(cursor, length);
                files.push(String::from_utf16_lossy(name));
                cursor = cursor.add(length + 1);
            }
            let _ = GlobalUnlock(medium.u.hGlobal);
            ReleaseStgMedium(&mut medium);
            files
        }
    }

    fn assert_same_paths(actual: &[String], expected: &[String]) {
        assert_eq!(actual.len(), expected.len(), "{actual:?} vs {expected:?}");
        for (actual_path, expected_path) in actual.iter().zip(expected) {
            assert!(
                actual_path.eq_ignore_ascii_case(expected_path),
                "{actual:?} vs {expected:?}"
            );
        }
    }

    /// Fills a popup menu that is never shown from `menu`, and returns how many entries it got.
    fn filled_entry_count(menu: &IContextMenu) -> i32 {
        // SAFETY: the popup menu is never shown and is destroyed before returning.
        // QueryContextMenu only adds entries to it.
        unsafe {
            let popup = CreatePopupMenu().expect("CreatePopupMenu");
            let filled: HRESULT = menu.QueryContextMenu(popup, 0, 1, 0x7FFF, CMF_NORMAL);
            let entries = GetMenuItemCount(Some(popup));
            let _ = DestroyMenu(popup);
            assert!(filled.is_ok(), "QueryContextMenu failed: {filled:?}");
            entries
        }
    }

    #[test]
    fn parse_paths_skips_a_missing_path_and_reports_it() {
        let _com = ComApartment::enter();
        let root = tempfile::tempdir().unwrap();
        let mut paths = files_in_three_folders(root.path());
        let missing = root.path().join("alpha").join("gone.txt");
        let missing = missing.to_string_lossy().into_owned();
        paths.insert(1, missing.clone());

        let parsed = parse_paths(&paths).expect("three paths exist");
        assert_eq!(parsed.skipped, vec![missing.clone()]);
        assert_eq!(parsed.item_ids.len(), 3);
        let data = parsed.data_object().unwrap();
        assert_eq!(data.skipped(), [missing]);
    }

    #[test]
    fn parse_paths_fails_when_nothing_is_left() {
        let _com = ComApartment::enter();
        let root = tempfile::tempdir().unwrap();
        let missing = root.path().join("gone.txt").to_string_lossy().into_owned();

        let error = parse_paths(&[missing]).err().expect("nothing exists");
        assert!(error.contains("exist"), "unexpected message: {error}");
    }

    #[test]
    fn parse_paths_refuses_an_empty_request_with_its_own_message() {
        let _com = ComApartment::enter();
        let error = parse_paths(&[]).err().expect("nothing was asked for");
        assert!(error.contains("No items"), "unexpected message: {error}");
    }

    #[test]
    fn parse_paths_drops_repeated_paths_keeping_the_first_order() {
        let _com = ComApartment::enter();
        let root = tempfile::tempdir().unwrap();
        let paths = files_in_three_folders(root.path());
        let first_again = paths[0].to_uppercase().replace('\\', "/");
        let requested = vec![
            paths[0].clone(),
            paths[1].clone(),
            first_again,
            paths[1].clone(),
        ];

        let parsed = parse_paths(&requested).unwrap();
        assert!(parsed.skipped.is_empty(), "{:?}", parsed.skipped);
        let data = parsed.data_object().unwrap();
        assert_same_paths(&dropped_file_list(data.object()), &paths[..2]);
    }

    #[test]
    fn parse_paths_refuses_more_than_the_limit_before_parsing_any() {
        let _com = ComApartment::enter();
        // These do not exist. Parsing them would skip them all and fail with a different message,
        // so the message shows the count was checked first.
        let too_many: Vec<String> = (0..=MAX_ITEMS)
            .map(|index| format!(r"Z:\spelunker-no-such-folder\file-{index}.txt"))
            .collect();

        let error = parse_paths(&too_many).err().expect("over the limit");
        assert!(error.contains("5000"), "unexpected message: {error}");
    }

    #[test]
    fn parse_paths_accepts_exactly_the_limit() {
        let _com = ComApartment::enter();
        let root = tempfile::tempdir().unwrap();
        let mut paths: Vec<String> = (1..MAX_ITEMS)
            .map(|index| {
                let missing = root.path().join(format!("gone-{index}.txt"));
                missing.to_string_lossy().into_owned()
            })
            .collect();
        let existing = root.path().join("here.txt");
        std::fs::write(&existing, b"here").unwrap();
        paths.push(existing.to_string_lossy().into_owned());
        assert_eq!(paths.len(), MAX_ITEMS);

        let parsed = parse_paths(&paths).expect("one path exists");
        assert_eq!(parsed.item_ids.len(), 1);
        assert_eq!(parsed.skipped.len(), MAX_ITEMS - 1);
    }

    #[test]
    fn the_data_object_offers_every_file_in_order_across_folders() {
        let _com = ComApartment::enter();
        let root = tempfile::tempdir().unwrap();
        let paths = files_in_three_folders(root.path());

        let data = parse_paths(&paths).unwrap().data_object().unwrap();
        let data = data.object();
        // SAFETY: plain COM calls on a valid interface with formats that live across the calls.
        unsafe {
            let drop_format = hglobal_format(CF_HDROP.0);
            assert_eq!(data.QueryGetData(&drop_format), S_OK, "CF_HDROP");
            let id_list_format = hglobal_format(RegisterClipboardFormatW(CFSTR_SHELLIDLIST) as u16);
            assert_eq!(
                data.QueryGetData(&id_list_format),
                S_OK,
                "Shell IDList Array"
            );
        }
        assert_same_paths(&dropped_file_list(data), &paths);
    }

    #[test]
    fn the_context_menu_fills_a_popup_menu_in_one_folder() {
        let _com = ComApartment::enter();
        let root = tempfile::tempdir().unwrap();
        let paths: Vec<String> = ["one.txt", "two.txt"]
            .iter()
            .map(|name| {
                let file = root.path().join(name);
                std::fs::write(&file, name.as_bytes()).unwrap();
                file.to_string_lossy().into_owned()
            })
            .collect();

        let menu = parse_paths(&paths).unwrap().context_menu().unwrap();
        assert!(
            filled_entry_count(menu.object()) > 0,
            "the menu has no entries"
        );
    }

    #[test]
    fn the_context_menu_fills_a_popup_menu_across_folders() {
        let _com = ComApartment::enter();
        let root = tempfile::tempdir().unwrap();
        let paths = files_in_three_folders(root.path());

        let menu = parse_paths(&paths).unwrap().context_menu().unwrap();
        assert!(
            filled_entry_count(menu.object()) > 0,
            "the menu has no entries"
        );
    }
}
