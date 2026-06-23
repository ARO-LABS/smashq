// src-tauri/src/session/file_reader/commands.rs
//
// Generic file-IPC Tauri commands exposed to the frontend. Thin handlers that
// delegate to the path-safety guards, the session-history scanner, and the
// session-delete helper. Registered in `lib.rs` as
// `session::file_reader::commands::*`.

// Commands im mod-Block wegen rustc 1.94 E0255 Workaround (siehe CLAUDE.md)
#![allow(clippy::module_inception)]

use super::path_safety::{safe_resolve, safe_resolve_user_claude, SkillDirEntry};
use super::session_delete::delete_claude_session_in;
use super::session_history::{scan_sessions_for_project, ClaudeSessionSummary};
use crate::error::ADPError;

#[tauri::command]
pub async fn read_project_file(folder: String, relative_path: String) -> Result<String, ADPError> {
    let path = safe_resolve(&folder, &relative_path)?;

    if !path.exists() || !path.is_file() {
        return Ok(String::new());
    }

    std::fs::read_to_string(&path)
        .map_err(|e| ADPError::file_io(format!("Failed to read file '{}': {}", relative_path, e)))
}

/// Max file size for write operations (10 MB)
const MAX_WRITE_SIZE: usize = 10 * 1024 * 1024;

/// Validate that `folder`/`relative_path` resolves to an existing `.md` file
/// within the size limit. Shared by the `open_md_in_editor` command and the PTY
/// sentinel detector. Returns the resolved absolute path on success.
///
/// No subtree confinement: callers pass `folder` = the file's own parent dir and
/// `relative_path` = the file name, so any absolute path is reachable while
/// `safe_resolve` still canonicalizes away `..`.
#[allow(dead_code)]
pub(crate) fn validate_md_target(
    folder: &str,
    relative_path: &str,
) -> Result<std::path::PathBuf, ADPError> {
    let path = safe_resolve(folder, relative_path)?;

    if !path.exists() || !path.is_file() {
        return Err(ADPError::validation(format!(
            "Markdown file not found: {}",
            relative_path
        )));
    }

    let is_md = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("md"))
        .unwrap_or(false);
    if !is_md {
        return Err(ADPError::validation(format!(
            "Not a Markdown (.md) file: {}",
            relative_path
        )));
    }

    let size = std::fs::metadata(&path)
        .map(|m| m.len() as usize)
        .unwrap_or(0);
    if size > MAX_WRITE_SIZE {
        return Err(ADPError::validation(format!(
            "File too large: {}MB exceeds {}MB limit",
            size / (1024 * 1024),
            MAX_WRITE_SIZE / (1024 * 1024)
        )));
    }

    Ok(path)
}

#[tauri::command]
pub async fn write_project_file(
    folder: String,
    relative_path: String,
    content: String,
) -> Result<(), ADPError> {
    // Size limit to prevent OOM / disk exhaustion
    if content.len() > MAX_WRITE_SIZE {
        return Err(ADPError::validation(format!(
            "File too large: {}MB exceeds {}MB limit",
            content.len() / (1024 * 1024),
            MAX_WRITE_SIZE / (1024 * 1024)
        )));
    }

    // Reject null bytes (binary content)
    if content.contains('\0') {
        return Err(ADPError::validation(
            "File contains null bytes — binary files are not supported",
        ));
    }

    let path = safe_resolve(&folder, &relative_path)?;

    if path.is_dir() {
        return Err(ADPError::validation(format!(
            "Cannot write to directory: {}",
            relative_path
        )));
    }

    if let Some(parent) = path.parent() {
        if !parent.exists() {
            log::warn!("Creating directory for write: {}", parent.display());
            std::fs::create_dir_all(parent)
                .map_err(|e| ADPError::file_io(format!("Failed to create directory: {}", e)))?;
        }
    }

    std::fs::write(&path, content)
        .map_err(|e| ADPError::file_io(format!("Failed to write file '{}': {}", relative_path, e)))
}

