//! The icon Explorer shows for a file type, as a PNG, taken from the system's registered icon for an extension.

use std::os::windows::ffi::OsStrExt;
use std::sync::Mutex;
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, SelectObject,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC,
};
use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL;
use windows_sys::Win32::UI::Shell::{
    SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_SMALLICON,
    SHGFI_USEFILEATTRIBUTES,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, DrawIconEx, GetSystemMetrics, DI_NORMAL, HICON, SM_CXICON, SM_CXSMICON,
};

const BYTES_PER_PIXEL: usize = 4;

/// Held for the whole of a lookup, so one runs at a time.
static TURNS: Mutex<()> = Mutex::new(());

/// Which of the system's icon sizes to take: the one for a row of a list, or the larger one for a card.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IconSize {
    Small,
    Large,
}

impl IconSize {
    /// The side of this icon in pixels, as set by the system (and so by its scaling). Icons are square.
    fn side(self) -> i32 {
        let metric = match self {
            IconSize::Small => SM_CXSMICON,
            IconSize::Large => SM_CXICON,
        };
        // SAFETY: a plain query with no pointers.
        unsafe { GetSystemMetrics(metric) }
    }

    fn flag(self) -> u32 {
        match self {
            IconSize::Small => SHGFI_SMALLICON,
            IconSize::Large => SHGFI_LARGEICON,
        }
    }
}

/// The PNG of the system icon registered for files ending in `extension` (without the dot), or
/// `None` when the shell has none. Like the type name, it is looked up by extension alone, so the
/// file is never opened, and it is the same icon for every file of that extension.
pub fn png_for_extension(extension: &str, size: IconSize) -> Option<Vec<u8>> {
    // The shell's icon lookup fails now and then when several threads ask at once, as the window does
    // for the first rows of a search, so they take turns. Each lookup is fast, and each extension is asked once.
    let _turn = TURNS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let icon = icon_for_extension(extension, size)?;
    let (width, height, rgba) = draw(icon.0, size.side())?;
    encode_png(width, height, &rgba)
}

/// An icon handle the shell made, destroyed when this is dropped.
struct OwnedIcon(HICON);

impl Drop for OwnedIcon {
    fn drop(&mut self) {
        // SAFETY: the shell made this handle for us alone, and nothing uses it once it is dropped.
        unsafe { DestroyIcon(self.0) };
    }
}

fn icon_for_extension(extension: &str, size: IconSize) -> Option<OwnedIcon> {
    // A made-up name is enough: with USEFILEATTRIBUTES the shell only looks at the extension.
    let dummy_name = format!("file.{extension}");
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
            SHGFI_ICON | size.flag() | SHGFI_USEFILEATTRIBUTES,
        );
        (result, info)
    };
    (result != 0 && !info.hIcon.is_null()).then_some(OwnedIcon(info.hIcon))
}

/// The icon as straight (not premultiplied) RGBA. An icon can be drawn onto a background but not
/// read back with its transparency, so it is drawn on black and again on white: where the two differ
/// the icon let the background through, and by how much is its transparency.
fn draw(icon: HICON, side: i32) -> Option<(u32, u32, Vec<u8>)> {
    if side <= 0 {
        return None;
    }
    let on_black = draw_on(icon, side, 0x00)?;
    let on_white = draw_on(icon, side, 0xFF)?;
    let mut rgba = Vec::with_capacity(on_black.len());
    for (black, white) in on_black
        .chunks_exact(BYTES_PER_PIXEL)
        .zip(on_white.chunks_exact(BYTES_PER_PIXEL))
    {
        rgba.extend_from_slice(&straight_rgba(black, white));
    }
    Some((side as u32, side as u32, rgba))
}

/// One pixel of the icon as straight RGBA, from its BGRA bytes drawn on black and drawn on white.
/// Each channel says the same, `white - black = 255 * (1 - alpha)`, so the middle one is used.
fn straight_rgba(on_black: &[u8], on_white: &[u8]) -> [u8; 4] {
    let alpha = (255 - u32::from(on_white[1]).saturating_sub(u32::from(on_black[1]))).min(255);
    let straight = |premultiplied: u8| -> u8 {
        // A pixel with no alpha has no color to recover.
        (u32::from(premultiplied) * 255 + alpha / 2)
            .checked_div(alpha)
            .map_or(0, |color| color.min(255) as u8)
    };
    // The bitmap is BGRA, a PNG wants RGBA.
    [
        straight(on_black[2]),
        straight(on_black[1]),
        straight(on_black[0]),
        alpha as u8,
    ]
}

