//! Structured NDJSON logging sink, shared by the Rust backend and the
//! frontend (via the `append_frontend_logs` command). One on-disk artifact
//! (`app-log.ndjson`) so an analysis session reads a single, machine-parseable
//! file. Size-based rotation keeps it bounded.

use crate::error::ADPError;
use crate::LOGGING_ENABLED;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

/// One structured log line. `ts` is ISO-8601 UTC, `level` is lowercase
/// (trace/debug/info/warn/error), `source` is "frontend" or "backend".
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StructuredEntry {
    pub ts: String,
    pub level: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
}

const MAX_BYTES: u64 = 5_000_000; // ~5 MB per file
const KEEP_ROTATED: usize = 3; // app-log.ndjson.1 .. .3

/// Per-field byte cap for frontend-supplied entries. A single uncapped entry
/// (e.g. a JSON.stringify'd store dump) could otherwise blow the 5-MB
/// rotation budget in one write.
pub const MAX_FIELD_BYTES: usize = 16_384;
/// Max entries per `append_frontend_logs` batch (frontend flushes at 25).
const MAX_BATCH: usize = 1000;

/// One-shot stderr warning per rotation-failure streak (reset on success) —
/// the rotation retries on every write while a transient file lock persists;
/// warning on each would spam stderr.
static ROTATE_WARNED: AtomicBool = AtomicBool::new(false);

struct WriterState {
    writer: Option<BufWriter<File>>,
    bytes: u64,
}

static STATE: OnceLock<Mutex<WriterState>> = OnceLock::new();

fn state() -> &'static Mutex<WriterState> {
    STATE.get_or_init(|| {
        Mutex::new(WriterState {
            writer: None,
            bytes: 0,
        })
    })
}

/// `%LOCALAPPDATA%/smashq/app-log.ndjson`, fallback to cwd.
pub fn ndjson_path() -> PathBuf {
    if let Some(data_dir) = std::env::var_os("LOCALAPPDATA") {
        let dir = PathBuf::from(data_dir).join("smashq");
        if std::fs::create_dir_all(&dir).is_ok() {
            return dir.join("app-log.ndjson");
        }
    }
    // Fallback: temp dir, NOT cwd — for an installed app the cwd is the
    // (read-only) install directory, where the append would fail silently
    // and the file would live outside every documented location.
    std::env::temp_dir().join("app-log.ndjson")
}

/// Rotate `path` -> `path.1` -> `path.2` ... dropping the oldest. The shift
/// renames stay best-effort; the PRIMARY rename result is returned so a
/// Windows file lock (AV scanner, tail tool without FILE_SHARE_DELETE)
/// becomes observable to the caller instead of silently unbounded growth.
fn rotate(path: &Path, keep: usize) -> std::io::Result<()> {
    let rotated = |n: usize| path.with_extension(format!("ndjson.{n}"));
    let _ = std::fs::remove_file(rotated(keep));
    for n in (1..keep).rev() {
        let _ = std::fs::rename(rotated(n), rotated(n + 1));
    }
    std::fs::rename(path, rotated(1))
}

/// Core write routine, parameterised on path/limits for testability.
fn write_to(
    st: &mut WriterState,
    path: &Path,
    entries: &[StructuredEntry],
    max_bytes: u64,
    keep: usize,
) -> std::io::Result<()> {
    for entry in entries {
        if st.bytes >= max_bytes {
            if let Some(mut w) = st.writer.take() {
                let _ = w.flush();
            }
            match rotate(path, keep) {
                Ok(()) => ROTATE_WARNED.store(false, Ordering::Relaxed),
                Err(e) => {
                    if !ROTATE_WARNED.swap(true, Ordering::Relaxed) {
                        eprintln!(
                            "[smashq] log rotation failed ({e}); appending to oversized file until the lock clears"
                        );
                    }
                }
            }
            // Reopen below re-reads the real size from metadata, so a failed
            // rotation keeps counting against the (oversized) primary file.
            st.bytes = 0;
        }
        if st.writer.is_none() {
            let f = OpenOptions::new().create(true).append(true).open(path)?;
            st.bytes = f.metadata().map(|m| m.len()).unwrap_or(0);
            st.writer = Some(BufWriter::new(f));
        }
        let line = serde_json::to_string(entry).unwrap_or_else(|_| fallback_line(entry));
        if let Some(w) = st.writer.as_mut() {
            writeln!(w, "{line}")?;
            w.flush()?;
            st.bytes += line.len() as u64 + 1;
        }
    }
    Ok(())
}

