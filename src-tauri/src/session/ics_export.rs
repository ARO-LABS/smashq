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

// ─── RFC5545 line folding ─────────────────────────────────────────────────────

/// Fold a single content line per RFC5545 §3.1: no line may exceed 75 octets.
/// Longer lines are split with CRLF + a single leading space; the space is
/// stripped by parsers when unfolding. Splits only on UTF-8 char boundaries so
/// a multi-byte codepoint is never cut in half.
///
/// The caller passes a complete, already-escaped line such as
/// `SUMMARY:Buy milk` — the property name counts toward the 75-octet budget,
/// exactly as RFC5545 requires.
fn fold_line(line: &str) -> String {
    const MAX_OCTETS: usize = 75;
    let mut out = String::with_capacity(line.len());
    let mut octets_in_line = 0usize;
    for ch in line.chars() {
        let ch_len = ch.len_utf8();
        // Continuation lines carry a leading space, leaving 74 octets of
        // payload budget. Fold before the char that would overflow.
        if octets_in_line + ch_len > MAX_OCTETS {
            out.push_str("\r\n ");
            octets_in_line = 1; // the leading space
        }
        out.push(ch);
        octets_in_line += ch_len;
    }
    out
}

// ─── Pure ICS builder ────────────────────────────────────────────────────────

