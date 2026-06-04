// src-tauri/src/session/file_reader/session_discovery.rs
//
// Deterministic claude-session-id discovery: snapshot the UUIDs visible for a
// project, diff two snapshots, and block until a brand-new UUID appears after a
// `claude` spawn. Replaces the fragile started_at proximity heuristic.

use super::session_history::{find_project_dir_in, is_uuid_like};
use std::path::Path;

/// Snapshot all Claude session UUIDs currently visible for a project folder.
///
/// Inspects `~/.claude/projects/<slug>/` and returns the set of UUIDs found
/// via either layout the scanner recognises (nested `<uuid>/<uuid>.jsonl`,
/// flat `<uuid>.jsonl`).
///
/// Pure function with explicit `claude_projects_root` parameter so tests
/// can pass a tempdir-based root. Returns an EMPTY set (not an error) when
/// the project dir does not exist yet — that case happens on first-ever
/// Claude session for a folder and is not exceptional.
///
/// Used by the deterministic claude-id discovery path: snapshot BEFORE
/// `claude` spawn, snapshot again once the first output event arrives, then
/// `diff_uuid_snapshots` yields the new session's UUID without any started_at
/// heuristic matching.
pub fn snapshot_session_uuids_in(
    claude_projects_root: &Path,
    folder: &str,
) -> std::collections::HashSet<String> {
    let mut uuids = std::collections::HashSet::new();

    let project_dir = match find_project_dir_in(claude_projects_root, folder) {
        Some(dir) => dir,
        None => return uuids,
    };

    let read_dir = match std::fs::read_dir(&project_dir) {
        Ok(rd) => rd,
        Err(_) => return uuids,
    };

    for entry in read_dir.flatten() {
        let name = match entry.file_name().to_str() {
            Some(n) => n.to_string(),
            None => continue,
        };
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };

        if ft.is_dir() {
            if is_uuid_like(&name) {
                let jsonl_path = entry.path().join(format!("{}.jsonl", name));
                if jsonl_path.is_file() {
                    uuids.insert(name);
                }
            }
        } else if ft.is_file() && name.ends_with(".jsonl") {
            let session_id = name.trim_end_matches(".jsonl");
            if is_uuid_like(session_id) {
                uuids.insert(session_id.to_string());
            }
        }
    }

    uuids
}

/// Pure: return UUIDs present in `after` but not in `before`.
///
/// Companion to `snapshot_session_uuids_in`. The single new UUID is the
/// freshly-spawned Claude session — used by the deterministic discovery
/// path to replace the fragile started_at proximity heuristic.
///
/// `pub(crate)` + `allow(dead_code)`: production `wait_for_new_session_uuid`
/// computes the set difference inline, so the only current callers are this
/// module's tests. Retained as a named crate-level helper (compiled into every
/// build, behavior unchanged) so the snapshot/diff contract stays available and
/// unit-testable in isolation.
#[allow(dead_code)]
pub(crate) fn diff_uuid_snapshots(
    before: &std::collections::HashSet<String>,
    after: &std::collections::HashSet<String>,
) -> Vec<String> {
    after.difference(before).cloned().collect()
}

/// Block the calling thread polling `~/.claude/projects/<slug>/` until a
/// brand-new session UUID appears (relative to `seen_uuids`) or `timeout`
/// elapses. Returns the new UUID or `None` on timeout.
///
/// Designed to be invoked from a background thread spawned RIGHT AFTER
/// `claude` is spawned: pass the snapshot taken BEFORE the spawn as
/// `seen_uuids`, then the first new UUID we observe IS the spawned
/// session — no started_at proximity matching needed.
///
/// **Synchronous on purpose**: avoids a `tokio` feature-bump
/// (`rt` is the only enabled feature at this commit) and keeps the
/// blocking nature explicit at the call site.
pub fn wait_for_new_session_uuid(
    claude_projects_root: &Path,
    folder: &str,
    seen_uuids: &std::collections::HashSet<String>,
    timeout: std::time::Duration,
    poll_interval: std::time::Duration,
) -> Option<String> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let current = snapshot_session_uuids_in(claude_projects_root, folder);
        if let Some(new_id) = current.difference(seen_uuids).next() {
            return Some(new_id.clone());
        }
        if std::time::Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(poll_interval);
    }
}

