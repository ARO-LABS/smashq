// src-tauri/src/session/file_reader/session_history.rs
//
// Claude CLI session history: the `ClaudeSessionSummary` domain model, JSONL
// parsing (pure + path-based wrapper), the project-dir slug resolution, the
// UUID heuristic, and the directory scanner that aggregates session summaries.

use crate::error::ADPError;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// File extension (incl. leading dot) of a Claude CLI session log.
const JSONL_EXTENSION: &str = ".jsonl";

/// Summary of a single Claude CLI session, extracted from JSONL files.
#[derive(Serialize, Clone)]
pub struct ClaudeSessionSummary {
    pub session_id: String,
    pub title: String,
    pub started_at: String,
    pub ended_at: String,
    pub model: String,
    pub user_turns: u32,
    pub total_messages: u32,
    pub subagent_count: u32,
    pub git_branch: String,
    pub cwd: String,
}

/// Convert a folder path to the Claude projects directory name.
/// E.g. `C:\Projects\smashq` → `C--Projects-smashq`
///
/// `pub` so integration tests in `src-tauri/tests/` can use the SAME slug
/// logic when constructing fixture directories — closes the silent-drift
/// contract where a fixture-builder reimplementation could go out of sync
/// with production.
pub fn folder_to_project_dir_name(folder: &str) -> String {
    folder
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Find the matching project directory inside the given Claude projects root
/// (case-insensitive slug match).
///
/// Pure function with explicit root parameter — the path-resolving wrapper
/// `find_project_dir` injects `~/.claude/projects/` from `dirs::home_dir()`.
/// Tests pass a tempdir-based root.
pub fn find_project_dir_in(claude_projects_root: &Path, folder: &str) -> Option<PathBuf> {
    if !claude_projects_root.is_dir() {
        return None;
    }

    let expected = folder_to_project_dir_name(folder).to_lowercase();

    let read_dir = std::fs::read_dir(claude_projects_root).ok()?;
    for entry in read_dir.flatten() {
        if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
            if let Some(name) = entry.file_name().to_str() {
                if name.to_lowercase() == expected {
                    return Some(entry.path());
                }
            }
        }
    }
    None
}

/// Check if a string looks like a UUID (simple heuristic).
pub(crate) fn is_uuid_like(s: &str) -> bool {
    s.len() == 36
        && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
        && s.matches('-').count() == 4
}

/// Parse JSONL session content (already loaded into memory) and extract a summary.
///
/// Pure function: no I/O, no filesystem access. Tests can pass arbitrary
/// fixture strings without needing tempfiles. The path-based wrapper
/// `parse_session_jsonl` handles the read_to_string boundary.
///
/// **Precondition:** Caller is responsible for bounding `content` size —
/// this function allocates per-line and parses each as JSON. Production callers
/// read from disk, where session files are typically <10MB; if you call this
/// with untrusted/unbounded input, add a size guard upstream.
pub fn parse_session_jsonl_str(content: &str, session_id: &str) -> Option<ClaudeSessionSummary> {
    // Defense-in-depth: even if a public caller bypasses the path-based
    // wrapper's MAX_JSONL_SIZE_BYTES cap, this hard limit short-circuits
    // before we allocate a Vec<&str> spanning the whole content.
    if content.len() > PARSE_HARD_LIMIT_BYTES {
        log::warn!(
            "parse_session_jsonl_str: content exceeds hard limit ({} bytes > {} bytes), skipping session_id={}",
            content.len(),
            PARSE_HARD_LIMIT_BYTES,
            session_id
        );
        return None;
    }
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return None;
    }

    let mut title = String::new();
    let mut started_at = String::new();
    let mut ended_at = String::new();
    let mut model = String::new();
    let mut user_turns: u32 = 0;
    let mut total_messages: u32 = 0;
    let mut git_branch = String::new();
    let mut cwd = String::new();

    for line in &lines {
        let val: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        total_messages += 1;

        // Extract timestamp from any message
        if let Some(ts) = val.get("timestamp").and_then(|v| v.as_str()) {
            if started_at.is_empty() {
                started_at = ts.to_string();
            }
            ended_at = ts.to_string();
        }

        // Extract git branch and cwd from first message that has them
        if git_branch.is_empty() {
            if let Some(branch) = val.get("gitBranch").and_then(|v| v.as_str()) {
                git_branch = branch.to_string();
            }
        }
        if cwd.is_empty() {
            if let Some(c) = val.get("cwd").and_then(|v| v.as_str()) {
                cwd = c.to_string();
            }
        }

        let msg_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let is_sidechain = val
            .get("isSidechain")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let is_meta = val.get("isMeta").and_then(|v| v.as_bool()).unwrap_or(false);

        // Count user turns (non-sidechain, non-meta user messages that aren't tool results)
        if msg_type == "user" && !is_sidechain && !is_meta {
            if let Some(content) = val.get("message").and_then(|m| m.get("content")) {
                match content {
                    Value::String(s) => {
                        user_turns += 1;
                        // Use first user prompt as title
                        if title.is_empty() {
                            let truncated: String = s.chars().take(120).collect();
                            title = truncated.replace('\n', " ").trim().to_string();
                        }
                    }
                    Value::Array(arr) => {
                        // Tool result arrays don't count as user turns
                        let is_tool_result = arr.iter().any(|item| {
                            item.get("type")
                                .and_then(|t| t.as_str())
                                .map(|t| t == "tool_result")
                                .unwrap_or(false)
                        });
                        if !is_tool_result {
                            user_turns += 1;
                        }
                    }
                    _ => {}
                }
            }
        }

        // Extract model from assistant messages
        if msg_type == "assistant" && model.is_empty() {
            if let Some(m) = val
                .get("message")
                .and_then(|m| m.get("model"))
                .and_then(|v| v.as_str())
            {
                model = m.to_string();
            }
        }
    }

    // Skip sessions with no real content
    if user_turns == 0 && title.is_empty() {
        return None;
    }

    if title.is_empty() {
        title = "(Kein Prompt)".to_string();
    }

    Some(ClaudeSessionSummary {
        session_id: session_id.to_string(),
        title,
        started_at,
        ended_at,
        model,
        user_turns,
        total_messages,
        subagent_count: 0, // Will be set by caller
        git_branch,
        cwd,
    })
}

