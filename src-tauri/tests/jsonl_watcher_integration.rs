//! Integration tests for the deterministic claude-session-id discovery
//! path that replaces `pickBestHistoryMatch` (frontend started_at heuristic).
//!
//! Bug guarded: title-to-session swap on app restart when two Claude
//! sessions in the same folder spawn within ~1s of each other. The frontend
//! heuristic assigned the wrong jsonl UUID to each runtime session card,
//! the wrong (UUID, title) pair was persisted via `sessionRestoreSync`, and
//! every restart inherited the swap.
//!
//! Contract: snapshot the project's UUID set BEFORE spawn, poll AFTER spawn
//! until a brand-new UUID appears, that UUID belongs to the spawned session
//! deterministically — no time-proximity matching needed.

use smashq_lib::session::file_reader::{
    folder_to_project_dir_name, snapshot_session_uuids_in, wait_for_new_session_uuid,
};
use std::fs;
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::Duration;
use tempfile::TempDir;

const FOLDER: &str = "C:\\Projects\\agentic-dashboard";
const UUID_A: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UUID_B: &str = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const UUID_C: &str = "cccccccc-cccc-cccc-cccc-cccccccccccc";

fn project_dir(root: &TempDir) -> std::path::PathBuf {
    let dir = root.path().join(folder_to_project_dir_name(FOLDER));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_flat(dir: &std::path::Path, uuid: &str) {
    fs::write(dir.join(format!("{}.jsonl", uuid)), b"{}").unwrap();
}

#[test]
fn returns_new_uuid_when_file_appears_before_timeout() {
    let root = TempDir::new().unwrap();
    let pd = project_dir(&root);
    write_flat(&pd, UUID_A); // Pre-existing transcript.

    let before = snapshot_session_uuids_in(root.path(), FOLDER);
    assert!(before.contains(UUID_A));

    // Simulate Claude writing the new jsonl ~200 ms after spawn — the
    // typical post-spawn latency in production. The barrier guarantees
    // the writer thread doesn't start until the watcher is ready, so the
    // test is not flaky on slow CI.
    let pd_clone = pd.clone();
    let barrier = Arc::new(Barrier::new(2));
    let writer_barrier = Arc::clone(&barrier);
    let writer = thread::spawn(move || {
        writer_barrier.wait();
        thread::sleep(Duration::from_millis(200));
        write_flat(&pd_clone, UUID_B);
    });

    barrier.wait();
    let result = wait_for_new_session_uuid(
        root.path(),
        FOLDER,
        &before,
        Duration::from_secs(2),
        Duration::from_millis(50),
    );

    writer.join().unwrap();
    assert_eq!(result, Some(UUID_B.to_string()));
}

#[test]
fn returns_none_on_timeout_when_no_new_file_appears() {
    let root = TempDir::new().unwrap();
    let pd = project_dir(&root);
    write_flat(&pd, UUID_A);

    let before = snapshot_session_uuids_in(root.path(), FOLDER);

    let result = wait_for_new_session_uuid(
        root.path(),
        FOLDER,
        &before,
        Duration::from_millis(300),
        Duration::from_millis(50),
    );

    assert_eq!(result, None);
}

#[test]
fn ignores_files_already_present_in_seen_set() {
    let root = TempDir::new().unwrap();
    let pd = project_dir(&root);
    write_flat(&pd, UUID_A);

    // Snapshot includes UUID_A — even if poll picks it up again, it must
    // not be mistaken for a "new" session. Without writing any new file,
    // the watcher should time out.
    let before = snapshot_session_uuids_in(root.path(), FOLDER);

    let result = wait_for_new_session_uuid(
        root.path(),
        FOLDER,
        &before,
        Duration::from_millis(300),
        Duration::from_millis(50),
    );

    assert_eq!(result, None);
}

#[test]
fn project_dir_does_not_exist_yet_then_appears() {
    // First-ever Claude session for this folder: project dir is created
    // by Claude on first spawn. Watcher must tolerate the dir not existing
    // at snapshot time and pick up the UUID once both the dir and the
    // jsonl materialise.
    let root = TempDir::new().unwrap();

    let before = snapshot_session_uuids_in(root.path(), FOLDER);
    assert!(before.is_empty());

    let root_path = root.path().to_path_buf();
    let barrier = Arc::new(Barrier::new(2));
    let writer_barrier = Arc::clone(&barrier);
    let writer = thread::spawn(move || {
        writer_barrier.wait();
        thread::sleep(Duration::from_millis(200));
        let pd = root_path.join(folder_to_project_dir_name(FOLDER));
        fs::create_dir_all(&pd).unwrap();
        write_flat(&pd, UUID_C);
    });

    barrier.wait();
    let result = wait_for_new_session_uuid(
        root.path(),
        FOLDER,
        &before,
        Duration::from_secs(2),
        Duration::from_millis(50),
    );

    writer.join().unwrap();
    assert_eq!(result, Some(UUID_C.to_string()));
}

#[test]
fn returns_some_when_multiple_new_uuids_appear() {
    // Race against another tool: two new files materialise between
    // snapshots. We do not promise WHICH one we return, only that we
    // return one of them — the spawn-site can decide what to do with it
    // (in production we expect one, log a warning if more).
    let root = TempDir::new().unwrap();
    let pd = project_dir(&root);

    let before = snapshot_session_uuids_in(root.path(), FOLDER);
    assert!(before.is_empty());

    let pd_clone = pd.clone();
    let barrier = Arc::new(Barrier::new(2));
    let writer_barrier = Arc::clone(&barrier);
    let writer = thread::spawn(move || {
        writer_barrier.wait();
        thread::sleep(Duration::from_millis(200));
        write_flat(&pd_clone, UUID_A);
        write_flat(&pd_clone, UUID_B);
    });

    barrier.wait();
    let result = wait_for_new_session_uuid(
        root.path(),
        FOLDER,
        &before,
        Duration::from_secs(2),
        Duration::from_millis(50),
    );

    writer.join().unwrap();
    let uuid = result.expect("must return some new uuid");
    assert!(
        uuid == UUID_A || uuid == UUID_B,
        "returned uuid must be one of the new ones, got {}",
        uuid
    );
}
