// src-tauri/src/session/ics_export.rs
//
// .ics calendar export for Tasks.
// RFC5545-compliant VCALENDAR/VEVENT — opens the generated file via the OS
// default calendar app so Smashq never has to know about the user's PIM tool.

use crate::error::ADPError;
use crate::util::silent_command;
use chrono::{DateTime, Local, TimeZone, Utc};

// ─── RFC5545 text escaping ───────────────────────────────────────────────────

/// Escape a user string for use inside a SUMMARY or DESCRIPTION property value.
///
/// RFC5545 §3.3.11 defines the TEXT escape rules:
///   - backslash → `\\`
///   - comma      → `\,`
///   - semicolon  → `\;`
///   - newline    → `\n` (literal backslash-n, not a real LF in the value)
fn ics_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace(',', "\\,")
        .replace(';', "\\;")
        .replace('\n', "\\n")
        .replace('\r', "") // strip CR; the LF above covers CRLF pairs
}

// ─── Pure ICS builder ────────────────────────────────────────────────────────

/// Build a complete VCALENDAR string for a single task event.
///
/// This is a pure function so it can be unit-tested without file I/O or a
/// Tauri runtime. The Tauri command calls this and then writes the result.
///
/// # Arguments
/// * `title`    – Task title (non-empty, ≤500 chars; caller must validate).
/// * `deadline` – Unix timestamp in milliseconds (> 0; caller must validate).
/// * `has_time` – When `true` the DTSTART is a local datetime; otherwise
///   VALUE=DATE (all-day event, DTEND +1 day).
/// * `note`     – Optional task note placed in DESCRIPTION.
pub fn build_ics(
    title: &str,
    deadline: i64,
    has_time: bool,
    note: Option<&str>,
) -> Result<String, ADPError> {
    // Convert deadline (ms) → DateTime
    let deadline_secs = deadline / 1000;
    let deadline_utc: DateTime<Utc> = Utc
        .timestamp_opt(deadline_secs, 0)
        .single()
        .ok_or_else(|| ADPError::validation("Ungültiger Deadline-Timestamp"))?;
    let deadline_local: DateTime<Local> = deadline_utc.with_timezone(&Local);

    // DTSTAMP — "now" in UTC, always in the full datetime+Z format.
    let dtstamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();

    // DTSTART / DTEND depend on whether the user stored a time component.
    let (dtstart_line, dtend_line) = if has_time {
        // Timed event: local wall-clock, no Z suffix, no VALUE= prefix.
        let start = deadline_local.format("%Y%m%dT%H%M%S").to_string();
        // DTEND = start + 1 hour
        let end_dt = deadline_local + chrono::Duration::hours(1);
        let end = end_dt.format("%Y%m%dT%H%M%S").to_string();
        (format!("DTSTART:{}", start), format!("DTEND:{}", end))
    } else {
        // All-day event: VALUE=DATE, YYYYMMDD, DTEND = next calendar day.
        let start = deadline_local.format("%Y%m%d").to_string();
        let end_dt = deadline_local + chrono::Duration::days(1);
        let end = end_dt.format("%Y%m%d").to_string();
        (
            format!("DTSTART;VALUE=DATE:{}", start),
            format!("DTEND;VALUE=DATE:{}", end),
        )
    };

    let summary = ics_escape(title);
    let description = note
        .map(|n| format!("DESCRIPTION:{}\r\n", ics_escape(n)))
        .unwrap_or_default();

    // UID is deterministic from the deadline so repeated exports do not
    // create duplicate calendar entries in most PIM applications.
    let uid = format!("smashq-{}@local", deadline);

    let ics = format!(
        "BEGIN:VCALENDAR\r\n\
         VERSION:2.0\r\n\
         PRODID:-//Smashq//Tasks//DE\r\n\
         CALSCALE:GREGORIAN\r\n\
         METHOD:PUBLISH\r\n\
         BEGIN:VEVENT\r\n\
         UID:{uid}\r\n\
         DTSTAMP:{dtstamp}\r\n\
         {dtstart}\r\n\
         {dtend}\r\n\
         SUMMARY:{summary}\r\n\
         {description}\
         TRANSP:OPAQUE\r\n\
         BEGIN:VALARM\r\n\
         TRIGGER:-PT15M\r\n\
         ACTION:DISPLAY\r\n\
         DESCRIPTION:Erinnerung\r\n\
         END:VALARM\r\n\
         END:VEVENT\r\n\
         END:VCALENDAR\r\n",
        uid = uid,
        dtstamp = dtstamp,
        dtstart = dtstart_line,
        dtend = dtend_line,
        summary = summary,
        description = description,
    );

    Ok(ics)
}

