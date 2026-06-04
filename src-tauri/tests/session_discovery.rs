//! Wave-1 Layer-A integration tests for the session-discovery codepath.
//!
//! These tests exercise the pure variants extracted in Wave 0
//! (`parse_session_jsonl_str`, `find_project_dir_in`, `scan_sessions_for_project_in`)
//! against tempdir-based fixture filesystems. No mocks, no `~/.claude/`
//! interaction — every test owns its TempDir and writes real JSONL files.
//!
//! Plan reference: `reports/2026-05-08-session-loading-real-tests-PLAN.md`
//! Bugs guarded:
//!   - `#256` "m2 ghost session" backend-side correctness (m2_repro)
//!   - `#257` Discovery-Race assignment correctness (descend_sort + m2_repro)
//!   - JSONL size-cap (oversized_jsonl_is_skipped) — protects against OOM

use smashq_lib::session::file_reader::{
    find_project_dir_in, folder_to_project_dir_name, parse_session_jsonl_str,
    scan_sessions_for_project_in,
};
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

// ---------------------------------------------------------------------------
// Fixture builders — produce realistic Claude CLI JSONL content.
// ---------------------------------------------------------------------------

/// Build a JSON line for a user message. Text MUST be JSON-safe (no quotes,
/// no backslashes); tests that need richer text should serialize via serde_json.
fn user_msg_line(timestamp: &str, text: &str) -> String {
    debug_assert!(
        !text.contains('"') && !text.contains('\\'),
        "user_msg_line text must be JSON-safe (no quotes, no backslashes); got: {:?}",
        text
    );
    format!(
        r#"{{"type":"user","timestamp":"{}","message":{{"content":"{}"}},"isSidechain":false,"isMeta":false}}"#,
        timestamp, text
    )
}

/// Build a sidechain user message (should NOT count as a user turn).
fn user_msg_line_sidechain(timestamp: &str, text: &str) -> String {
    debug_assert!(!text.contains('"') && !text.contains('\\'));
    format!(
        r#"{{"type":"user","timestamp":"{}","message":{{"content":"{}"}},"isSidechain":true,"isMeta":false}}"#,
        timestamp, text
    )
}

/// Build a user message whose content is a `tool_result` array (should NOT
/// count as a user turn — these are CLI-injected, not human-typed).
fn user_msg_line_tool_result(timestamp: &str, tool_use_id: &str) -> String {
    format!(
        r#"{{"type":"user","timestamp":"{}","message":{{"content":[{{"type":"tool_result","tool_use_id":"{}","content":"ok"}}]}},"isSidechain":false,"isMeta":false}}"#,
        timestamp, tool_use_id
    )
}

/// Build a user message with `cwd` and `gitBranch` extras.
fn user_msg_line_with_meta(timestamp: &str, text: &str, cwd: &str, branch: &str) -> String {
    debug_assert!(!text.contains('"') && !text.contains('\\'));
    format!(
        r#"{{"type":"user","timestamp":"{}","message":{{"content":"{}"}},"cwd":"{}","gitBranch":"{}","isSidechain":false,"isMeta":false}}"#,
        timestamp, text, cwd, branch
    )
}

/// Build a user message line WITHOUT a timestamp field.
fn user_msg_line_no_timestamp(text: &str) -> String {
    debug_assert!(!text.contains('"') && !text.contains('\\'));
    format!(
        r#"{{"type":"user","message":{{"content":"{}"}},"isSidechain":false,"isMeta":false}}"#,
        text
    )
}

/// Build a JSON line for an assistant message with model + simple text.
fn assistant_msg_line(timestamp: &str, model: &str, text: &str) -> String {
    debug_assert!(!text.contains('"') && !text.contains('\\'));
    format!(
        r#"{{"type":"assistant","timestamp":"{}","message":{{"model":"{}","content":"{}"}}}}"#,
        timestamp, model, text
    )
}

