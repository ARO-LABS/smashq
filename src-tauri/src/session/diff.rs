// src-tauri/src/session/diff.rs
//
// Session-Diff: per-session git snapshot mechanism + diff computation.
//
// Snapshot model (siehe `tasks/2026-05-12-session-diff-window-design.md`):
// 1. Beim Session-Start (in `create_session`) wird ein gc-sicherer Snapshot
//    angelegt — entweder via `git stash create` (Working-Tree mit eingefrorenem
//    Stand) oder als Fallback der aktuelle HEAD. Der Snapshot landet als
//    Ref unter `refs/agentic-explorer/session-<id>`.
// 2. Beim Session-Close wird der Ref geloescht (`git update-ref -d`).
// 3. `get_session_diff` vergleicht den Snapshot mit dem aktuellen Working-Tree
//    und liefert ein deterministisches `SessionDiff`-Struct.
//
// Performance-Budget: `MAX_FILE_BYTES` (500 KB pro File) + `MAX_TOTAL_BYTES`
// (5 MB Total). Oversize-Files werden ohne Content geliefert, das Top-Total-Limit
// triggert `truncated=true`.

use crate::error::{ADPError, ADPErrorCode};
use crate::util::{silent_command, timed_output, DEFAULT_COMMAND_TIMEOUT};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::path::Path;
use std::process::Output;
use std::time::Instant;

/// Runs `git -C <folder> <args...>` with the shared `DEFAULT_COMMAND_TIMEOUT`
/// and returns the raw `Output` (or the spawn/timeout error from
/// `timed_output`). Centralizes only the invariant boilerplate that every git
/// call in this module shares — the `-C <folder>` prefix, the silent-command
/// console-hiding, and the timeout — so each call site keeps its own exact
/// stdout-vs-status-vs-exit-code handling and error mapping.
///
/// Behavior-preserving by construction: the produced argv is byte-identical to
/// the hand-rolled `silent_command("git").arg("-C").arg(folder)...` chains it
/// replaces, because `args` is appended in order after the `-C <folder>` pair.
fn git_in<I, S>(folder: &Path, args: I) -> Result<Output, ADPError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut cmd = silent_command("git");
    cmd.arg("-C").arg(folder);
    cmd.args(args);
    timed_output(cmd, DEFAULT_COMMAND_TIMEOUT)
}

/// Per-file Performance-Budget: ueberschreitet ein einzelnes File diese Groesse,
/// wird `oversize=true` gesetzt und beide Contents leer gelassen — der User
/// sieht den Status und kann externen Tools nachgehen.
pub const MAX_FILE_BYTES: u64 = 500 * 1024;

/// Diff-weites Performance-Budget. Total bezieht sich auf Summe aller
/// `old_content` + `new_content`. Wird das Limit erreicht, wird der Rest
/// der Files mit `oversize=true` angereichert und `truncated=true` gesetzt.
pub const MAX_TOTAL_BYTES: usize = 5 * 1024 * 1024;

/// Status eines Files im Diff (an Git `--name-status` orientiert).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    pub path: String,
    pub status: FileStatus,
    pub additions: u32,
    pub deletions: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_content: Option<String>,
    /// True wenn File ueber `MAX_FILE_BYTES` liegt oder Total-Budget
    /// erschoepft ist. Frontend zeigt dann nur den Status, keinen Inhalt.
    pub oversize: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDiff {
    pub session_id: String,
    pub snapshot_commit: String,
    pub snapshot_at: DateTime<Utc>,
    pub computed_at: DateTime<Utc>,
    pub compute_ms: u64,
    pub files: Vec<DiffFile>,
    /// True wenn Total-Performance-Budget (5 MB) erreicht wurde.
    pub truncated: bool,
}

/// Result eines erfolgreichen Session-Start-Snapshots — gespeichert
/// auf der Session-Struktur und im Diff-Window angezeigt.
#[derive(Debug, Clone)]
pub struct SnapshotResult {
    pub commit: String,
    pub created_at: DateTime<Utc>,
}