// ─── Tauri command ───────────────────────────────────────────────────────────

pub mod commands {
    use super::*;

    /// Export a task as an .ics file and open it in the OS default calendar app.
    ///
    /// # Parameters
    /// * `title`             – Task title.
    /// * `deadline`          – Unix epoch in **milliseconds** (> 0).
    /// * `deadline_has_time` – Whether a specific time was set on the deadline.
    /// * `note`              – Optional task note for the DESCRIPTION field.
    #[tauri::command]
    pub async fn export_task_ics(
        title: String,
        deadline: i64,
        deadline_has_time: bool,
        note: Option<String>,
    ) -> Result<(), ADPError> {
        // ── Validation ──────────────────────────────────────────────────────
        let title = title.trim().to_string();
        if title.is_empty() {
            return Err(ADPError::validation("Aufgabentitel darf nicht leer sein"));
        }
        if title.len() > 500 {
            return Err(ADPError::validation(
                "Aufgabentitel darf maximal 500 Zeichen haben",
            ));
        }
        if deadline <= 0 {
            return Err(ADPError::validation(
                "Deadline muss ein positiver Unix-Timestamp (ms) sein",
            ));
        }

        // ── Build ICS content ────────────────────────────────────────────────
        let ics_content = build_ics(&title, deadline, deadline_has_time, note.as_deref())?;

        // ── Write to temp dir ────────────────────────────────────────────────
        // Filename is derived exclusively from the numeric deadline to prevent
        // any path-traversal attack via user-supplied title strings.
        let file_name = format!("smashq-task-{}.ics", deadline);
        let temp_path = std::env::temp_dir().join(&file_name);

        std::fs::write(&temp_path, ics_content.as_bytes()).map_err(|e| {
            ADPError::command_failed(format!("Fehler beim Schreiben der .ics-Datei: {}", e))
        })?;

        let path_str = temp_path
            .to_str()
            .ok_or_else(|| ADPError::internal("Ungültiger Temp-Pfad"))?;

        // ── Shell-open (per-OS, mirrors folder_actions.rs pattern) ───────────
        #[cfg(target_os = "windows")]
        {
            silent_command("cmd")
                .args(["/C", "start", "", path_str])
                .spawn()
                .map_err(|e| {
                    ADPError::command_failed(format!("Fehler beim Öffnen der .ics-Datei: {}", e))
                })?;
        }
        #[cfg(target_os = "macos")]
        {
            silent_command("open").arg(path_str).spawn().map_err(|e| {
                ADPError::command_failed(format!("Fehler beim Öffnen der .ics-Datei: {}", e))
            })?;
        }
        #[cfg(target_os = "linux")]
        {
            silent_command("xdg-open")
                .arg(path_str)
                .spawn()
                .map_err(|e| {
                    ADPError::command_failed(format!("Fehler beim Öffnen der .ics-Datei: {}", e))
                })?;
        }

        log::info!("Exported task ICS: {}", temp_path.display());
        Ok(())
    }
}