#[tauri::command]
pub async fn list_project_dir(
    folder: String,
    relative_path: String,
) -> Result<Vec<String>, ADPError> {
    let path = safe_resolve(&folder, &relative_path)?;

    if !path.exists() || !path.is_dir() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(&path).map_err(|e| {
        ADPError::file_io(format!(
            "Failed to read directory '{}': {}",
            relative_path, e
        ))
    })?;

    for entry in read_dir.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            entries.push(name.to_string());
        }
    }

    entries.sort();
    Ok(entries)
}

/// Scan Claude CLI session history from ~/.claude/projects/ for a given project folder.
#[tauri::command]
pub async fn scan_claude_sessions(folder: String) -> Result<Vec<ClaudeSessionSummary>, ADPError> {
    scan_sessions_for_project(&folder)
}

/// Move a Claude CLI session to the OS trash. Removes the entire session
/// directory (`<slug>/<uuid>/`, including any `subagents/` subfolder) or
/// the flat `<slug>/<uuid>.jsonl` file when the session uses the older
/// layout. Idempotent: returns `Ok(())` when nothing matches, so the
/// frontend can call this even if the list is stale.
#[tauri::command]
pub async fn delete_claude_session(folder: String, session_id: String) -> Result<(), ADPError> {
    let claude_projects_root = match dirs::home_dir() {
        Some(home) => home.join(".claude").join("projects"),
        None => return Ok(()),
    };
    delete_claude_session_in(&claude_projects_root, &folder, &session_id)
}

/// Read a file from the user's ~/.claude/ directory.
#[tauri::command]
pub async fn read_user_claude_file(relative_path: String) -> Result<String, ADPError> {
    let path = safe_resolve_user_claude(&relative_path)?;

    if !path.exists() || !path.is_file() {
        return Ok(String::new());
    }

    std::fs::read_to_string(&path)
        .map_err(|e| ADPError::file_io(format!("Failed to read file: {}", e)))
}

/// List entries in a subdirectory under ~/.claude/.
/// Returns file/dir names sorted alphabetically.
#[tauri::command]
pub async fn list_user_claude_dir(relative_path: String) -> Result<Vec<String>, ADPError> {
    let path = safe_resolve_user_claude(&relative_path)?;

    if !path.exists() || !path.is_dir() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(&path).map_err(|e| {
        ADPError::file_io(format!(
            "Failed to read directory '{}': {}",
            relative_path, e
        ))
    })?;

    for entry in read_dir.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            entries.push(name.to_string());
        }
    }

    entries.sort();
    Ok(entries)
}

/// List all skill directories under .claude/skills/, returning each skill's
/// SKILL.md content and whether it has a reference/ subdirectory.
/// This batches N+1 IPC calls into a single round-trip.
#[tauri::command]
pub async fn list_skill_dirs(folder: String) -> Result<Vec<SkillDirEntry>, ADPError> {
    let path = safe_resolve(&folder, ".claude/skills")?;

    if !path.exists() || !path.is_dir() {
        return Ok(Vec::new());
    }

    let mut skills = Vec::new();
    let read_dir = std::fs::read_dir(&path)
        .map_err(|e| ADPError::file_io(format!("Failed to read skills directory: {}", e)))?;

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let entry_path = entry.path();
        let dir_name = match entry.file_name().to_str() {
            Some(name) => name.to_string(),
            None => continue,
        };

        if entry_path.is_file() {
            // Simple .md skill file — read content directly
            if !dir_name.ends_with(".md") {
                continue;
            }
            let content = std::fs::read_to_string(&entry_path).unwrap_or_default();
            skills.push(SkillDirEntry {
                dir_name,
                content,
                has_reference_dir: false,
            });
            continue;
        }

        if !entry_path.is_dir() {
            continue;
        }

        // Look for SKILL.md in the subdirectory
        let skill_md = entry_path.join("SKILL.md");
        let content = if skill_md.is_file() {
            std::fs::read_to_string(&skill_md).unwrap_or_default()
        } else {
            // Also try lowercase skill.md
            let skill_md_lower = entry_path.join("skill.md");
            if skill_md_lower.is_file() {
                std::fs::read_to_string(&skill_md_lower).unwrap_or_default()
            } else {
                String::new()
            }
        };

        let has_reference_dir = entry_path.join("reference").is_dir();

        skills.push(SkillDirEntry {
            dir_name,
            content,
            has_reference_dir,
        });
    }

    skills.sort_by(|a, b| a.dir_name.cmp(&b.dir_name));
    Ok(skills)
}

