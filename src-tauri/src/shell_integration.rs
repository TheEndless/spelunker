//! "Search with Spelunker" in Explorer's right-click menu for folders, the empty space inside a
//! folder, and drives. Registered for the current user only (no administrator rights needed),
//! under `HKEY_CURRENT_USER\Software\Classes`, and fully removable.
//!
//! Windows 11 shows entries added this way under "Show more options" in its new compact menu.

use std::process::Command;

/// Where each entry lives, and the placeholder Explorer fills in with the chosen folder:
/// `%1` for a selected folder or drive, `%V` for the folder whose background was clicked.
/// The dot after it is deliberate. A drive arrives as `D:\`, and inside quotes a trailing
/// backslash would escape the closing quote. `D:\.` is the same place and parses safely, and
/// `folder_from_argument` removes the dot again.
const PLACES: [Place; 4] = [
    Place {
        key: "Directory\\shell\\Spelunker",
        placeholder: "%1.",
        label: FOLDER_LABEL,
    },
    Place {
        key: "Directory\\Background\\shell\\Spelunker",
        placeholder: "%V.",
        label: FOLDER_LABEL,
    },
    Place {
        key: "Drive\\shell\\Spelunker",
        placeholder: "%1.",
        label: FOLDER_LABEL,
    },
    // The This PC icon (desktop and navigation pane). It is not a folder, so there is no path to
    // pass: the words stand for every local drive, which the app expands itself.
    Place {
        key: "CLSID\\{20D04FE0-3AEA-1069-A2D8-08002B30309D}\\shell\\Spelunker",
        placeholder: "This PC",
        label: THIS_PC_LABEL,
    },
];
const CLASSES: &str = "HKCU\\Software\\Classes";
const FOLDER_LABEL: &str = "Search with Spelunker";
const THIS_PC_LABEL: &str = "Search all drives with Spelunker";

struct Place {
    key: &'static str,
    placeholder: &'static str,
    label: &'static str,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RegistryValue {
    pub key: String,
    /// `None` is the key's default value.
    pub name: Option<&'static str>,
    pub data: String,
}

/// Every registry value that makes up the entries for the program at `exe`.
pub fn registry_values(exe: &str) -> Vec<RegistryValue> {
    let mut values = Vec::new();
    for place in PLACES {
        let key = format!("{CLASSES}\\{}", place.key);
        values.push(RegistryValue {
            key: key.clone(),
            name: None,
            data: place.label.to_string(),
        });
        values.push(RegistryValue {
            key: key.clone(),
            name: Some("Icon"),
            data: format!("\"{exe}\",0"),
        });
        values.push(RegistryValue {
            key: format!("{key}\\command"),
            name: None,
            data: format!("\"{exe}\" \"{}\"", place.placeholder),
        });
    }
    values
}

/// `reg.exe` from the system folder, so a look-alike next to the app or on PATH is never run.
fn reg_program() -> std::path::PathBuf {
    let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    std::path::PathBuf::from(system_root)
        .join("System32")
        .join("reg.exe")
}

fn run_reg(arguments: &[&str]) -> Result<std::process::Output, String> {
    let mut command = Command::new(reg_program());
    command.args(arguments);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command.output().map_err(|error| error.to_string())
}

/// True for a program inside cargo's own build folders: `target\debug`, `target\release`, or
/// those under a cross-compile triple such as `target\x86_64-pc-windows-msvc\release`. A folder
/// that is merely called "target" (an install under `D:\Tools\target\Spelunker`) does not count.
fn in_cargo_target_folder(exe: &str) -> bool {
    let parts: Vec<String> = exe
        .to_lowercase()
        .split(['\\', '/'])
        .map(str::to_string)
        .collect();
    let is_profile =
        |name: Option<&String>| name.is_some_and(|name| name == "debug" || name == "release");
    parts.iter().enumerate().any(|(index, part)| {
        part == "target" && (is_profile(parts.get(index + 1)) || is_profile(parts.get(index + 2)))
    })
}

/// Why the program at `exe` must not put itself in Explorer's menu, or `None` when it may. A
/// development build (or one run straight from a cargo `target` folder) loads its window from the
/// dev server, so an entry pointing at it would only ever open an error page once the server is off.
/// `override_requested` is for the end-to-end scripts, which clean up after themselves.
pub fn registration_refusal(
    exe: &str,
    debug_build: bool,
    override_requested: bool,
) -> Option<String> {
    if (debug_build || in_cargo_target_folder(exe)) && !override_requested {
        return Some(
            "This is a development build, which only works while the dev server runs, so it will not add itself to Explorer. Install Spelunker with the setup to get the entry"
                .to_string(),
        );
    }
    None
}

pub fn register(exe: &str) -> Result<(), String> {
    for value in registry_values(exe) {
        let mut arguments = vec!["add", value.key.as_str()];
        match value.name {
            Some(name) => arguments.extend(["/v", name]),
            None => arguments.push("/ve"),
        }
        arguments.extend(["/t", "REG_SZ", "/d", value.data.as_str(), "/f"]);
        let output = run_reg(&arguments)?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
    }
    Ok(())
}