/// Set up a tempdir that mimics `~/.claude/projects/`. Returns the TempDir
/// (drop = cleanup) and the path that should be passed to `*_in` functions
/// as `claude_projects_root`.
fn setup_fake_projects_root() -> (TempDir, PathBuf) {
    let tmp = TempDir::new().expect("create tempdir");
    let projects_root = tmp.path().to_path_buf();
    (tmp, projects_root)
}

/// Within a `projects_root`, create the slug-encoded subdir for the given
/// folder path and return the subdir path. Equivalent to what the Claude CLI
/// would create when a session starts in that working dir.
///
/// Delegates to the production `folder_to_project_dir_name` so this helper
/// can never silently drift from the slug logic the scanner enforces.
fn make_project_subdir(projects_root: &std::path::Path, folder: &str) -> PathBuf {
    let slug = folder_to_project_dir_name(folder);
    let dir = projects_root.join(slug);
    fs::create_dir_all(&dir).expect("create project subdir");
    dir
}

/// Write a JSONL session file at `<project_subdir>/<uuid>.jsonl` (top-level
/// layout). Returns the full file path. The nested layout
/// `<project_subdir>/<uuid>/<uuid>.jsonl` is built by `write_nested_jsonl_fixture`.
fn write_jsonl_fixture(project_subdir: &std::path::Path, uuid: &str, lines: &[String]) -> PathBuf {
    let path = project_subdir.join(format!("{}.jsonl", uuid));
    let content = lines.join("\n");
    fs::write(&path, content).expect("write jsonl fixture");
    path
}

/// Write a JSONL session file in the nested layout `<project_subdir>/<uuid>/<uuid>.jsonl`,
/// optionally placing `count` `*.meta.json` files in a sibling `subagents/`
/// directory so the scanner's subagent counter is exercised. Returns the
/// outer subdirectory path (for further fixture additions).
fn write_nested_jsonl_fixture(
    project_subdir: &std::path::Path,
    uuid: &str,
    lines: &[String],
    subagent_count: u32,
) -> PathBuf {
    let outer = project_subdir.join(uuid);
    fs::create_dir_all(&outer).expect("create nested uuid dir");
    let jsonl = outer.join(format!("{}.jsonl", uuid));
    fs::write(&jsonl, lines.join("\n")).expect("write nested jsonl");

    if subagent_count > 0 {
        let subagents_dir = outer.join("subagents");
        fs::create_dir_all(&subagents_dir).expect("create subagents dir");
        for i in 0..subagent_count {
            fs::write(subagents_dir.join(format!("agent-{i}.meta.json")), "{}")
                .expect("write subagent meta");
        }
    }
    outer
}

// ---------------------------------------------------------------------------
// A1.2 — parse_session_jsonl_str: 6 edge cases
// ---------------------------------------------------------------------------

#[test]
fn parse_str_empty_content_returns_none() {
    // Already covered by inline smoke test, but locked here as integration
    // contract too — pure-API stability across the crate boundary.
    assert!(parse_session_jsonl_str("", "uuid-1").is_none());
}

#[test]
fn parse_str_only_corrupted_lines_returns_none() {
    let content = "{ this is not valid json }\n{ neither is this }";
    let result = parse_session_jsonl_str(content, "uuid-1");
    // No valid JSON → no user turns → no title → None.
    assert!(result.is_none());
}

#[test]
fn parse_str_assistant_only_returns_none() {
    // A session with only assistant messages has user_turns == 0 and
    // title is never assigned → returns None.
    let content = assistant_msg_line("2026-05-08T10:00:00Z", "claude-opus-4", "Hi there");
    assert!(parse_session_jsonl_str(&content, "uuid-1").is_none());
}