/// Resolve the main working tree root for a folder that may be inside a git worktree.
///
/// In a linked worktree, `session.folder` points to the worktree path. CLAUDE.md
/// should be read from the main working tree so the user always sees the project's
/// canonical config file, not a branch-specific (possibly outdated or missing) copy.
///
/// Uses `git worktree list --porcelain` — the first `worktree <path>` line is
/// always the main working tree, regardless of where the command is run from.
/// Falls back to the original folder on any error (non-git dirs, no git installed, etc.).
#[tauri::command]
pub async fn resolve_project_root(folder: String) -> Result<String, ADPError> {
    match crate::github::commands::run_command(&folder, "git", &["worktree", "list", "--porcelain"])
    {
        Ok(output) => {
            for line in output.lines() {
                if let Some(path) = line.strip_prefix("worktree ") {
                    return Ok(path.to_string());
                }
            }
            Ok(folder)
        }
        // Not a git repo or git not available — silently fall back to the original path
        Err(_) => Ok(folder),
    }
}

// ============================================================================
// Tauri Command Integration Tests (Issue #91 / QA-16)
// ============================================================================
//
// Tests the 3 public Tauri commands via the in-module command fns:
//   - read_project_file
//   - write_project_file
//   - list_project_dir
//
// Uses tauri::async_runtime::block_on (Option A) to drive the async fns
// without requiring a tokio dev-dependency.
#[cfg(test)]
mod command_tests {
    use super::{list_project_dir, read_project_file, validate_md_target, write_project_file};
    use std::fs;
    use tempfile::TempDir;

    fn setup() -> TempDir {
        TempDir::new().expect("create tempdir")
    }

    fn base_of(tmp: &TempDir) -> String {
        tmp.path().to_string_lossy().to_string()
    }

    // --- read_project_file (6 tests) ---

    #[test]
    fn test_read_project_file_roundtrip() {
        let tmp = setup();
        fs::write(tmp.path().join("test.md"), "hello world").expect("write fixture");

        let result =
            tauri::async_runtime::block_on(read_project_file(base_of(&tmp), "test.md".to_string()));

        assert_eq!(result.expect("read should succeed"), "hello world");
    }

    #[test]
    fn test_read_project_file_nonexistent_returns_empty() {
        // Contract: missing file → Ok("") (callers depend on this to handle
        // missing CLAUDE.md, hooks.json etc. without error plumbing).
        let tmp = setup();

        let result = tauri::async_runtime::block_on(read_project_file(
            base_of(&tmp),
            "does-not-exist.md".to_string(),
        ));

        assert_eq!(result.expect("missing file must yield Ok"), "");
    }

    #[test]
    fn test_read_project_file_blocks_traversal() {
        let tmp = setup();

        let result = tauri::async_runtime::block_on(read_project_file(
            base_of(&tmp),
            "../../etc/passwd".to_string(),
        ));

        let err = result.unwrap_err();
        assert!(
            err.message.contains("Path traversal detected"),
            "expected traversal error, got: {}",
            err.message
        );
    }

    #[test]
    fn test_read_project_file_utf8_bom() {
        let tmp = setup();
        let bom_content = "\u{FEFF}hello";
        fs::write(tmp.path().join("bom.txt"), bom_content).expect("write fixture");

        let result =
            tauri::async_runtime::block_on(read_project_file(base_of(&tmp), "bom.txt".to_string()));

        let out = result.expect("read should succeed");
        assert_eq!(out, bom_content);
        assert!(out.starts_with('\u{FEFF}'), "BOM must be preserved");
    }

    #[test]
    fn test_read_project_file_utf8_multibyte() {
        let tmp = setup();
        let content = "Schöne Grüße 🚀";
        fs::write(tmp.path().join("utf8.txt"), content).expect("write fixture");

        let result = tauri::async_runtime::block_on(read_project_file(
            base_of(&tmp),
            "utf8.txt".to_string(),
        ));

        assert_eq!(result.expect("read should succeed"), content);
    }

