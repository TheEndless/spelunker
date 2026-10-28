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
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Ole::{
    IDropSource, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_MOVE,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
use windows::Win32::UI::Shell::SHDoDragDrop;
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON};

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

/// Whether the physical primary mouse button is held right now.
fn primary_button_down() -> bool {
    // SAFETY: plain reads of the input state and a system setting, with no pointers involved. The
    // high bit of GetAsyncKeyState (a negative value) means the button is down now.
    let (left_down, right_down, buttons_swapped) = unsafe {
        (
            GetAsyncKeyState(i32::from(VK_LBUTTON.0)) < 0,
            GetAsyncKeyState(i32::from(VK_RBUTTON.0)) < 0,
            GetSystemMetrics(SM_SWAPBUTTON) != 0,
        )
    };
    button_allows_drag(left_down, right_down, buttons_swapped)
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
/// Refused, without touching anything, while another menu or drag is open, and when the physical
/// primary button is not down. The second check matters: a drag that starts with the button
/// already released does not end empty, it DROPS at once onto whatever is under the real cursor.
/// It also means synthetic input that presses no physical button (a script driving the page) can
/// never start one. Fails with a message when the paths cannot be packaged (none exist, too many).
pub fn start(hwnd: HWND, paths: &[String]) -> Result<DragOutcome, String> {
    let Some(_guard) = modal_guard::try_enter() else {
        return Ok(DragOutcome::refused(
            "A menu or another drag is still open.",
        ));
    };
    if !primary_button_down() {
        return Ok(DragOutcome::refused(
            "The mouse button was released before the drag could start.",
        ));
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
    let allowed = DROPEFFECT(DROPEFFECT_COPY.0 | DROPEFFECT_MOVE.0 | DROPEFFECT_LINK.0);
    // SAFETY: `hwnd` is this window and the call is on its thread, which has OLE initialized (see
    // the module doc). The data object is alive for the whole call. A null drop source is
    // documented for SHDoDragDrop: the shell then uses its default one, which follows the mouse
    // buttons and Escape and shows the shell's drag image. `None` is passed as a null pointer.
    let effect = unsafe { SHDoDragDrop(Some(hwnd), data.object(), None::<&IDropSource>, allowed) }
        .map_err(|error| format!("The drag could not start: {error}"))?;
    let skipped = data.skipped().to_vec();
    drop(data);
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
    fn both_buttons_up_refuses_a_drag_either_way() {
        assert!(!button_allows_drag(false, false, false));
        assert!(!button_allows_drag(false, false, true));
    }
}
