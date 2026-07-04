use crate::error::ADPError;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

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

/// Characters that cannot appear in a Windows/NTFS filename, plus `%` itself
/// (the escape character — must be escaped too so decoding stays unambiguous).
const NOTE_FILENAME_FORBIDDEN: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|', '%'];

/// Encode a project folder key (e.g. "c:/projects/foo") into a filename-safe,
/// REVERSIBLE string by percent-escaping only the forbidden characters.
/// Everything else (letters, digits, spaces, unicode) passes through
/// unchanged, so filenames stay mostly readable. Replaces the previous
/// `sanitize_note_filename`, which collapsed every forbidden char to `_` —
/// lossy and non-injective, so `load_notes()` could never recover the
/// original key from the filename (see tasks/lessons.md for the resulting
/// "project notes vanish after restart" bug).
fn encode_note_filename(folder_key: &str) -> String {
    folder_key
        .chars()
        .map(|c| {
            if NOTE_FILENAME_FORBIDDEN.contains(&c) {
                format!("%{:02x}", c as u32)
            } else {
                c.to_string()
            }
        })
        .collect()
}

/// Reverse `encode_note_filename`. Returns the original key when `stem` is a
/// validly percent-encoded string. Legacy filenames written by the old
/// (lossy) `sanitize_note_filename` contain no `%`, so they decode to
/// themselves unchanged — identical to before this fix, not a regression. A
/// malformed `%` sequence (not two hex digits) also falls back to the raw
/// stem rather than failing the whole load.
fn decode_note_filename(stem: &str) -> String {
    let mut out = String::new();
    let mut chars = stem.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            match u32::from_str_radix(&hex, 16)
                .ok()
                .and_then(|b| char::try_from(b).ok())
            {
                Some(decoded) => out.push(decoded),
                None => return stem.to_string(),
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Write data to a file atomically via a temp file + rename.
/// This prevents corruption if the app crashes mid-write.
///
/// The temp filename is unique per call (process id + atomic counter) and lives
/// in the SAME directory as the target, so the rename stays on one filesystem
/// and concurrent writers (e.g. main + detached-tasks window) never collide on a
/// shared temp path. Cleanup-on-failure removes only THIS call's temp.
fn atomic_write(path: &Path, data: &str) -> Result<(), ADPError> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let temp = path.with_extension(format!(
        "tmp.{}.{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::write(&temp, data)
        .map_err(|e| ADPError::file_io(format!("Failed to write temp file: {}", e)))?;
    std::fs::rename(&temp, path).map_err(|e| {
        // Clean up this call's unique temp file on rename failure
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

    log::debug!(
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
    /// Returns a JSON object: { "global": "...", "c:/projects/foo": "...", ... }
    /// (project keys are percent-decoded back from their on-disk filename via
    /// `decode_note_filename` — see that function for why this must be reversible).
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
                let key = if stem == "global" {
                    stem
                } else {
                    decode_note_filename(&stem)
                };
                notes.insert(key, serde_json::Value::String(content));
            }
        }

        serde_json::to_string(&notes)
            .map_err(|e| ADPError::parse(format!("Failed to serialize notes: {}", e)))
    }

    /// Save a note as a .md file in Documents/Smashq/notes/
    /// `note_key` is "global" for global notes, or the percent-encoded folder path for project notes.
    #[tauri::command]
    pub async fn save_note_file(note_key: String, content: String) -> Result<(), ADPError> {
        let dir = notes_dir()?;
        let filename = if note_key == "global" {
            "global.md".to_string()
        } else {
            format!("{}.md", encode_note_filename(&note_key))
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

    /// Load tasks JSON from Documents/Smashq/tasks.json
    /// Returns empty string if file doesn't exist yet (first run).
    /// Falls back to backup files if primary is missing or corrupt.
    #[tauri::command]
    pub async fn load_tasks() -> Result<String, ADPError> {
        let path = settings_dir()?.join("tasks.json");
        load_with_fallback(&path, "tasks")
    }

    /// Save tasks JSON to Documents/Smashq/tasks.json
    #[tauri::command]
    pub async fn save_tasks(data: String) -> Result<(), ADPError> {
        let path = settings_dir()?.join("tasks.json");
        create_backup(&path, 3);
        atomic_write(&path, &data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // --- encode_note_filename / decode_note_filename ---

    #[test]
    fn encode_keeps_plain_identifiers_unchanged() {
        assert_eq!(encode_note_filename("my-project_2024"), "my-project_2024");
    }

    #[test]
    fn encode_escapes_path_separators() {
        assert_eq!(encode_note_filename("a/b\\c"), "a%2fb%5cc");
    }

    #[test]
    fn encode_escapes_windows_drive_colon() {
        assert_eq!(
            encode_note_filename("c:/projects/foo"),
            "c%3a%2fprojects%2ffoo"
        );
    }

    #[test]
    fn encode_escapes_all_forbidden_glob_chars_and_percent() {
        assert_eq!(
            encode_note_filename("a*b?c\"d<e>f|g%h"),
            "a%2ab%3fc%22d%3ce%3ef%7cg%25h"
        );
    }

    #[test]
    fn decode_roundtrips_arbitrary_keys() {
        for key in [
            "c:/projects/smashq",
            "my-project_2024",
            "a/b\\c",
            "path with spaces/foo",
            "unicode/pröjéct",
            "50%done/folder",
        ] {
            assert_eq!(decode_note_filename(&encode_note_filename(key)), key);
        }
    }

    #[test]
    fn decode_returns_legacy_lossy_names_unchanged() {
        // Old `sanitize_note_filename` output contains no `%` — must keep
        // loading exactly as before this fix, not regress to an error.
        assert_eq!(
            decode_note_filename("c__projects_smashq"),
            "c__projects_smashq"
        );
    }

    #[test]
    fn decode_falls_back_to_raw_stem_on_malformed_percent_sequence() {
        assert_eq!(decode_note_filename("50%zz-folder"), "50%zz-folder");
        assert_eq!(decode_note_filename("trailing%"), "trailing%");
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
        let leftover = std::fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(Result::ok)
            .any(|e| e.file_name().to_string_lossy().contains(".tmp"));
        assert!(
            !leftover,
            "no .tmp file should remain after a successful write"
        );
    }

    #[test]
    fn atomic_write_is_concurrency_safe() {
        use std::sync::Arc;
        let tmp = TempDir::new().unwrap();
        let path = Arc::new(tmp.path().join("tasks.json"));
        let threads: Vec<_> = (0..16)
            .map(|t| {
                let path = Arc::clone(&path);
                std::thread::spawn(move || {
                    for i in 0..20 {
                        let payload = format!("{{\"thread\":{},\"iter\":{}}}", t, i);
                        atomic_write(&path, &payload).expect("atomic_write must succeed");
                    }
                })
            })
            .collect();
        for h in threads {
            h.join().unwrap();
        }
        // Final file must be valid (one full payload, never a partial/corrupt write).
        let content = std::fs::read_to_string(path.as_path()).unwrap();
        assert!(
            content.starts_with("{\"thread\":") && content.ends_with('}'),
            "final file must equal exactly one payload, got: {}",
            content
        );
        // No leftover temp files from any of the racing writers.
        let leftover: Vec<_> = std::fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp"))
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(leftover.is_empty(), "leftover temp files: {:?}", leftover);
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
