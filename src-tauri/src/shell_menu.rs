//! The Windows Explorer context menu for a file or folder, shown at a screen position.
//!
//! The shell builds the real menu (Open with, Send to, Share, antivirus and archive entries, and
//! so on). A few entries of our own are put above it. Everything here must run on the thread that
//! owns the window, because the menu is modal and the shell talks to that window's message loop.

use crate::shell_items::{wide, ItemIdList};
use std::sync::atomic::{AtomicBool, Ordering};
use windows::core::{Interface, PCSTR, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    DefSubclassProc, IContextMenu, IContextMenu2, IContextMenu3, IShellFolder,
    RemoveWindowSubclass, SHBindToParent, SHParseDisplayName, SetWindowSubclass, CMF_NORMAL,
    CMINVOKECOMMANDINFO,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreatePopupMenu, DestroyMenu, InsertMenuW, SetForegroundWindow, TrackPopupMenuEx, HMENU,
    MF_BYPOSITION, MF_SEPARATOR, MF_STRING, SW_SHOWNORMAL, TPM_RETURNCMD, TPM_RIGHTBUTTON,
    WM_DRAWITEM, WM_INITMENUPOPUP, WM_MEASUREITEM, WM_MENUCHAR,
};

/// First command id the shell may use, and the last. Our own entries live above this range.
const SHELL_FIRST_ID: u32 = 1;
const SHELL_LAST_ID: u32 = 0x7FFF;
const EXTRA_FIRST_ID: u32 = 0x8000;
const SUBCLASS_ID: usize = 0x5350_4C4B;

/// An entry of our own shown above the shell's, identified by a position in the list given.
pub struct ExtraItem {
    pub label: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// The user chose our entry at this index.
    Extra(usize),
    /// The shell ran the chosen command itself.
    ShellCommand,
    Dismissed,
}

/// The shell sends these to the owner window while its menu is open, and expects them forwarded.
struct MenuHandlers {
    menu2: Option<IContextMenu2>,
    menu3: Option<IContextMenu3>,
}

unsafe extern "system" fn forward_menu_messages(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    handlers_address: usize,
) -> LRESULT {
    if matches!(
        message,
        WM_INITMENUPOPUP | WM_DRAWITEM | WM_MEASUREITEM | WM_MENUCHAR
    ) {
        // SAFETY: the address is of a `MenuHandlers` that outlives the subclass (see `show`).
        let handlers = unsafe { &*(handlers_address as *const MenuHandlers) };
        if let Some(menu3) = &handlers.menu3 {
            let mut result = LRESULT(0);
            if unsafe { menu3.HandleMenuMsg2(message, wparam, lparam, Some(&mut result)) }.is_ok() {
                return result;
            }
        } else if let Some(menu2) = &handlers.menu2 {
            if unsafe { menu2.HandleMenuMsg(message, wparam, lparam) }.is_ok() {
                return LRESULT(0);
            }
        }
    }
    unsafe { DefSubclassProc(window, message, wparam, lparam) }
}

struct Menu(HMENU);
impl Drop for Menu {
    fn drop(&mut self) {
        // SAFETY: created by CreatePopupMenu in `show`.
        let _ = unsafe { DestroyMenu(self.0) };
    }
}

/// True while a menu is open. The menu is modal, but the webview can still deliver another request
/// meanwhile, and a second menu would take over the first one's message forwarding.
static MENU_OPEN: AtomicBool = AtomicBool::new(false);

struct OpenGuard;
impl Drop for OpenGuard {
    fn drop(&mut self) {
        MENU_OPEN.store(false, Ordering::SeqCst);
    }
}

