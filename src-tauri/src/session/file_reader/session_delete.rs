// src-tauri/src/session/file_reader/session_delete.rs
//
// Move a Claude CLI session (either on-disk layout) to the OS trash. UUID-
// validated up front and routed through the canonicalize-based traversal guard
// as defense-in-depth so a malformed id can never escape the project slug-dir.

use super::path_safety::safe_resolve_with_base;
use super::session_history::{find_project_dir_in, is_uuid_like};
use crate::error::ADPError;
use std::path::Path;

/// Move a Claude CLI session to the OS trash.
///
/// Handles both layouts the scanner recognises:
/// - Directory layout: `<slug>/<uuid>/` (with `<uuid>.jsonl` inside, plus
///   optional `subagents/`-folder — wandert komplett mit, weil wir auf
///   Folder-Ebene loeschen).
/// - Flat layout: `<slug>/<uuid>.jsonl` top-level.
///
/// Pure function with explicit `claude_projects_root` parameter — production
/// wrapper `delete_claude_session` injects `~/.claude/projects/`. Tests pass
/// a tempdir-based root.
///
/// **Idempotent**: Returns `Ok(())` when no slug-dir matches the folder OR
/// when the session is not found at either layout. The session-id is
/// UUID-validated up-front so a malformed id can never reach `trash::delete`
/// and never escape into another part of the user's home directory.
pub fn delete_claude_session_in(
    claude_projects_root: &Path,
    folder: &str,
    session_id: &str,
) -> Result<(), ADPError> {
    if !is_uuid_like(session_id) {
        return Err(ADPError::validation(format!(
            "Invalid session_id (must be UUID): '{}'",
            session_id
        )));
    }

    let slug_dir = match find_project_dir_in(claude_projects_root, folder) {
        Some(dir) => dir,
        None => return Ok(()), // No matching slug — idempotent
    };

    // Defense-in-depth: even though `is_uuid_like` rejects path separators
    // and `..`, run both candidate paths through the canonicalize-based
    // traversal guard so any future relaxation of UUID validation cannot
    // turn into an escape.
    let dir_target = safe_resolve_with_base(&slug_dir, session_id)?;
    let file_target = safe_resolve_with_base(&slug_dir, &format!("{}.jsonl", session_id))?;

    if dir_target.is_dir() {
        trash::delete(&dir_target).map_err(|e| {
            ADPError::file_io(format!("Failed to move session directory to trash: {}", e))
        })?;
        return Ok(());
    }

    if file_target.is_file() {
        trash::delete(&file_target).map_err(|e| {
            ADPError::file_io(format!("Failed to move session file to trash: {}", e))
        })?;
        return Ok(());
    }

    // Idempotent — session not found at either layout
    Ok(())
}