    #[test]
    fn test_read_project_file_invalid_utf8_fails_gracefully() {
        let tmp = setup();
        // Invalid UTF-8: lone high bytes that don't form valid sequences.
        let raw: [u8; 4] = [0xFF, 0xFE, 0x00, 0xFF];
        fs::write(tmp.path().join("binary.bin"), raw).expect("write fixture");

        let result = tauri::async_runtime::block_on(read_project_file(
            base_of(&tmp),
            "binary.bin".to_string(),
        ));

        // Must return Err (not panic). read_to_string fails on non-UTF-8.
        let err = result.unwrap_err();
        assert!(
            err.message.contains("Failed to read file"),
            "expected structured read error, got: {}",
            err.message
        );
    }

    // --- write_project_file (6 tests) ---

    #[test]
    fn test_write_project_file_creates_parent_dirs() {
        let tmp = setup();

        let result = tauri::async_runtime::block_on(write_project_file(
            base_of(&tmp),
            "new/nested/deep/file.md".to_string(),
            "content".to_string(),
        ));

        result.expect("write should succeed");
        let target = tmp.path().join("new/nested/deep/file.md");
        assert!(target.is_file(), "target file must exist");
        assert_eq!(
            fs::read_to_string(&target).expect("read back written file"),
            "content"
        );
    }

    #[test]
    fn test_write_project_file_overwrites_existing() {
        let tmp = setup();
        fs::write(tmp.path().join("file.md"), "first").expect("write fixture");

        let result = tauri::async_runtime::block_on(write_project_file(
            base_of(&tmp),
            "file.md".to_string(),
            "second".to_string(),
        ));

        result.expect("overwrite should succeed");
        assert_eq!(
            fs::read_to_string(tmp.path().join("file.md")).expect("read back overwritten file"),
            "second"
        );
        // No backup file created
        assert!(!tmp.path().join("file.md.bak").exists());
    }

    #[test]
    fn test_write_project_file_rejects_oversized() {
        let tmp = setup();
        // MAX_WRITE_SIZE = 10 MB → 10 * 1024 * 1024 + 1 byte
        let oversized = "a".repeat(10 * 1024 * 1024 + 1);

        let result = tauri::async_runtime::block_on(write_project_file(
            base_of(&tmp),
            "big.txt".to_string(),
            oversized,
        ));

        let err = result.unwrap_err();
        assert!(
            err.message.contains("File too large"),
            "expected size-limit error, got: {}",
            err.message
        );
        assert!(
            !tmp.path().join("big.txt").exists(),
            "oversized file must not be written"
        );
    }

    #[test]
    fn test_write_project_file_rejects_null_bytes() {
        let tmp = setup();

        let result = tauri::async_runtime::block_on(write_project_file(
            base_of(&tmp),
            "null.txt".to_string(),
            "hello\0world".to_string(),
        ));

        let err = result.unwrap_err();
        assert!(
            err.message.contains("null bytes"),
            "expected null-byte rejection, got: {}",
            err.message
        );
        assert!(
            !tmp.path().join("null.txt").exists(),
            "file with null bytes must not be written"
        );
    }

    #[test]
    fn test_write_project_file_rejects_directory_target() {
        let tmp = setup();
        fs::create_dir(tmp.path().join("somedir")).expect("create dir");

        let result = tauri::async_runtime::block_on(write_project_file(
            base_of(&tmp),
            "somedir".to_string(),
            "content".to_string(),
        ));

        let err = result.unwrap_err();
        assert!(
            err.message.contains("Cannot write to directory"),
            "expected directory-target rejection, got: {}",
            err.message
        );
    }

    #[test]
    fn test_write_project_file_blocks_traversal() {
        let tmp = setup();
        // Outer directory (parent of tmp) - we verify nothing escapes into here.
        let parent_dir = tmp
            .path()
            .parent()
            .expect("tempdir has parent")
            .to_path_buf();
        // Unique filename per run to avoid false positives from previous
        // runs that left state behind (Windows AV-lock race).
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let escape_name = format!("escape-test-qa16-{unique}.txt");
        let escape_target = parent_dir.join(&escape_name);

        let result = tauri::async_runtime::block_on(write_project_file(
            base_of(&tmp),
            format!("../{escape_name}"),
            "pwned".to_string(),
        ));

        let err = result.unwrap_err();
        assert!(
            err.message.contains("Path traversal detected"),
            "expected traversal error, got: {}",
            err.message
        );
        assert!(
            !escape_target.exists(),
            "file must NOT have been written outside tmp: {}",
            escape_target.display()
        );
    }

