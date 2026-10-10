//! Saved searches, kept as one JSON file in the app's data folder (under %APPDATA%).
//!
//! The backend treats the content as opaque JSON text. The webview owns the shape of a saved
//! search, so adding a criterion later never needs a migration here.

use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const FILE_NAME: &str = "saved-searches.json";
const EMPTY_LIST: &str = "[]";

pub struct SavedSearchStore {
    path: PathBuf,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct LoadedSearches {
    pub json: String,
    /// Set when the file existed but could not be used. The unreadable file is kept aside.
    pub warning: Option<String>,
}

impl SavedSearchStore {
    pub fn in_folder(folder: &Path) -> Self {
        Self {
            path: folder.join(FILE_NAME),
        }
    }

    /// Returns the stored JSON, or an empty list when nothing has been saved yet. A file that is
    /// not valid JSON is renamed to `.corrupt` (so nothing is lost) and reported as a warning.
    pub fn load(&self) -> io::Result<LoadedSearches> {
        let text = match fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(LoadedSearches {
                    json: EMPTY_LIST.to_string(),
                    warning: None,
                })
            }
            Err(error) => return Err(error),
        };
        if serde_json::from_str::<serde_json::Value>(&text).is_ok() {
            return Ok(LoadedSearches {
                json: text,
                warning: None,
            });
        }
        let aside = self.path.with_extension("json.corrupt");
        fs::rename(&self.path, &aside)?;
        Ok(LoadedSearches {
            json: EMPTY_LIST.to_string(),
            warning: Some(format!(
                "The saved searches file was unreadable. It was kept as {}",
                aside.display()
            )),
        })
    }

    /// Replaces the stored JSON. Writes a temporary file first so a crash mid-save cannot leave a
    /// half-written file behind.
    pub fn save(&self, json: &str) -> io::Result<()> {
        serde_json::from_str::<serde_json::Value>(json)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        if let Some(folder) = self.path.parent() {
            fs::create_dir_all(folder)?;
        }
        let temporary = self.path.with_extension("json.tmp");
        fs::write(&temporary, json)?;
        fs::rename(&temporary, &self.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, SavedSearchStore) {
        let folder = tempfile::tempdir().unwrap();
        let store = SavedSearchStore::in_folder(folder.path());
        (folder, store)
    }

    #[test]
    fn a_fresh_install_has_no_saved_searches() {
        let (_folder, store) = store();
        assert_eq!(
            store.load().unwrap(),
            LoadedSearches {
                json: "[]".into(),
                warning: None
            }
        );
    }

    #[test]
    fn saved_json_round_trips_exactly() {
        let (_folder, store) = store();
        let json = r#"[{"name":"Logs","criteria":{"text":"ERR"}}]"#;
        store.save(json).unwrap();
        assert_eq!(store.load().unwrap().json, json);
    }

    #[test]
    fn saving_creates_the_data_folder() {
        let folder = tempfile::tempdir().unwrap();
        let store = SavedSearchStore::in_folder(&folder.path().join("not").join("yet"));
        store.save("[]").unwrap();
        assert_eq!(store.load().unwrap().json, "[]");
    }

    #[test]
    fn saving_overwrites_the_previous_list() {
        let (_folder, store) = store();
        store.save(r#"[{"name":"one"}]"#).unwrap();
        store.save("[]").unwrap();
        assert_eq!(store.load().unwrap().json, "[]");
    }

    #[test]
    fn invalid_json_is_refused_and_the_old_file_survives() {
        let (_folder, store) = store();
        store.save(r#"[{"name":"keep me"}]"#).unwrap();
        assert!(store.save("{not json").is_err());
        assert_eq!(store.load().unwrap().json, r#"[{"name":"keep me"}]"#);
    }

    #[test]
    fn a_corrupt_file_is_set_aside_not_deleted() {
        let (folder, store) = store();
        fs::write(folder.path().join(FILE_NAME), "{truncated").unwrap();
        let loaded = store.load().unwrap();
        assert_eq!(loaded.json, "[]");
        assert!(loaded.warning.is_some());
        let kept = folder.path().join("saved-searches.json.corrupt");
        assert_eq!(fs::read_to_string(kept).unwrap(), "{truncated");
        assert!(!folder.path().join(FILE_NAME).exists());
    }

    #[test]
    fn no_temporary_file_is_left_after_a_save() {
        let (folder, store) = store();
        store.save("[]").unwrap();
        assert!(!folder.path().join("saved-searches.json.tmp").exists());
    }
}
