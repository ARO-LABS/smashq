//! Integration tests for the session-diff snapshot/diff mechanism.
//!
//! Snapshot-Refs (`refs/agentic-explorer/session-<id>`) are created via
//! `git stash create` (or HEAD-Fallback) and persisted via `git update-ref`.
//! All tests own a TempDir + a real local git repo and shell out to the
//! `git` binary — same code path as production.

use smashq_lib::session::diff::{
    compute_session_diff, create_session_snapshot, delete_session_snapshot, has_session_diff,
    is_git_repo, FileStatus,
};
use std::path::Path;
use std::process::Command;
use tempfile::TempDir;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/// Spawn `git` with the given args in `dir`. Asserts success.
fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("failed to spawn git");
    assert!(
        out.status.success(),
        "git {args:?} failed: stdout={} stderr={}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Build a one-commit repo at `dir`. Returns the HEAD commit hash.
fn init_repo(dir: &Path) -> String {
    git(dir, &["init", "-q", "-b", "main"]);
    // Stabilize identity for stash create.
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "user.name", "Test"]);
    std::fs::write(dir.join("README.md"), "initial\n").unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "initial"]);
    let head = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["rev-parse", "HEAD"])
        .output()
        .unwrap();
    String::from_utf8_lossy(&head.stdout).trim().to_string()
}

/// Reads the value of a ref (returns None if missing).
fn ref_value(dir: &Path, ref_name: &str) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["rev-parse", "--verify", ref_name])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

// ---------------------------------------------------------------------------
// Tests — is_git_repo
// ---------------------------------------------------------------------------

#[test]
fn is_git_repo_false_for_plain_folder() {
    let dir = TempDir::new().unwrap();
    assert!(!is_git_repo(dir.path()));
}

#[test]
fn is_git_repo_true_for_initialized_repo() {
    let dir = TempDir::new().unwrap();
    init_repo(dir.path());
    assert!(is_git_repo(dir.path()));
}

// ---------------------------------------------------------------------------
// Tests — has_session_diff (leichtgewichtiger Probe-Check)
// ---------------------------------------------------------------------------

#[test]
fn has_session_diff_false_on_clean_tree() {
    // Snapshot direkt nach Commit, kein Edit → kein Diff.
    let dir = TempDir::new().unwrap();
    let head = init_repo(dir.path());
    let snap = create_session_snapshot(dir.path(), "probe-clean").unwrap();
    // Sanity: snapshot eines clean trees ist HEAD (stash create liefert
    // leeren Output, Fallback greift).
    assert_eq!(snap.commit, head);
    assert!(!has_session_diff(dir.path(), &snap.commit));
}

#[test]
fn has_session_diff_true_for_modified_tracked_file() {
    let dir = TempDir::new().unwrap();
    init_repo(dir.path());
    let snap = create_session_snapshot(dir.path(), "probe-mod").unwrap();
    // Existing tracked file editieren — git diff --quiet sieht das.
    std::fs::write(dir.path().join("README.md"), "edited\n").unwrap();
    assert!(has_session_diff(dir.path(), &snap.commit));
}

#[test]
fn has_session_diff_true_for_untracked_file_only() {
    // Tracked Files unveraendert, aber ein neuer Untracked-File →
    // git diff --quiet returnt 0 (clean), aber ls-files --others
    // findet das File. Probe muss true liefern.
    let dir = TempDir::new().unwrap();
    init_repo(dir.path());
    let snap = create_session_snapshot(dir.path(), "probe-untracked").unwrap();
    std::fs::write(dir.path().join("new_file.txt"), "fresh\n").unwrap();
    assert!(has_session_diff(dir.path(), &snap.commit));
}