/// Maximum size of a JSONL session file we are willing to load into memory.
/// 100 MiB (104,857,600 bytes) is roughly an order of magnitude above the
/// largest realistic session transcript Claude CLI produces; anything larger
/// is treated as corrupt-or-malicious and silently skipped to protect against
/// OOM. Note: this is mebibytes (1024²), not megabytes (10⁶).
const MAX_JSONL_SIZE_BYTES: u64 = 100 * 1024 * 1024;

/// Hard upper bound for `parse_session_jsonl_str` content, applied as
/// defense-in-depth even when callers bypass the path-based wrapper.
/// Set 2× the wrapper cap so legitimate edge cases (BOM, near-cap files
/// expanded by `read_to_string` UTF-8 decoding) still pass; truly absurd
/// inputs short-circuit before per-line allocation.
const PARSE_HARD_LIMIT_BYTES: usize = 200 * 1024 * 1024;

/// Parse a single JSONL session file and extract a summary.
///
/// Thin wrapper around `parse_session_jsonl_str` that handles the
/// `read_to_string` boundary AND enforces a size cap so the pure parser
/// never sees an unbounded allocation. Returns `None` on:
/// - file metadata unavailable (permission denied, missing)
/// - file size > `MAX_JSONL_SIZE_BYTES`
/// - read failure (mid-read I/O error, non-UTF8 content)
/// - empty content
pub(crate) fn parse_session_jsonl(
    path: &std::path::Path,
    session_id: &str,
) -> Option<ClaudeSessionSummary> {
    let metadata = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) => {
            log::warn!(
                "parse_session_jsonl: cannot stat {} ({}), skipping",
                path.display(),
                e
            );
            return None;
        }
    };
    if metadata.len() > MAX_JSONL_SIZE_BYTES {
        log::warn!(
            "Skipping oversized JSONL session file ({} bytes > {} bytes cap): {}",
            metadata.len(),
            MAX_JSONL_SIZE_BYTES,
            path.display()
        );
        return None;
    }
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            log::warn!(
                "parse_session_jsonl: read failed for {} ({}), skipping",
                path.display(),
                e
            );
            return None;
        }
    };
    parse_session_jsonl_str(&content, session_id)
}

/// Scan a project's Claude session history from the given Claude projects root.
///
/// Pure function with explicit `claude_projects_root` parameter — tests pass a
/// tempdir-based root, production calls `scan_sessions_for_project` which
/// resolves `~/.claude/projects/`. Returns sessions sorted DESC by `started_at`.
pub fn scan_sessions_for_project_in(
    claude_projects_root: &Path,
    folder: &str,
) -> Result<Vec<ClaudeSessionSummary>, ADPError> {
    let project_dir = match find_project_dir_in(claude_projects_root, folder) {
        Some(dir) => dir,
        None => return Ok(Vec::new()),
    };

    let mut sessions: Vec<ClaudeSessionSummary> = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    let read_dir = std::fs::read_dir(&project_dir)
        .map_err(|e| ADPError::file_io(format!("Failed to read project directory: {}", e)))?;

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
            // Check for [uuid]/[uuid].jsonl
            if is_uuid_like(&name) && !seen_ids.contains(&name) {
                let jsonl_path = entry.path().join(format!("{}{}", name, JSONL_EXTENSION));
                if jsonl_path.is_file() {
                    // Count subagents
                    let subagent_count = entry
                        .path()
                        .join("subagents")
                        .read_dir()
                        .map(|rd| {
                            rd.flatten()
                                .filter(|e| {
                                    e.file_name()
                                        .to_str()
                                        .map(|n| n.ends_with(".meta.json"))
                                        .unwrap_or(false)
                                })
                                .count() as u32
                        })
                        .unwrap_or(0);

                    if let Some(mut summary) = parse_session_jsonl(&jsonl_path, &name) {
                        summary.subagent_count = subagent_count;
                        sessions.push(summary);
                        seen_ids.insert(name);
                    }
                }
            }
        } else if ft.is_file() && name.ends_with(JSONL_EXTENSION) {
            // Top-level [uuid].jsonl
            let session_id = name.trim_end_matches(JSONL_EXTENSION);
            if is_uuid_like(session_id) && !seen_ids.contains(session_id) {
                if let Some(summary) = parse_session_jsonl(&entry.path(), session_id) {
                    sessions.push(summary);
                    seen_ids.insert(session_id.to_string());
                }
            }
        }
    }

    // Sort by started_at descending (newest first)
    sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at));

    Ok(sessions)
}