#[cfg(test)]
mod tests {
    use super::super::session_history::folder_to_project_dir_name;
    use super::*;
    use std::collections::HashSet;

    fn setup_temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("Failed to create temp dir")
    }

    fn write_flat_jsonl(project_dir: &Path, uuid: &str) {
        std::fs::write(project_dir.join(format!("{}.jsonl", uuid)), b"{}").unwrap();
    }

    fn write_nested_jsonl(project_dir: &Path, uuid: &str) {
        let dir = project_dir.join(uuid);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(format!("{}.jsonl", uuid)), b"{}").unwrap();
    }

    #[test]
    fn diff_uuid_snapshots_returns_only_new_entries() {
        let before: HashSet<String> = ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string()]
            .into_iter()
            .collect();
        let after: HashSet<String> = [
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string(),
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
        ]
        .into_iter()
        .collect();

        let new_uuids = diff_uuid_snapshots(&before, &after);
        assert_eq!(
            new_uuids,
            vec!["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string()]
        );
    }

    #[test]
    fn diff_uuid_snapshots_empty_when_no_new_entries() {
        let same: HashSet<String> = ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string()]
            .into_iter()
            .collect();
        assert!(diff_uuid_snapshots(&same, &same).is_empty());
    }

    #[test]
    fn diff_uuid_snapshots_returns_multiple_when_multiple_new() {
        let before: HashSet<String> = HashSet::new();
        let after: HashSet<String> = [
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string(),
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
        ]
        .into_iter()
        .collect();

        let mut new_uuids = diff_uuid_snapshots(&before, &after);
        new_uuids.sort();
        assert_eq!(
            new_uuids,
            vec![
                "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string(),
                "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
            ]
        );
    }

    #[test]
    fn snapshot_uuids_returns_empty_when_project_dir_missing() {
        let tmp = setup_temp_dir();
        let root = tmp.path();
        // No project dir created — snapshot must be empty, not error.
        let result = snapshot_session_uuids_in(root, "C:\\does\\not\\exist");
        assert!(result.is_empty());
    }

    #[test]
    fn snapshot_uuids_picks_up_flat_layout() {
        let tmp = setup_temp_dir();
        let root = tmp.path();
        let folder = "C:\\Projects\\agentic-dashboard";
        let project_dir = root.join(folder_to_project_dir_name(folder));
        std::fs::create_dir_all(&project_dir).unwrap();

        write_flat_jsonl(&project_dir, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

        let snap = snapshot_session_uuids_in(root, folder);
        assert!(snap.contains("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
        assert_eq!(snap.len(), 1);
    }

    #[test]
    fn snapshot_uuids_picks_up_nested_layout() {
        let tmp = setup_temp_dir();
        let root = tmp.path();
        let folder = "C:\\Projects\\agentic-dashboard";
        let project_dir = root.join(folder_to_project_dir_name(folder));
        std::fs::create_dir_all(&project_dir).unwrap();

        write_nested_jsonl(&project_dir, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

        let snap = snapshot_session_uuids_in(root, folder);
        assert!(snap.contains("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"));
        assert_eq!(snap.len(), 1);
    }

    #[test]
    fn snapshot_uuids_ignores_non_uuid_directories_and_files() {
        let tmp = setup_temp_dir();
        let root = tmp.path();
        let folder = "C:\\Projects\\agentic-dashboard";
        let project_dir = root.join(folder_to_project_dir_name(folder));
        std::fs::create_dir_all(&project_dir).unwrap();

        // Garbage that the scanner must NOT mistake for a session.
        std::fs::write(project_dir.join("README.md"), b"hi").unwrap();
        std::fs::create_dir_all(project_dir.join("memory")).unwrap();
        std::fs::write(project_dir.join("not-a-uuid.jsonl"), b"{}").unwrap();

        write_flat_jsonl(&project_dir, "cccccccc-cccc-cccc-cccc-cccccccccccc");

        let snap = snapshot_session_uuids_in(root, folder);
        assert_eq!(snap.len(), 1, "only the real UUID file must be counted");
        assert!(snap.contains("cccccccc-cccc-cccc-cccc-cccccccccccc"));
    }

    #[test]
    fn snapshot_diff_simulates_post_spawn_appearance() {
        // Simulates the production sequence: snapshot → spawn claude →
        // wait → snapshot → diff. The single new UUID is the spawned
        // session's id. This is the contract that replaces
        // pickBestHistoryMatch's started_at heuristic.
        let tmp = setup_temp_dir();
        let root = tmp.path();
        let folder = "C:\\Projects\\agentic-dashboard";
        let project_dir = root.join(folder_to_project_dir_name(folder));
        std::fs::create_dir_all(&project_dir).unwrap();

        // Pre-existing transcript from an earlier session.
        write_flat_jsonl(&project_dir, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        let before = snapshot_session_uuids_in(root, folder);

        // Simulate Claude writing the new session's jsonl.
        write_flat_jsonl(&project_dir, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
        let after = snapshot_session_uuids_in(root, folder);

        let new_uuids = diff_uuid_snapshots(&before, &after);
        assert_eq!(
            new_uuids,
            vec!["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string()]
        );
    }

    // ========================================================================
    // snapshot_session_uuids_in / wait_for_new_session_uuid
    // ========================================================================

    #[test]
    fn snapshot_uuids_handles_both_layouts_together() {
        let tmp = setup_temp_dir();
        let folder = "C:\\Projects\\app";
        let project_dir = tmp.path().join(folder_to_project_dir_name(folder));
        std::fs::create_dir_all(&project_dir).unwrap();
        write_flat_jsonl(&project_dir, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        write_nested_jsonl(&project_dir, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

        let snap = snapshot_session_uuids_in(tmp.path(), folder);
        assert_eq!(snap.len(), 2);
    }

    #[test]
    fn snapshot_uuids_ignores_nested_uuid_dir_without_jsonl() {
        let tmp = setup_temp_dir();
        let folder = "C:\\Projects\\app";
        let project_dir = tmp.path().join(folder_to_project_dir_name(folder));
        let uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        // UUID dir but no jsonl inside.
        std::fs::create_dir_all(project_dir.join(uuid)).unwrap();

        let snap = snapshot_session_uuids_in(tmp.path(), folder);
        assert!(snap.is_empty());
    }

    #[test]
    fn wait_for_new_session_returns_immediately_when_already_present() {
        let tmp = setup_temp_dir();
        let folder = "C:\\Projects\\app";
        let project_dir = tmp.path().join(folder_to_project_dir_name(folder));
        std::fs::create_dir_all(&project_dir).unwrap();
        let uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        write_flat_jsonl(&project_dir, uuid);

        // seen_uuids empty → the existing uuid is "new" → returned at once.
        let result = wait_for_new_session_uuid(
            tmp.path(),
            folder,
            &HashSet::new(),
            std::time::Duration::from_secs(5),
            std::time::Duration::from_millis(10),
        );
        assert_eq!(result, Some(uuid.to_string()));
    }

    #[test]
    fn wait_for_new_session_times_out_when_no_new_uuid() {
        let tmp = setup_temp_dir();
        let folder = "C:\\Projects\\app";
        let project_dir = tmp.path().join(folder_to_project_dir_name(folder));
        std::fs::create_dir_all(&project_dir).unwrap();
        let uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        write_flat_jsonl(&project_dir, uuid);

        let mut seen = HashSet::new();
        seen.insert(uuid.to_string());

        // The only uuid is already seen → no new uuid → timeout → None.
        let result = wait_for_new_session_uuid(
            tmp.path(),
            folder,
            &seen,
            std::time::Duration::from_millis(30),
            std::time::Duration::from_millis(10),
        );
        assert_eq!(result, None);
    }

    #[test]
    fn diff_uuid_snapshots_ignores_removed_entries() {
        // Entry present in `before` but not `after` → not in diff (diff = new only).
        let before: HashSet<String> = [
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string(),
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
        ]
        .into_iter()
        .collect();
        let after: HashSet<String> = ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa".to_string()]
            .into_iter()
            .collect();
        assert!(diff_uuid_snapshots(&before, &after).is_empty());
    }
}
