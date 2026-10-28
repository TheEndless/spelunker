//! The native drag of result files out of the window.
//!
//! The page decides when a press on a row has become a drag and asks for it while the button is
//! still held. The drag itself is the shell's: `SHDoDragDrop` with the shell's own data object
//! (CF_HDROP and the shell formats, see `shell_items`) and no drop source of ours, so the shell
//! supplies its default drop source and its drag image (the file icons and a count).
//!
//! OLE drag and drop needs OLE initialized on the window thread. The windowing library does that
//! only while its own drag and drop support is on (`dragDropEnabled` on the main window in
//! tauri.conf.json, which also feeds the page's folder drops). It must stay on, or every drag
//! fails with an error instead of starting.

use crate::modal_guard;
use crate::shell_items::parse_paths;
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::System::Ole::{
    IDropSource, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_MOVE,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
use windows::Win32::UI::Shell::SHDoDragDrop;
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetCursorPos, GetForegroundWindow, GetSystemMetrics, WindowFromPoint, GA_ROOT,
    SM_SWAPBUTTON,
};

/// How a drag ended, for the page.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DragOutcome {
    /// False when the drag was refused before it began (see `reason`).
    pub started: bool,
    /// What the drop target reported: "none", "copy", "move" or "link". An optimized move within
    /// one volume and a move the target finishes later both report "none", so the page checks
    /// which files are gone instead of trusting this.
    pub effect: String,
    /// The requested paths the shell no longer knew, which the drag left out.
    pub skipped: Vec<String>,
    /// Why the drag was refused, for the user. Absent when it started.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl DragOutcome {
    fn refused(reason: &str) -> Self {
        DragOutcome {
            started: false,
            effect: "none".to_string(),
            skipped: Vec::new(),
            reason: Some(reason.to_string()),
        }
    }
}

/// Whether the physical button state allows a drag to start: the primary button must be down.
/// `GetAsyncKeyState` reports the physical buttons, so with the buttons swapped in the mouse
/// settings the primary button is the physical right one.
pub fn button_allows_drag(left_down: bool, right_down: bool, buttons_swapped: bool) -> bool {
    if buttons_swapped {
        right_down
    } else {
        left_down
    }
}

/// Why the input state does not allow a drag to start.
#[derive(Debug, PartialEq, Eq)]
pub enum DragRefusal {
    ButtonUp,
    WindowNotForeground,
    PointerNotOverWindow,
}

impl DragRefusal {
    /// The short reason the page shows.
    fn reason(&self) -> &'static str {
        match self {
            DragRefusal::ButtonUp => "The mouse button was released before the drag could start.",
            DragRefusal::WindowNotForeground => {
                "The drag did not start because Spelunker is not the active window."
            }
            DragRefusal::PointerNotOverWindow => {
                "The drag did not start because the pointer is not over the Spelunker window."
            }
        }
    }
}

/// Whether the input state allows a drag to start. The physical primary button must be down. The
/// button state is global, so a button held in another program would pass that test alone. The
/// window must therefore also be the foreground window (a real press on a row activates it) and
/// the window under the pointer must be ours (not merely the cursor inside our rectangle, which a
/// topmost window can cover).
pub fn drag_may_start(
    left_down: bool,
    right_down: bool,
    buttons_swapped: bool,
    window_is_foreground: bool,
    pointer_over_our_window: bool,
) -> Result<(), DragRefusal> {
    if !button_allows_drag(left_down, right_down, buttons_swapped) {
        Err(DragRefusal::ButtonUp)
    } else if !window_is_foreground {
        Err(DragRefusal::WindowNotForeground)
    } else if !pointer_over_our_window {
        Err(DragRefusal::PointerNotOverWindow)
    } else {
        Ok(())
    }
}

/// Whether `root_under_pointer` (the top-level window under the cursor) is our window. A null
/// handle on either side, which is what a failed lookup gives, never counts as ours.
fn is_our_window(root_under_pointer: HWND, ours: HWND) -> bool {
    !ours.is_invalid() && root_under_pointer == ours
}

