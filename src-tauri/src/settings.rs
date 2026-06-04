use crate::error::ADPError;
use std::path::{Path, PathBuf};

/// Settings directory: Documents/Smashq/
fn settings_dir() -> Result<PathBuf, ADPError> {
    let doc_dir = dirs::document_dir()
        .ok_or_else(|| ADPError::file_io("Could not determine Documents directory"))?;
    let dir = doc_dir.join("Smashq");
    std::fs::create_dir_all(&dir)
        .map_err(|e| ADPError::file_io(format!("Failed to create settings directory: {}", e)))?;
    Ok(dir)
}

fn settings_path() -> Result<PathBuf, ADPError> {
    Ok(settings_dir()?.join("settings.json"))
}

fn notes_dir() -> Result<PathBuf, ADPError> {
    let dir = settings_dir()?.join("notes");
    std::fs::create_dir_all(&dir)
        .map_err(|e| ADPError::file_io(format!("Failed to create notes directory: {}", e)))?;
    Ok(dir)
}

/// Sanitize a project folder path into a safe filename
fn sanitize_note_filename(folder_key: &str) -> String {
    folder_key
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

/// Write data to a file atomically via a temp file + rename.
/// This prevents corruption if the app crashes mid-write.
fn atomic_write(path: &Path, data: &str) -> Result<(), ADPError> {
    let temp = path.with_extension("tmp");
    std::fs::write(&temp, data)
        .map_err(|e| ADPError::file_io(format!("Failed to write temp file: {}", e)))?;
    std::fs::rename(&temp, path).map_err(|e| {
        // Clean up temp file on rename failure
        let _ = std::fs::remove_file(&temp);
        ADPError::file_io(format!("Failed to rename temp to target: {}", e))
    })
}

/// Rotate up to `max_backups` backup copies before overwriting a file.
/// Pattern: file.backup.3.json -> deleted, .2 -> .3, .1 -> .2, original -> .1 (copy).
fn create_backup(path: &Path, max_backups: u32) {
    if !path.exists() {
        return;
    }

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("json");
    let stem = path.with_extension("");

    // Delete the oldest backup if it exists
    let oldest = PathBuf::from(format!("{}.backup.{}.{}", stem.display(), max_backups, ext));
    if oldest.exists() {
        let _ = std::fs::remove_file(&oldest);
    }

    // Shift existing backups up by one slot (N-1 -> N, ... , 1 -> 2)
    for i in (1..max_backups).rev() {
        let from = PathBuf::from(format!("{}.backup.{}.{}", stem.display(), i, ext));
        let to = PathBuf::from(format!("{}.backup.{}.{}", stem.display(), i + 1, ext));
        if from.exists() {
            let _ = std::fs::rename(&from, &to);
        }
    }

    // Copy the current file into backup slot 1 (copy, not move!)
    let first_backup = PathBuf::from(format!("{}.backup.1.{}", stem.display(), ext));
    if let Err(e) = std::fs::copy(path, &first_backup) {
        log::warn!("Failed to create backup of {}: {}", path.display(), e);
    }
}

/// Load a JSON file with fallback to backup copies.
/// If the primary file is missing or contains invalid JSON, tries backup.1, .2, .3.
/// Returns empty string if nothing is recoverable (fresh start).
fn load_with_fallback(path: &Path, label: &str) -> Result<String, ADPError> {
    // Try primary file first
    if path.exists() {
        match std::fs::read_to_string(path) {
            Ok(content) => {
                if serde_json::from_str::<serde_json::Value>(&content).is_ok() {
                    return Ok(content);
                }
                log::warn!("{}: primary file has invalid JSON, trying backups", label);
            }
            Err(e) => {
                log::warn!(
                    "{}: failed to read primary file: {}, trying backups",
                    label,
                    e
                );
            }
        }
    }

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("json");
    let stem = path.with_extension("");

    // Try backup files 1..3
    for i in 1..=3 {
        let backup = PathBuf::from(format!("{}.backup.{}.{}", stem.display(), i, ext));
        if !backup.exists() {
            continue;
        }
        match std::fs::read_to_string(&backup) {
            Ok(content) => {
                if serde_json::from_str::<serde_json::Value>(&content).is_ok() {
                    log::warn!("{}: recovered from backup {}", label, backup.display());
                    return Ok(content);
                }
                log::warn!(
                    "{}: backup {} also has invalid JSON, skipping",
                    label,
                    backup.display()
                );
            }
            Err(e) => {
                log::warn!(
                    "{}: failed to read backup {}: {}",
                    label,
                    backup.display(),
                    e
                );
            }
        }
    }

    log::warn!(
        "{}: all files corrupt or missing, returning empty (fresh start)",
        label
    );
    Ok(String::new())
}

#[allow(clippy::module_inception)]
pub mod commands {
    use super::*;

    /// Load settings JSON from Documents/Smashq/settings.json
    /// Returns empty string if file doesn't exist yet (first run).
    /// Falls back to backup files if primary is missing or corrupt.
    #[tauri::command]
    pub async fn load_user_settings() -> Result<String, ADPError> {
        let path = settings_path()?;
        load_with_fallback(&path, "settings")
    }

    /// Save settings JSON to Documents/Smashq/settings.json
    #[tauri::command]
    pub async fn save_user_settings(data: String) -> Result<(), ADPError> {
        let path = settings_path()?;
        create_backup(&path, 3);
        atomic_write(&path, &data)
    }

    /// Load favorites JSON from Documents/Smashq/favorites.json
    /// Returns empty string if file doesn't exist yet.
    /// Falls back to backup files if primary is missing or corrupt.
    #[tauri::command]
    pub async fn load_favorites_file() -> Result<String, ADPError> {
        let path = settings_dir()?.join("favorites.json");
        load_with_fallback(&path, "favorites")
    }

    /// Save favorites list as JSON to Documents/Smashq/favorites.json
    #[tauri::command]
    pub async fn save_favorites_file(data: String) -> Result<(), ADPError> {
        let path = settings_dir()?.join("favorites.json");
        create_backup(&path, 3);
        atomic_write(&path, &data)
    }

    /// Load all notes from Documents/Smashq/notes/
    /// Returns a JSON object: { "global": "...", "c_/projects/foo": "...", ... }
    #[tauri::command]
    pub async fn load_notes() -> Result<String, ADPError> {
        let dir = notes_dir()?;
        let mut notes = serde_json::Map::new();

        let entries = std::fs::read_dir(&dir)
            .map_err(|e| ADPError::file_io(format!("Failed to read notes directory: {}", e)))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("md") {
                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default()
                    .to_string();
                let content = std::fs::read_to_string(&path).map_err(|e| {
                    ADPError::file_io(format!("Failed to read note {}: {}", stem, e))
                })?;
                notes.insert(stem, serde_json::Value::String(content));
            }
        }

        serde_json::to_string(&notes)
            .map_err(|e| ADPError::parse(format!("Failed to serialize notes: {}", e)))
    }

    /// Save a note as a .md file in Documents/Smashq/notes/
    /// `note_key` is "global" for global notes, or the sanitized folder path for project notes.
    #[tauri::command]
    pub async fn save_note_file(note_key: String, content: String) -> Result<(), ADPError> {
        let dir = notes_dir()?;
        let filename = if note_key == "global" {
            "global.md".to_string()
        } else {
            format!("{}.md", sanitize_note_filename(&note_key))
        };
        let path = dir.join(&filename);

        if content.trim().is_empty() {
            // Remove empty note files to keep the directory clean
            if path.exists() {
                std::fs::remove_file(&path).map_err(|e| {
                    ADPError::file_io(format!("Failed to remove empty note file: {}", e))
                })?;
            }
            return Ok(());
        }

        atomic_write(&path, &content)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // --- sanitize_note_filename ---

    #[test]
    fn sanitize_keeps_plain_identifiers() {
        assert_eq!(sanitize_note_filename("my-project_2024"), "my-project_2024");
    }

    #[test]
    fn sanitize_replaces_path_separators() {
        // Forward and back slashes both become underscores.
        assert_eq!(sanitize_note_filename("a/b\\c"), "a_b_c");
    }

    #[test]
    fn sanitize_replaces_windows_drive_colon() {
        // "C:/Projects/foo" — colon and slashes are forbidden chars.
        assert_eq!(sanitize_note_filename("C:/Projects/foo"), "C__Projects_foo");
    }

    #[test]
    fn sanitize_replaces_all_forbidden_glob_chars() {
        assert_eq!(sanitize_note_filename("a*b?c\"d<e>f|g"), "a_b_c_d_e_f_g");
    }

    #[test]
    fn sanitize_trims_leading_and_trailing_underscores() {
        // A leading slash becomes "_" and is then trimmed away.
        assert_eq!(sanitize_note_filename("/leading/path/"), "leading_path");
    }

    #[test]
    fn sanitize_collapses_all_forbidden_to_empty() {
        assert_eq!(sanitize_note_filename("***"), "");
    }

    // --- atomic_write ---

    #[test]
    fn atomic_write_creates_file_with_content() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("data.json");
        atomic_write(&path, "{\"x\":1}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"x\":1}");
    }

    #[test]
    fn atomic_write_overwrites_existing_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("data.json");
        atomic_write(&path, "old").unwrap();
        atomic_write(&path, "new").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn atomic_write_leaves_no_temp_file_behind() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("data.json");
        atomic_write(&path, "content").unwrap();
        assert!(!path.with_extension("tmp").exists());
    }

    // --- create_backup ---

    #[test]
    fn create_backup_is_noop_for_missing_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("absent.json");
        create_backup(&path, 3);
        assert!(!path.with_file_name("absent.backup.1.json").exists());
    }

    #[test]
    fn create_backup_copies_current_into_slot_one() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.json");
        std::fs::write(&path, "v1").unwrap();
        create_backup(&path, 3);
        let backup1 = tmp.path().join("settings.backup.1.json");
        assert_eq!(std::fs::read_to_string(&backup1).unwrap(), "v1");
        // Original is copied, not moved — it must still exist.
        assert!(path.exists());
    }

    #[test]
    fn create_backup_rotates_older_slots() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.json");

        std::fs::write(&path, "v1").unwrap();
        create_backup(&path, 3);
        std::fs::write(&path, "v2").unwrap();
        create_backup(&path, 3);

        // Newest copy in slot 1, previous copy shifted into slot 2.
        let backup1 = tmp.path().join("settings.backup.1.json");
        let backup2 = tmp.path().join("settings.backup.2.json");
        assert_eq!(std::fs::read_to_string(&backup1).unwrap(), "v2");
        assert_eq!(std::fs::read_to_string(&backup2).unwrap(), "v1");
    }

    // --- load_with_fallback ---

    #[test]
    fn load_returns_primary_when_valid() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.json");
        std::fs::write(&path, "{\"ok\":true}").unwrap();
        let loaded = load_with_fallback(&path, "test").unwrap();
        assert_eq!(loaded, "{\"ok\":true}");
    }

    #[test]
    fn load_returns_empty_when_nothing_exists() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.json");
        let loaded = load_with_fallback(&path, "test").unwrap();
        assert_eq!(loaded, "");
    }

    #[test]
    fn load_recovers_from_backup_when_primary_is_corrupt() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.json");
        std::fs::write(&path, "not valid json{{{").unwrap();
        std::fs::write(
            tmp.path().join("settings.backup.1.json"),
            "{\"recovered\":1}",
        )
        .unwrap();
        let loaded = load_with_fallback(&path, "test").unwrap();
        assert_eq!(loaded, "{\"recovered\":1}");
    }

    #[test]
    fn load_returns_empty_when_primary_and_backups_all_corrupt() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("settings.json");
        std::fs::write(&path, "bad{{{").unwrap();
        std::fs::write(tmp.path().join("settings.backup.1.json"), "also bad{").unwrap();
        let loaded = load_with_fallback(&path, "test").unwrap();
        assert_eq!(loaded, "");
    }
}
