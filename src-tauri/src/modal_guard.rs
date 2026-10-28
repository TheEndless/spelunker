//! One guard for the app's modal loops: the system menu and the native drag.
//!
//! Both loops run on the window thread, and the webview is still served while either one is open,
//! so the page can ask for another menu or drag meanwhile. A second loop would take over the
//! first one's message forwarding (or start a menu inside a drag), so it is refused instead.

use std::sync::atomic::{AtomicBool, Ordering};

/// True while a modal loop is open.
static MODAL_LOOP_OPEN: AtomicBool = AtomicBool::new(false);

/// Held while a modal loop is open. Dropping it lets the next one in.
pub struct ModalGuard {
    flag: &'static AtomicBool,
}

impl Drop for ModalGuard {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::SeqCst);
    }
}

/// The guard for a new modal loop, or None while another one is open.
pub fn try_enter() -> Option<ModalGuard> {
    try_enter_flag(&MODAL_LOOP_OPEN)
}

fn try_enter_flag(flag: &'static AtomicBool) -> Option<ModalGuard> {
    if flag.swap(true, Ordering::SeqCst) {
        None
    } else {
        Some(ModalGuard { flag })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_enter_is_refused_while_the_first_guard_is_held() {
        static FLAG: AtomicBool = AtomicBool::new(false);
        let first = try_enter_flag(&FLAG);
        assert!(first.is_some(), "the first enter is allowed");
        assert!(
            try_enter_flag(&FLAG).is_none(),
            "the second enter is refused"
        );
        drop(first);
    }

    #[test]
    fn enter_is_allowed_again_after_the_guard_drops() {
        static FLAG: AtomicBool = AtomicBool::new(false);
        drop(try_enter_flag(&FLAG).expect("the first enter is allowed"));
        assert!(
            try_enter_flag(&FLAG).is_some(),
            "allowed again after the drop"
        );
    }

    /// The only test that uses the shared flag, so no other test can hold it meanwhile.
    #[test]
    fn the_shared_guard_refuses_a_second_loop_until_the_first_ends() {
        let menu = try_enter().expect("nothing else is open");
        assert!(try_enter().is_none(), "a drag inside the menu is refused");
        drop(menu);
        assert!(try_enter().is_some(), "allowed again after the menu closed");
    }
}
