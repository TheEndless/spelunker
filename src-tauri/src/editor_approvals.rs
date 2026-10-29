//! The custom editor commands the person has approved. A custom command is a program the app
//! starts for them, so the page cannot choose one by itself: the first time a command is used the
//! app asks in a native dialog, which only the person at the keyboard can answer, and remembers the
//! answer here, in a file in the app's data folder.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const FILE_NAME: &str = "approved-editors.json";

pub struct ApprovedEditors {
    file: PathBuf,
    approved: Mutex<HashSet<String>>,
}

impl ApprovedEditors {
    /// The approvals kept in `folder`. A missing or damaged file means none are approved.
    pub fn in_folder(folder: &Path) -> Self {
        let file = folder.join(FILE_NAME);
        let approved = std::fs::read_to_string(&file)
            .ok()
            .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
            .unwrap_or_default()
            .into_iter()
            .collect();
        Self {
            file,
            approved: Mutex::new(approved),
        }
    }

    pub fn is_approved(&self, template: &str) -> bool {
        self.approved
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains(template)
    }

    /// Remembers `template`, in memory and on disk. Failing to write the file only means the
    /// person is asked again next time.
    pub fn approve(&self, template: &str) {
        let mut approved = self
            .approved
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        approved.insert(template.to_string());
        let mut sorted: Vec<&String> = approved.iter().collect();
        sorted.sort();
        if let (Some(folder), Ok(text)) = (self.file.parent(), serde_json::to_string(&sorted)) {
            let _ = std::fs::create_dir_all(folder);
            let _ = std::fs::write(&self.file, text);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_approved_at_first() {
        let folder = tempfile::tempdir().unwrap();
        let store = ApprovedEditors::in_folder(folder.path());
        assert!(!store.is_approved("code.cmd -g {path}"));
    }

    #[test]
    fn an_approved_command_is_remembered_across_restarts() {
        let folder = tempfile::tempdir().unwrap();
        ApprovedEditors::in_folder(folder.path()).approve("mine.exe {path}");
        let again = ApprovedEditors::in_folder(folder.path());
        assert!(again.is_approved("mine.exe {path}"));
        assert!(!again.is_approved("mine.exe {path} --other"));
    }

    #[test]
    fn approval_is_for_the_exact_text() {
        let folder = tempfile::tempdir().unwrap();
        let store = ApprovedEditors::in_folder(folder.path());
        store.approve("mine.exe {path}");
        assert!(!store.is_approved("mine.exe  {path}"));
        assert!(!store.is_approved("Mine.exe {path}"));
    }

    #[test]
    fn a_damaged_file_approves_nothing() {
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join(FILE_NAME), "not json").unwrap();
        assert!(!ApprovedEditors::in_folder(folder.path()).is_approved("x"));
    }

    #[test]
    fn a_folder_that_does_not_exist_yet_is_made_when_approving() {
        let parent = tempfile::tempdir().unwrap();
        let folder = parent.path().join("not").join("yet");
        ApprovedEditors::in_folder(&folder).approve("x");
        assert!(ApprovedEditors::in_folder(&folder).is_approved("x"));
    }
}