#[test]
fn parse_str_extracts_started_and_ended_at() {
    let lines = [
        user_msg_line("2026-05-08T10:00:00Z", "first"),
        assistant_msg_line("2026-05-08T10:00:30Z", "claude", "ack"),
        user_msg_line("2026-05-08T10:01:00Z", "second"),
    ];
    let result = parse_session_jsonl_str(&lines.join("\n"), "uuid-x").unwrap();
    assert_eq!(result.started_at, "2026-05-08T10:00:00Z");
    assert_eq!(result.ended_at, "2026-05-08T10:01:00Z");
    assert_eq!(result.user_turns, 2);
    // First user turn becomes the title (truncated to 120 chars, but "first"
    // is short enough to pass through verbatim).
    assert_eq!(result.title, "first");
}

#[test]
fn parse_str_invalid_timestamp_string_passes_through() {
    // The parser stores `timestamp` as-is, no date parsing. This locks that
    // contract: invalid strings don't crash, they just propagate to the UI
    // which is responsible for formatting / fallback.
    let content = user_msg_line("not-a-real-date", "hi");
    let result = parse_session_jsonl_str(&content, "uuid-1").unwrap();
    assert_eq!(result.started_at, "not-a-real-date");
}

#[test]
fn parse_str_truncates_long_title_to_120_chars() {
    let long_text = "a".repeat(200);
    let content = user_msg_line("2026-05-08T10:00:00Z", &long_text);
    let result = parse_session_jsonl_str(&content, "uuid-1").unwrap();
    // Title is truncated to 120 chars (per parse_session_jsonl_str logic).
    assert_eq!(result.title.chars().count(), 120);
}

// ---------------------------------------------------------------------------
// A1.3 — find_project_dir_in: 4 cases
// ---------------------------------------------------------------------------

#[test]
fn find_project_dir_in_exact_slug_match() {
    let (_tmp, root) = setup_fake_projects_root();
    fs::create_dir_all(root.join("C--Projects-myapp")).unwrap();

    let result = find_project_dir_in(&root, r"C:\Projects\myapp");
    assert!(result.is_some());
    assert!(result.unwrap().ends_with("C--Projects-myapp"));
}

#[test]
fn find_project_dir_in_case_insensitive_match() {
    let (_tmp, root) = setup_fake_projects_root();
    // Disk has lowercase, query is mixed-case
    fs::create_dir_all(root.join("c--projects-myapp")).unwrap();

    let result = find_project_dir_in(&root, r"C:\Projects\MyApp");
    assert!(result.is_some());
    let found = result.unwrap();
    assert!(found.ends_with("c--projects-myapp"));
}

#[test]
fn find_project_dir_in_returns_none_when_no_match() {
    let (_tmp, root) = setup_fake_projects_root();
    fs::create_dir_all(root.join("C--Projects-other")).unwrap();

    let result = find_project_dir_in(&root, r"C:\Projects\myapp");
    assert!(result.is_none());
}

#[test]
fn find_project_dir_in_returns_none_when_root_absent() {
    let nonexistent = std::path::Path::new("/this/projects/root/does/not/exist");
    let result = find_project_dir_in(nonexistent, r"C:\Projects\anything");
    assert!(result.is_none());
}

// ---------------------------------------------------------------------------
// A1.4 — scan_sessions_for_project_in: 3 cases
// ---------------------------------------------------------------------------

#[test]
fn scan_empty_project_dir_returns_empty_vec() {
    let (_tmp, root) = setup_fake_projects_root();
    // Project subdir exists but contains no JSONL files
    make_project_subdir(&root, r"C:\Projects\empty");

    let result = scan_sessions_for_project_in(&root, r"C:\Projects\empty").unwrap();
    assert!(result.is_empty());
}

