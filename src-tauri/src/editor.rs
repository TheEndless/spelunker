//! "Open in editor at line": a command template such as `code.cmd -g "{path}:{line}"` is split into
//! a program and arguments and started directly, never through a shell, so a path with spaces or
//! shell characters cannot be misread as extra arguments or commands.

use std::path::{Path, PathBuf};

/// Splits `template` into words. Double quotes group words, and the quotes themselves are dropped.
fn split_words(template: &str) -> Result<Vec<String>, String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut in_word = false;
    let mut in_quotes = false;
    for character in template.chars() {
        match character {
            '"' => {
                in_quotes = !in_quotes;
                in_word = true;
            }
            space if space.is_whitespace() && !in_quotes => {
                if in_word {
                    words.push(std::mem::take(&mut current));
                    in_word = false;
                }
            }
            other => {
                current.push(other);
                in_word = true;
            }
        }
    }
    if in_quotes {
        return Err("The editor command has an opening quote with no closing quote".to_string());
    }
    if in_word {
        words.push(current);
    }
    Ok(words)
}

/// The program and arguments for `template`, with `{path}` and `{line}` filled in.
pub fn build_command(
    template: &str,
    path: &str,
    line: u64,
) -> Result<(String, Vec<String>), String> {
    let line_text = line.max(1).to_string();
    let mut words = split_words(template)?
        .into_iter()
        .map(|word| fill_placeholders(&word, path, &line_text));
    let program = words
        .next()
        .ok_or_else(|| "No editor command is set. Choose an editor in Settings".to_string())?;
    Ok((program, words.collect()))
}

/// Replaces `{path}` and `{line}` in one left-to-right pass. The inserted text is never searched
/// again, so a file called `a{line}.txt` stays intact.
fn fill_placeholders(word: &str, path: &str, line: &str) -> String {
    let mut filled = String::with_capacity(word.len() + path.len());
    let mut rest = word;
    while let Some(start) = rest.find('{') {
        filled.push_str(&rest[..start]);
        let after = &rest[start..];
        if let Some(remaining) = after.strip_prefix("{path}") {
            filled.push_str(path);
            rest = remaining;
        } else if let Some(remaining) = after.strip_prefix("{line}") {
            filled.push_str(line);
            rest = remaining;
        } else {
            filled.push('{');
            rest = &after[1..];
        }
    }
    filled.push_str(rest);
    filled
}

/// Executable kinds Windows can start, most direct first. A bare name is tried last and only
/// when the command already carries an extension: VS Code puts a shell script called `code` next
/// to `code.cmd`, and the script cannot be started.
const EXECUTABLE_EXTENSIONS: [&str; 4] = [".exe", ".cmd", ".bat", ".com"];

