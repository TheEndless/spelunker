#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod batcher;
mod commands;
mod drives;
mod dropped_paths;
mod dto;
mod editor;
mod file_drag;
mod modal_guard;
mod navigation;
mod os_datetime;
mod preview_access;
mod roots;
mod shell_integration;
mod shell_items;
mod shell_menu;
mod store;
mod type_name;

use tauri::{Emitter, Manager};
use tauri_plugin_window_state::StateFlags;

/// The folders named by command-line arguments, as Explorer passes them from the folder menu.
/// A relative argument (a terminal launch such as `spelunker .`) is taken from `working_folder`,
/// the folder the launch happened in, which for a second launch is not this process's own.
fn folders_from_arguments(
    arguments: &[String],
    working_folder: &std::path::Path,
) -> Option<String> {
    // "This PC" is not a folder, so it would not survive the folder check below. It means every
    // local drive and covers any folders given beside it. A real folder that happens to have such
    // a name in the launch folder (`spelunker computer`) is that folder, not every drive.
    let means_all_drives = |argument: &String| {
        let word = argument.trim().trim_matches('"');
        drives::is_all_drives(word) && !working_folder.join(word).is_dir()
    };
    if arguments.iter().any(means_all_drives) {
        return Some(drives::ALL_DRIVES_LABEL.to_string());
    }
    let cleaned: Vec<String> = arguments
        .iter()
        .map(|argument| shell_integration::folder_from_argument(argument))
        .map(|folder| shell_integration::absolute_from(&folder, working_folder))
        .collect();
    let folders = dropped_paths::folders_from_paths(&cleaned);
    (!folders.is_empty()).then(|| folders.join("; "))
}

/// Puts the Explorer menu entry in place on the first run of an installed copy, and repairs it if
/// the program moved. Skipped after the user turned it off, and for builds run straight from a
/// cargo `target` folder, whose path should not end up in the registry.
fn ensure_explorer_entry(app: &tauri::AppHandle) {
    let Ok(exe) = std::env::current_exe().map(|path| path.to_string_lossy().into_owned()) else {
        return;
    };
    if shell_integration::registration_refusal(&exe, cfg!(debug_assertions), false).is_some() {
        return;
    }
    let opted_out = commands::explorer_opt_out_file(app).is_some_and(|marker| marker.exists());
    if !opted_out && !shell_integration::is_registered(&exe) {
        let _ = shell_integration::register(&exe);
    }
}

/// The environment variable that keeps a debug build from bringing its window forward, so the
/// end-to-end scripts never take focus from the person using the machine (see tools/e2e/README.md).
const NO_FOCUS_VARIABLE: &str = "SPELUNKER_NO_FOCUS";

/// Whether the app may bring its window forward: when the window first appears, on a second
/// launch, and when the window state plugin shows the restored window. Only a debug build listens
/// to the variable, so a release build always does, whatever the environment says.
fn should_take_focus(debug_build: bool, no_focus_value: Option<&str>) -> bool {
    !debug_build || no_focus_value != Some("1")
}