/// Build a complete VCALENDAR string for a single task event.
///
/// This is a pure function so it can be unit-tested without file I/O or a
/// Tauri runtime. The Tauri command calls this and then writes the result.
///
/// # Arguments
/// * `title`     – Task title (non-empty, ≤500 chars; caller must validate).
/// * `starts_at` – Unix timestamp in milliseconds for event start (> 0; caller must validate).
/// * `ends_at`   – Unix timestamp in milliseconds for event end (≥ starts_at; caller must validate).
/// * `note`      – Optional task note placed in DESCRIPTION.
pub fn build_ics(
    title: &str,
    starts_at: i64,
    ends_at: i64,
    note: Option<&str>,
) -> Result<String, ADPError> {
    let to_local = |ms: i64| -> Result<DateTime<Local>, ADPError> {
        Utc.timestamp_opt(ms / 1000, 0)
            .single()
            .map(|u| u.with_timezone(&Local))
            .ok_or_else(|| ADPError::validation("Ungültiger Timestamp"))
    };
    let start_local = to_local(starts_at)?;
    let end_local = to_local(ends_at)?;

    let dtstamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let dtstart_line = format!("DTSTART:{}", start_local.format("%Y%m%dT%H%M%S"));
    let dtend_line = format!("DTEND:{}", end_local.format("%Y%m%dT%H%M%S"));

    // SUMMARY/DESCRIPTION/UID can exceed 75 octets, so fold the complete
    // (property-name-included) line per RFC5545 §3.1 to stay valid for strict
    // parsers.
    let summary_line = fold_line(&format!("SUMMARY:{}", ics_escape(title)));
    let description = note
        .map(|n| {
            format!(
                "{}\r\n",
                fold_line(&format!("DESCRIPTION:{}", ics_escape(n)))
            )
        })
        .unwrap_or_default();

    // UID is deterministic from starts_at so repeated exports do not
    // create duplicate calendar entries in most PIM applications.
    let uid_line = fold_line(&format!("UID:smashq-{}@local", starts_at));

    let ics = format!(
        "BEGIN:VCALENDAR\r\n\
         VERSION:2.0\r\n\
         PRODID:-//Smashq//Tasks//DE\r\n\
         CALSCALE:GREGORIAN\r\n\
         METHOD:PUBLISH\r\n\
         BEGIN:VEVENT\r\n\
         {uid}\r\n\
         DTSTAMP:{dtstamp}\r\n\
         {dtstart}\r\n\
         {dtend}\r\n\
         {summary}\r\n\
         {description}\
         TRANSP:OPAQUE\r\n\
         BEGIN:VALARM\r\n\
         TRIGGER:-PT15M\r\n\
         ACTION:DISPLAY\r\n\
         DESCRIPTION:Erinnerung\r\n\
         END:VALARM\r\n\
         END:VEVENT\r\n\
         END:VCALENDAR\r\n",
        uid = uid_line,
        dtstamp = dtstamp,
        dtstart = dtstart_line,
        dtend = dtend_line,
        summary = summary_line,
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
    /// * `title`     – Task title.
    /// * `starts_at` – Unix epoch in **milliseconds** for event start (> 0).
    /// * `ends_at`   – Unix epoch in **milliseconds** for event end (≥ starts_at).
    /// * `note`      – Optional task note for the DESCRIPTION field.
    #[tauri::command]
    pub async fn export_task_ics(
        title: String,
        starts_at: i64,
        ends_at: i64,
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
        if starts_at <= 0 {
            return Err(ADPError::validation(
                "Startzeit muss ein positiver Unix-Timestamp (ms) sein",
            ));
        }
        if ends_at < starts_at {
            return Err(ADPError::validation(
                "Endzeit darf nicht vor der Startzeit liegen",
            ));
        }

        // ── Build ICS content ────────────────────────────────────────────────
        let ics_content = build_ics(&title, starts_at, ends_at, note.as_deref())?;

        // ── Write to a per-process temp subdir ───────────────────────────────
        // Filename is derived exclusively from the numeric starts_at to prevent
        // any path-traversal attack via user-supplied title strings.
        //
        // Writing into a per-process subdir (smashq-<pid>) instead of the
        // world-writable shared temp_dir() removes the predictable-path
        // symlink/overwrite-follow vector on multi-user hosts: another user
        // cannot pre-create our exact path to redirect or clobber the write.
        let dir = std::env::temp_dir().join(format!("smashq-{}", std::process::id()));
        std::fs::create_dir_all(&dir).map_err(|e| {
            ADPError::command_failed(format!("Fehler beim Anlegen des Temp-Ordners: {}", e))
        })?;
        let file_name = format!("smashq-task-{}.ics", starts_at);
        let temp_path = dir.join(&file_name);

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
    const FIXED_START_MS: i64 = 1_718_461_800_000;
    // FIXED_END_MS = FIXED_START_MS + 30 minutes
    const FIXED_END_MS: i64 = FIXED_START_MS + 30 * 60 * 1000;

    // ── build_ics: structure ─────────────────────────────────────────────────

    #[test]
    fn build_ics_contains_vevent_wrapper() {
        let ics = build_ics("Test", FIXED_START_MS, FIXED_END_MS, None).unwrap();
        assert!(ics.contains("BEGIN:VCALENDAR"));
        assert!(ics.contains("BEGIN:VEVENT"));
        assert!(ics.contains("END:VEVENT"));
        assert!(ics.contains("END:VCALENDAR"));
    }

    #[test]
    fn build_ics_contains_required_properties() {
        let ics = build_ics("Test", FIXED_START_MS, FIXED_END_MS, None).unwrap();
        assert!(ics.contains("PRODID:-//Smashq//Tasks//DE"));
        assert!(ics.contains("VERSION:2.0"));
        assert!(ics.contains("TRANSP:OPAQUE"));
        assert!(ics.contains("TRIGGER:-PT15M"));
    }

    #[test]
    fn build_ics_uid_contains_starts_at() {
        let ics = build_ics("Test", FIXED_START_MS, FIXED_END_MS, None).unwrap();
        assert!(ics.contains(&format!("UID:smashq-{}@local", FIXED_START_MS)));
    }

    // ── RFC5545 line folding (finding 5) ─────────────────────────────────────

    /// Returns the byte length of the longest physical line in `ics`,
    /// ignoring the CRLF terminators that `lines()` already strips.
    fn max_line_octets(ics: &str) -> usize {
        ics.lines().map(|l| l.len()).max().unwrap_or(0)
    }

    #[test]
    fn fold_line_short_line_unchanged() {
        // A line well under 75 octets must pass through verbatim (happy path).
        assert_eq!(fold_line("SUMMARY:short"), "SUMMARY:short");
    }

    #[test]
    fn build_ics_long_summary_is_folded_to_75_octets() {
        // A >75-octet title must produce only physical lines of <=75 octets.
        let long_title = "A".repeat(300);
        let ics = build_ics(&long_title, FIXED_START_MS, FIXED_END_MS, None).unwrap();
        assert!(
            max_line_octets(&ics) <= 75,
            "every physical line must be <=75 octets, got {}",
            max_line_octets(&ics)
        );
        // Folding must be lossless: unfolding (drop CRLF + leading space)
        // restores the original SUMMARY payload.
        let unfolded = ics.replace("\r\n ", "");
        assert!(unfolded.contains(&format!("SUMMARY:{}", long_title)));
    }

    #[test]
    fn fold_line_never_splits_multibyte_char() {
        // Edge case: a run of 3-octet codepoints (€ = 0xE2 0x82 0xAC). The
        // folder must break on char boundaries, so every continuation chunk
        // remains valid UTF-8 and re-parses without replacement chars.
        let line = format!("SUMMARY:{}", "\u{20AC}".repeat(60));
        let folded = fold_line(&line);
        assert!(folded.is_char_boundary(folded.len()));
        for physical in folded.split("\r\n ") {
            assert!(physical.len() <= 75, "chunk too long: {}", physical.len());
        }
        // No codepoint was destroyed: unfolding restores the original.
        assert_eq!(folded.replace("\r\n ", ""), line);
    }

    // ── DTSTART formatting ───────────────────────────────────────────────────

    #[test]
    fn build_ics_timed_dtstart_has_local_datetime_format() {
        let ics = build_ics("Test", FIXED_START_MS, FIXED_END_MS, None).unwrap();
        // Must start with "DTSTART:" (no VALUE= prefix) and contain a
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
        let ics = build_ics("Buy milk, eggs", FIXED_START_MS, FIXED_END_MS, None).unwrap();
        assert!(
            ics.contains("SUMMARY:Buy milk\\, eggs"),
            "comma must be escaped in SUMMARY"
        );
    }

    #[test]
    fn build_ics_description_is_escaped() {
        let ics = build_ics(
            "Test",
            FIXED_START_MS,
            FIXED_END_MS,
            Some("Note; with\nnewline"),
        )
        .unwrap();
        assert!(ics.contains("DESCRIPTION:Note\\; with\\nnewline"));
    }

    // ── Note optional ────────────────────────────────────────────────────────

    #[test]
    fn build_ics_without_note_omits_description() {
        let ics = build_ics("Test", FIXED_START_MS, FIXED_END_MS, None).unwrap();
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
        let ics = build_ics("Test", FIXED_START_MS, FIXED_END_MS, Some("My note")).unwrap();
        assert!(ics.contains("DESCRIPTION:My note"));
    }

    // ── Validation errors ────────────────────────────────────────────────────

    #[test]
    fn build_ics_rejects_invalid_timestamp() {
        // A clearly-out-of-range value (i64::MIN) should cause chrono to fail
        // to produce a valid DateTime, triggering the builder-level error.
        let result = build_ics("Test", i64::MIN, i64::MIN + 1, None);
        assert!(result.is_err());
    }

    // ── DTEND is after DTSTART ───────────────────────────────────────────────

    #[test]
    fn build_ics_timed_dtend_is_after_dtstart() {
        let ics = build_ics("Test", FIXED_START_MS, FIXED_END_MS, None).unwrap();
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
        assert!(end_val > start_val, "DTEND must be after DTSTART");
    }

    #[test]
    fn build_ics_dtend_matches_ends_at() {
        let ics = build_ics("T", FIXED_START_MS, FIXED_END_MS, None).unwrap();
        let dig = |p: &str| {
            ics.lines()
                .find(|l| l.starts_with(p))
                .unwrap()
                .trim_start_matches(p)
                .chars()
                .filter(|c| c.is_ascii_digit())
                .collect::<String>()
        };
        assert!(dig("DTEND:").parse::<u64>().unwrap() > dig("DTSTART:").parse::<u64>().unwrap());
    }

    // ── Temp-file integration (uses tempfile dev-dep indirectly via std) ──────

    #[test]
    fn build_ics_output_can_be_written_and_re_read() {
        let ics = build_ics(
            "Schreiben & Lesen",
            FIXED_START_MS,
            FIXED_END_MS,
            Some("ok"),
        )
        .unwrap();
        let tmp = std::env::temp_dir().join("smashq-ics-test-roundtrip.ics");
        std::fs::write(&tmp, ics.as_bytes()).unwrap();
        let back = std::fs::read_to_string(&tmp).unwrap();
        std::fs::remove_file(&tmp).ok();
        assert!(back.contains("BEGIN:VEVENT"));
        assert!(back.contains("SUMMARY:Schreiben & Lesen"));
    }
}
