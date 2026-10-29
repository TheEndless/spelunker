use crate::batcher::{event_queue, forward_batches, BATCH_INTERVAL};
use crate::dto::{PreviewLineDto, QueryRequest, SearchMessage, SearchRequest};
use crate::editor_approvals::ApprovedEditors;
use crate::search_scope::SearchScope;
use crate::store::{LoadedSearches, SavedSearchStore};
use spelunker_core::{
    preview_file, search, validate_content_query, validate_name_regex as check_name_regex,
    CancelToken,
};
use std::process::Command;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::State;

/// The cancel token of the search currently running, if any.
#[derive(Default)]
pub struct ActiveSearch(Mutex<Option<CancelToken>>);

impl ActiveSearch {
    /// Cancels the previous search and returns a fresh token for the next one.
    fn replace(&self) -> CancelToken {
        let mut active = self.0.lock().unwrap();
        if let Some(previous) = active.take() {
            previous.cancel();
        }
        let token = CancelToken::new();
        *active = Some(token.clone());
        token
    }

    fn cancel(&self) {
        if let Some(token) = self.0.lock().unwrap().as_ref() {
            token.cancel();
        }
    }
}

#[tauri::command]
pub fn start_search(
    request: SearchRequest,
    on_message: Channel<SearchMessage>,
    active: State<'_, ActiveSearch>,
    scope: State<'_, SearchScope>,
) {
    let cancel = active.replace();
    let config = request.into_config();
    scope.set(&config.roots);

    std::thread::spawn(move || {
        let (sender, receiver) = event_queue();
        let batch_channel = on_message.clone();
        let forwarder = std::thread::spawn(move || {
            forward_batches(receiver, BATCH_INTERVAL, |message| {
                let _ = batch_channel.send(message);
            });
        });

        // search() drops the callback, and with it the sender, before it returns. That is what
        // lets the forwarder below finish even when workers are still stuck in a blocking open.
        let outcome = search(&config, &cancel, move |event| {
            let _ = sender.send(event);
        });
        let _ = forwarder.join();

        let done = match outcome {
            Ok(summary) => SearchMessage::Done {
                summary: Some(summary.into()),
                error: None,
            },
            Err(error) => SearchMessage::Done {
                summary: None,
                error: Some(error.to_string()),
            },
        };
        let _ = on_message.send(done);
    });
}

#[tauri::command]
pub fn stop_search(active: State<'_, ActiveSearch>) {
    active.cancel();
}

/// The system's icon for files ending in `extension`, as the bytes of a PNG, or no bytes when the
/// shell has none. `large` asks for the bigger icon a card shows, not the one a row does. The shell
/// can be slow the first time it is asked, so it runs off the window's thread.
#[tauri::command]
pub async fn file_icon(extension: String, large: bool) -> tauri::ipc::Response {
    let size = if large {
        crate::file_icon::IconSize::Large
    } else {
        crate::file_icon::IconSize::Small
    };
    let png = tauri::async_runtime::spawn_blocking(move || {
        crate::file_icon::png_for_extension(&extension, size)
    })
    .await
    .ok()
    .flatten()
    .unwrap_or_default();
    tauri::ipc::Response::new(png)
}