#[test]
fn has_session_diff_false_for_broken_snapshot_ref() {
    // Snapshot-Commit existiert nicht (z.B. nach gc oder Race-Delete).
    // Probe muss `false` liefern — kein faelschliches Icon, kein Panik.
    let dir = TempDir::new().unwrap();
    init_repo(dir.path());
    // Beliebiger Hex-Hash, der garantiert nicht im Repo ist.
    assert!(!has_session_diff(
        dir.path(),
        "deadbeefcafebabe1234567890abcdef12345678",
    ));
}

// ---------------------------------------------------------------------------
// Tests — create_session_snapshot
// ---------------------------------------------------------------------------

#[test]
fn snapshot_clean_repo_falls_back_to_head() {
    let dir = TempDir::new().unwrap();
    let head = init_repo(dir.path());

    let snap = create_session_snapshot(dir.path(), "abc-123").unwrap();
    assert_eq!(snap.commit, head, "clean repo must snapshot HEAD");

    let stored =
        ref_value(dir.path(), "refs/agentic-explorer/session-abc-123").expect("ref must exist");
    assert_eq!(stored, head);
}

#[test]
fn snapshot_dirty_repo_uses_stash_create() {
    let dir = TempDir::new().unwrap();
    let head = init_repo(dir.path());

    // Mutate working tree so stash create has something to capture.
    std::fs::write(dir.path().join("README.md"), "modified\n").unwrap();

    let snap = create_session_snapshot(dir.path(), "dirty").unwrap();
    assert_ne!(
        snap.commit, head,
        "dirty repo snapshot must differ from HEAD"
    );

    // The snapshot commit references the working-tree state — git show
    // should hand us the "modified" content.
    let show = Command::new("git")
        .arg("-C")
        .arg(dir.path())
        .args(["show", &format!("{}:README.md", snap.commit)])
        .output()
        .unwrap();
    assert!(show.status.success());
    assert_eq!(
        String::from_utf8_lossy(&show.stdout).trim(),
        "modified",
        "stash commit must contain dirty content"
    );
}

#[test]
fn snapshot_in_detached_head_uses_head_commit() {
    let dir = TempDir::new().unwrap();
    let head = init_repo(dir.path());
    // Detach: `git checkout <sha>` puts HEAD on the commit directly.
    git(dir.path(), &["checkout", "-q", &head]);

    let snap = create_session_snapshot(dir.path(), "detached").unwrap();
    // Either stash-create (likely empty -> fallback to HEAD) or HEAD itself.
    // Both paths must hand us a non-empty hash that resolves.
    assert!(!snap.commit.is_empty());
    let stored = ref_value(dir.path(), "refs/agentic-explorer/session-detached")
        .expect("ref must exist even in detached HEAD");
    assert_eq!(stored, snap.commit);
}

// ---------------------------------------------------------------------------
// Tests — delete_session_snapshot
// ---------------------------------------------------------------------------

#[test]
fn delete_snapshot_removes_ref() {
    let dir = TempDir::new().unwrap();
    init_repo(dir.path());
    create_session_snapshot(dir.path(), "to-delete").unwrap();
    assert!(ref_value(dir.path(), "refs/agentic-explorer/session-to-delete").is_some());

    delete_session_snapshot(dir.path(), "to-delete").unwrap();
    assert!(
        ref_value(dir.path(), "refs/agentic-explorer/session-to-delete").is_none(),
        "ref must be gone after delete"
    );
}

#[test]
fn delete_snapshot_missing_ref_is_not_error() {
    let dir = TempDir::new().unwrap();
    init_repo(dir.path());
    // No snapshot created — delete must still succeed (warn, not fail).
    delete_session_snapshot(dir.path(), "never-existed").unwrap();
}

// ---------------------------------------------------------------------------
// Tests — compute_session_diff
// ---------------------------------------------------------------------------