fn main() {
    let launch_arguments: Vec<String> = std::env::args().skip(1).collect();
    let take_focus = should_take_focus(
        cfg!(debug_assertions),
        std::env::var(NO_FOCUS_VARIABLE).ok().as_deref(),
    );
    // Restoring the saved "visible" state shows the window and then focuses it, so a run that must
    // not take focus leaves that one part of the state alone.
    let mut window_state = tauri_plugin_window_state::Builder::default();
    if !take_focus {
        window_state = window_state.with_state_flags(StateFlags::all() - StateFlags::VISIBLE);
    }

    tauri::Builder::default()
        // A second launch (for example from Explorer's menu) hands its folder to the running window.
        .plugin(tauri_plugin_single_instance::init(
            move |app, arguments, working_folder| {
                if take_focus {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
                // This runs inside the other launch's message call, so the disk checks for the
                // folder go to another thread instead of holding that launch (and this one) up.
                let app = app.clone();
                let arguments = arguments[1.min(arguments.len())..].to_vec();
                let working_folder = std::path::PathBuf::from(working_folder);
                std::thread::spawn(move || {
                    if let Some(folder) = folders_from_arguments(&arguments, &working_folder) {
                        let _ = app.emit("open-folder", folder);
                    }
                });
            },
        ))
        .plugin(window_state.build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(commands::ActiveSearch::default())
        .manage(commands::LaunchFolder::default())
        .setup(move |app| {
            let folder = app.path().app_data_dir()?;
            app.manage(store::SavedSearchStore::in_folder(&folder));
            app.state::<commands::LaunchFolder>()
                .set(folders_from_arguments(
                    &launch_arguments,
                    &std::env::current_dir().unwrap_or_default(),
                ));
            ensure_explorer_entry(app.handle());

            // The window is made here, not from the config alone, so it can refuse to leave the app's own pages.
            let mut window_config = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .expect("tauri.conf.json defines the main window");
            // A run that must not take focus shows the window without activating it.
            window_config.focus &= take_focus;
            tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)?
                .on_navigation(|url| navigation::is_app_page(url, cfg!(debug_assertions)))
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_search,
            commands::stop_search,
            commands::preview,
            commands::read_file_text,
            commands::write_text_file,
            commands::open_in_editor,
            commands::open_path,
            commands::reveal_path,
            commands::validate_content,
            commands::validate_name_regex,
            commands::load_saved_searches,
            commands::save_saved_searches,
            commands::folders_from_dropped_paths,
            commands::shell_integration_enabled,
            commands::set_shell_integration,
            commands::take_launch_folder,
            commands::show_shell_menu,
            commands::allow_preview,
            commands::existing_paths,
            commands::start_file_drag,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Spelunker");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn the_this_pc_argument_becomes_the_all_drives_choice() {
        let found = folders_from_arguments(&["This PC".to_string()], Path::new("C:\\Work"));
        assert_eq!(found.as_deref(), Some(drives::ALL_DRIVES_LABEL));
    }

    #[test]
    fn the_all_drives_words_work_in_any_case_and_with_quotes() {
        for argument in ["this pc", "\"This PC\"", "ALL DRIVES"] {
            let found = folders_from_arguments(&[argument.to_string()], Path::new("C:\\Work"));
            assert_eq!(
                found.as_deref(),
                Some(drives::ALL_DRIVES_LABEL),
                "{argument}"
            );
        }
    }

    #[test]
    fn all_drives_wins_over_folders_given_beside_it() {
        let arguments = ["C:\\".to_string(), "This PC".to_string()];
        let found = folders_from_arguments(&arguments, Path::new("C:\\Work"));
        assert_eq!(found.as_deref(), Some(drives::ALL_DRIVES_LABEL));
    }

    #[test]
    fn a_real_folder_called_computer_is_that_folder_not_every_drive() {
        let base = tempfile::tempdir().unwrap();
        let folder = base.path().join("Computer");
        std::fs::create_dir(&folder).unwrap();
        let found = folders_from_arguments(&["computer".to_string()], base.path());
        // Windows paths are case-insensitive, and the argument is used as it was typed.
        let expected = folder.to_string_lossy().to_lowercase();
        assert_eq!(found.map(|path| path.to_lowercase()), Some(expected));
    }

    #[test]
    fn a_release_build_always_takes_focus_whatever_the_variable_says() {
        for value in [None, Some("1"), Some("0"), Some(""), Some("yes")] {
            assert!(should_take_focus(false, value), "{value:?}");
        }
    }

    #[test]
    fn a_debug_build_takes_focus_unless_the_variable_is_1() {
        assert!(should_take_focus(true, None));
        assert!(should_take_focus(true, Some("0")));
        assert!(should_take_focus(true, Some("")));
        assert!(!should_take_focus(true, Some("1")));
    }

    #[test]
    fn a_word_that_is_not_a_folder_is_ignored() {
        let found =
            folders_from_arguments(&["no-such-folder-xyz".to_string()], Path::new("C:\\Work"));
        assert_eq!(found, None);
    }
}