/// Reads the live input state for `hwnd` and checks it with `drag_may_start`. The one place both
/// checks in `start` go through, so they cannot drift apart. A failed read counts against the drag.
///
/// The pointer test asks which top-level window is under the cursor rather than whether the cursor
/// lies in our rectangle, so a topmost window over Spelunker counts as not ours. Then a release in
/// the last instant before the drag starts drops on our own drop target, whose events for these
/// files the page ignores, and never on another program.
fn live_input_refusal(hwnd: HWND) -> Option<DragRefusal> {
    // SAFETY: plain reads of the input state, a system setting and window state. The out pointer
    // points at a local that lives across the call. The high bit of GetAsyncKeyState (a negative
    // value) means the button is down now. WindowFromPoint and GetAncestor return a null handle
    // on failure, which `is_our_window` refuses.
    let (left_down, right_down, buttons_swapped, window_is_foreground, pointer_over_our_window) = unsafe {
        let mut cursor = POINT::default();
        let pointer_over_our_window = GetCursorPos(&mut cursor).is_ok()
            && is_our_window(GetAncestor(WindowFromPoint(cursor), GA_ROOT), hwnd);
        (
            GetAsyncKeyState(i32::from(VK_LBUTTON.0)) < 0,
            GetAsyncKeyState(i32::from(VK_RBUTTON.0)) < 0,
            GetSystemMetrics(SM_SWAPBUTTON) != 0,
            GetForegroundWindow() == hwnd,
            pointer_over_our_window,
        )
    };
    drag_may_start(
        left_down,
        right_down,
        buttons_swapped,
        window_is_foreground,
        pointer_over_our_window,
    )
    .err()
}

fn effect_name(effect: DROPEFFECT) -> &'static str {
    if effect.0 & DROPEFFECT_MOVE.0 != 0 {
        "move"
    } else if effect.0 & DROPEFFECT_COPY.0 != 0 {
        "copy"
    } else if effect.0 & DROPEFFECT_LINK.0 != 0 {
        "link"
    } else {
        "none"
    }
}