/// Prueft, ob der angegebene Pfad innerhalb eines Git-Working-Tree liegt.
/// False bei nicht-Repos, bare-Repos und I/O-Fehlern.
pub fn is_git_repo(folder: &Path) -> bool {
    match git_in(folder, ["rev-parse", "--is-inside-work-tree"]) {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            stdout == "true"
        }
        _ => false,
    }
}

/// Legt fuer `session_id` einen Snapshot-Ref unter
/// `refs/agentic-explorer/session-<id>` an.
///
/// Ablauf:
/// 1. `git stash create` — liefert einen Commit, der Working-Tree + Index
///    eingefroren enthaelt. Bei cleanem Tree leerer Output.
/// 2. Fallback auf `git rev-parse HEAD`, wenn `stash create` nichts produziert
///    hat oder fehlgeschlagen ist (Empty-Repo erkennt das auch).
/// 3. `git update-ref` registriert den Commit gc-sicher.
///
/// Die `session_id` MUSS bereits validiert sein (alphanumerisch + `-`/`_`).
pub fn create_session_snapshot(
    folder: &Path,
    session_id: &str,
) -> Result<SnapshotResult, ADPError> {
    debug_assert!(
        session_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
        "create_session_snapshot: session_id contained invalid characters"
    );

    // Step 1: stash create — produziert einen Commit auch ohne stash push.
    let stash_commit = match git_in(folder, ["stash", "create"]) {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        }
        _ => None,
    };

    // Step 2: Fallback auf HEAD-Commit bei cleanem Tree, Merge-State o.ae.
    let commit = match stash_commit {
        Some(c) => c,
        None => {
            let out = git_in(folder, ["rev-parse", "HEAD"]).map_err(|e| {
                ADPError::command_failed(format!("git rev-parse HEAD failed: {}", e))
            })?;
            if !out.status.success() {
                let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
                return Err(ADPError::new(
                    ADPErrorCode::CommandExecutionFailed,
                    format!("git rev-parse HEAD failed: {}", stderr.trim()),
                ));
            }
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        }
    };

    if commit.is_empty() {
        return Err(ADPError::new(
            ADPErrorCode::CommandExecutionFailed,
            "Snapshot creation produced empty commit hash",
        ));
    }

    // Step 3: gc-sichere Persistenz via update-ref.
    let ref_name = ref_name_for_session(session_id);
    let out = git_in(folder, ["update-ref", ref_name.as_str(), commit.as_str()])
        .map_err(|e| ADPError::command_failed(format!("git update-ref failed: {}", e)))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        return Err(ADPError::new(
            ADPErrorCode::CommandExecutionFailed,
            format!("git update-ref failed: {}", stderr.trim()),
        ));
    }

    Ok(SnapshotResult {
        commit,
        created_at: Utc::now(),
    })
}

/// Loescht den Snapshot-Ref fuer eine Session. Fehlt der Ref bereits
/// (z. B. weil das Repo manuell geputzt wurde), wird `Ok(())` zurueckgegeben
/// — wir wollen Session-Close nicht haerter machen als noetig.
pub fn delete_session_snapshot(folder: &Path, session_id: &str) -> Result<(), ADPError> {
    let ref_name = ref_name_for_session(session_id);
    match git_in(folder, ["update-ref", "-d", ref_name.as_str()]) {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            log::warn!(
                "delete_session_snapshot: ref {} could not be removed: {}",
                ref_name,
                stderr.trim()
            );
            Ok(())
        }
        Err(e) => {
            log::warn!("delete_session_snapshot: {}", e);
            Ok(())
        }
    }
}

