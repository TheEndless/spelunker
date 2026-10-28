//! The Windows Explorer context menu for one or many files and folders, shown at a screen position.
//!
//! The shell builds the real menu (Open with, Send to, Share, antivirus and archive entries, and
//! so on). A few entries of our own are put above it. Everything here must run on the thread that
//! owns the window, because the menu is modal and the shell talks to that window's message loop.

use crate::modal_guard;
use crate::shell_items::{parse_paths, wide};
use windows::core::{Interface, PCSTR, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_SHIFT};
use windows::Win32::UI::Shell::{
    DefSubclassProc, IContextMenu, IContextMenu2, IContextMenu3, RemoveWindowSubclass,
    SetWindowSubclass, CMF_NORMAL, CMIC_MASK_CONTROL_DOWN, CMIC_MASK_PTINVOKE,
    CMIC_MASK_SHIFT_DOWN, CMINVOKECOMMANDINFO, CMINVOKECOMMANDINFOEX, SEE_MASK_UNICODE,
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

/// `CMIC_MASK_UNICODE` is defined in the Windows headers as `SEE_MASK_UNICODE`, and the windows
/// crate only exports the latter.
const CMIC_MASK_UNICODE: u32 = SEE_MASK_UNICODE;

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

/// What happened, and which of the requested paths the shell no longer knew (so the menu left
/// them out).
pub struct MenuChoice {
    pub outcome: Outcome,
    pub skipped: Vec<String>,
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

/// Shows the shell menu for `paths` at the screen position (`x`, `y`) and carries out the choice.
///
/// Paths that no longer exist are left out and reported in `skipped`. Fails with a message for the
/// user when none of them exist. While another menu or a drag is open, nothing is shown and the
/// request counts as dismissed.
pub fn show(
    window: HWND,
    paths: &[String],
    x: i32,
    y: i32,
    extras: &[ExtraItem],
) -> Result<MenuChoice, String> {
    let Some(_modal) = modal_guard::try_enter() else {
        return Ok(MenuChoice {
            outcome: Outcome::Dismissed,
            skipped: Vec::new(),
        });
    };
    // The wrapper owns the item ids the menu was made from. It is declared before everything that
    // uses the menu, so it is dropped last: after InvokeCommand has returned and after every
    // interface taken from the menu (and the message forwarding that uses them) is gone.
    let shell_menu = parse_paths(paths)?.context_menu()?;
    let outcome = run_menu(window, shell_menu.object(), x, y, extras)?;
    Ok(MenuChoice {
        outcome,
        skipped: shell_menu.skipped().to_vec(),
    })
}

fn run_menu(
    window: HWND,
    menu: &IContextMenu,
    x: i32,
    y: i32,
    extras: &[ExtraItem],
) -> Result<Outcome, String> {
    let failed = |step: &str, error: windows::core::Error| format!("{step}: {error}");
    // SAFETY: plain COM and Win32 calls on the window's own thread, which the windowing library
    // has already set up for COM. The menu object and the item ids behind it are kept alive by the
    // caller until this returns. The handlers box outlives the subclass that reads it, because the
    // subclass is removed before the box is dropped. The labels outlive their InsertMenuW calls.
    unsafe {
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

        // The keys as they were when the menu entry was chosen (the thread's own key state, not
        // the live keyboard), so holding Shift while choosing Delete skips the recycle bin.
        let control_down = GetKeyState(i32::from(VK_CONTROL.0)) < 0;
        let shift_down = GetKeyState(i32::from(VK_SHIFT.0)) < 0;
        // The shell takes a command offset in the verb's place when the high word is zero. It is
        // given in both the narrow and the wide verb, since the request says it is a wide one.
        let offset = (chosen - SHELL_FIRST_ID) as usize;
        let invoke = CMINVOKECOMMANDINFOEX {
            cbSize: std::mem::size_of::<CMINVOKECOMMANDINFOEX>() as u32,
            fMask: invoke_flags(control_down, shift_down),
            hwnd: window,
            lpVerb: PCSTR(offset as *const u8),
            lpVerbW: PCWSTR(offset as *const u16),
            nShow: SW_SHOWNORMAL.0,
            ptInvoke: POINT { x, y },
            ..Default::default()
        };
        // InvokeCommand is declared with the plain request. The extended one begins with the same
        // fields in the same places (checked by a test below), and its `cbSize` tells the shell
        // which of the two it was given.
        menu.InvokeCommand(&invoke as *const CMINVOKECOMMANDINFOEX as *const CMINVOKECOMMANDINFO)
            .map_err(|error| failed("The command failed", error))?;
        Ok(Outcome::ShellCommand)
    }
}

/// The `fMask` of the invoke request: the wide verb and the click point are filled in, and the
/// Ctrl and Shift keys that are down are passed on, so Shift+Delete deletes without the recycle bin.
fn invoke_flags(control_down: bool, shift_down: bool) -> u32 {
    let mut flags = CMIC_MASK_UNICODE | CMIC_MASK_PTINVOKE;
    if control_down {
        flags |= CMIC_MASK_CONTROL_DOWN;
    }
    if shift_down {
        flags |= CMIC_MASK_SHIFT_DOWN;
    }
    flags
}

/// Converts a point in the window's client area (physical pixels) to the screen.
pub fn client_to_screen(window: HWND, x: i32, y: i32) -> (i32, i32) {
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    let mut point = POINT { x, y };
    // SAFETY: `point` is a valid, writable POINT.
    let _ = unsafe { ClientToScreen(window, &mut point) };
    (point.x, point.y)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::offset_of;

    const ALWAYS: u32 = CMIC_MASK_UNICODE | CMIC_MASK_PTINVOKE;

    #[test]
    fn invoke_flags_name_the_wide_verb_and_the_click_point_with_no_keys_down() {
        assert_eq!(invoke_flags(false, false), ALWAYS);
    }

    #[test]
    fn invoke_flags_pass_on_ctrl() {
        assert_eq!(invoke_flags(true, false), ALWAYS | CMIC_MASK_CONTROL_DOWN);
    }

    #[test]
    fn invoke_flags_pass_on_shift() {
        assert_eq!(invoke_flags(false, true), ALWAYS | CMIC_MASK_SHIFT_DOWN);
    }

    #[test]
    fn invoke_flags_pass_on_ctrl_and_shift_together() {
        assert_eq!(
            invoke_flags(true, true),
            ALWAYS | CMIC_MASK_CONTROL_DOWN | CMIC_MASK_SHIFT_DOWN
        );
    }

    #[test]
    fn the_unicode_flag_has_the_documented_value() {
        assert_eq!(CMIC_MASK_UNICODE, 0x0000_4000);
    }

    /// The cast in `run_menu` relies on this.
    #[test]
    fn the_extended_invoke_request_begins_like_the_plain_one() {
        type Plain = CMINVOKECOMMANDINFO;
        type Extended = CMINVOKECOMMANDINFOEX;
        assert_eq!(offset_of!(Plain, cbSize), offset_of!(Extended, cbSize));
        assert_eq!(offset_of!(Plain, fMask), offset_of!(Extended, fMask));
        assert_eq!(offset_of!(Plain, hwnd), offset_of!(Extended, hwnd));
        assert_eq!(offset_of!(Plain, lpVerb), offset_of!(Extended, lpVerb));
        assert_eq!(
            offset_of!(Plain, lpParameters),
            offset_of!(Extended, lpParameters)
        );
        assert_eq!(
            offset_of!(Plain, lpDirectory),
            offset_of!(Extended, lpDirectory)
        );
        assert_eq!(offset_of!(Plain, nShow), offset_of!(Extended, nShow));
        assert_eq!(offset_of!(Plain, dwHotKey), offset_of!(Extended, dwHotKey));
        assert_eq!(offset_of!(Plain, hIcon), offset_of!(Extended, hIcon));
        assert!(std::mem::size_of::<Extended>() > std::mem::size_of::<Plain>());
    }
}
