//! Dates the way Windows shows them. The web view formats dates by its own language, which is not
//! the user's regional settings (a custom short date, a 24-hour clock, and so on). Windows formats
//! them in Explorer from those settings, and asking Windows to do the same here makes the Modified
//! column read exactly like Explorer's.

use windows_sys::Win32::Foundation::{FILETIME, SYSTEMTIME};
use windows_sys::Win32::Globalization::{
    GetDateFormatEx, GetTimeFormatEx, DATE_SHORTDATE, TIME_NOSECONDS,
};
use windows_sys::Win32::System::Time::{FileTimeToSystemTime, SystemTimeToTzSpecificLocalTime};

/// Ticks of 100 nanoseconds between 1601 (where Windows file times start) and 1970 (Unix time).
const UNIX_EPOCH_IN_FILETIME_TICKS: u64 = 116_444_736_000_000_000;
const TICKS_PER_MILLISECOND: u64 = 10_000;
/// Room for a formatted date or time. The longest short forms are far shorter than this.
const TEXT_CAPACITY: usize = 96;

/// A Unix time in milliseconds as Windows file time ticks.
fn filetime_ticks(unix_milliseconds: u64) -> u64 {
    unix_milliseconds * TICKS_PER_MILLISECOND + UNIX_EPOCH_IN_FILETIME_TICKS
}

/// The date and time of a Unix time in milliseconds, in the user's time zone and in the short
/// date and short time formats from their Windows regional settings, for example `10/9/2026 6:46 AM`.
/// `None` if Windows cannot convert or format it.
pub fn format_local_short(unix_milliseconds: u64) -> Option<String> {
    let ticks = filetime_ticks(unix_milliseconds);
    let file_time = FILETIME {
        dwLowDateTime: (ticks & 0xFFFF_FFFF) as u32,
        dwHighDateTime: (ticks >> 32) as u32,
    };
    // SAFETY: every pointer is to a local value that outlives the call, and the output buffers are
    // as long as the lengths passed. A null locale name means the user's own locale, and a null
    // time zone means the current one.
    unsafe {
        let mut utc: SYSTEMTIME = std::mem::zeroed();
        if FileTimeToSystemTime(&file_time, &mut utc) == 0 {
            return None;
        }
        let mut local: SYSTEMTIME = std::mem::zeroed();
        if SystemTimeToTzSpecificLocalTime(std::ptr::null(), &utc, &mut local) == 0 {
            return None;
        }

        let mut date = [0u16; TEXT_CAPACITY];
        let date_length = GetDateFormatEx(
            std::ptr::null(),
            DATE_SHORTDATE,
            &local,
            std::ptr::null(),
            date.as_mut_ptr(),
            TEXT_CAPACITY as i32,
            std::ptr::null(),
        );
        let mut time = [0u16; TEXT_CAPACITY];
        let time_length = GetTimeFormatEx(
            std::ptr::null(),
            TIME_NOSECONDS,
            &local,
            std::ptr::null(),
            time.as_mut_ptr(),
            TEXT_CAPACITY as i32,
        );
        if date_length <= 1 || time_length <= 1 {
            return None;
        }
        // The returned lengths include the closing NUL.
        let date = String::from_utf16_lossy(&date[..date_length as usize - 1]);
        let time = String::from_utf16_lossy(&time[..time_length as usize - 1]);
        Some(format!("{date} {time}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_unix_epoch_is_the_known_windows_file_time() {
        assert_eq!(filetime_ticks(0), 116_444_736_000_000_000);
    }

    #[test]
    fn a_millisecond_is_ten_thousand_ticks() {
        assert_eq!(filetime_ticks(1) - filetime_ticks(0), 10_000);
    }

    #[test]
    fn a_known_time_is_converted_exactly() {
        // 2001-09-09 01:46:40 UTC is 1_000_000_000_000 milliseconds after the Unix epoch.
        assert_eq!(filetime_ticks(1_000_000_000_000), 126_444_736_000_000_000);
    }

    #[test]
    fn windows_formats_a_date_with_the_year_and_a_time() {
        let text = format_local_short(1_781_524_800_000).expect("Windows formats a valid date");
        assert!(text.contains("26"), "no year in {text:?}");
        assert!(
            text.contains(':') || text.contains('.') || text.contains('h'),
            "no time in {text:?}"
        );
        assert!(
            text.contains(' '),
            "date and time are separated in {text:?}"
        );
    }

    #[test]
    fn different_days_give_different_text() {
        let first = format_local_short(1_781_524_800_000).unwrap();
        let later = format_local_short(1_781_524_800_000 + 3 * 86_400_000).unwrap();
        assert_ne!(first, later);
    }
}