/// Move a per-project memory file (`projects/<dir>/memory/<file>` under
/// `~/.claude/`) to the OS trash.
///
/// The segment whitelist is the primary guard: exactly four `/`-separated
/// segments in the shape `projects/<dir>/memory/<file>`. Nothing else under
/// `~/.claude/` (settings.json, CLAUDE.md, skills, ...) is reachable through
/// this function, no matter what the frontend sends. The canonicalize-based
/// traversal guard runs on top as defense-in-depth, mirroring
/// `delete_claude_session_in`.
///
/// **Idempotent**: returns `Ok(())` when the file is already gone, so the
/// frontend can call this even if its list is stale.
pub fn delete_memory_file_in(claude_root: &Path, relative_path: &str) -> Result<(), ADPError> {
    let segments: Vec<&str> = relative_path.split('/').collect();
    let shape_ok = segments.len() == 4
        && segments[0] == "projects"
        && segments[2] == "memory"
        && segments
            .iter()
            .all(|s| !s.is_empty() && *s != "." && *s != ".." && !s.contains('\\'));
    if !shape_ok {
        return Err(ADPError::validation(format!(
            "Invalid memory file path (must be projects/<dir>/memory/<file>): '{}'",
            relative_path
        )));
    }

    let target = safe_resolve_with_base(claude_root, relative_path)?;

    if target.is_file() {
        trash::delete(&target).map_err(|e| {
            ADPError::file_io(format!("Failed to move memory file to trash: {}", e))
        })?;
    }

    // Idempotent — file already gone
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::session_history::folder_to_project_dir_name;
    use super::*;
    use std::fs;

    fn setup_temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("Failed to create temp dir")
    }

    // --- delete_claude_session_in tests ---
    //
    // Tests the pure variant that takes an explicit `claude_projects_root`.
    // Negative-paths (UUID-validation, idempotency on missing root/slug/session)
    // never invoke `trash::delete` and therefore pass even in environments
    // without a Recycle Bin. The three positive-path tests below DO call
    // `trash::delete` against a tempdir-rooted fixture; they assert only that
    // the source path is gone afterwards (not that anything lands in the trash),
    // which holds across Windows / Linux / macOS implementations.

    /// Canonical UUID-shaped string used by the delete tests. Matches the
    /// `is_uuid_like` heuristic (36 chars, hex + 4 dashes).
    const DELETE_TEST_UUID: &str = "12345678-90ab-cdef-1234-567890abcdef";

    #[test]
    fn test_delete_claude_session_in_rejects_non_uuid() {
        let tmp = setup_temp_dir();
        let result = delete_claude_session_in(tmp.path(), "any-folder", "not-a-uuid");
        assert!(result.is_err());
        assert!(
            result.unwrap_err().message.contains("Invalid session_id"),
            "expected validation error for non-uuid"
        );
    }

    #[test]
    fn test_delete_claude_session_in_rejects_traversal_in_session_id() {
        // Even a syntactically-not-a-UUID id with `..` must be rejected at
        // the validation gate, never reaching `safe_resolve_with_base`.
        let tmp = setup_temp_dir();
        let result = delete_claude_session_in(tmp.path(), "any-folder", "../../etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().message.contains("Invalid session_id"));
    }

    #[test]
    fn test_delete_claude_session_in_returns_ok_for_nonexistent_root() {
        // Mirrors the scanner contract: a missing ~/.claude/projects/ on
        // a fresh install must NOT surface as an error.
        let nonexistent = std::path::Path::new("/this/path/does/not/exist/anywhere");
        let result = delete_claude_session_in(nonexistent, "any-folder", DELETE_TEST_UUID);
        assert!(result.is_ok());
    }

    #[test]
    fn test_delete_claude_session_in_returns_ok_for_missing_slug() {
        let tmp = setup_temp_dir();
        // Root exists, slug-dir for the project does NOT — idempotent Ok
        let result = delete_claude_session_in(tmp.path(), "C:/Some/Project", DELETE_TEST_UUID);
        assert!(result.is_ok());
    }

    #[test]
    fn test_delete_claude_session_in_returns_ok_for_missing_session() {
        let tmp = setup_temp_dir();
        let folder = "C:/Some/Project";
        let slug_dir = tmp.path().join(folder_to_project_dir_name(folder));
        fs::create_dir_all(&slug_dir).unwrap();
        // Slug exists, session does not — idempotent Ok
        let result = delete_claude_session_in(tmp.path(), folder, DELETE_TEST_UUID);
        assert!(result.is_ok());
    }

    #[test]
    fn test_delete_claude_session_in_removes_directory_layout() {
        let tmp = setup_temp_dir();
        let folder = "C:/Some/Project";
        let slug_dir = tmp.path().join(folder_to_project_dir_name(folder));
        let session_dir = slug_dir.join(DELETE_TEST_UUID);
        fs::create_dir_all(&session_dir).unwrap();
        let jsonl_path = session_dir.join(format!("{}.jsonl", DELETE_TEST_UUID));
        fs::write(&jsonl_path, "{}").unwrap();

        let result = delete_claude_session_in(tmp.path(), folder, DELETE_TEST_UUID);
        assert!(result.is_ok(), "delete failed: {:?}", result);
        assert!(
            !session_dir.exists(),
            "session directory must be gone from source after trash"
        );
    }

    #[test]
    fn test_delete_claude_session_in_removes_flat_layout() {
        let tmp = setup_temp_dir();
        let folder = "C:/Some/Project";
        let slug_dir = tmp.path().join(folder_to_project_dir_name(folder));
        fs::create_dir_all(&slug_dir).unwrap();
        let jsonl_path = slug_dir.join(format!("{}.jsonl", DELETE_TEST_UUID));
        fs::write(&jsonl_path, "{}").unwrap();

        let result = delete_claude_session_in(tmp.path(), folder, DELETE_TEST_UUID);
        assert!(result.is_ok(), "delete failed: {:?}", result);
        assert!(
            !jsonl_path.exists(),
            "flat-layout session file must be gone from source after trash"
        );
    }

    #[test]
    fn test_delete_claude_session_in_takes_subagents_with_dir() {
        // Closes the contract: deleting on folder-level moves the entire
        // session-dir, including a `subagents/`-subfolder. Without this,
        // partial cleanup would leave orphan agent-meta files behind.
        let tmp = setup_temp_dir();
        let folder = "C:/Some/Project";
        let slug_dir = tmp.path().join(folder_to_project_dir_name(folder));
        let session_dir = slug_dir.join(DELETE_TEST_UUID);
        let subagents_dir = session_dir.join("subagents");
        fs::create_dir_all(&subagents_dir).unwrap();
        fs::write(
            session_dir.join(format!("{}.jsonl", DELETE_TEST_UUID)),
            "{}",
        )
        .unwrap();
        fs::write(subagents_dir.join("agent-1.meta.json"), "{}").unwrap();
        fs::write(subagents_dir.join("agent-2.meta.json"), "{}").unwrap();

        let result = delete_claude_session_in(tmp.path(), folder, DELETE_TEST_UUID);
        assert!(result.is_ok(), "delete failed: {:?}", result);
        assert!(
            !session_dir.exists(),
            "session directory and its subagents/ subfolder must be gone"
        );
    }

    // --- delete_memory_file_in tests ---
    //
    // Same philosophy as above: negative paths never reach `trash::delete`,
    // the positive path asserts only that the source file is gone.

    #[test]
    fn test_delete_memory_file_in_rejects_traversal() {
        let tmp = setup_temp_dir();
        let result = delete_memory_file_in(tmp.path(), "projects/../memory/x.md");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .message
            .contains("Invalid memory file path"));
    }

    #[test]
    fn test_delete_memory_file_in_rejects_paths_outside_memory_dirs() {
        let tmp = setup_temp_dir();
        for bad in [
            "settings.json",
            "CLAUDE.md",
            "projects/foo/other/file.md",
            "projects/foo/memory",
            "projects/foo/memory/sub/file.md",
            "projects/foo/memory/",
            "projects\\foo\\memory\\file.md",
        ] {
            let result = delete_memory_file_in(tmp.path(), bad);
            assert!(result.is_err(), "path '{}' must be rejected", bad);
        }
    }

    #[test]
    fn test_delete_memory_file_in_is_idempotent_when_file_missing() {
        let tmp = setup_temp_dir();
        let result = delete_memory_file_in(tmp.path(), "projects/foo/memory/gone.md");
        assert!(result.is_ok(), "missing file must be Ok (idempotent)");
    }

    #[test]
    fn test_delete_memory_file_in_moves_file_to_trash() {
        let tmp = setup_temp_dir();
        let memory_dir = tmp.path().join("projects").join("proj").join("memory");
        fs::create_dir_all(&memory_dir).expect("create memory dir");
        let file = memory_dir.join("note.md");
        fs::write(&file, "# note").expect("write memory file");

        let result = delete_memory_file_in(tmp.path(), "projects/proj/memory/note.md");
        assert!(result.is_ok(), "delete failed: {:?}", result);
        assert!(!file.exists(), "memory file must be gone");
        assert!(memory_dir.exists(), "memory dir itself must survive");
    }
}