/// Drags `paths` out of the window `hwnd` and returns when the drag has ended. Runs on the window
/// thread, inside its OLE apartment, and blocks it for the whole drag (OLE runs its own loop).
///
/// Refused while another menu or drag is open, and whenever `live_input_refusal` objects: the
/// physical primary button is not down, the window is not the foreground window, or the top-level
/// window under the pointer is not this one. These matter: a drag that starts with the button already released does not end
/// empty, it DROPS at once onto whatever is under the real cursor. They also mean synthetic input
/// that presses no physical button (a script driving the page) can never start one, and neither
/// can a script while the user holds a button in another program.
///
/// The input is checked TWICE. Once before the paths are parsed, so a refused drag never touches
/// the disk. Again after the data object is built and right before SHDoDragDrop, because parsing
/// up to 5,000 paths can stall on an offline share and the user may release meanwhile. Fails with
/// a message when the paths cannot be packaged (none exist, too many).
pub fn start(hwnd: HWND, paths: &[String]) -> Result<DragOutcome, String> {
    let Some(_guard) = modal_guard::try_enter() else {
        return Ok(DragOutcome::refused(
            "A menu or another drag is still open.",
        ));
    };
    if let Some(refusal) = live_input_refusal(hwnd) {
        return Ok(DragOutcome::refused(refusal.reason()));
    }
    // Made here, on the window thread, and kept in this local until the drag has ended: the
    // wrapper owns the item ids the data object was built from and frees them only after the
    // object is released (see `ShellObject`). The interface is lent to the call, never cloned out.
    //
    // A drop target (or the clipboard, if a target puts the data there) may keep its own
    // reference to the data object after SHDoDragDrop returns. The ids are freed when this
    // wrapper drops, so that reference must not depend on them. The object comes from the shell
    // item array, which most likely copied the ids when it was created. That is INFERRED from how
    // the shell builds item arrays and is not verified.
    let data = parse_paths(paths)?.data_object()?;
    // Parsing touched the disk and may have taken long. Nothing may run between this check and
    // the drag call.
    if let Some(refusal) = live_input_refusal(hwnd) {
        return Ok(DragOutcome::refused(refusal.reason()));
    }
    let allowed = DROPEFFECT(DROPEFFECT_COPY.0 | DROPEFFECT_MOVE.0 | DROPEFFECT_LINK.0);
    // SAFETY: `hwnd` is this window and the call is on its thread, which has OLE initialized (see
    // the module doc). The data object is alive for the whole call. A null drop source is
    // documented for SHDoDragDrop: the shell then uses its default one, which follows the mouse
    // buttons and Escape and shows the shell's drag image. `None` is passed as a null pointer.
    let effect = unsafe { SHDoDragDrop(Some(hwnd), data.object(), None::<&IDropSource>, allowed) }
        .map_err(|error| format!("The drag could not start: {error}"))?;
    let skipped = data.skipped().to_vec();
    drop(data);
    // A drag cancelled with Escape also ends here, as started with no effect, so the page runs its
    // check for gone rows after a cancel too. That check only removes rows of files confirmed gone.
    Ok(DragOutcome {
        started: true,
        effect: effect_name(effect).to_string(),
        skipped,
        reason: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_left_button_down_allows_a_drag() {
        assert!(button_allows_drag(true, false, false));
    }

    #[test]
    fn the_left_button_up_refuses_a_drag() {
        assert!(!button_allows_drag(false, false, false));
        assert!(
            !button_allows_drag(false, true, false),
            "the right button alone is not the primary one"
        );
    }

    #[test]
    fn swapped_buttons_make_the_right_button_the_primary_one() {
        assert!(button_allows_drag(false, true, true));
        assert!(
            !button_allows_drag(true, false, true),
            "the left button alone is not the primary one when swapped"
        );
    }

    #[test]
    fn a_held_primary_button_in_the_foreground_window_with_the_pointer_over_it_may_drag() {
        assert_eq!(drag_may_start(true, false, false, true, true), Ok(()));
        assert_eq!(drag_may_start(false, true, true, true, true), Ok(()));
    }

    #[test]
    fn a_released_button_is_refused_whatever_else_holds() {
        assert_eq!(
            drag_may_start(false, false, false, true, true),
            Err(DragRefusal::ButtonUp)
        );
        assert_eq!(
            drag_may_start(true, false, true, true, true),
            Err(DragRefusal::ButtonUp),
            "the left button is not the primary one when swapped"
        );
    }

    #[test]
    fn a_window_that_is_not_the_foreground_window_is_refused() {
        assert_eq!(
            drag_may_start(true, false, false, false, true),
            Err(DragRefusal::WindowNotForeground)
        );
    }

    #[test]
    fn a_pointer_not_over_our_window_is_refused() {
        assert_eq!(
            drag_may_start(true, false, false, true, false),
            Err(DragRefusal::PointerNotOverWindow)
        );
    }

    #[test]
    fn each_refusal_has_its_own_reason() {
        let reasons = [
            DragRefusal::ButtonUp.reason(),
            DragRefusal::WindowNotForeground.reason(),
            DragRefusal::PointerNotOverWindow.reason(),
        ];
        assert_ne!(reasons[0], reasons[1]);
        assert_ne!(reasons[1], reasons[2]);
        assert_ne!(reasons[0], reasons[2]);
    }

    #[test]
    fn only_our_own_root_window_counts_and_a_failed_lookup_never_does() {
        let ours = HWND(0x1234 as *mut core::ffi::c_void);
        let other = HWND(0x5678 as *mut core::ffi::c_void);
        let failed = HWND(std::ptr::null_mut());
        assert!(is_our_window(ours, ours));
        assert!(!is_our_window(other, ours), "a window over ours");
        assert!(!is_our_window(failed, ours), "a failed lookup");
        assert!(!is_our_window(failed, failed), "no window of ours at all");
    }

    #[test]
    fn both_buttons_up_refuses_a_drag_either_way() {
        assert!(!button_allows_drag(false, false, false));
        assert!(!button_allows_drag(false, false, true));
    }
}