/// Schneller "gibt es ueberhaupt Aenderungen seit Snapshot?"-Check.
///
/// Vermeidet die teure `compute_session_diff`-Pipeline (Content-Reads,
/// Budget-Tracking) und macht nur:
/// 1. `git diff --quiet <snapshot>` — Exit 0 = no diff, 1 = diff present.
/// 2. `git ls-files --others --exclude-standard` — Untracked-Probe (git diff
///    sieht Untracked nicht; ein einziger Untracked-File reicht fuer Diff=true).
///
/// Bei jedem nicht-erfolgreichen Git-Aufruf wird `false` geliefert — der
/// Caller behandelt "unknown" wie "kein Diff", damit das UI in Race-Conditions
/// (z.B. Snapshot-Ref gerade geloescht) nicht faelschlich ein Icon zeigt.
pub fn has_session_diff(folder: &Path, snapshot_commit: &str) -> bool {
    match git_in(folder, ["diff", "--quiet", snapshot_commit, "--", "."]) {
        Ok(out) => {
            // Exit 1 = differences found. Exit 0 = no diff. Other codes
            // (z.B. 128 fuer broken ref) fallen unten in den Untracked-Check.
            if let Some(code) = out.status.code() {
                if code == 1 {
                    return true;
                }
                if code != 0 {
                    // Snapshot kaputt / nicht erreichbar — kein verlaesslicher
                    // Modified-Diff, aber Untracked koennte noch existieren.
                    log::debug!(
                        "has_session_diff: git diff --quiet returned exit {} for {:?}",
                        code,
                        folder
                    );
                }
            }
        }
        Err(e) => {
            log::debug!("has_session_diff: git diff --quiet error: {}", e);
            return false;
        }
    }

    match git_in(folder, ["ls-files", "--others", "--exclude-standard"]) {
        Ok(out) if out.status.success() => {
            // Auch nur EINE nicht-leere Zeile = es gibt Untracked-Changes.
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .any(|l| !l.trim().is_empty())
        }
        _ => false,
    }
}

/// Berechnet das `SessionDiff` zwischen Snapshot und aktuellem Working-Tree.
pub fn compute_session_diff(
    folder: &Path,
    session_id: &str,
    snapshot_commit: &str,
    snapshot_at: DateTime<Utc>,
) -> Result<SessionDiff, ADPError> {
    let started = Instant::now();

    // 1) `git diff --name-status` — Status pro File.
    let status_out = git_in(
        folder,
        ["diff", "--name-status", snapshot_commit, "--", "."],
    )
    .map_err(|e| ADPError::command_failed(format!("git diff --name-status failed: {}", e)))?;
    if !status_out.status.success() {
        let stderr = String::from_utf8_lossy(&status_out.stderr).into_owned();
        return Err(ADPError::new(
            ADPErrorCode::CommandExecutionFailed,
            format!("git diff --name-status failed: {}", stderr.trim()),
        ));
    }
    let mut entries = parse_name_status(&String::from_utf8_lossy(&status_out.stdout));

    // 2) Untracked Files dazumischen — `git diff` ignoriert sie.
    if let Ok(out) = git_in(folder, ["ls-files", "--others", "--exclude-standard"]) {
        if out.status.success() {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let path = line.trim();
                if path.is_empty() {
                    continue;
                }
                if entries.iter().any(|(p, _)| p == path) {
                    continue;
                }
                entries.push((path.to_string(), FileStatus::Untracked));
            }
        }
    }

    // 3) `git diff --numstat` — Additionen/Deletionen pro File.
    let numstats: std::collections::HashMap<String, (u32, u32)> =
        match git_in(folder, ["diff", "--numstat", snapshot_commit, "--", "."]) {
            Ok(out) if out.status.success() => parse_numstat(&String::from_utf8_lossy(&out.stdout)),
            _ => std::collections::HashMap::new(),
        };

    // 4) Pro File Contents nachladen, dabei Budget-Tracking.
    let mut files: Vec<DiffFile> = Vec::with_capacity(entries.len());
    let mut total_bytes: usize = 0;
    let mut truncated = false;

    for (path, status) in entries {
        let (additions, deletions) = numstats.get(&path).copied().unwrap_or((0, 0));
        let mut file = DiffFile {
            path: path.clone(),
            status: status.clone(),
            additions,
            deletions,
            old_content: None,
            new_content: None,
            oversize: false,
        };

        if truncated {
            // Total-Budget bereits ueberschritten — Rest oversize markieren.
            file.oversize = true;
            files.push(file);
            continue;
        }

        // old_content (aus Snapshot lesen, ausser bei Added/Untracked).
        let want_old = !matches!(status, FileStatus::Added | FileStatus::Untracked);
        let want_new = !matches!(status, FileStatus::Deleted);

        let old_size = if want_old {
            file_size_in_commit(folder, snapshot_commit, &path).unwrap_or(0)
        } else {
            0
        };
        let new_size = if want_new {
            let p = folder.join(&path);
            std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };
        let largest = old_size.max(new_size);

        if largest > MAX_FILE_BYTES {
            file.oversize = true;
            files.push(file);
            continue;
        }

        if want_old {
            file.old_content = read_file_from_commit(folder, snapshot_commit, &path).ok();
        }
        if want_new {
            let p = folder.join(&path);
            file.new_content = std::fs::read_to_string(&p).ok();
        }

        let consumed = file.old_content.as_ref().map(|s| s.len()).unwrap_or(0)
            + file.new_content.as_ref().map(|s| s.len()).unwrap_or(0);

        if total_bytes.saturating_add(consumed) > MAX_TOTAL_BYTES {
            file.old_content = None;
            file.new_content = None;
            file.oversize = true;
            truncated = true;
        } else {
            total_bytes = total_bytes.saturating_add(consumed);
        }

        files.push(file);
    }

    let compute_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;

    Ok(SessionDiff {
        session_id: session_id.to_string(),
        snapshot_commit: snapshot_commit.to_string(),
        snapshot_at,
        computed_at: Utc::now(),
        compute_ms,
        files,
        truncated,
    })
}