#[test]
fn compute_diff_modified_added_deleted_files() {
    let dir = TempDir::new().unwrap();
    init_repo(dir.path());

    // Need a baseline file to delete.
    std::fs::write(dir.path().join("delete-me.txt"), "bye\n").unwrap();
    std::fs::write(dir.path().join("modify-me.txt"), "before\n").unwrap();
    git(dir.path(), &["add", "."]);
    git(dir.path(), &["commit", "-q", "-m", "baseline"]);

    // Snapshot at this state.
    let snap = create_session_snapshot(dir.path(), "compute").unwrap();

    // Mutate: modify, add, delete.
    std::fs::write(dir.path().join("modify-me.txt"), "after\n").unwrap();
    std::fs::write(dir.path().join("new-file.txt"), "fresh\n").unwrap();
    std::fs::remove_file(dir.path().join("delete-me.txt")).unwrap();

    // Stage added file so git diff sees it. (Untracked is also covered below.)
    git(dir.path(), &["add", "new-file.txt"]);

    let diff = compute_session_diff(dir.path(), "compute", &snap.commit, snap.created_at)
        .expect("diff must compute");

    let by_path: std::collections::HashMap<_, _> =
        diff.files.iter().map(|f| (f.path.clone(), f)).collect();

    let modified = by_path.get("modify-me.txt").expect("modified file");
    assert_eq!(modified.status, FileStatus::Modified);
    assert_eq!(modified.old_content.as_deref(), Some("before\n"));
    assert_eq!(modified.new_content.as_deref(), Some("after\n"));

    let added = by_path.get("new-file.txt").expect("added file");
    assert_eq!(added.status, FileStatus::Added);
    assert!(added.old_content.is_none());
    assert_eq!(added.new_content.as_deref(), Some("fresh\n"));

    let deleted = by_path.get("delete-me.txt").expect("deleted file");
    assert_eq!(deleted.status, FileStatus::Deleted);
    assert!(deleted.new_content.is_none());
    assert_eq!(deleted.old_content.as_deref(), Some("bye\n"));
    assert!(!diff.truncated);
}

#[test]
fn compute_diff_includes_untracked_file() {
    let dir = TempDir::new().unwrap();
    init_repo(dir.path());
    let snap = create_session_snapshot(dir.path(), "untrk").unwrap();

    // Pure untracked — not added to index.
    std::fs::write(dir.path().join("loose.txt"), "untracked\n").unwrap();

    let diff = compute_session_diff(dir.path(), "untrk", &snap.commit, snap.created_at).unwrap();
    let loose = diff
        .files
        .iter()
        .find(|f| f.path == "loose.txt")
        .expect("untracked file must appear in diff");
    assert_eq!(loose.status, FileStatus::Untracked);
    assert_eq!(loose.new_content.as_deref(), Some("untracked\n"));
}

#[test]
fn compute_diff_survives_git_gc_aggressive() {
    let dir = TempDir::new().unwrap();
    init_repo(dir.path());
    // Create dirty state so snapshot != HEAD — a stash-create commit that is
    // reachable ONLY via the ref. If the ref didn't keep it alive, gc would
    // drop it.
    std::fs::write(dir.path().join("README.md"), "dirty\n").unwrap();
    let snap = create_session_snapshot(dir.path(), "gc-test").unwrap();

    // Cleanup working tree state to ensure the stash commit is only reachable
    // through our ref.
    git(dir.path(), &["checkout", "--", "README.md"]);

    // Aggressive gc — must NOT prune the snapshot commit because the ref
    // anchors it.
    git(
        dir.path(),
        &["gc", "--prune=now", "--aggressive", "--quiet"],
    );

    // Snapshot ref still resolves and points to a valid commit.
    let resolved = ref_value(dir.path(), "refs/agentic-explorer/session-gc-test")
        .expect("ref must survive gc");
    assert_eq!(resolved, snap.commit);

    // Diff computation still works.
    let diff = compute_session_diff(dir.path(), "gc-test", &snap.commit, snap.created_at).unwrap();
    // README was modified between snapshot and current (checkout reverted it).
    let readme = diff
        .files
        .iter()
        .find(|f| f.path == "README.md")
        .expect("README must show as modified after revert");
    assert_eq!(readme.status, FileStatus::Modified);
}
