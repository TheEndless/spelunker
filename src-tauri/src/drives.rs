//! "This PC" and "All drives" as a place to search: they stand for every local fixed drive.

/// The words that mean "every local drive" when typed or chosen in Look in.
const ALL_DRIVES_NAMES: [&str; 4] = ["this pc", "all drives", "this pc (all drives)", "computer"];

/// What the Look in box shows when every local drive is searched. The UI offers it as a choice.
pub const ALL_DRIVES_LABEL: &str = "This PC (all drives)";

/// What a "This PC" entry stands for.
enum ThisPc {
    /// Every local fixed drive, as they are when the search starts.
    EveryFixedDrive,
    /// The drives the entry lists, such as `This PC (C:, D:)`, as roots like `C:\`.
    Drives(Vec<String>),
}

/// `d:` as the root `D:\`, or None for anything that is not a drive letter and a colon.
fn drive_root(text: &str) -> Option<String> {
    match text.as_bytes() {
        [letter, b':'] if letter.is_ascii_alphabetic() => {
            Some(format!("{}:\\", letter.to_ascii_uppercase() as char))
        }
        _ => None,
    }
}

fn parse_this_pc(root: &str) -> Option<ThisPc> {
    let normalized = root.trim().to_lowercase();
    if ALL_DRIVES_NAMES.contains(&normalized.as_str()) {
        return Some(ThisPc::EveryFixedDrive);
    }
    let listed = normalized.strip_prefix("this pc (")?.strip_suffix(')')?;
    let drives: Option<Vec<String>> = listed
        .split(',')
        .map(|part| drive_root(part.trim()))
        .collect();
    drives.map(ThisPc::Drives)
}

/// True for the words that mean every drive, and for `This PC` followed by a list of drive letters
/// in parentheses, which is what the Look in box shows after choosing This PC.
pub fn is_all_drives(root: &str) -> bool {
    parse_this_pc(root).is_some()
}

/// What the Look in box shows for these drives: `This PC (C:, D:)`, or just `This PC` with none.
pub fn this_pc_label(drives: &[String]) -> String {
    let letters: Vec<&str> = drives
        .iter()
        .map(|drive| drive.trim_end_matches('\\'))
        .collect();
    if letters.is_empty() {
        "This PC".to_string()
    } else {
        format!("This PC ({})", letters.join(", "))
    }
}

/// Replaces each "This PC" style entry with its drives, keeping the other roots as they are. A
/// plain entry means every drive in `drives`, and one that lists letters means exactly those.
/// Repeats are left for `roots::tidy_roots`, which handles them along with nested folders.
pub fn expand_roots(roots: Vec<String>, drives: &[String]) -> Vec<String> {
    roots
        .into_iter()
        .flat_map(|root| match parse_this_pc(&root) {
            Some(ThisPc::EveryFixedDrive) => drives.to_vec(),
            Some(ThisPc::Drives(listed)) => listed,
            None => vec![root],
        })
        .collect()
}

/// Local fixed drives such as `C:\`. Removable, network, and optical drives are left out, since
/// searching them is rarely what "everything on this PC" means and they can stall.
pub fn fixed_drives() -> Vec<String> {
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    const DRIVE_FIXED: u32 = 3;
    // SAFETY: reads system state only, and takes no pointers.
    let mask = unsafe { GetLogicalDrives() };
    (0..26u32)
        .filter(|bit| mask & (1 << bit) != 0)
        .map(|bit| format!("{}:\\", (b'A' + bit as u8) as char))
        .filter(|root| {
            let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
            // SAFETY: `wide` is a NUL-terminated UTF-16 string that outlives the call.
            unsafe { GetDriveTypeW(wide.as_ptr()) == DRIVE_FIXED }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drives() -> Vec<String> {
        vec!["C:\\".to_string(), "D:\\".to_string()]
    }

    #[test]
    fn the_all_drives_names_are_recognised_in_any_case() {
        assert!(is_all_drives("This PC"));
        assert!(is_all_drives("  all drives "));
        assert!(is_all_drives("THIS PC (All Drives)"));
        assert!(!is_all_drives("C:\\"));
        assert!(!is_all_drives("This PC Games"));
    }

    /// The same cases as `isAllDrives` in src/lib/folderCombo.test.ts.
    #[test]
    fn a_this_pc_entry_may_list_the_drives_it_stands_for() {
        assert!(is_all_drives("This PC (C:, D:, E:)"));
        assert!(is_all_drives("this pc (d:)"));
        assert!(is_all_drives(" THIS PC (C:,D:) "));
        assert!(!is_all_drives("This PC ()"));
        assert!(!is_all_drives("This PC (C:\\Games)"));
        assert!(!is_all_drives("This PC (C:, Games)"));
        assert!(!is_all_drives("This PC (D:) extra"));
    }

    #[test]
    fn a_listed_this_pc_is_exactly_those_drives() {
        let roots = expand_roots(vec!["This PC (E:, c:)".into()], &drives());
        assert_eq!(roots, ["E:\\", "C:\\"]);
    }

    #[test]
    fn the_label_lists_the_drive_letters() {
        assert_eq!(this_pc_label(&drives()), "This PC (C:, D:)");
        assert_eq!(this_pc_label(&[]), "This PC");
    }

    #[test]
    fn the_label_it_makes_expands_back_to_the_same_drives() {
        let roots = expand_roots(vec![this_pc_label(&drives())], &["Z:\\".to_string()]);
        assert_eq!(roots, drives());
    }

    #[test]
    fn this_pc_becomes_every_drive() {
        let roots = expand_roots(vec!["This PC".into()], &drives());
        assert_eq!(roots, drives());
    }

    #[test]
    fn other_folders_are_kept_in_order_around_the_expansion() {
        let roots = expand_roots(
            vec!["E:\\Work".into(), "All drives".into(), "F:\\Notes".into()],
            &drives(),
        );
        assert_eq!(roots, ["E:\\Work", "C:\\", "D:\\", "F:\\Notes"]);
    }

    #[test]
    fn plain_roots_pass_through_untouched() {
        let roots = expand_roots(vec!["C:\\Users".into()], &drives());
        assert_eq!(roots, ["C:\\Users"]);
    }

    /// The Look in box recognises the same words in TypeScript (to show the all-drives button as
    /// pressed) as the backend does here (to expand them). The lists live in two languages, so this
    /// reads the TypeScript source and fails if they ever differ.
    #[test]
    fn the_typescript_word_list_matches_this_one() {
        let source = include_str!("../../src/lib/folderCombo.ts");
        let list_start = source
            .find("const ALL_DRIVES_WORDS = [")
            .expect("folderCombo.ts defines ALL_DRIVES_WORDS");
        let list = &source[list_start..];
        let list = &list[..list.find("];").expect("the list ends")];
        let words: Vec<&str> = list.split('\'').skip(1).step_by(2).collect();
        assert_eq!(words, ALL_DRIVES_NAMES);

        let label_line = source
            .lines()
            .find(|line| line.contains("export const ALL_DRIVES_LABEL"))
            .expect("folderCombo.ts defines ALL_DRIVES_LABEL");
        assert!(
            label_line.contains(&format!("'{ALL_DRIVES_LABEL}'")),
            "{label_line}"
        );
    }
}