fn ref_name_for_session(session_id: &str) -> String {
    format!("refs/agentic-explorer/session-{}", session_id)
}

/// Parses `git diff --name-status` output into `(path, status)` pairs.
///
/// `pub` so the criterion benchmark in `benches/parsers.rs` can measure it;
/// the function is otherwise an internal helper of `compute_session_diff`.
pub fn parse_name_status(out: &str) -> Vec<(String, FileStatus)> {
    let mut result = Vec::new();
    for line in out.lines() {
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split('\t');
        let Some(status_str) = parts.next() else {
            continue;
        };
        let status_char = status_str.chars().next().unwrap_or('M');
        let status = match status_char {
            'A' => FileStatus::Added,
            'D' => FileStatus::Deleted,
            'R' => FileStatus::Renamed,
            _ => FileStatus::Modified,
        };

        // Renamed-Zeilen haben drei Tab-getrennte Felder (`R100<TAB>old<TAB>new`).
        // Wir zeigen den neuen Pfad.
        let path = match status {
            FileStatus::Renamed => parts.nth(1).unwrap_or("").to_string(),
            _ => parts.next().unwrap_or("").to_string(),
        };

        if path.is_empty() {
            continue;
        }
        result.push((path, status));
    }
    result
}

/// Parses `git diff --numstat` output into a `path → (additions, deletions)` map.
///
/// `pub` so the criterion benchmark in `benches/parsers.rs` can measure it;
/// the function is otherwise an internal helper of `compute_session_diff`.
pub fn parse_numstat(out: &str) -> std::collections::HashMap<String, (u32, u32)> {
    let mut map = std::collections::HashMap::new();
    for line in out.lines() {
        // Split lazily — `git diff --numstat` lines are `add<TAB>del<TAB>path`.
        // Taking three iterator steps avoids the per-line `Vec<&str>` heap
        // allocation that `.collect()` would cost; a line with fewer than
        // three fields yields `None` and is skipped, same as the old
        // `parts.len() < 3` guard.
        let mut parts = line.split('\t');
        let (Some(add_str), Some(del_str), Some(path)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let additions: u32 = add_str.parse().unwrap_or(0);
        let deletions: u32 = del_str.parse().unwrap_or(0);
        // Binaere Files liefern "-\t-\tpath", parse() failt → 0/0 ist ok.
        map.insert(path.to_string(), (additions, deletions));
    }
    map
}

fn file_size_in_commit(folder: &Path, commit: &str, path: &str) -> Result<u64, ADPError> {
    let spec = format!("{}:{}", commit, path);
    let out = git_in(folder, ["cat-file", "-s", spec.as_str()])
        .map_err(|e| ADPError::command_failed(format!("git cat-file -s failed: {}", e)))?;
    if !out.status.success() {
        return Ok(0);
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Ok(s.parse::<u64>().unwrap_or(0))
}

fn read_file_from_commit(folder: &Path, commit: &str, path: &str) -> Result<String, ADPError> {
    let spec = format!("{}:{}", commit, path);
    let out = git_in(folder, ["show", spec.as_str()])
        .map_err(|e| ADPError::command_failed(format!("git show failed: {}", e)))?;
    if !out.status.success() {
        return Err(ADPError::new(
            ADPErrorCode::FileIoError,
            format!("git show {}:{} not found", commit, path),
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_name_status_handles_basic_statuses() {
        let out = "M\tsrc/foo.rs\nA\tsrc/new.rs\nD\tsrc/old.rs\n";
        let parsed = parse_name_status(out);
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0], ("src/foo.rs".to_string(), FileStatus::Modified));
        assert_eq!(parsed[1], ("src/new.rs".to_string(), FileStatus::Added));
        assert_eq!(parsed[2], ("src/old.rs".to_string(), FileStatus::Deleted));
    }

    #[test]
    fn parse_name_status_handles_renamed() {
        // Renamed-Zeilen aus `git diff --name-status` haben 3 Felder.
        let out = "R100\told/path.rs\tnew/path.rs\n";
        let parsed = parse_name_status(out);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0], ("new/path.rs".to_string(), FileStatus::Renamed));
    }

    #[test]
    fn parse_numstat_skips_binary_and_empty() {
        let out = "5\t2\tfoo.rs\n-\t-\tbinary.png\n\n";
        let map = parse_numstat(out);
        assert_eq!(map.get("foo.rs"), Some(&(5u32, 2u32)));
        // Binary-File: parse() failt -> 0/0
        assert_eq!(map.get("binary.png"), Some(&(0u32, 0u32)));
    }

    #[test]
    fn ref_name_for_session_uses_namespace() {
        assert_eq!(
            ref_name_for_session("abc-123"),
            "refs/agentic-explorer/session-abc-123"
        );
    }

    // --- parse_name_status: edge cases ----------------------------------

    #[test]
    fn parse_name_status_empty_input_yields_empty() {
        assert!(parse_name_status("").is_empty());
        assert!(parse_name_status("\n\n\n").is_empty());
    }

    #[test]
    fn parse_name_status_unknown_status_char_falls_back_to_modified() {
        // Copy ('C'), Type-change ('T'), Unmerged ('U') sind nicht explizit
        // gemappt -> Default-Arm liefert Modified.
        let out = "C\tsrc/copy.rs\nT\tsrc/type.rs\nU\tsrc/unmerged.rs\n";
        let parsed = parse_name_status(out);
        assert_eq!(parsed.len(), 3);
        assert!(parsed.iter().all(|(_, s)| *s == FileStatus::Modified));
    }

    #[test]
    fn parse_name_status_skips_line_with_missing_path() {
        // Status-Feld vorhanden, aber kein Tab/Pfad -> Zeile wird verworfen.
        let out = "M\nA\tsrc/real.rs\n";
        let parsed = parse_name_status(out);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].0, "src/real.rs");
    }

    #[test]
    fn parse_name_status_renamed_without_new_path_is_skipped() {
        // Renamed erwartet 3 Felder; fehlt das dritte -> leerer Pfad -> skip.
        let out = "R100\told/only.rs\n";
        let parsed = parse_name_status(out);
        assert!(parsed.is_empty());
    }

    #[test]
    fn parse_name_status_preserves_paths_with_spaces() {
        let out = "M\tsrc/dir with space/file name.rs\n";
        let parsed = parse_name_status(out);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].0, "src/dir with space/file name.rs");
    }

    #[test]
    fn parse_name_status_status_uses_first_char_of_field() {
        // `git diff --name-status` liefert bei Rename `R100`, bei Copy `C075`.
        // Nur das erste Zeichen entscheidet.
        let out = "R087\ta.rs\tb.rs\n";
        let parsed = parse_name_status(out);
        assert_eq!(parsed[0], ("b.rs".to_string(), FileStatus::Renamed));
    }

    // --- parse_numstat: edge cases --------------------------------------

    #[test]
    fn parse_numstat_empty_input_yields_empty_map() {
        assert!(parse_numstat("").is_empty());
    }

    #[test]
    fn parse_numstat_skips_lines_with_too_few_fields() {
        // Zwei-Feld-Zeile hat keinen Pfad -> ignoriert.
        let out = "5\t2\n10\t3\tok.rs\n";
        let map = parse_numstat(out);
        assert_eq!(map.len(), 1);
        assert_eq!(map.get("ok.rs"), Some(&(10u32, 3u32)));
    }

    #[test]
    fn parse_numstat_zero_counts_are_kept() {
        let out = "0\t0\tunchanged.rs\n";
        let map = parse_numstat(out);
        assert_eq!(map.get("unchanged.rs"), Some(&(0u32, 0u32)));
    }

    #[test]
    fn parse_numstat_negative_value_falls_back_to_zero() {
        // Git liefert nie negativ, aber parse::<u32>() failt sauber -> 0.
        let out = "-3\t4\tbad.rs\n";
        let map = parse_numstat(out);
        assert_eq!(map.get("bad.rs"), Some(&(0u32, 4u32)));
    }

    #[test]
    fn parse_numstat_last_line_wins_on_duplicate_path() {
        // HashMap::insert ueberschreibt -> letzte Zeile gewinnt.
        let out = "1\t1\tdup.rs\n9\t9\tdup.rs\n";
        let map = parse_numstat(out);
        assert_eq!(map.get("dup.rs"), Some(&(9u32, 9u32)));
    }

    #[test]
    fn parse_numstat_large_counts_parse_correctly() {
        let out = "1000000\t999999\tbig.rs\n";
        let map = parse_numstat(out);
        assert_eq!(map.get("big.rs"), Some(&(1_000_000u32, 999_999u32)));
    }

    // --- ref_name_for_session -------------------------------------------

    #[test]
    fn ref_name_for_session_handles_underscores_and_empty() {
        assert_eq!(
            ref_name_for_session("a_b_c"),
            "refs/agentic-explorer/session-a_b_c"
        );
        assert_eq!(ref_name_for_session(""), "refs/agentic-explorer/session-");
    }

    // --- FileStatus serde -----------------------------------------------

    #[test]
    fn file_status_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&FileStatus::Modified).unwrap(),
            "\"modified\""
        );
        assert_eq!(
            serde_json::to_string(&FileStatus::Untracked).unwrap(),
            "\"untracked\""
        );
        assert_eq!(
            serde_json::to_string(&FileStatus::Renamed).unwrap(),
            "\"renamed\""
        );
    }

    #[test]
    fn file_status_deserializes_lowercase_roundtrip() {
        for status in [
            FileStatus::Modified,
            FileStatus::Added,
            FileStatus::Deleted,
            FileStatus::Renamed,
            FileStatus::Untracked,
        ] {
            let json = serde_json::to_string(&status).unwrap();
            let back: FileStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(back, status);
        }
    }

    #[test]
    fn file_status_rejects_unknown_variant() {
        assert!(serde_json::from_str::<FileStatus>("\"bogus\"").is_err());
        // Capitalized variante wird von rename_all = "lowercase" abgelehnt.
        assert!(serde_json::from_str::<FileStatus>("\"Modified\"").is_err());
    }

    // --- DiffFile serde --------------------------------------------------

    #[test]
    fn diff_file_serializes_camel_case_keys() {
        let file = DiffFile {
            path: "src/x.rs".to_string(),
            status: FileStatus::Modified,
            additions: 3,
            deletions: 1,
            old_content: Some("old".to_string()),
            new_content: Some("new".to_string()),
            oversize: false,
        };
        let json = serde_json::to_string(&file).unwrap();
        assert!(json.contains("\"oldContent\":\"old\""));
        assert!(json.contains("\"newContent\":\"new\""));
        assert!(json.contains("\"oversize\":false"));
    }

    #[test]
    fn diff_file_skips_none_content_fields() {
        let file = DiffFile {
            path: "src/del.rs".to_string(),
            status: FileStatus::Deleted,
            additions: 0,
            deletions: 7,
            old_content: None,
            new_content: None,
            oversize: false,
        };
        let json = serde_json::to_string(&file).unwrap();
        // skip_serializing_if = Option::is_none -> Keys ganz weglassen.
        assert!(!json.contains("oldContent"));
        assert!(!json.contains("newContent"));
        // oversize hat kein skip -> immer da.
        assert!(json.contains("\"oversize\":false"));
    }

    // --- SessionDiff serde + struct construction -------------------------

    #[test]
    fn session_diff_serializes_camel_case_keys() {
        let now = Utc::now();
        let diff = SessionDiff {
            session_id: "sess-1".to_string(),
            snapshot_commit: "deadbeef".to_string(),
            snapshot_at: now,
            computed_at: now,
            compute_ms: 42,
            files: Vec::new(),
            truncated: true,
        };
        let json = serde_json::to_string(&diff).unwrap();
        assert!(json.contains("\"sessionId\":\"sess-1\""));
        assert!(json.contains("\"snapshotCommit\":\"deadbeef\""));
        assert!(json.contains("\"computeMs\":42"));
        assert!(json.contains("\"truncated\":true"));
        assert!(json.contains("\"files\":[]"));
    }

    #[test]
    fn session_diff_serializes_nested_files() {
        let now = Utc::now();
        let diff = SessionDiff {
            session_id: "s".to_string(),
            snapshot_commit: "c".to_string(),
            snapshot_at: now,
            computed_at: now,
            compute_ms: 0,
            files: vec![DiffFile {
                path: "a.rs".to_string(),
                status: FileStatus::Added,
                additions: 5,
                deletions: 0,
                old_content: None,
                new_content: Some("x".to_string()),
                oversize: false,
            }],
            truncated: false,
        };
        let json = serde_json::to_string(&diff).unwrap();
        assert!(json.contains("\"status\":\"added\""));
        assert!(json.contains("\"newContent\":\"x\""));
    }

    // --- Budget constants ------------------------------------------------

    #[test]
    fn budget_constants_have_expected_sizes() {
        assert_eq!(MAX_FILE_BYTES, 500 * 1024);
        assert_eq!(MAX_TOTAL_BYTES, 5 * 1024 * 1024);
        // Per-File-Budget muss kleiner sein als das Total-Budget.
        assert!((MAX_FILE_BYTES as usize) < MAX_TOTAL_BYTES);
    }

    // --- SnapshotResult construction ------------------------------------

    #[test]
    fn snapshot_result_holds_commit_and_timestamp() {
        let before = Utc::now();
        let result = SnapshotResult {
            commit: "abc123".to_string(),
            created_at: Utc::now(),
        };
        assert_eq!(result.commit, "abc123");
        assert!(result.created_at >= before);
    }
}