/// Scan a project's Claude session history from `~/.claude/projects/`.
///
/// Production wrapper around `scan_sessions_for_project_in` that resolves the
/// home directory at call time. Returns an empty Vec if the home directory
/// cannot be determined.
pub(crate) fn scan_sessions_for_project(
    folder: &str,
) -> Result<Vec<ClaudeSessionSummary>, ADPError> {
    let claude_projects_root = match dirs::home_dir() {
        Some(home) => home.join(".claude").join("projects"),
        None => return Ok(Vec::new()),
    };
    scan_sessions_for_project_in(&claude_projects_root, folder)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("Failed to create temp dir")
    }

    // --- Wave 0 sanity: pure-function early-return paths ---

    #[test]
    fn test_scan_sessions_for_project_in_returns_empty_for_nonexistent_root() {
        // Locks the early-return contract: when the projects-root does not exist,
        // the pure function returns Ok(empty Vec) — never an error. The Tauri
        // command relies on this so a missing ~/.claude/ on a fresh install
        // surfaces as "no history" instead of a startup error.
        let nonexistent = std::path::Path::new("/this/path/does/not/exist/anywhere");
        let result = scan_sessions_for_project_in(nonexistent, "any-folder");
        assert!(matches!(result, Ok(ref v) if v.is_empty()));
    }

    #[test]
    fn test_find_project_dir_in_returns_none_for_nonexistent_root() {
        let nonexistent = std::path::Path::new("/this/path/does/not/exist/anywhere");
        let result = find_project_dir_in(nonexistent, "any-folder");
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_session_jsonl_str_returns_none_for_empty_content() {
        assert!(parse_session_jsonl_str("", "uuid-xyz").is_none());
    }

    // ========================================================================
    // folder_to_project_dir_name — slug conversion
    // ========================================================================

    #[test]
    fn folder_to_slug_replaces_windows_drive_and_separators() {
        assert_eq!(
            folder_to_project_dir_name("C:\\Projects\\smashq"),
            "C--Projects-smashq"
        );
    }

    #[test]
    fn folder_to_slug_replaces_unix_separators() {
        assert_eq!(
            folder_to_project_dir_name("/home/user/my-proj"),
            "-home-user-my-proj"
        );
    }

    #[test]
    fn folder_to_slug_preserves_alphanumeric_and_dash() {
        assert_eq!(folder_to_project_dir_name("abc-123-XYZ"), "abc-123-XYZ");
    }

    #[test]
    fn folder_to_slug_replaces_dots_and_spaces() {
        assert_eq!(
            folder_to_project_dir_name("my.proj with spaces"),
            "my-proj-with-spaces"
        );
    }

    #[test]
    fn folder_to_slug_replaces_non_ascii() {
        // Non-ASCII alphanumeric is NOT ascii_alphanumeric → becomes '-'.
        assert_eq!(folder_to_project_dir_name("Grüße"), "Gr--e");
    }

    #[test]
    fn folder_to_slug_empty_input_yields_empty() {
        assert_eq!(folder_to_project_dir_name(""), "");
    }

    #[test]
    fn folder_to_slug_underscore_becomes_dash() {
        assert_eq!(folder_to_project_dir_name("a_b_c"), "a-b-c");
    }

    // ========================================================================
    // is_uuid_like — UUID heuristic
    // ========================================================================

    #[test]
    fn is_uuid_like_accepts_canonical_uuid() {
        assert!(is_uuid_like("12345678-90ab-cdef-1234-567890abcdef"));
    }

    #[test]
    fn is_uuid_like_accepts_all_dashes_and_hex() {
        assert!(is_uuid_like("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    }

    #[test]
    fn is_uuid_like_rejects_wrong_length() {
        assert!(!is_uuid_like("12345678-90ab-cdef-1234-567890abcde"));
        assert!(!is_uuid_like("12345678-90ab-cdef-1234-567890abcdeff"));
    }

    #[test]
    fn is_uuid_like_rejects_empty() {
        assert!(!is_uuid_like(""));
    }

    #[test]
    fn is_uuid_like_rejects_non_hex_char() {
        // 'g' is not a hex digit; length is still 36.
        assert!(!is_uuid_like("g2345678-90ab-cdef-1234-567890abcdef"));
    }

    #[test]
    fn is_uuid_like_rejects_wrong_dash_count() {
        // 36 chars, hex+dash, but only 3 dashes (one dash → hex 'a').
        assert!(!is_uuid_like("12345678-90ab-cdefa1234-567890abcdef"));
    }

    #[test]
    fn is_uuid_like_rejects_path_separators() {
        // 36-char string with a slash — not hex, must be rejected.
        assert!(!is_uuid_like("12345678/90ab/cdef/1234/567890abcdef0"));
    }

    #[test]
    fn is_uuid_like_rejects_dotdot_traversal() {
        assert!(!is_uuid_like("../../../../../../../../etc/passwd123"));
    }

    #[test]
    fn is_uuid_like_uppercase_hex_accepted() {
        assert!(is_uuid_like("ABCDEF12-3456-7890-ABCD-EF1234567890"));
    }

    // ========================================================================
    // parse_session_jsonl_str — JSONL parsing & extraction
    // ========================================================================

    #[test]
    fn parse_returns_none_for_whitespace_only_lines() {
        // Only blank lines → no parseable JSON → user_turns 0, title empty → None.
        assert!(parse_session_jsonl_str("\n\n   \n", "sid").is_none());
    }

    #[test]
    fn parse_returns_none_when_all_lines_malformed() {
        let content = "not json\n{broken\n][\n";
        assert!(parse_session_jsonl_str(content, "sid").is_none());
    }

    #[test]
    fn parse_skips_malformed_lines_but_uses_valid_ones() {
        let content = concat!(
            "this is garbage\n",
            r#"{"type":"user","message":{"content":"hello"}}"#,
            "\n",
            "{also broken\n"
        );
        let s = parse_session_jsonl_str(content, "sid").expect("valid line present");
        assert_eq!(s.user_turns, 1);
        assert_eq!(s.title, "hello");
        // total_messages counts only successfully-parsed lines.
        assert_eq!(s.total_messages, 1);
    }

    #[test]
    fn parse_extracts_string_user_content_as_title() {
        let content = r#"{"type":"user","message":{"content":"Fix the bug"}}"#;
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.title, "Fix the bug");
        assert_eq!(s.user_turns, 1);
    }

    #[test]
    fn parse_truncates_title_to_120_chars() {
        let long = "x".repeat(200);
        let content = format!(r#"{{"type":"user","message":{{"content":"{}"}}}}"#, long);
        let s = parse_session_jsonl_str(&content, "sid").unwrap();
        assert_eq!(s.title.chars().count(), 120);
    }

    #[test]
    fn parse_title_replaces_newlines_with_spaces() {
        let content = r#"{"type":"user","message":{"content":"line one\nline two"}}"#;
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.title, "line one line two");
        assert!(!s.title.contains('\n'));
    }

    #[test]
    fn parse_title_is_trimmed() {
        let content = r#"{"type":"user","message":{"content":"   padded   "}}"#;
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.title, "padded");
    }

    #[test]
    fn parse_title_truncates_before_trim() {
        // First 120 chars taken, THEN newline-replace + trim. Leading spaces
        // within the first 120 chars get trimmed away.
        let content = r#"{"type":"user","message":{"content":"  abc"}}"#;
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.title, "abc");
    }

    #[test]
    fn parse_only_first_user_string_becomes_title() {
        let content = concat!(
            r#"{"type":"user","message":{"content":"first prompt"}}"#,
            "\n",
            r#"{"type":"user","message":{"content":"second prompt"}}"#,
        );
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.title, "first prompt");
        assert_eq!(s.user_turns, 2);
    }

    #[test]
    fn parse_sidechain_user_message_does_not_count() {
        let content = r#"{"type":"user","isSidechain":true,"message":{"content":"sub"}}"#;
        // Sidechain user → not a turn, title stays empty → None.
        assert!(parse_session_jsonl_str(content, "sid").is_none());
    }

    #[test]
    fn parse_meta_user_message_does_not_count() {
        let content = r#"{"type":"user","isMeta":true,"message":{"content":"meta"}}"#;
        assert!(parse_session_jsonl_str(content, "sid").is_none());
    }

    #[test]
    fn parse_tool_result_array_does_not_count_as_turn() {
        let content =
            r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"x"}]}}"#;
        assert!(parse_session_jsonl_str(content, "sid").is_none());
    }

    #[test]
    fn parse_non_tool_result_array_counts_as_turn() {
        // An array of content blocks without a tool_result IS a user turn.
        let content = r#"{"type":"user","message":{"content":[{"type":"text","text":"hi"}]}}"#;
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.user_turns, 1);
        // Array content does not populate title.
        assert_eq!(s.title, "(Kein Prompt)");
    }

    #[test]
    fn parse_array_turn_without_title_uses_placeholder() {
        let content = r#"{"type":"user","message":{"content":[{"type":"text","text":"hi"}]}}"#;
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.title, "(Kein Prompt)");
    }

    #[test]
    fn parse_mixed_array_with_tool_result_not_counted() {
        // Array containing ANY tool_result item → whole message is a tool result.
        let content = concat!(
            r#"{"type":"user","message":{"content":[{"type":"text","text":"x"},"#,
            r#"{"type":"tool_result","content":"y"}]}}"#
        );
        assert!(parse_session_jsonl_str(content, "sid").is_none());
    }

    #[test]
    fn parse_user_content_object_does_not_count() {
        // content as a bare object (not string/array) → no turn.
        let content = r#"{"type":"user","message":{"content":{"foo":"bar"}}}"#;
        assert!(parse_session_jsonl_str(content, "sid").is_none());
    }

    #[test]
    fn parse_user_without_message_field_does_not_count() {
        let content = r#"{"type":"user"}"#;
        assert!(parse_session_jsonl_str(content, "sid").is_none());
    }

    #[test]
    fn parse_extracts_timestamps_first_and_last() {
        let content = concat!(
            r#"{"type":"user","timestamp":"2026-01-01T00:00:00Z","message":{"content":"a"}}"#,
            "\n",
            r#"{"type":"assistant","timestamp":"2026-01-02T00:00:00Z","message":{}}"#,
            "\n",
            r#"{"type":"assistant","timestamp":"2026-01-03T00:00:00Z","message":{}}"#,
        );
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.started_at, "2026-01-01T00:00:00Z");
        assert_eq!(s.ended_at, "2026-01-03T00:00:00Z");
    }

    #[test]
    fn parse_single_timestamp_sets_started_equals_ended() {
        let content =
            r#"{"type":"user","timestamp":"2026-05-19T12:00:00Z","message":{"content":"a"}}"#;
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.started_at, "2026-05-19T12:00:00Z");
        assert_eq!(s.ended_at, s.started_at);
    }

    #[test]
    fn parse_non_string_timestamp_is_ignored() {
        // timestamp as a number → as_str() None → not captured.
        let content = r#"{"type":"user","timestamp":12345,"message":{"content":"a"}}"#;
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.started_at, "");
        assert_eq!(s.ended_at, "");
    }

    #[test]
    fn parse_missing_timestamp_leaves_fields_empty() {
        let content = r#"{"type":"user","message":{"content":"a"}}"#;
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.started_at, "");
        assert_eq!(s.ended_at, "");
    }

    #[test]
    fn parse_extracts_git_branch_from_first_occurrence() {
        let content = concat!(
            r#"{"type":"user","gitBranch":"main","message":{"content":"a"}}"#,
            "\n",
            r#"{"type":"user","gitBranch":"feature","message":{"content":"b"}}"#,
        );
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.git_branch, "main");
    }

    #[test]
    fn parse_extracts_cwd_from_first_occurrence() {
        let content = concat!(
            r#"{"type":"user","cwd":"/first","message":{"content":"a"}}"#,
            "\n",
            r#"{"type":"user","cwd":"/second","message":{"content":"b"}}"#,
        );
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.cwd, "/first");
    }

    #[test]
    fn parse_missing_git_branch_and_cwd_default_empty() {
        let content = r#"{"type":"user","message":{"content":"a"}}"#;
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.git_branch, "");
        assert_eq!(s.cwd, "");
    }

    #[test]
    fn parse_extracts_model_from_first_assistant() {
        let content = concat!(
            r#"{"type":"user","message":{"content":"a"}}"#,
            "\n",
            r#"{"type":"assistant","message":{"model":"claude-opus-4-7"}}"#,
            "\n",
            r#"{"type":"assistant","message":{"model":"claude-haiku"}}"#,
        );
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.model, "claude-opus-4-7");
    }

    #[test]
    fn parse_model_from_user_message_ignored() {
        // model only read from assistant messages.
        let content = r#"{"type":"user","message":{"content":"a","model":"x"}}"#;
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.model, "");
    }

    #[test]
    fn parse_assistant_without_model_leaves_model_empty() {
        let content = concat!(
            r#"{"type":"user","message":{"content":"a"}}"#,
            "\n",
            r#"{"type":"assistant","message":{}}"#,
        );
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.model, "");
    }

    #[test]
    fn parse_counts_total_messages_across_types() {
        let content = concat!(
            r#"{"type":"user","message":{"content":"a"}}"#,
            "\n",
            r#"{"type":"assistant","message":{}}"#,
            "\n",
            r#"{"type":"system"}"#,
            "\n",
            r#"{"type":"summary"}"#,
        );
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.total_messages, 4);
        assert_eq!(s.user_turns, 1);
    }

    #[test]
    fn parse_session_with_only_summary_line_returns_none() {
        // No user turn, no title → skipped.
        let content = r#"{"type":"summary","summary":"old session"}"#;
        assert!(parse_session_jsonl_str(content, "sid").is_none());
    }

    #[test]
    fn parse_missing_type_field_treated_as_empty_type() {
        // type absent → "" → not user/assistant; if there's no turn → None.
        let content = r#"{"timestamp":"2026-01-01T00:00:00Z"}"#;
        assert!(parse_session_jsonl_str(content, "sid").is_none());
    }

    #[test]
    fn parse_non_string_type_field_ignored() {
        let content = r#"{"type":123,"message":{"content":"a"}}"#;
        // type not a string → "" → no turn → None.
        assert!(parse_session_jsonl_str(content, "sid").is_none());
    }

    #[test]
    #[allow(non_snake_case)] // test name mirrors the `isSidechain` JSON field verbatim
    fn parse_isSidechain_non_bool_defaults_false() {
        // isSidechain as string → as_bool None → unwrap_or(false) → counts.
        let content = r#"{"type":"user","isSidechain":"yes","message":{"content":"a"}}"#;
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.user_turns, 1);
    }

    #[test]
    fn parse_session_id_is_passed_through_verbatim() {
        let content = r#"{"type":"user","message":{"content":"a"}}"#;
        let s = parse_session_jsonl_str(content, "my-custom-id-42").unwrap();
        assert_eq!(s.session_id, "my-custom-id-42");
    }

    #[test]
    fn parse_subagent_count_is_zero_from_pure_parser() {
        // The pure parser never sets subagent_count — caller does.
        let content = r#"{"type":"user","message":{"content":"a"}}"#;
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.subagent_count, 0);
    }

    #[test]
    fn parse_assistant_only_session_without_user_returns_none() {
        // Assistant messages but no user turn and no title → None.
        let content = r#"{"type":"assistant","message":{"model":"claude"}}"#;
        assert!(parse_session_jsonl_str(content, "sid").is_none());
    }

    #[test]
    fn parse_empty_string_user_content_still_counts_turn() {
        // Empty string content → user_turns increments, title becomes "" → placeholder.
        let content = r#"{"type":"user","message":{"content":""}}"#;
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.user_turns, 1);
        assert_eq!(s.title, "(Kein Prompt)");
    }

    #[test]
    fn parse_whitespace_only_user_content_counts_turn_placeholder_title() {
        // "   " → title trimmed to "" → placeholder, but turn still counted.
        let content = r#"{"type":"user","message":{"content":"   "}}"#;
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.user_turns, 1);
        assert_eq!(s.title, "(Kein Prompt)");
    }

    #[test]
    fn parse_handles_crlf_line_endings() {
        // str::lines() splits on \r\n too.
        let content = concat!(
            r#"{"type":"user","message":{"content":"a"}}"#,
            "\r\n",
            r#"{"type":"assistant","message":{}}"#,
        );
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.total_messages, 2);
    }

    #[test]
    fn parse_blank_lines_between_records_are_skipped() {
        let content = concat!(
            r#"{"type":"user","message":{"content":"a"}}"#,
            "\n\n\n",
            r#"{"type":"assistant","message":{}}"#,
        );
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        // Blank lines fail JSON parse → not counted.
        assert_eq!(s.total_messages, 2);
    }

    #[test]
    fn parse_unicode_in_title_preserved() {
        let content = r#"{"type":"user","message":{"content":"Grüße 🚀 done"}}"#;
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.title, "Grüße 🚀 done");
    }

    #[test]
    fn parse_title_120_char_limit_counts_chars_not_bytes() {
        // 120 multibyte chars: char count == 120 even though byte len > 120.
        let emoji = "🚀".repeat(200);
        let content = format!(r#"{{"type":"user","message":{{"content":"{}"}}}}"#, emoji);
        let s = parse_session_jsonl_str(&content, "sid").unwrap();
        assert_eq!(s.title.chars().count(), 120);
    }

    #[test]
    fn parse_multiple_user_turns_accumulate() {
        let content = concat!(
            r#"{"type":"user","message":{"content":"a"}}"#,
            "\n",
            r#"{"type":"user","message":{"content":"b"}}"#,
            "\n",
            r#"{"type":"user","message":{"content":"c"}}"#,
        );
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.user_turns, 3);
    }

    #[test]
    fn parse_json_array_top_level_line_does_not_count_as_user() {
        // A line that is a JSON array (not object) → val.get() yields None
        // for everything → counted in total but no turn.
        let content = r#"[1,2,3]"#;
        assert!(parse_session_jsonl_str(content, "sid").is_none());
    }

    #[test]
    fn parse_json_scalar_line_is_valid_json_counted_in_total() {
        // A bare number is valid JSON → parsed, total_messages++, but with a
        // user line so the session survives.
        let content = concat!("42\n", r#"{"type":"user","message":{"content":"a"}}"#,);
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        assert_eq!(s.total_messages, 2);
        assert_eq!(s.user_turns, 1);
    }

    // ========================================================================
    // ClaudeSessionSummary — struct construction & serde
    // ========================================================================

    #[test]
    fn summary_serializes_to_expected_json_keys() {
        let content = concat!(
            r#"{"type":"user","timestamp":"2026-01-01T00:00:00Z","gitBranch":"main","#,
            r#""cwd":"/proj","message":{"content":"hello"}}"#,
            "\n",
            r#"{"type":"assistant","message":{"model":"claude-opus"}}"#,
        );
        let s = parse_session_jsonl_str(content, "sid-1").unwrap();
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["session_id"], "sid-1");
        assert_eq!(json["title"], "hello");
        assert_eq!(json["started_at"], "2026-01-01T00:00:00Z");
        assert_eq!(json["ended_at"], "2026-01-01T00:00:00Z");
        assert_eq!(json["model"], "claude-opus");
        assert_eq!(json["user_turns"], 1);
        assert_eq!(json["total_messages"], 2);
        assert_eq!(json["subagent_count"], 0);
        assert_eq!(json["git_branch"], "main");
        assert_eq!(json["cwd"], "/proj");
    }

    #[test]
    fn summary_is_cloneable() {
        let content = r#"{"type":"user","message":{"content":"a"}}"#;
        let s = parse_session_jsonl_str(content, "sid").unwrap();
        let cloned = s.clone();
        assert_eq!(cloned.session_id, s.session_id);
        assert_eq!(cloned.title, s.title);
        assert_eq!(cloned.user_turns, s.user_turns);
    }

    // ========================================================================
    // parse_session_jsonl (path-based wrapper) — file I/O boundary
    // ========================================================================

    #[test]
    fn parse_wrapper_returns_none_for_missing_file() {
        let tmp = setup_temp_dir();
        let missing = tmp.path().join("nope.jsonl");
        assert!(parse_session_jsonl(&missing, "sid").is_none());
    }

    #[test]
    fn parse_wrapper_returns_none_for_empty_file() {
        let tmp = setup_temp_dir();
        let f = tmp.path().join("empty.jsonl");
        std::fs::write(&f, "").unwrap();
        assert!(parse_session_jsonl(&f, "sid").is_none());
    }

    #[test]
    fn parse_wrapper_reads_valid_file() {
        let tmp = setup_temp_dir();
        let f = tmp.path().join("session.jsonl");
        std::fs::write(&f, r#"{"type":"user","message":{"content":"from disk"}}"#).unwrap();
        let s = parse_session_jsonl(&f, "disk-sid").unwrap();
        assert_eq!(s.title, "from disk");
        assert_eq!(s.session_id, "disk-sid");
    }

    #[test]
    fn parse_wrapper_returns_none_for_non_utf8_file() {
        let tmp = setup_temp_dir();
        let f = tmp.path().join("binary.jsonl");
        std::fs::write(&f, [0xFF, 0xFE, 0x00, 0xFF]).unwrap();
        // read_to_string fails → None, no panic.
        assert!(parse_session_jsonl(&f, "sid").is_none());
    }

    // ========================================================================
    // scan_sessions_for_project_in — directory scanning
    // ========================================================================

    #[test]
    fn scan_returns_empty_when_project_dir_missing() {
        let tmp = setup_temp_dir();
        let result = scan_sessions_for_project_in(tmp.path(), "C:\\No\\Such\\Project").unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn scan_finds_flat_layout_session() {
        let tmp = setup_temp_dir();
        let folder = "C:\\Projects\\test-proj";
        let project_dir = tmp.path().join(folder_to_project_dir_name(folder));
        std::fs::create_dir_all(&project_dir).unwrap();
        let uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        std::fs::write(
            project_dir.join(format!("{}.jsonl", uuid)),
            r#"{"type":"user","message":{"content":"hi"}}"#,
        )
        .unwrap();

        let result = scan_sessions_for_project_in(tmp.path(), folder).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].session_id, uuid);
        assert_eq!(result[0].title, "hi");
    }

    #[test]
    fn scan_finds_nested_layout_session() {
        let tmp = setup_temp_dir();
        let folder = "C:\\Projects\\test-proj";
        let project_dir = tmp.path().join(folder_to_project_dir_name(folder));
        let uuid = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
        let session_dir = project_dir.join(uuid);
        std::fs::create_dir_all(&session_dir).unwrap();
        std::fs::write(
            session_dir.join(format!("{}.jsonl", uuid)),
            r#"{"type":"user","message":{"content":"nested"}}"#,
        )
        .unwrap();

        let result = scan_sessions_for_project_in(tmp.path(), folder).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].title, "nested");
    }

    #[test]
    fn scan_counts_subagents_in_nested_layout() {
        let tmp = setup_temp_dir();
        let folder = "C:\\Projects\\test-proj";
        let project_dir = tmp.path().join(folder_to_project_dir_name(folder));
        let uuid = "cccccccc-cccc-cccc-cccc-cccccccccccc";
        let session_dir = project_dir.join(uuid);
        let subagents = session_dir.join("subagents");
        std::fs::create_dir_all(&subagents).unwrap();
        std::fs::write(
            session_dir.join(format!("{}.jsonl", uuid)),
            r#"{"type":"user","message":{"content":"x"}}"#,
        )
        .unwrap();
        std::fs::write(subagents.join("a1.meta.json"), "{}").unwrap();
        std::fs::write(subagents.join("a2.meta.json"), "{}").unwrap();
        // Non-meta files must not be counted.
        std::fs::write(subagents.join("ignore.txt"), "x").unwrap();

        let result = scan_sessions_for_project_in(tmp.path(), folder).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].subagent_count, 2);
    }

    #[test]
    fn scan_subagent_count_zero_when_no_subagents_dir() {
        let tmp = setup_temp_dir();
        let folder = "C:\\Projects\\test-proj";
        let project_dir = tmp.path().join(folder_to_project_dir_name(folder));
        let uuid = "dddddddd-dddd-dddd-dddd-dddddddddddd";
        let session_dir = project_dir.join(uuid);
        std::fs::create_dir_all(&session_dir).unwrap();
        std::fs::write(
            session_dir.join(format!("{}.jsonl", uuid)),
            r#"{"type":"user","message":{"content":"x"}}"#,
        )
        .unwrap();

        let result = scan_sessions_for_project_in(tmp.path(), folder).unwrap();
        assert_eq!(result[0].subagent_count, 0);
    }

    #[test]
    fn scan_ignores_non_uuid_files_and_dirs() {
        let tmp = setup_temp_dir();
        let folder = "C:\\Projects\\test-proj";
        let project_dir = tmp.path().join(folder_to_project_dir_name(folder));
        std::fs::create_dir_all(&project_dir).unwrap();
        std::fs::write(project_dir.join("README.md"), "hi").unwrap();
        std::fs::write(project_dir.join("not-a-uuid.jsonl"), "{}").unwrap();
        std::fs::create_dir_all(project_dir.join("memory")).unwrap();

        let result = scan_sessions_for_project_in(tmp.path(), folder).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn scan_skips_uuid_dir_without_matching_jsonl() {
        let tmp = setup_temp_dir();
        let folder = "C:\\Projects\\test-proj";
        let project_dir = tmp.path().join(folder_to_project_dir_name(folder));
        let uuid = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
        // UUID dir exists but no <uuid>.jsonl inside.
        std::fs::create_dir_all(project_dir.join(uuid)).unwrap();

        let result = scan_sessions_for_project_in(tmp.path(), folder).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn scan_sorts_sessions_by_started_at_descending() {
        let tmp = setup_temp_dir();
        let folder = "C:\\Projects\\test-proj";
        let project_dir = tmp.path().join(folder_to_project_dir_name(folder));
        std::fs::create_dir_all(&project_dir).unwrap();

        let old_uuid = "11111111-1111-1111-1111-111111111111";
        let new_uuid = "22222222-2222-2222-2222-222222222222";
        std::fs::write(
            project_dir.join(format!("{}.jsonl", old_uuid)),
            r#"{"type":"user","timestamp":"2026-01-01T00:00:00Z","message":{"content":"old"}}"#,
        )
        .unwrap();
        std::fs::write(
            project_dir.join(format!("{}.jsonl", new_uuid)),
            r#"{"type":"user","timestamp":"2026-12-31T00:00:00Z","message":{"content":"new"}}"#,
        )
        .unwrap();

        let result = scan_sessions_for_project_in(tmp.path(), folder).unwrap();
        assert_eq!(result.len(), 2);
        // Newest (latest started_at) first.
        assert_eq!(result[0].title, "new");
        assert_eq!(result[1].title, "old");
    }

    #[test]
    fn scan_skips_empty_session_files() {
        let tmp = setup_temp_dir();
        let folder = "C:\\Projects\\test-proj";
        let project_dir = tmp.path().join(folder_to_project_dir_name(folder));
        std::fs::create_dir_all(&project_dir).unwrap();
        let uuid = "33333333-3333-3333-3333-333333333333";
        // Empty file → parse_session_jsonl returns None → not in result.
        std::fs::write(project_dir.join(format!("{}.jsonl", uuid)), "").unwrap();

        let result = scan_sessions_for_project_in(tmp.path(), folder).unwrap();
        assert!(result.is_empty());
    }

    // ========================================================================
    // find_project_dir_in — case-insensitive slug match
    // ========================================================================

    #[test]
    fn find_project_dir_matches_exact_slug() {
        let tmp = setup_temp_dir();
        let folder = "C:\\Projects\\my-app";
        let slug = folder_to_project_dir_name(folder);
        std::fs::create_dir_all(tmp.path().join(&slug)).unwrap();

        let found = find_project_dir_in(tmp.path(), folder);
        assert!(found.is_some());
        assert!(found.unwrap().ends_with(&slug));
    }

    #[test]
    fn find_project_dir_match_is_case_insensitive() {
        let tmp = setup_temp_dir();
        // Create dir with lowercase variant.
        std::fs::create_dir_all(tmp.path().join("c--projects-app")).unwrap();
        // Look up using a folder whose slug differs only in case.
        let found = find_project_dir_in(tmp.path(), "C:\\Projects\\app");
        assert!(found.is_some());
    }

    #[test]
    fn find_project_dir_returns_none_when_no_match() {
        let tmp = setup_temp_dir();
        std::fs::create_dir_all(tmp.path().join("some-other-dir")).unwrap();
        assert!(find_project_dir_in(tmp.path(), "C:\\Projects\\app").is_none());
    }

    #[test]
    fn find_project_dir_ignores_files_with_matching_name() {
        let tmp = setup_temp_dir();
        let folder = "C:\\Projects\\app";
        let slug = folder_to_project_dir_name(folder);
        // A FILE named like the slug — not a directory → must be ignored.
        std::fs::write(tmp.path().join(&slug), "x").unwrap();
        assert!(find_project_dir_in(tmp.path(), folder).is_none());
    }
}