fn key_exists(key: &str) -> bool {
    run_reg(&["query", key])
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Removes the current user's entries. A key that was never there is fine. One that is still there
/// afterwards is an error, which happens when the entry was installed for all users (it lives
/// under the machine-wide key and needs an administrator or the uninstaller to remove).
pub fn unregister() -> Result<(), String> {
    for place in PLACES {
        let key = format!("{CLASSES}\\{}", place.key);
        run_reg(&["delete", key.as_str(), "/f"])?;
        if key_exists(&key) {
            return Err(format!("Windows would not remove {key}"));
        }
    }
    let merged = format!("HKCR\\{}", PLACES[0].key);
    if key_exists(&merged) {
        return Err(
            "The entry was installed for all users. Uninstall Spelunker to remove it".to_string(),
        );
    }
    Ok(())
}

/// The folder an Explorer launch argument stands for. Registration appends a dot to the folder
/// placeholder (`C:\Docs` arrives as `C:\Docs.` and a drive `D:\` as `D:\.`), and this removes it.
pub fn folder_from_argument(argument: &str) -> String {
    let mut folder = argument.trim().trim_matches('"').to_string();
    // One trailing dot is ours. A name ending in two dots is something else and stays as it is.
    if folder.ends_with('.') && !folder.ends_with("..") {
        folder.pop();
    }
    // Keep the trailing backslash only on a drive root such as `D:\`.
    let is_drive_root = folder.len() == 3 && folder.ends_with(":\\");
    if !is_drive_root {
        folder = folder.trim_end_matches('\\').to_string();
    }
    folder
}

/// Makes a relative launch argument absolute by taking it from the folder the launch happened in.
pub fn absolute_from(folder: &str, working_folder: &std::path::Path) -> String {
    if folder.is_empty() || std::path::Path::new(folder).is_absolute() {
        return folder.to_string();
    }
    if folder == "." {
        return working_folder.to_string_lossy().into_owned();
    }
    working_folder.join(folder).to_string_lossy().into_owned()
}

/// True when an entry exists, whoever installed it (this user, or an installer for all users),
/// and points at the program at `exe`.
pub fn is_registered(exe: &str) -> bool {
    // HKCR is the merged view of the machine-wide and per-user classes.
    let key = format!("HKCR\\{}\\command", PLACES[0].key);
    run_reg(&["query", key.as_str(), "/ve"])
        .map(|output| {
            // Windows paths are case-insensitive, and the installer may have written another case.
            output.status.success()
                && String::from_utf8_lossy(&output.stdout)
                    .to_lowercase()
                    .contains(&exe.to_lowercase())
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command_for(values: &[RegistryValue], place: &str) -> String {
        let key = format!("{CLASSES}\\{place}\\command");
        values
            .iter()
            .find(|value| value.key == key)
            .unwrap()
            .data
            .clone()
    }

    #[test]
    fn folders_drives_and_folder_backgrounds_all_get_an_entry() {
        let values = registry_values("C:\\Apps\\Spelunker.exe");
        for place in [
            "Directory\\shell",
            "Directory\\Background\\shell",
            "Drive\\shell",
        ] {
            let key = format!("{CLASSES}\\{place}\\Spelunker");
            let label = values
                .iter()
                .find(|value| value.key == key && value.name.is_none())
                .unwrap();
            assert_eq!(label.data, "Search with Spelunker");
        }
    }

    #[test]
    fn the_command_passes_the_clicked_folder_in_quotes() {
        let values = registry_values("C:\\Program Files\\Spelunker\\spelunker.exe");
        assert_eq!(
            command_for(&values, "Directory\\shell\\Spelunker"),
            "\"C:\\Program Files\\Spelunker\\spelunker.exe\" \"%1.\""
        );
        assert_eq!(
            command_for(&values, "Directory\\Background\\shell\\Spelunker"),
            "\"C:\\Program Files\\Spelunker\\spelunker.exe\" \"%V.\""
        );
    }

    #[test]
    fn the_this_pc_icon_gets_its_own_entry_that_says_all_drives() {
        let values = registry_values("C:\\Apps\\Spelunker.exe");
        let key =
            format!("{CLASSES}\\CLSID\\{{20D04FE0-3AEA-1069-A2D8-08002B30309D}}\\shell\\Spelunker");
        let label = values
            .iter()
            .find(|value| value.key == key && value.name.is_none())
            .unwrap();
        assert_eq!(label.data, "Search all drives with Spelunker");
        let command = values
            .iter()
            .find(|value| value.key == format!("{key}\\command"))
            .unwrap();
        assert_eq!(command.data, "\"C:\\Apps\\Spelunker.exe\" \"This PC\"");
    }

    #[test]
    fn entries_carry_the_program_icon() {
        let values = registry_values("C:\\x\\s.exe");
        let icons = values
            .iter()
            .filter(|value| value.name == Some("Icon"))
            .count();
        assert_eq!(icons, 4);
    }

    #[test]
    fn everything_is_under_the_current_user_classes_key() {
        assert!(registry_values("x.exe")
            .iter()
            .all(|value| value.key.starts_with("HKCU\\Software\\Classes\\")));
    }

    #[test]
    fn a_folder_argument_loses_the_registration_dot() {
        // Explorer passes an ordinary folder without a trailing backslash, so the dot follows the name.
        assert_eq!(
            folder_from_argument("C:\\Users\\me\\Docs."),
            "C:\\Users\\me\\Docs"
        );
        assert_eq!(
            folder_from_argument("\"C:\\Users\\me\\Docs.\""),
            "C:\\Users\\me\\Docs"
        );
        assert_eq!(
            folder_from_argument("\\\\server\\share."),
            "\\\\server\\share"
        );
    }

    #[test]
    fn a_folder_argument_with_a_backslash_before_the_dot_is_cleaned_too() {
        assert_eq!(
            folder_from_argument("C:\\Users\\me\\Docs\\."),
            "C:\\Users\\me\\Docs"
        );
    }

    #[test]
    fn a_dot_means_the_folder_the_launch_happened_in() {
        let working = std::path::Path::new("C:\\Work\\Project");
        assert_eq!(absolute_from(".", working), "C:\\Work\\Project");
    }

    #[test]
    fn a_relative_folder_is_taken_from_the_launch_folder() {
        let working = std::path::Path::new("C:\\Work");
        assert_eq!(absolute_from("src", working), "C:\\Work\\src");
    }

    #[test]
    fn an_absolute_folder_is_left_alone() {
        let working = std::path::Path::new("C:\\Work");
        assert_eq!(absolute_from("D:\\Data", working), "D:\\Data");
        assert_eq!(absolute_from("", working), "");
    }

    #[test]
    fn a_name_ending_in_two_dots_keeps_them() {
        assert_eq!(folder_from_argument("C:\\Work\\.."), "C:\\Work\\..");
    }

    #[test]
    fn a_drive_argument_keeps_its_root_backslash() {
        assert_eq!(folder_from_argument("D:\\."), "D:\\");
        assert_eq!(folder_from_argument("D:\\"), "D:\\");
    }

    #[test]
    fn an_ordinary_path_is_left_alone() {
        assert_eq!(folder_from_argument("C:\\Work\\Notes"), "C:\\Work\\Notes");
    }
}

#[cfg(test)]
mod registration_refusal_tests {
    use super::*;

    #[test]
    fn a_development_build_is_refused() {
        let reason = registration_refusal(r"C:\Apps\Spelunker\Spelunker.exe", true, false);
        assert!(reason.unwrap().contains("development build"));
    }

    #[test]
    fn a_build_run_from_a_cargo_target_folder_is_refused() {
        let exe = r"D:\Dev\spelunker\target\release\Spelunker.exe";
        assert!(registration_refusal(exe, false, false).is_some());
        assert!(registration_refusal(&exe.to_uppercase(), false, false).is_some());
    }

    #[test]
    fn an_installed_release_build_is_allowed() {
        let exe = r"C:\Users\me\AppData\Local\Programs\Spelunker\Spelunker.exe";
        assert_eq!(registration_refusal(exe, false, false), None);
    }

    #[test]
    fn the_test_scripts_can_override_the_refusal() {
        assert_eq!(
            registration_refusal(r"D:\Dev\target\debug\app.exe", true, true),
            None
        );
    }
}

#[cfg(test)]
mod cargo_target_tests {
    use super::*;

    #[test]
    fn the_debug_and_release_folders_are_cargo_builds() {
        assert!(in_cargo_target_folder(
            r"D:\Dev\spelunker\target\debug\spelunker-app.exe"
        ));
        assert!(in_cargo_target_folder(
            r"D:\Dev\spelunker\target\release\Spelunker.exe"
        ));
    }

    #[test]
    fn a_cross_compile_folder_is_a_cargo_build_too() {
        assert!(in_cargo_target_folder(
            r"D:\Dev\target\x86_64-pc-windows-msvc\release\app.exe"
        ));
    }

    #[test]
    fn the_check_ignores_case_and_slash_direction() {
        assert!(in_cargo_target_folder("D:/Dev/Target/Release/app.exe"));
    }

    #[test]
    fn an_install_in_a_folder_merely_called_target_is_not_a_cargo_build() {
        assert!(!in_cargo_target_folder(
            r"D:\Tools\target\Spelunker\Spelunker.exe"
        ));
        assert!(!in_cargo_target_folder(r"C:\target\Spelunker.exe"));
    }

    #[test]
    fn an_ordinary_install_is_not_a_cargo_build() {
        assert!(!in_cargo_target_folder(
            r"C:\Users\me\AppData\Local\Programs\Spelunker\Spelunker.exe"
        ));
    }
}