#[test]
fn scan_three_sessions_returns_desc_by_started_at() {
    let (_tmp, root) = setup_fake_projects_root();
    let proj = make_project_subdir(&root, r"C:\Projects\sorted");

    write_jsonl_fixture(
        &proj,
        "11111111-1111-4111-8111-111111111111",
        &[user_msg_line("2026-05-08T08:00:00Z", "alt")],
    );
    write_jsonl_fixture(
        &proj,
        "22222222-2222-4222-8222-222222222222",
        &[user_msg_line("2026-05-08T10:00:00Z", "neu")],
    );
    write_jsonl_fixture(
        &proj,
        "33333333-3333-4333-8333-333333333333",
        &[user_msg_line("2026-05-08T09:00:00Z", "mittel")],
    );

    let result = scan_sessions_for_project_in(&root, r"C:\Projects\sorted").unwrap();
    assert_eq!(result.len(), 3);
    // DESC: newest first
    assert_eq!(result[0].started_at, "2026-05-08T10:00:00Z");
    assert_eq!(result[1].started_at, "2026-05-08T09:00:00Z");
    assert_eq!(result[2].started_at, "2026-05-08T08:00:00Z");
}

#[test]
fn scan_mix_of_valid_and_corrupt_returns_only_valid() {
    let (_tmp, root) = setup_fake_projects_root();
    let proj = make_project_subdir(&root, r"C:\Projects\mixed");

    // Valid session
    write_jsonl_fixture(
        &proj,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        &[user_msg_line("2026-05-08T10:00:00Z", "valid")],
    );
    // Corrupted file (filename is uuid-shaped, content is garbage)
    fs::write(
        proj.join("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl"),
        "not even close to JSON\n{still broken",
    )
    .unwrap();

    let result = scan_sessions_for_project_in(&root, r"C:\Projects\mixed").unwrap();
    // Corrupt file produces no valid session (user_turns == 0, title empty → None)
    // → only the valid one in the result.
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].session_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
}

// ---------------------------------------------------------------------------
// A1.5 — m2-Bug-Repro: three sessions in same folder, distinct UUIDs
// ---------------------------------------------------------------------------

#[test]
fn m2_three_same_folder_sessions_returned_distinct() {
    // Locks the backend invariant the m2 ghost-session bug exploited:
    // when three sessions exist in the same folder with distinct started_at
    // timestamps (here 100ms apart), scan returns all three with distinct
    // UUIDs — never collapses them. The frontend Discovery layer then
    // closest-timestamp-matches each to its card.
    let (_tmp, root) = setup_fake_projects_root();
    let proj = make_project_subdir(&root, r"C:\Projects\m2");

    write_jsonl_fixture(
        &proj,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        &[user_msg_line("2026-05-08T10:00:00.100Z", "card-1")],
    );
    write_jsonl_fixture(
        &proj,
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        &[user_msg_line("2026-05-08T10:00:00.200Z", "card-2")],
    );
    write_jsonl_fixture(
        &proj,
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        &[user_msg_line("2026-05-08T10:00:00.300Z", "card-3")],
    );

    let result = scan_sessions_for_project_in(&root, r"C:\Projects\m2").unwrap();
    assert_eq!(result.len(), 3, "all three sessions must be present");

    let uuids: std::collections::HashSet<&str> =
        result.iter().map(|s| s.session_id.as_str()).collect();
    assert_eq!(uuids.len(), 3, "UUIDs must be distinct (no collapse)");
    assert!(uuids.contains("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    assert!(uuids.contains("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));
    assert!(uuids.contains("cccccccc-cccc-4ccc-8ccc-cccccccccccc"));

    // DESC sort on started_at — newest (card-3) first
    assert_eq!(result[0].title, "card-3");
    assert_eq!(result[2].title, "card-1");
}

// ---------------------------------------------------------------------------
// A1.6 — JSONL size cap: oversized files are skipped, no OOM
// ---------------------------------------------------------------------------