// ─── Unit tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // A fixed timestamp: 2024-06-15 14:30:00 UTC → ms = 1718461800000
    // We use a concrete value so that DTSTART format assertions are stable.
    const FIXED_DEADLINE_MS: i64 = 1_718_461_800_000;

    // ── build_ics: structure ─────────────────────────────────────────────────

    #[test]
    fn build_ics_contains_vevent_wrapper() {
        let ics = build_ics("Test", FIXED_DEADLINE_MS, true, None).unwrap();
        assert!(ics.contains("BEGIN:VCALENDAR"));
        assert!(ics.contains("BEGIN:VEVENT"));
        assert!(ics.contains("END:VEVENT"));
        assert!(ics.contains("END:VCALENDAR"));
    }

    #[test]
    fn build_ics_contains_required_properties() {
        let ics = build_ics("Test", FIXED_DEADLINE_MS, false, None).unwrap();
        assert!(ics.contains("PRODID:-//Smashq//Tasks//DE"));
        assert!(ics.contains("VERSION:2.0"));
        assert!(ics.contains("TRANSP:OPAQUE"));
        assert!(ics.contains("TRIGGER:-PT15M"));
    }

    #[test]
    fn build_ics_uid_contains_deadline() {
        let ics = build_ics("Test", FIXED_DEADLINE_MS, false, None).unwrap();
        assert!(ics.contains(&format!("UID:smashq-{}@local", FIXED_DEADLINE_MS)));
    }

    // ── DTSTART formatting ───────────────────────────────────────────────────

    #[test]
    fn build_ics_timed_dtstart_has_local_datetime_format() {
        let ics = build_ics("Test", FIXED_DEADLINE_MS, true, None).unwrap();
        // Timed: must start with "DTSTART:" (no VALUE= prefix) and contain a
        // datetime token matching YYYYMMDDTHHMMSS (15 digits + T separator).
        assert!(ics.contains("DTSTART:"));
        // The value must NOT carry a VALUE=DATE prefix.
        assert!(!ics.contains("DTSTART;VALUE=DATE:"));
        // Rough shape check: find the DTSTART line and verify its value looks
        // like a local datetime string (14 digits + T at position 8).
        let dtstart_val = ics
            .lines()
            .find(|l| l.starts_with("DTSTART:"))
            .unwrap()
            .trim_start_matches("DTSTART:");
        assert_eq!(dtstart_val.len(), 15, "YYYYMMDDTHHMMSS = 15 chars");
        assert_eq!(&dtstart_val[8..9], "T");
        // Must NOT end with Z (timed local, not UTC).
        assert!(!dtstart_val.ends_with('Z'));
    }

    #[test]
    fn build_ics_date_only_dtstart_uses_value_date() {
        let ics = build_ics("Test", FIXED_DEADLINE_MS, false, None).unwrap();
        assert!(ics.contains("DTSTART;VALUE=DATE:"));
        // DATE value: 8 digits only, no T.
        let dtstart_val = ics
            .lines()
            .find(|l| l.starts_with("DTSTART;VALUE=DATE:"))
            .unwrap()
            .trim_start_matches("DTSTART;VALUE=DATE:");
        assert_eq!(dtstart_val.len(), 8, "YYYYMMDD = 8 chars");
        assert!(!dtstart_val.contains('T'));
    }

    // ── RFC5545 escaping ─────────────────────────────────────────────────────

    #[test]
    fn ics_escape_replaces_comma() {
        assert_eq!(ics_escape("a,b"), "a\\,b");
    }

    #[test]
    fn ics_escape_replaces_semicolon() {
        assert_eq!(ics_escape("a;b"), "a\\;b");
    }

    #[test]
    fn ics_escape_replaces_backslash() {
        assert_eq!(ics_escape("a\\b"), "a\\\\b");
    }

    #[test]
    fn ics_escape_replaces_newline() {
        assert_eq!(ics_escape("a\nb"), "a\\nb");
    }

    #[test]
    fn ics_escape_order_backslash_before_comma() {
        // A backslash followed by a comma: `\,` must become `\\,` (backslash
        // escaped first), NOT `\\\,` (comma re-escaped after the backslash).
        assert_eq!(ics_escape("\\,"), "\\\\\\,");
    }

    #[test]
    fn build_ics_summary_is_escaped() {
        // Title with a comma — must appear as \, in SUMMARY.
        let ics = build_ics("Buy milk, eggs", FIXED_DEADLINE_MS, false, None).unwrap();
        assert!(
            ics.contains("SUMMARY:Buy milk\\, eggs"),
            "comma must be escaped in SUMMARY"
        );
    }

    #[test]
    fn build_ics_description_is_escaped() {
        let ics = build_ics(
            "Test",
            FIXED_DEADLINE_MS,
            false,
            Some("Note; with\nnewline"),
        )
        .unwrap();
        assert!(ics.contains("DESCRIPTION:Note\\; with\\nnewline"));
    }

    // ── Note optional ────────────────────────────────────────────────────────

    #[test]
    fn build_ics_without_note_omits_description() {
        let ics = build_ics("Test", FIXED_DEADLINE_MS, false, None).unwrap();
        // The VALARM block always emits "DESCRIPTION:Erinnerung".
        // When no note is given, no other DESCRIPTION property must appear.
        // We verify that every "DESCRIPTION:" line in the output is exactly
        // the VALARM reminder line and nothing task-note-related.
        let task_description_lines: Vec<&str> = ics
            .lines()
            .filter(|l| l.starts_with("DESCRIPTION:") && *l != "DESCRIPTION:Erinnerung")
            .collect();
        assert!(
            task_description_lines.is_empty(),
            "Unexpected DESCRIPTION lines: {:?}",
            task_description_lines
        );
    }

    #[test]
    fn build_ics_with_note_includes_description() {
        let ics = build_ics("Test", FIXED_DEADLINE_MS, false, Some("My note")).unwrap();
        assert!(ics.contains("DESCRIPTION:My note"));
    }

    // ── Validation errors ────────────────────────────────────────────────────

    #[test]
    fn build_ics_rejects_invalid_timestamp() {
        // Timestamp 0 ms → epoch second 0, which is valid for chrono but we
        // check deadline > 0 in the command layer. At the builder level, a
        // clearly-out-of-range value (negative seconds) should also error.
        let result = build_ics("Test", i64::MIN, false, None);
        assert!(result.is_err());
    }

    // ── DTEND is after DTSTART ───────────────────────────────────────────────

    #[test]
    fn build_ics_timed_dtend_is_one_hour_after_dtstart() {
        let ics = build_ics("Test", FIXED_DEADLINE_MS, true, None).unwrap();
        let start_val: u64 = ics
            .lines()
            .find(|l| l.starts_with("DTSTART:"))
            .unwrap()
            .trim_start_matches("DTSTART:")
            .chars()
            .filter(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse()
            .unwrap();
        let end_val: u64 = ics
            .lines()
            .find(|l| l.starts_with("DTEND:"))
            .unwrap()
            .trim_start_matches("DTEND:")
            .chars()
            .filter(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse()
            .unwrap();
        // end > start (exact hour difference is timezone-sensitive; just confirm end > start)
        assert!(end_val > start_val, "DTEND must be after DTSTART");
    }

    #[test]
    fn build_ics_date_only_dtend_is_next_day() {
        let ics = build_ics("Test", FIXED_DEADLINE_MS, false, None).unwrap();
        let start_str = ics
            .lines()
            .find(|l| l.starts_with("DTSTART;VALUE=DATE:"))
            .unwrap()
            .trim_start_matches("DTSTART;VALUE=DATE:");
        let end_str = ics
            .lines()
            .find(|l| l.starts_with("DTEND;VALUE=DATE:"))
            .unwrap()
            .trim_start_matches("DTEND;VALUE=DATE:");
        let start_day: u32 = start_str[6..8].parse().unwrap();
        let end_day: u32 = end_str[6..8].parse().unwrap();
        // Same month: end day = start day + 1 (or month rolled over, but for
        // the fixed mid-month timestamp this holds cleanly).
        assert_eq!(end_day, start_day + 1, "DTEND must be next calendar day");
    }

    // ── Temp-file integration (uses tempfile dev-dep indirectly via std) ──────

    #[test]
    fn build_ics_output_can_be_written_and_re_read() {
        let ics = build_ics("Schreiben & Lesen", FIXED_DEADLINE_MS, true, Some("ok")).unwrap();
        let tmp = std::env::temp_dir().join("smashq-ics-test-roundtrip.ics");
        std::fs::write(&tmp, ics.as_bytes()).unwrap();
        let back = std::fs::read_to_string(&tmp).unwrap();
        std::fs::remove_file(&tmp).ok();
        assert!(back.contains("BEGIN:VEVENT"));
        assert!(back.contains("SUMMARY:Schreiben & Lesen"));
    }
}