/// Marker line when an entry fails to serialize. Must satisfy the
/// StructuredEntry schema (ts/source are mandatory) — otherwise read_from
/// filters it as malformed and the marker is never visible in the viewer.
/// `json!` escapes the caller-provided strings safely.
fn fallback_line(entry: &StructuredEntry) -> String {
    serde_json::json!({
        "ts": entry.ts,
        "level": "error",
        "source": entry.source,
        "message": "serialize failed",
    })
    .to_string()
}

/// Public entry: append `entries` to the shared NDJSON file. `Ok(true)` =
/// written, `Ok(false)` = gate off (defense in depth), `Err` = I/O failure.
/// The env_logger closure ignores the result (it MUST NOT log from the write
/// path — see the deadlock note in lib.rs); the IPC command propagates it so
/// the frontend re-queue/retry machinery actually fires.
pub fn write_entries(entries: &[StructuredEntry]) -> std::io::Result<bool> {
    if !LOGGING_ENABLED.load(Ordering::Relaxed) {
        return Ok(false);
    }
    let path = ndjson_path();
    match state().lock() {
        Ok(mut st) => write_to(&mut st, &path, entries, MAX_BYTES, KEEP_ROTATED).map(|()| true),
        Err(_) => Ok(false), // poisoned mutex: skip, never panic the logger
    }
}

/// Truncate the primary log file and remove rotated siblings, then reset the
/// shared writer so the next append reopens the fresh file. Reihenfolge ist
/// kritisch: den offenen BufWriter ZUERST droppen — auf Windows (kein
/// FILE_SHARE_DELETE) schluege sonst schon das Truncate am eigenen Handle fehl.
fn clear_to(st: &mut WriterState, path: &Path, keep: usize) -> std::io::Result<()> {
    // 1. Offenes Schreib-Handle freigeben.
    st.writer = None;
    // 2. Primaerdatei leeren. truncate statt remove: Inode bleibt erhalten,
    //    kein Delete-am-eigenen-Handle-Problem. create(true) deckt den Fall ab,
    //    dass die Datei noch nicht existiert.
    OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)?;
    st.bytes = 0;
    // 3. Rotierte Dateien wegraeumen (kein offenes Handle -> best-effort).
    for n in 1..=keep {
        let _ = std::fs::remove_file(path.with_extension(format!("ndjson.{n}")));
    }
    Ok(())
}

/// Public: leert das gesamte On-Disk-Log (primaer + rotiert). Recovered einen
/// vergifteten Mutex via into_inner(), weil das offene Handle sonst nie
/// freigegeben wird und der Wipe scheiterte.
pub fn clear_entries() -> std::io::Result<()> {
    let path = ndjson_path();
    let mut st = state().lock().unwrap_or_else(|e| e.into_inner());
    clear_to(&mut st, &path, KEEP_ROTATED)
}