#[test]
fn oversized_jsonl_is_skipped() {
    // Locks the size-cap contract added in Wave 1: a file larger than
    // MAX_JSONL_SIZE_BYTES (100 MiB) is skipped at the wrapper level so the
    // pure parser never sees an unbounded allocation.
    //
    // Strengthening (post-review): we embed a valid JSON line at the start
    // of the oversized file. If the cap is ever bumped above 101 MiB or
    // removed, the oversized file would be read, the valid prefix would
    // parse as a session, and result.len() becomes 2 — failing the test
    // loudly instead of passing silently on a NUL-byte read that produces
    // zero valid lines.
    let (_tmp, root) = setup_fake_projects_root();
    let proj = make_project_subdir(&root, r"C:\Projects\big");

    let oversized_path = proj.join("dddddddd-dddd-4ddd-8ddd-dddddddddddd.jsonl");
    // Step 1: write valid JSONL prefix with newline so `lines()` separates
    // the valid content from the trailing NUL bytes.
    let valid_prefix = format!(
        "{}\n",
        user_msg_line("2026-05-08T11:00:00Z", "ghost-if-cap-bypassed")
    );
    fs::write(&oversized_path, &valid_prefix).expect("write prefix");

    // Step 2: extend file to 101 MiB via set_len. Sparse on NTFS/ext4/APFS,
    // so disk write is microseconds, not minutes. metadata.len() returns
    // the logical 101 MiB which is what the cap check sees.
    let f = fs::OpenOptions::new()
        .write(true)
        .open(&oversized_path)
        .expect("open for set_len");
    f.set_len(101 * 1024 * 1024).expect("set_len");
    drop(f);

    // Plus one valid session — the cap-firing assertion is "result has only
    // this one entry, NOT two".
    write_jsonl_fixture(
        &proj,
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        &[user_msg_line("2026-05-08T10:00:00Z", "small-and-valid")],
    );

    let result = scan_sessions_for_project_in(&root, r"C:\Projects\big").unwrap();

    assert_eq!(
        result.len(),
        1,
        "oversized JSONL must be skipped — if this fails with len 2, the cap was bypassed"
    );
    assert_eq!(result[0].session_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
}

// ---------------------------------------------------------------------------
// Wave-1 follow-up tests (post-review): close gaps the reviewer surfaced.
// ---------------------------------------------------------------------------

#[test]
fn scan_filters_non_uuid_filenames() {
    // The is_uuid_like() filter (file_reader.rs:192) protects against the
    // scanner ingesting unrelated .jsonl files (notes, exports, backups).
    // If someone weakens that check (removes length test or dash-count
    // test), this test starts ingesting "notes.jsonl" and breaks loudly.
    let (_tmp, root) = setup_fake_projects_root();
    let proj = make_project_subdir(&root, r"C:\Projects\filter");

    // Valid session
    write_jsonl_fixture(
        &proj,
        "12345678-1234-4234-8234-123456789012",
        &[user_msg_line("2026-05-08T10:00:00Z", "real")],
    );
    // Non-UUID filename — must be filtered
    fs::write(
        proj.join("notes.jsonl"),
        user_msg_line("2026-05-08T11:00:00Z", "notes-content"),
    )
    .unwrap();
    // Short hex string — must be filtered too (length check)
    fs::write(proj.join("1234.jsonl"), "{}").unwrap();

    let result = scan_sessions_for_project_in(&root, r"C:\Projects\filter").unwrap();
    assert_eq!(result.len(), 1, "only UUID-named files should be ingested");
    assert_eq!(result[0].session_id, "12345678-1234-4234-8234-123456789012");
}

#[test]
fn scan_handles_nested_uuid_layout_with_subagents() {
    // Production supports both top-level `<uuid>.jsonl` AND nested
    // `<uuid>/<uuid>.jsonl` layouts (file_reader.rs:383-411). This test
    // covers the nested branch including subagent_count population — the
    // entire subagents/*.meta.json counting logic at file_reader.rs:389-403.
    let (_tmp, root) = setup_fake_projects_root();
    let proj = make_project_subdir(&root, r"C:\Projects\nested");

    write_nested_jsonl_fixture(
        &proj,
        "fafafafa-fafa-4afa-8afa-fafafafafafa",
        &[user_msg_line("2026-05-08T10:00:00Z", "nested-session")],
        3, // 3 subagent meta files
    );

    let result = scan_sessions_for_project_in(&root, r"C:\Projects\nested").unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].session_id, "fafafafa-fafa-4afa-8afa-fafafafafafa");
    assert_eq!(
        result[0].subagent_count, 3,
        "nested layout must populate subagent_count from sibling subagents/*.meta.json"
    );
}