    #[test]
    fn test_write_project_file_blocks_absolute_windows_path() {
        // Absolute path as relative_path arg: PathBuf::join replaces base
        // when rhs is absolute. safe_resolve_with_base canonicalizes and
        // verifies starts_with(base) — must reject.
        let tmp = setup();

        // Target must NOT resolve inside tmp. Use a path guaranteed outside.
        let absolute_rhs = if cfg!(windows) {
            "C:\\Windows\\System32\\drivers\\etc\\hosts"
        } else {
            "/etc/passwd"
        };

        let result = tauri::async_runtime::block_on(write_project_file(
            base_of(&tmp),
            absolute_rhs.to_string(),
            "pwned".to_string(),
        ));

        // Must fail — either as traversal, or as write error, but NEVER succeed.
        assert!(
            result.is_err(),
            "absolute path as relative_path must be rejected, got: {result:?}"
        );
    }

    #[test]
    fn test_write_project_file_rejects_null_byte_in_path() {
        // Null byte in relative_path: Rust's OS layer rejects via InvalidInput.
        // Test locks that contract — no panic, structured error, no file written.
        let tmp = setup();

        let result = tauri::async_runtime::block_on(write_project_file(
            base_of(&tmp),
            "foo\0bar.txt".to_string(),
            "content".to_string(),
        ));

        assert!(
            result.is_err(),
            "null-byte in relative_path must be rejected, got: {result:?}"
        );
        // No file of any variation should exist
        assert!(
            tmp.path().read_dir().expect("read tmp").next().is_none(),
            "tmp dir must remain empty after null-byte rejection"
        );
    }

    // --- list_project_dir (3 tests) ---

    #[test]
    fn test_list_project_dir_sorted() {
        let tmp = setup();
        fs::write(tmp.path().join("c.txt"), "").expect("write c");
        fs::write(tmp.path().join("a.txt"), "").expect("write a");
        fs::write(tmp.path().join("b.txt"), "").expect("write b");

        let result =
            tauri::async_runtime::block_on(list_project_dir(base_of(&tmp), ".".to_string()));

        let entries = result.expect("list should succeed");
        assert_eq!(entries, vec!["a.txt", "b.txt", "c.txt"]);
    }

    #[test]
    fn test_list_project_dir_nonexistent_returns_empty() {
        // Contract: missing dir → Ok(vec![]) (callers depend on this for
        // optional directories like .claude/skills).
        let tmp = setup();

        let result = tauri::async_runtime::block_on(list_project_dir(
            base_of(&tmp),
            "no-such-subdir".to_string(),
        ));

        assert_eq!(
            result.expect("missing dir must yield Ok"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn test_list_project_dir_blocks_traversal() {
        let tmp = setup();

        let result =
            tauri::async_runtime::block_on(list_project_dir(base_of(&tmp), "../".to_string()));

        let err = result.unwrap_err();
        assert!(
            err.message.contains("Path traversal detected"),
            "expected traversal error, got: {}",
            err.message
        );
    }

    // --- validate_md_target (4 tests) ---

    #[test]
    fn validate_md_target_accepts_existing_md() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.md"), "# hi").unwrap();
        let res = validate_md_target(&tmp.path().to_string_lossy(), "a.md");
        assert!(res.is_ok());
        assert!(res.unwrap().ends_with("a.md"));
    }

    #[test]
    fn validate_md_target_rejects_non_md() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.txt"), "x").unwrap();
        let err = validate_md_target(&tmp.path().to_string_lossy(), "a.txt").unwrap_err();
        assert!(err.message.contains("Not a Markdown"));
    }

    #[test]
    fn validate_md_target_rejects_missing_file() {
        let tmp = tempfile::tempdir().unwrap();
        let err = validate_md_target(&tmp.path().to_string_lossy(), "nope.md").unwrap_err();
        assert!(err.message.contains("not found"));
    }

    #[test]
    fn validate_md_target_accepts_uppercase_extension() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("README.MD"), "x").unwrap();
        assert!(validate_md_target(&tmp.path().to_string_lossy(), "README.MD").is_ok());
    }
}