fn truncate_at_boundary(s: &mut String, max: usize) {
    if s.len() <= max {
        return;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s.truncate(end);
}

/// Frontend input is a trust boundary: force the source attribution (a
/// frontend batch claiming source="backend" would falsify the viewer), cap
/// field sizes so a single entry cannot blow the 5-MB rotation budget.
fn sanitize_entry(mut e: StructuredEntry) -> StructuredEntry {
    e.source = "frontend".into();
    truncate_at_boundary(&mut e.message, MAX_FIELD_BYTES);
    if let Some(stack) = e.stack.as_mut() {
        truncate_at_boundary(stack, MAX_FIELD_BYTES);
    }
    if let Some(module) = e.module.as_mut() {
        truncate_at_boundary(module, 256);
    }
    e
}

/// Last `max` lines of one file with bounded memory (no full-file Vec).
/// Byte-based split + lossy UTF-8: a crash mid-write can leave a truncated
/// multibyte sequence, which `lines()` reports as an Err — and would either
/// hide every entry after it (map_while) or risk an infinite Err loop
/// (filter_map, clippy::lines_filter_map_ok). Lossy conversion makes the
/// corrupt line harmless (filtered as malformed JSON later) while map_while
/// still stops on genuine read errors.
fn tail_lines(path: &Path, max: usize) -> VecDeque<String> {
    let Ok(file) = File::open(path) else {
        return VecDeque::new();
    };
    let mut buf: VecDeque<String> = VecDeque::new();
    for chunk in BufReader::new(file).split(b'\n').map_while(Result::ok) {
        if buf.len() == max {
            buf.pop_front();
        }
        buf.push_back(String::from_utf8_lossy(&chunk).into_owned());
    }
    buf
}

/// Read the last `max` entries, skipping malformed lines. When the primary
/// file holds fewer than `max` lines (fresh after rotation), backfill from
/// `.1` → `.3` so the documented "last N entries" contract survives the
/// rotation boundary instead of showing a near-empty viewer.
fn read_from(path: &Path, max: usize) -> Vec<StructuredEntry> {
    let mut lines: Vec<String> = tail_lines(path, max).into();
    for n in 1..=KEEP_ROTATED {
        if lines.len() >= max {
            break;
        }
        let rotated = path.with_extension(format!("ndjson.{n}"));
        let mut older: Vec<String> = tail_lines(&rotated, max - lines.len()).into();
        older.append(&mut lines);
        lines = older;
    }
    lines
        .iter()
        .filter_map(|l| serde_json::from_str::<StructuredEntry>(l).ok())
        .collect()
}

#[allow(clippy::module_inception)]
pub mod commands {
    use super::*;

    /// Frontend batches its log entries here. Input is validated (source
    /// forced to "frontend", fields capped). Errors are propagated — a
    /// silent Ok on gate-off or I/O failure would make the frontend drop
    /// its batch believing it was persisted. `async` keeps the blocking
    /// file I/O off the main thread.
    #[tauri::command]
    pub async fn append_frontend_logs(mut entries: Vec<StructuredEntry>) -> Result<(), ADPError> {
        entries.truncate(MAX_BATCH);
        let entries: Vec<StructuredEntry> = entries.into_iter().map(sanitize_entry).collect();
        match write_entries(&entries) {
            Ok(true) => Ok(()),
            Ok(false) => Err(ADPError::internal(
                "file logging disabled — batch not persisted",
            )),
            Err(e) => Err(ADPError::internal(format!("log write failed: {e}"))),
        }
    }

    /// Returns the last `max_lines` (default 500, capped) structured entries,
    /// backfilling across the rotation boundary. `async` keeps the file scan
    /// (up to ~5 MB) off the main thread — a non-async command would stall
    /// the event loop on every viewer mount/refresh.
    #[tauri::command]
    pub async fn read_structured_log(
        max_lines: Option<usize>,
    ) -> Result<Vec<StructuredEntry>, ADPError> {
        Ok(read_from(
            &ndjson_path(),
            max_lines.unwrap_or(500).min(5000),
        ))
    }

    /// Wipe das gesamte On-Disk-Protokoll (primaere + rotierte NDJSON-Dateien).
    /// Destruktiv und irreversibel — das Frontend fragt vorher per confirm nach.
    /// `async` haelt die Datei-I/O vom Main-Thread fern.
    #[tauri::command]
    pub async fn clear_structured_log() -> Result<(), ADPError> {
        clear_entries().map_err(|e| ADPError::internal(format!("log clear failed: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(level: &str, msg: &str) -> StructuredEntry {
        StructuredEntry {
            ts: "2026-06-07T10:00:00.000Z".into(),
            level: level.into(),
            source: "backend".into(),
            module: Some("test".into()),
            message: msg.into(),
            stack: None,
        }
    }

    #[test]
    fn roundtrip_write_then_read() {
        let dir = std::env::temp_dir().join("smashq-log-test-roundtrip");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("app-log.ndjson");
        let _ = std::fs::remove_file(&path);

        let mut st = WriterState {
            writer: None,
            bytes: 0,
        };
        let entries = vec![
            entry("info", "one"),
            entry("debug", "two"),
            entry("error", "three"),
        ];
        write_to(&mut st, &path, &entries, MAX_BYTES, KEEP_ROTATED).unwrap();
        if let Some(mut w) = st.writer.take() {
            w.flush().unwrap();
        }

        let read = read_from(&path, 500);
        assert_eq!(read.len(), 3);
        assert_eq!(read[0].message, "one");
        assert_eq!(read[1].level, "debug");
        assert_eq!(read[2].message, "three");
    }

    #[test]
    fn rotation_triggers_at_threshold() {
        let dir = std::env::temp_dir().join("smashq-log-test-rotation");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("app-log.ndjson");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("ndjson.1"));

        let mut st = WriterState {
            writer: None,
            bytes: 0,
        };
        let big = entry("info", &"x".repeat(200));
        write_to(&mut st, &path, std::slice::from_ref(&big), 50, KEEP_ROTATED).unwrap();
        write_to(&mut st, &path, std::slice::from_ref(&big), 50, KEEP_ROTATED).unwrap();
        if let Some(mut w) = st.writer.take() {
            w.flush().unwrap();
        }

        assert!(
            path.with_extension("ndjson.1").exists(),
            "rotated file must exist"
        );
        assert!(path.exists(), "fresh primary file must exist");
    }

    #[test]
    fn write_entries_reports_gate_closed() {
        // LOGGING_ENABLED defaults to false in tests (set in run(), not here).
        // A silent-Ok drop was indistinguishable from success for the frontend
        // retry machinery — the gate state must be observable.
        LOGGING_ENABLED.store(false, Ordering::Relaxed);
        let r = write_entries(&[entry("info", "dropped")]);
        assert!(
            matches!(r, Ok(false)),
            "gate-closed must be observable, not silent Ok"
        );
    }

    #[test]
    fn sanitize_entry_caps_fields_and_forces_source() {
        let mut e = entry("info", &"x".repeat(100_000));
        e.stack = Some("y".repeat(100_000));
        e.source = "backend".into(); // Frontend darf Attribution nicht faelschen
        let sanitized = sanitize_entry(e);
        assert!(sanitized.message.len() <= MAX_FIELD_BYTES);
        assert!(sanitized.stack.unwrap().len() <= MAX_FIELD_BYTES);
        assert_eq!(sanitized.source, "frontend");
    }

    #[test]
    fn truncate_respects_char_boundaries() {
        let mut s = "ä".repeat(MAX_FIELD_BYTES); // 2 Bytes je Zeichen
        truncate_at_boundary(&mut s, MAX_FIELD_BYTES);
        assert!(s.len() <= MAX_FIELD_BYTES);
        assert!(s.is_char_boundary(s.len()));
    }

    #[test]
    fn serialize_fallback_line_is_schema_complete() {
        // Der Fallback muss ts/source tragen, sonst filtert read_from ihn als
        // malformed heraus und der Fehler-Marker ist nie sichtbar.
        let line = fallback_line(&entry("info", "whatever"));
        let parsed: StructuredEntry = serde_json::from_str(&line).unwrap();
        assert_eq!(parsed.message, "serialize failed");
        assert!(!parsed.ts.is_empty());
        assert!(!parsed.source.is_empty());
    }

    #[test]
    fn read_skips_invalid_utf8_line_and_keeps_newer_entries() {
        let dir = std::env::temp_dir().join("smashq-log-test-utf8");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("app-log.ndjson");
        let good = |m: &str| {
            format!(
                "{{\"ts\":\"t\",\"level\":\"info\",\"source\":\"backend\",\"message\":\"{m}\"}}"
            )
        };
        let mut bytes = Vec::new();
        bytes.extend_from_slice(good("before").as_bytes());
        bytes.extend_from_slice(b"\n\xC3\x28corrupt\n"); // abgeschnittene Multibyte-Sequenz
        bytes.extend_from_slice(good("after").as_bytes());
        bytes.push(b'\n');
        std::fs::write(&path, bytes).unwrap();

        let read = read_from(&path, 500);
        assert_eq!(read.len(), 2, "entries after a corrupt line must survive");
        assert_eq!(read[1].message, "after");
    }

    #[test]
    fn read_backfills_from_rotated_file_after_rotation() {
        let dir = std::env::temp_dir().join("smashq-log-test-backfill");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("app-log.ndjson");
        let line = |m: &str| {
            format!(
                "{{\"ts\":\"t\",\"level\":\"info\",\"source\":\"backend\",\"message\":\"{m}\"}}\n"
            )
        };
        std::fs::write(
            path.with_extension("ndjson.1"),
            format!("{}{}", line("old1"), line("old2")),
        )
        .unwrap();
        std::fs::write(&path, line("new1")).unwrap();

        let read = read_from(&path, 500);
        assert_eq!(
            read.iter().map(|e| e.message.as_str()).collect::<Vec<_>>(),
            vec!["old1", "old2", "new1"]
        );
        // max wird respektiert — die JUENGSTEN Eintraege gewinnen.
        let capped = read_from(&path, 2);
        assert_eq!(
            capped
                .iter()
                .map(|e| e.message.as_str())
                .collect::<Vec<_>>(),
            vec!["old2", "new1"]
        );
    }

    #[test]
    fn read_skips_malformed_lines() {
        let dir = std::env::temp_dir().join("smashq-log-test-malformed");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("app-log.ndjson");
        std::fs::write(
            &path,
            "not json\n{\"ts\":\"t\",\"level\":\"info\",\"source\":\"backend\",\"message\":\"ok\"}\n",
        )
        .unwrap();
        let read = read_from(&path, 500);
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].message, "ok");
    }

    #[test]
    fn clear_empties_primary_and_rotated_then_writes_fresh() {
        let dir = std::env::temp_dir().join("smashq-log-test-clear");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("app-log.ndjson");
        // Seed: primaere Datei + eine rotierte Datei.
        std::fs::write(&path, "line\n").unwrap();
        std::fs::write(path.with_extension("ndjson.1"), "old\n").unwrap();

        let mut st = WriterState {
            writer: None,
            bytes: 99,
        };
        clear_to(&mut st, &path, KEEP_ROTATED).unwrap();

        // Primaere Datei existiert und ist leer, rotierte weg, bytes zurueckgesetzt.
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "");
        assert!(!path.with_extension("ndjson.1").exists());
        assert_eq!(st.bytes, 0);
        assert!(st.writer.is_none());

        // Ein Write NACH dem Clear landet in der frischen Datei (kein stale Handle).
        write_to(
            &mut st,
            &path,
            &[entry("info", "after")],
            MAX_BYTES,
            KEEP_ROTATED,
        )
        .unwrap();
        if let Some(mut w) = st.writer.take() {
            w.flush().unwrap();
        }
        let read = read_from(&path, 500);
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].message, "after");
    }
}