#[test]
fn parse_str_tool_result_array_does_not_count_as_user_turn() {
    // tool_result echoes from the Claude CLI come back as user-typed
    // messages with array-content (file_reader.rs:270-281). They must NOT
    // increment user_turns or take title — only real human-typed messages
    // do. Without this filter, every CLI-injected response would inflate
    // user_turns and the title would become whatever the tool returned.
    let lines = [
        user_msg_line("2026-05-08T10:00:00Z", "real-prompt"),
        user_msg_line_tool_result("2026-05-08T10:00:01Z", "toolu_xyz"),
        user_msg_line_tool_result("2026-05-08T10:00:02Z", "toolu_abc"),
    ];
    let result = parse_session_jsonl_str(&lines.join("\n"), "uuid-1").unwrap();
    assert_eq!(
        result.user_turns, 1,
        "tool_result arrays must NOT count as user turns"
    );
    assert_eq!(result.title, "real-prompt");
}

#[test]
fn parse_str_sidechain_messages_do_not_count_as_user_turns() {
    // Sidechain messages (sub-agent forks) and meta messages must not
    // count as user turns (file_reader.rs:259) — they're internal CLI
    // bookkeeping, not human input.
    let lines = [
        user_msg_line("2026-05-08T10:00:00Z", "real-prompt"),
        user_msg_line_sidechain("2026-05-08T10:00:01Z", "subagent-internal-msg"),
    ];
    let result = parse_session_jsonl_str(&lines.join("\n"), "uuid-1").unwrap();
    assert_eq!(
        result.user_turns, 1,
        "sidechain user messages must NOT count as user turns"
    );
    assert_eq!(result.title, "real-prompt");
}

#[test]
fn parse_str_missing_timestamp_returns_empty_strings() {
    // Documents (and locks) the contract for malformed entries with no
    // `timestamp` field: started_at and ended_at default to "" rather than
    // panicking or substituting an arbitrary value. The frontend is
    // responsible for handling empty timestamps gracefully.
    let content = user_msg_line_no_timestamp("hi-no-time");
    let result = parse_session_jsonl_str(&content, "uuid-1").unwrap();
    assert_eq!(result.started_at, "");
    assert_eq!(result.ended_at, "");
    assert_eq!(result.user_turns, 1);
    assert_eq!(result.title, "hi-no-time");
}

#[test]
fn parse_str_extracts_cwd_and_git_branch_from_first_message_with_them() {
    // file_reader.rs:240-249 extracts cwd and gitBranch from the first
    // message that carries them. Locks both happy-path extraction and the
    // "first wins" semantic — if a later message has different values,
    // they're ignored.
    let lines = [
        user_msg_line_with_meta(
            "2026-05-08T10:00:00Z",
            "first-with-meta",
            r"C:\\Projects\\app",
            "main",
        ),
        user_msg_line_with_meta(
            "2026-05-08T10:01:00Z",
            "second-different-meta",
            r"C:\\Projects\\OTHER",
            "feature",
        ),
    ];
    let result = parse_session_jsonl_str(&lines.join("\n"), "uuid-1").unwrap();
    assert_eq!(
        result.cwd, r"C:\Projects\app",
        "cwd must come from FIRST message (later cwd ignored)"
    );
    assert_eq!(
        result.git_branch, "main",
        "gitBranch must come from FIRST message"
    );
}