/// The icon drawn at `side` pixels square onto a background of `background` in every channel, as BGRA bytes.
fn draw_on(icon: HICON, side: i32, background: u8) -> Option<Vec<u8>> {
    let length = side as usize * side as usize * BYTES_PER_PIXEL;
    // SAFETY: each handle is checked before use and released on every path. `bits` points to
    // `length` bytes that belong to the bitmap while it is alive, and is only used before that.
    unsafe {
        let device: HDC = CreateCompatibleDC(std::ptr::null_mut());
        if device.is_null() {
            return None;
        }
        let mut header: BITMAPINFO = std::mem::zeroed();
        header.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: side,
            // A negative height makes the rows run top to bottom, which is how a PNG wants them.
            biHeight: -side,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            ..std::mem::zeroed()
        };
        let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
        let bitmap: HBITMAP =
            CreateDIBSection(device, &header, DIB_RGB_COLORS, &mut bits, 0 as HANDLE, 0);
        if bitmap.is_null() || bits.is_null() {
            DeleteDC(device);
            return None;
        }
        let previous = SelectObject(device, bitmap);
        std::ptr::write_bytes(bits as *mut u8, background, length);
        let drew = DrawIconEx(
            device,
            0,
            0,
            icon,
            side,
            side,
            0,
            std::ptr::null_mut(),
            DI_NORMAL,
        ) != 0;
        GdiFlush();
        let pixels = drew.then(|| std::slice::from_raw_parts(bits as *const u8, length).to_vec());
        SelectObject(device, previous);
        DeleteObject(bitmap);
        DeleteDC(device);
        pixels
    }
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().ok()?;
    writer.write_image_data(rgba).ok()?;
    writer.finish().ok()?;
    Some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(bytes: &[u8]) -> (png::OutputInfo, Vec<u8>) {
        let mut reader = png::Decoder::new(std::io::Cursor::new(bytes))
            .read_info()
            .unwrap();
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        let info = reader.next_frame(&mut pixels).unwrap();
        (info, pixels)
    }

    #[test]
    fn a_registered_extension_gets_a_square_icon_with_some_transparency() {
        let bytes =
            png_for_extension("txt", IconSize::Small).expect("the shell has an icon for .txt");
        let (info, pixels) = decode(&bytes);
        assert_eq!(info.width, info.height);
        assert!(info.width >= 16);
        assert_eq!(info.color_type, png::ColorType::Rgba);
        let alphas: Vec<u8> = pixels.chunks_exact(4).map(|pixel| pixel[3]).collect();
        assert!(alphas.contains(&255), "something is drawn");
        assert!(
            alphas.iter().any(|&alpha| alpha < 255),
            "the corners of an icon are see-through"
        );
    }

    #[test]
    fn an_unregistered_extension_still_gets_the_generic_file_icon() {
        assert!(png_for_extension("zzqxj", IconSize::Small).is_some());
    }

    #[test]
    fn the_large_icon_is_bigger_than_the_small_one() {
        let small = decode(&png_for_extension("txt", IconSize::Small).unwrap()).0;
        let large = decode(&png_for_extension("txt", IconSize::Large).unwrap()).0;
        assert!(large.width > small.width);
        assert_eq!(large.width, large.height);
    }

    #[test]
    fn different_types_get_different_pictures() {
        let text = png_for_extension("txt", IconSize::Small).unwrap();
        let archive = png_for_extension("zip", IconSize::Small).unwrap();
        assert_ne!(text, archive);
    }

    #[test]
    fn the_same_extension_gives_the_same_picture_each_time() {
        assert_eq!(
            png_for_extension("txt", IconSize::Small),
            png_for_extension("txt", IconSize::Small)
        );
    }

    #[test]
    fn many_threads_asking_at_once_all_get_an_icon() {
        let threads: Vec<_> = ["txt", "zip", "pdf", "png", "docx", "csv", "log", "json"]
            .into_iter()
            .map(|extension| {
                std::thread::spawn(move || png_for_extension(extension, IconSize::Small).is_some())
            })
            .collect();
        for thread in threads {
            assert!(thread.join().unwrap());
        }
    }

    #[test]
    fn an_opaque_pixel_comes_back_as_it_was_drawn() {
        // Opaque red looks the same on either background, as BGRA.
        assert_eq!(
            straight_rgba(&[0, 0, 255, 0], &[0, 0, 255, 0]),
            [255, 0, 0, 255]
        );
    }

    #[test]
    fn a_pixel_the_icon_did_not_touch_is_fully_transparent() {
        assert_eq!(
            straight_rgba(&[0, 0, 0, 0], &[255, 255, 255, 255]),
            [0, 0, 0, 0]
        );
    }

    #[test]
    fn a_half_transparent_pixel_gets_half_alpha_and_its_full_color_back() {
        // Half-transparent pure red: 128 red over black, and 255 red with 127 green and blue over white.
        let [red, green, blue, alpha] = straight_rgba(&[0, 0, 128, 0], &[127, 127, 255, 255]);
        assert!((i32::from(alpha) - 128).abs() <= 1, "alpha {alpha}");
        assert!(
            red >= 254 && green <= 1 && blue <= 1,
            "{red} {green} {blue}"
        );
    }
}
