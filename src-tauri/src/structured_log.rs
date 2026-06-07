//! Structured NDJSON logging sink, shared by the Rust backend and the
//! frontend (via the `append_frontend_logs` command). One on-disk artifact
//! (`app-log.ndjson`) so an analysis session reads a single, machine-parseable
//! file. Size-based rotation keeps it bounded.

use crate::error::ADPError;
use crate::LOGGING_ENABLED;
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
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
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("app-log.ndjson")
}

/// Rotate `path` -> `path.1` -> `path.2` ... dropping the oldest.
fn rotate(path: &Path, keep: usize) {
    let rotated = |n: usize| path.with_extension(format!("ndjson.{n}"));
    let _ = std::fs::remove_file(rotated(keep));
    for n in (1..keep).rev() {
        let _ = std::fs::rename(rotated(n), rotated(n + 1));
    }
    let _ = std::fs::rename(path, rotated(1));
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
            rotate(path, keep);
            st.bytes = 0;
        }
        if st.writer.is_none() {
            let f = OpenOptions::new().create(true).append(true).open(path)?;
            st.bytes = f.metadata().map(|m| m.len()).unwrap_or(0);
            st.writer = Some(BufWriter::new(f));
        }
        let line = serde_json::to_string(entry).unwrap_or_else(|_| {
            String::from("{\"level\":\"error\",\"message\":\"serialize failed\"}")
        });
        if let Some(w) = st.writer.as_mut() {
            writeln!(w, "{line}")?;
            w.flush()?;
            st.bytes += line.len() as u64 + 1;
        }
    }
    Ok(())
}

/// Public entry: append `entries` to the shared NDJSON file when logging is
/// enabled. No-ops when the gate is off (defense in depth).
pub fn write_entries(entries: &[StructuredEntry]) {
    if !LOGGING_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    let path = ndjson_path();
    if let Ok(mut st) = state().lock() {
        let _ = write_to(&mut st, &path, entries, MAX_BYTES, KEEP_ROTATED);
    }
}

/// Read the last `max` entries, skipping malformed lines.
fn read_from(path: &Path, max: usize) -> Vec<StructuredEntry> {
    let Ok(file) = File::open(path) else {
        return Vec::new();
    };
    let lines: Vec<String> = BufReader::new(file).lines().map_while(Result::ok).collect();
    let start = lines.len().saturating_sub(max);
    lines[start..]
        .iter()
        .filter_map(|l| serde_json::from_str::<StructuredEntry>(l).ok())
        .collect()
}

#[allow(clippy::module_inception)]
pub mod commands {
    use super::*;

    /// Frontend batches its log entries here. Each entry's `source` is "frontend".
    #[tauri::command]
    pub fn append_frontend_logs(entries: Vec<StructuredEntry>) -> Result<(), ADPError> {
        write_entries(&entries);
        Ok(())
    }

    /// Returns the last `max_lines` (default 500) structured entries.
    #[tauri::command]
    pub fn read_structured_log(max_lines: Option<usize>) -> Result<Vec<StructuredEntry>, ADPError> {
        Ok(read_from(&ndjson_path(), max_lines.unwrap_or(500)))
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
}