fn find_in_folders(program: &str, folders: &[PathBuf]) -> Option<PathBuf> {
    let has_extension = Path::new(program).extension().is_some();
    for folder in folders {
        let with_extensions = EXECUTABLE_EXTENSIONS
            .iter()
            .map(|extension| format!("{program}{extension}"));
        let bare = has_extension.then(|| program.to_string());
        for name in with_extensions.chain(bare) {
            let candidate = folder.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Only absolute folders are searched. An empty or relative PATH entry would resolve against
/// whatever the current folder happens to be.
fn searchable_folders(folders: Vec<PathBuf>) -> Vec<PathBuf> {
    folders
        .into_iter()
        .filter(|folder| folder.is_absolute())
        .collect()
}

/// Finds `program` on PATH, and for Notepad++ also in its usual install folders, since its
/// installer does not add it to PATH.
pub fn resolve_program(program: &str) -> Result<PathBuf, String> {
    let given = Path::new(program);
    if given.components().count() > 1 {
        return if given.is_file() {
            Ok(given.to_path_buf())
        } else {
            Err(format!("The editor was not found at {program}"))
        };
    }
    let mut folders: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    if program.to_lowercase().starts_with("notepad++") {
        for variable in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
            if let Some(base) = std::env::var_os(variable) {
                folders.push(PathBuf::from(base).join("Notepad++"));
            }
        }
    }
    find_in_folders(program, &searchable_folders(folders)).ok_or_else(|| {
        format!(
            "Could not find {program}. Check the editor in Settings, or put its full path in the command"
        )
    })
}

pub fn open_in_editor(template: &str, path: &str, line: u64) -> Result<(), String> {
    let (program, arguments) = build_command(template, path, line)?;
    let resolved = resolve_program(&program)?;
    let mut command = std::process::Command::new(resolved);
    command.args(arguments);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholders_are_filled_in() {
        let (program, arguments) =
            build_command("code.cmd -g {path}:{line}", "C:\\a\\b.rs", 42).unwrap();
        assert_eq!(program, "code.cmd");
        assert_eq!(arguments, ["-g", "C:\\a\\b.rs:42"]);
    }

    #[test]
    fn a_quoted_placeholder_stays_one_argument_even_with_spaces_in_the_path() {
        let (_, arguments) =
            build_command("notepad++ -n{line} \"{path}\"", "C:\\My Files\\a b.txt", 7).unwrap();
        assert_eq!(arguments, ["-n7", "C:\\My Files\\a b.txt"]);
    }

    #[test]
    fn an_unquoted_path_with_spaces_is_still_one_argument() {
        let (_, arguments) = build_command("edit {path}", "C:\\My Files\\a b.txt", 1).unwrap();
        assert_eq!(arguments, ["C:\\My Files\\a b.txt"]);
    }

    #[test]
    fn shell_characters_in_a_path_are_not_interpreted() {
        let (program, arguments) =
            build_command("edit {path}", "C:\\a & calc.exe\\x.txt", 1).unwrap();
        assert_eq!(program, "edit");
        assert_eq!(arguments, ["C:\\a & calc.exe\\x.txt"]);
    }

    #[test]
    fn a_missing_or_zero_line_becomes_line_one() {
        let (_, arguments) = build_command("e +{line}", "x", 0).unwrap();
        assert_eq!(arguments, ["+1"]);
    }

    #[test]
    fn a_program_in_quotes_with_spaces_is_one_word() {
        let (program, arguments) = build_command(
            "\"C:\\Program Files\\Ed\\ed.exe\" --line {line} {path}",
            "f.txt",
            3,
        )
        .unwrap();
        assert_eq!(program, "C:\\Program Files\\Ed\\ed.exe");
        assert_eq!(arguments, ["--line", "3", "f.txt"]);
    }

    #[test]
    fn a_line_placeholder_inside_the_path_is_left_as_written() {
        let (_, arguments) = build_command("e {path} +{line}", "C:\\x\\a{line}.txt", 9).unwrap();
        assert_eq!(arguments, ["C:\\x\\a{line}.txt", "+9"]);
    }

    #[test]
    fn a_path_placeholder_inside_the_path_is_left_as_written() {
        let (_, arguments) = build_command("e {path}", "C:\\x\\{path}.txt", 1).unwrap();
        assert_eq!(arguments, ["C:\\x\\{path}.txt"]);
    }

    #[test]
    fn a_command_without_an_extension_finds_the_runnable_file_not_a_shell_script() {
        let folder = tempfile::tempdir().unwrap();
        // VS Code ships both: `code` is a shell script Windows cannot start, `code.cmd` can be.
        std::fs::write(folder.path().join("code"), "#!/bin/sh").unwrap();
        std::fs::write(folder.path().join("code.cmd"), "@echo off").unwrap();
        let found = find_in_folders("code", &[folder.path().to_path_buf()]).unwrap();
        assert_eq!(found.file_name().unwrap(), "code.cmd");
    }

    #[test]
    fn a_command_that_already_has_an_extension_is_taken_as_given() {
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("tool.exe"), "x").unwrap();
        let found = find_in_folders("tool.exe", &[folder.path().to_path_buf()]).unwrap();
        assert_eq!(found.file_name().unwrap(), "tool.exe");
    }

    #[test]
    fn relative_folders_on_the_path_are_never_searched() {
        assert!(searchable_folders(vec![
            "".into(),
            ".".into(),
            "tools".into(),
            "C:\\Tools".into()
        ])
        .iter()
        .all(|folder| folder.is_absolute()));
    }

    #[test]
    fn an_empty_template_asks_for_an_editor() {
        let error = build_command("   ", "f.txt", 1).unwrap_err();
        assert!(error.contains("Settings"), "{error}");
    }

    #[test]
    fn an_unclosed_quote_is_reported() {
        assert!(build_command("ed \"{path}", "f.txt", 1).is_err());
    }

    #[test]
    fn a_program_that_does_not_exist_is_reported_by_name() {
        let error = resolve_program("definitely-not-an-editor-12345").unwrap_err();
        assert!(error.contains("definitely-not-an-editor-12345"), "{error}");
    }
}