/// Shows the shell menu for `path` at the screen position (`x`, `y`) and carries out the choice.
pub fn show(
    window: HWND,
    path: &str,
    x: i32,
    y: i32,
    extras: &[ExtraItem],
) -> Result<Outcome, String> {
    if MENU_OPEN.swap(true, Ordering::SeqCst) {
        return Ok(Outcome::Dismissed);
    }
    let _open = OpenGuard;
    let failed = |step: &str, error: windows::core::Error| format!("{step}: {error}");
    // SAFETY: plain COM and Win32 calls on the window's own thread, which the windowing library
    // has already set up for COM. Every pointer handed to the shell stays alive until the menu
    // closes, and the subclass is removed before they are freed.
    unsafe {
        let wide_path = wide(path);
        let mut absolute = std::ptr::null_mut();
        SHParseDisplayName(PCWSTR(wide_path.as_ptr()), None, &mut absolute, 0, None)
            .map_err(|error| failed("The shell does not know this path", error))?;
        let absolute = ItemIdList::from_raw(absolute);

        let mut child: *mut ITEMIDLIST = std::ptr::null_mut();
        let folder: IShellFolder = SHBindToParent(absolute.as_ptr(), Some(&mut child))
            .map_err(|error| failed("Could not find the containing folder", error))?;
        let menu: IContextMenu = folder
            .GetUIObjectOf(window, &[child as *const ITEMIDLIST], None)
            .map_err(|error| failed("The shell has no menu for this item", error))?;

        let popup =
            Menu(CreatePopupMenu().map_err(|error| failed("Could not create a menu", error))?);
        menu.QueryContextMenu(popup.0, 0, SHELL_FIRST_ID, SHELL_LAST_ID, CMF_NORMAL)
            .ok()
            .map_err(|error| failed("The shell could not fill the menu", error))?;

        // Our entries go on top, followed by a separator, in the order they were given.
        for (position, item) in extras.iter().enumerate() {
            let label = wide(&item.label);
            let _ = InsertMenuW(
                popup.0,
                position as u32,
                MF_BYPOSITION | MF_STRING,
                (EXTRA_FIRST_ID as usize) + position,
                PCWSTR(label.as_ptr()),
            );
        }
        if !extras.is_empty() {
            let _ = InsertMenuW(
                popup.0,
                extras.len() as u32,
                MF_BYPOSITION | MF_SEPARATOR,
                0,
                PCWSTR::null(),
            );
        }

        let handlers = Box::new(MenuHandlers {
            menu2: menu.cast::<IContextMenu2>().ok(),
            menu3: menu.cast::<IContextMenu3>().ok(),
        });
        let handlers_address = &*handlers as *const MenuHandlers as usize;
        let subclassed = SetWindowSubclass(
            window,
            Some(forward_menu_messages),
            SUBCLASS_ID,
            handlers_address,
        )
        .as_bool();

        // Without this the menu would not close when the user clicks elsewhere.
        let _ = SetForegroundWindow(window);
        let chosen = TrackPopupMenuEx(
            popup.0,
            (TPM_RETURNCMD | TPM_RIGHTBUTTON).0,
            x,
            y,
            window,
            None,
        )
        .0 as u32;

        if subclassed {
            let _ = RemoveWindowSubclass(window, Some(forward_menu_messages), SUBCLASS_ID);
        }
        drop(handlers);

        if chosen == 0 {
            return Ok(Outcome::Dismissed);
        }
        if chosen >= EXTRA_FIRST_ID {
            return Ok(Outcome::Extra((chosen - EXTRA_FIRST_ID) as usize));
        }

        let invoke = CMINVOKECOMMANDINFO {
            cbSize: std::mem::size_of::<CMINVOKECOMMANDINFO>() as u32,
            hwnd: window,
            // The shell takes a command offset in the verb's place when the high word is zero.
            lpVerb: PCSTR((chosen - SHELL_FIRST_ID) as usize as *const u8),
            nShow: SW_SHOWNORMAL.0,
            ..Default::default()
        };
        menu.InvokeCommand(&invoke)
            .map_err(|error| failed("The command failed", error))?;
        Ok(Outcome::ShellCommand)
    }
}

/// Converts a point in the window's client area (physical pixels) to the screen.
pub fn client_to_screen(window: HWND, x: i32, y: i32) -> (i32, i32) {
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    let mut point = POINT { x, y };
    // SAFETY: `point` is a valid, writable POINT.
    let _ = unsafe { ClientToScreen(window, &mut point) };
    (point.x, point.y)
}