#[tauri::command]
pub async fn preview(
    scope: State<'_, SearchScope>,
    path: String,
    query: QueryRequest,
    context_lines: usize,
    include_binary: bool,
) -> Result<Vec<PreviewLineDto>, String> {
    scope.check(&path)?;
    let query = query.into_query();
    tauri::async_runtime::spawn_blocking(move || {
        preview_file(path.as_ref(), &query, context_lines, include_binary)
    })
    .await
    .map_err(|error| error.to_string())?
    .map(|lines| lines.into_iter().map(PreviewLineDto::from).collect())
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_path(scope: State<'_, SearchScope>, path: String) -> Result<(), String> {
    scope.check(&path)?;
    Command::new("explorer")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// The command line text that makes Explorer select `path`. Explorer reads the whole text after
/// "/select," as one path, and quoting it keeps a comma in a folder name from being taken as a
/// separator. It is passed raw, so a quote in the path would end the quoted part and let the rest
/// be read as more arguments. A real file name cannot hold one, so such a path is refused, and so
/// is one with a control character.
fn reveal_argument(path: &str) -> Result<String, String> {
    if path
        .chars()
        .any(|character| character == '"' || character.is_control())
    {
        return Err("That path has a character that cannot be shown in Explorer".to_string());
    }
    Ok(format!("/select,\"{path}\""))
}

/// Looks on GitHub for a newer release than this app. It runs off the window's thread, since it waits
/// on the network. The answer says what was found, or why nothing could be.
#[tauri::command]
pub async fn check_for_updates(
    app: tauri::AppHandle,
) -> Result<crate::updates::UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || crate::updates::check(&current))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

/// Opens a page of this project's releases in the browser. Any other address is refused, so the page
/// cannot use this to open something else.
#[tauri::command]
pub fn open_release_page(address: String) -> Result<(), String> {
    if !crate::updates::is_openable(&address) {
        return Err("That is not a page of Spelunker's releases".to_string());
    }
    Command::new("explorer")
        .arg(address)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn reveal_path(scope: State<'_, SearchScope>, path: String) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    scope.check(&path)?;
    let argument = reveal_argument(&path)?;
    // The argument is passed raw so Rust's own escaping does not add backslashes inside it.
    Command::new("explorer")
        .raw_arg(argument)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// The given paths that still exist, in the order given, for dropping the rows whose files the
/// system menu deleted or renamed. One call covers any number of rows. It touches the disk, which
/// can stall on an offline share, so it runs off the window's thread. A path is only reported gone
/// when the system says so. When it cannot tell (no access, a network error) or the check itself
/// fails, the path counts as existing, so no row is dropped by mistake.
#[tauri::command]
pub async fn existing_paths(paths: Vec<String>) -> Vec<String> {
    let requested: std::sync::Arc<[String]> = paths.into();
    let checked = std::sync::Arc::clone(&requested);
    tauri::async_runtime::spawn_blocking(move || paths_that_exist(&checked))
        .await
        .unwrap_or_else(|_| requested.to_vec())
}

fn paths_that_exist(paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .filter(|path| still_exists(std::path::Path::new(path).try_exists()))
        .cloned()
        .collect()
}

/// Only a definite "not there" counts as gone. An error means the answer is unknown.
fn still_exists(lookup: std::io::Result<bool>) -> bool {
    !matches!(lookup, Ok(false))
}

/// The regex engine's complaint about a content query, or `None` when it is valid. Used for live
/// validation, so the answer comes from the same engine that will run the search.
#[tauri::command]
pub fn validate_content(query: QueryRequest) -> Option<String> {
    validate_content_query(&query.into_query())
        .err()
        .map(|error| error.to_string())
}

#[tauri::command]
pub fn validate_name_regex(pattern: String) -> Option<String> {
    check_name_regex(&pattern)
        .err()
        .map(|error| error.to_string())
}

#[tauri::command]
pub fn load_saved_searches(store: State<'_, SavedSearchStore>) -> Result<LoadedSearches, String> {
    store.load().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_saved_searches(json: String, store: State<'_, SavedSearchStore>) -> Result<(), String> {
    store.save(&json).map_err(|error| error.to_string())
}

/// The folders to search for paths dropped onto the window (files stand for their folder).
/// Checking what a path is touches the disk, which can stall on an offline network share, so it
/// runs off the thread that serves the window.
#[tauri::command]
pub async fn folders_from_dropped_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || crate::dropped_paths::folders_from_paths(&paths))
        .await
        .map_err(|error| error.to_string())
}

/// Largest text file the preview reads in one go.
const PREVIEW_MAX_BYTES: usize = 4 * 1024 * 1024;

/// The whole text of a file for the preview, with lines matching `query` marked.
#[tauri::command]
pub async fn read_file_text(
    scope: State<'_, SearchScope>,
    path: String,
    query: Option<QueryRequest>,
) -> Result<crate::dto::FileTextDto, String> {
    scope.check(&path)?;
    let query = query.map(QueryRequest::into_query);
    tauri::async_runtime::spawn_blocking(move || {
        spelunker_core::read_file_text(path.as_ref(), query.as_ref(), PREVIEW_MAX_BYTES)
    })
    .await
    .map_err(|error| error.to_string())?
    .map(Into::into)
    .map_err(|error| error.to_string())
}

/// Whether `extension` can be offered as a file type in the save dialog: a few letters or digits.
fn is_plain_extension(extension: &str) -> bool {
    (1..=8).contains(&extension.len())
        && extension
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
}

/// Asks the person where to save `content` and writes it there. The page never names the file: the
/// place comes from the native dialog, which only the person at the keyboard can answer, so a page
/// cannot use this to write anywhere it likes. False when the dialog was cancelled.
#[tauri::command]
pub async fn save_text_file(
    app: tauri::AppHandle,
    suggested_name: String,
    extension: String,
    content: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    if !is_plain_extension(&extension) {
        return Err("That is not a file type this can save".to_string());
    }
    // The dialog waits for an answer, and saving to a slow or offline share must not freeze the window.
    tauri::async_runtime::spawn_blocking(move || {
        let Some(target) = app
            .dialog()
            .file()
            .set_file_name(suggested_name)
            .add_filter(extension.to_uppercase(), &[extension.as_str()])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = target.into_path().map_err(|error| error.to_string())?;
        std::fs::write(path, content)
            .map(|()| true)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Opens `path` in the editor the page names at `line`. A built-in editor (`vscode`, `notepadpp`)
/// has its command line here, in Rust. A custom command comes from the page, so the first time a
/// command is used the person is asked, in a native dialog the page cannot answer, whether to run
/// it, and the answer is remembered.
#[tauri::command]
pub async fn open_in_editor(
    app: tauri::AppHandle,
    scope: State<'_, SearchScope>,
    approvals: State<'_, ApprovedEditors>,
    editor: String,
    custom_template: String,
    path: String,
    line: u64,
) -> Result<(), String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    scope.check(&path)?;
    let template = match crate::editor::built_in_template(&editor) {
        Some(built_in) => built_in.to_string(),
        None if editor == "custom" => {
            let custom = custom_template.trim().to_string();
            if custom.is_empty() {
                return Err("No editor command is set. Choose an editor in Settings".to_string());
            }
            if !approvals.is_approved(&custom) {
                let question = format!(
                    "Spelunker is about to run this command to open a file:\n\n{custom}\n\nOnly run it if you wrote it in Settings."
                );
                let allowed = tauri::async_runtime::spawn_blocking(move || {
                    app.dialog()
                        .message(question)
                        .title("Run this editor command?")
                        .kind(MessageDialogKind::Warning)
                        .buttons(MessageDialogButtons::OkCancelCustom(
                            "Run it".to_string(),
                            "Cancel".to_string(),
                        ))
                        .blocking_show()
                })
                .await
                .map_err(|error| error.to_string())?;
                if !allowed {
                    return Err("The custom editor command was not approved".to_string());
                }
                approvals.approve(&custom);
            }
            custom
        }
        None => return Err("That editor is not one Spelunker knows".to_string()),
    };
    // Finding the program looks on the disk, so it stays off the window's thread.
    tauri::async_runtime::spawn_blocking(move || {
        crate::editor::open_in_editor(&template, &path, line)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn current_exe_text() -> Result<String, String> {
    std::env::current_exe()
        .map(|exe| exe.to_string_lossy().into_owned())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn shell_integration_enabled() -> bool {
    // It runs reg.exe, so it stays off the window's thread.
    tauri::async_runtime::spawn_blocking(|| {
        current_exe_text().is_ok_and(|exe| crate::shell_integration::is_registered(&exe))
    })
    .await
    .unwrap_or(false)
}

/// A marker file in the app data folder records that the user turned the Explorer entry off, so
/// the app does not put it back on the next start.
pub fn explorer_opt_out_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .ok()
        .map(|folder| folder.join("explorer-entry-off"))
}

#[tauri::command]
pub async fn set_shell_integration(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        let exe = current_exe_text()?;
        let override_requested = std::env::var_os("SPELUNKER_ALLOW_DEV_REGISTRATION").is_some();
        if let Some(reason) = crate::shell_integration::registration_refusal(
            &exe,
            cfg!(debug_assertions),
            override_requested,
        ) {
            return Err(reason);
        }
    }
    let marker = explorer_opt_out_file(&app);
    // Up to nine reg.exe calls, so this stays off the window's thread.
    tauri::async_runtime::spawn_blocking(move || {
        if enabled {
            crate::shell_integration::register(&current_exe_text()?)?;
            if let Some(marker) = marker {
                let _ = std::fs::remove_file(marker);
            }
            Ok(())
        } else {
            if let Some(marker) = marker {
                if let Some(folder) = marker.parent() {
                    let _ = std::fs::create_dir_all(folder);
                }
                std::fs::write(marker, "off").map_err(|error| error.to_string())?;
            }
            crate::shell_integration::unregister()
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

/// The folder Explorer asked the app to search when it was started from a folder's menu.
#[derive(Default)]
pub struct LaunchFolder(Mutex<Option<String>>);

impl LaunchFolder {
    pub fn set(&self, folder: Option<String>) {
        *self.0.lock().unwrap() = folder;
    }
}

#[tauri::command]
pub fn take_launch_folder(launch: State<'_, LaunchFolder>) -> Option<String> {
    launch.0.lock().unwrap().take()
}

/// Shows Explorer's own context menu for all of `paths` at (`x`, `y`), in the window's client
/// pixels. `extra_labels` are our own entries put above it. Runs on the window's thread, which is
/// where the shell needs it. Fails with a message for the user when none of the paths exist.
#[tauri::command]
pub fn show_shell_menu(
    window: tauri::WebviewWindow,
    scope: State<'_, SearchScope>,
    paths: Vec<String>,
    x: i32,
    y: i32,
    extra_labels: Vec<String>,
) -> Result<ShellMenuResult, String> {
    use crate::shell_menu::{client_to_screen, show, ExtraItem, Outcome};
    scope.check_all(&paths)?;
    let handle = window.hwnd().map_err(|error| error.to_string())?;
    let hwnd = windows::Win32::Foundation::HWND(handle.0);
    let (screen_x, screen_y) = client_to_screen(hwnd, x, y);
    let extras: Vec<ExtraItem> = extra_labels
        .into_iter()
        .map(|label| ExtraItem { label })
        .collect();
    let choice = show(hwnd, &paths, screen_x, screen_y, &extras)?;
    Ok(ShellMenuResult {
        extra: match choice.outcome {
            Outcome::Extra(index) => Some(index),
            Outcome::ShellCommand | Outcome::Dismissed => None,
        },
        ran_shell_command: choice.outcome == Outcome::ShellCommand,
        skipped: choice.skipped,
    })
}

/// Shows the native folder dialog and returns the folder chosen, or the This PC label listing the
/// local drives when This PC was chosen. None when it was cancelled, when the choice is not
/// something a search can use (Network, Control Panel), or while another menu or dialog is open.
/// Runs on the window's thread, which is where the shell wants its dialogs.
#[tauri::command]
pub fn pick_folder(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    let Some(_modal) = crate::modal_guard::try_enter() else {
        return Ok(None);
    };
    let handle = window.hwnd().map_err(|error| error.to_string())?;
    crate::folder_dialog::pick(windows::Win32::Foundation::HWND(handle.0))
}

/// What Look in shows for This PC: its name and the letters of the local fixed drives.
#[tauri::command]
pub fn this_pc_label() -> String {
    crate::drives::this_pc_label(&crate::drives::fixed_drives())
}

/// Starts a native drag of the files. Refused unless the physical primary mouse button is down,
/// this window is the foreground window, and the top-level window under the pointer is this one,
/// all checked before the paths are parsed and again right before the drag (see
/// `file_drag::start`). A synchronous command, so it runs on the window's thread, which is where
/// OLE needs the drag to run.
#[tauri::command]
pub fn start_file_drag(
    window: tauri::WebviewWindow,
    scope: State<'_, SearchScope>,
    paths: Vec<String>,
) -> Result<crate::file_drag::DragOutcome, String> {
    scope.check_all(&paths)?;
    let handle = window.hwnd().map_err(|error| error.to_string())?;
    crate::file_drag::start(windows::Win32::Foundation::HWND(handle.0), &paths)
}

/// What the user did in the system menu: chose one of our entries, or the shell carried out one of
/// its own (which may have deleted or renamed files), or nothing. `skipped` names the requested
/// paths that no longer existed, which the menu left out.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellMenuResult {
    pub extra: Option<usize>,
    pub ran_shell_command: bool,
    pub skipped: Vec<String>,
}

/// Lets the webview load one file (a picture, PDF, audio or video) through the asset protocol.
/// Nothing is readable that way until it has been allowed here, and a file named like a PDF has to
/// be a real PDF, so a hostile page cannot be passed off as one.
#[tauri::command]
pub async fn allow_preview(
    app: tauri::AppHandle,
    scope: State<'_, SearchScope>,
    path: String,
) -> Result<(), String> {
    use tauri::Manager;
    scope.check(&path)?;
    let checked = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::preview_access::verify_previewable(std::path::Path::new(&checked))
    })
    .await
    .map_err(|error| error.to_string())??;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path_text(path: &std::path::Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn only_a_short_plain_extension_can_be_offered_to_save() {
        for good in ["csv", "json", "txt", "md", "Log2"] {
            assert!(is_plain_extension(good), "{good}");
        }
        for bad in [
            "",
            "*",
            "c sv",
            "a.b",
            "toolongextension",
            "exe;bat",
            "\u{e9}",
        ] {
            assert!(!is_plain_extension(bad), "{bad}");
        }
    }

    #[test]
    fn reveal_quotes_the_path_for_explorer() {
        assert_eq!(
            reveal_argument(r"C:\My Files\a, b.txt").unwrap(),
            r#"/select,"C:\My Files\a, b.txt""#
        );
    }

    #[test]
    fn reveal_refuses_a_path_that_could_end_the_quote() {
        assert!(reveal_argument(r#"C:\a" C:\Windows\win.ini"#).is_err());
        assert!(reveal_argument("C:\\a\nb").is_err());
    }

    #[test]
    fn paths_that_exist_keeps_files_and_folders_in_the_order_given() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("here.txt");
        std::fs::write(&file, b"here").unwrap();
        let folder = root.path().join("folder");
        std::fs::create_dir(&folder).unwrap();
        let missing = root.path().join("gone.txt");

        let requested = vec![path_text(&folder), path_text(&missing), path_text(&file)];
        assert_eq!(
            paths_that_exist(&requested),
            vec![path_text(&folder), path_text(&file)]
        );
    }

    #[test]
    fn paths_that_exist_returns_each_path_exactly_as_it_was_given() {
        // The page matches the answer to its own paths by text, so a spelling must never be rewritten.
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("Here.TXT");
        std::fs::write(&file, b"here").unwrap();
        let odd_spelling = path_text(&file).replace('\\', "/").to_uppercase();
        let found = paths_that_exist(std::slice::from_ref(&odd_spelling));
        assert_eq!(found, vec![odd_spelling]);
    }

    #[test]
    fn paths_that_exist_drops_every_missing_path() {
        let root = tempfile::tempdir().unwrap();
        let requested = vec![
            path_text(&root.path().join("one.txt")),
            path_text(&root.path().join("two.txt")),
        ];
        assert!(paths_that_exist(&requested).is_empty());
    }

    #[test]
    fn paths_that_exist_of_nothing_is_nothing() {
        assert!(paths_that_exist(&[]).is_empty());
    }

    #[test]
    fn only_a_definite_not_found_counts_as_gone() {
        assert!(still_exists(Ok(true)));
        assert!(!still_exists(Ok(false)));
        let denied = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert!(still_exists(Err(denied)), "no access is not gone");
        let network = std::io::Error::other("the network name is no longer available");
        assert!(still_exists(Err(network)), "a network error is not gone");
    }

    /// A path the system refuses to look up gives an error, not "not found", so it is kept.
    #[test]
    fn paths_that_exist_keeps_a_path_the_system_cannot_check() {
        let unchecked = "C:\\folder\0name.txt".to_string();
        assert!(std::path::Path::new(&unchecked).try_exists().is_err());
        assert_eq!(
            paths_that_exist(std::slice::from_ref(&unchecked)),
            vec![unchecked]
        );
    }

    #[test]
    fn paths_that_exist_keeps_a_repeated_path_at_each_position() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("here.txt");
        std::fs::write(&file, b"here").unwrap();
        let missing = root.path().join("gone.txt");

        let requested = vec![path_text(&file), path_text(&missing), path_text(&file)];
        assert_eq!(
            paths_that_exist(&requested),
            vec![path_text(&file), path_text(&file)]
        );
    }
}
