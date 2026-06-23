// src-tauri/src/session/manager.rs

use crate::error::{ADPError, ADPErrorCode};
use chrono::{DateTime, Utc};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    pub folder: String,
    pub shell: String,
    pub status: String, // "running" | "done" | "error"
    pub exit_code: Option<i32>,
    /// True wenn der `folder` als Git-Working-Tree erkannt wurde — Diff-Button
    /// im Frontend bindet daran sein Sichtbarkeitsflag.
    #[serde(rename = "isGitRepo")]
    pub is_git_repo: bool,
    /// Commit-Hash des Pre-Spawn-Snapshots (Stash oder HEAD). None bei
    /// Non-Git-Folders, leerem Repo oder Snapshot-Fehler.
    #[serde(rename = "snapshotCommit", skip_serializing_if = "Option::is_none")]
    pub snapshot_commit: Option<String>,
    /// Zeitpunkt des Snapshots — vom Frontend im Diff-Window-Footer angezeigt.
    #[serde(rename = "snapshotAt", skip_serializing_if = "Option::is_none")]
    pub snapshot_at: Option<DateTime<Utc>>,
}

#[derive(Clone, serde::Serialize)]
pub struct SessionOutputEvent {
    pub id: String,
    pub data: String,
}

#[derive(Clone, serde::Serialize)]
pub struct SessionExitEvent {
    pub id: String,
    pub exit_code: i32,
}

#[derive(Clone, serde::Serialize)]
pub struct SessionStatusEvent {
    pub id: String,
    pub status: String,
    pub snippet: String,
}

/// Emitted once when the watcher thread observes the freshly-spawned
/// Claude session's jsonl file appearing in `~/.claude/projects/<slug>/`.
/// The frontend uses this for deterministic session-id assignment instead
/// of the `started_at` proximity heuristic that mis-pairs runtime cards
/// to UUIDs when two sessions spawn in the same folder within ~1s.
#[derive(Clone, serde::Serialize)]
pub struct SessionClaudeIdEvent {
    pub id: String,
    #[serde(rename = "claudeSessionId")]
    pub claude_session_id: String,
}

struct SessionHandle {
    info: SessionInfo,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    /// Killer handle cloned from the spawned child. close_session calls
    /// `kill()` on this so a per-session close deterministically terminates
    /// the shell — dropping the master alone does NOT reach grandchildren
    /// (claude.exe + MCP servers) on Windows, where the Job Object only
    /// fires on whole-app exit.
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// Set by close_session to make the claude-id watcher thread exit early
    /// instead of polling up to 15s and emitting a resolve event for a dead
    /// session.
    watcher_cancelled: Arc<AtomicBool>,
}

pub struct SessionManager {
    sessions: Mutex<HashMap<String, SessionHandle>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Spawnt eine neue Claude-Session in einem PTY.
    ///
    /// Bestimmt den Shell-Befehl anhand des `shell`-Parameters:
    /// - "powershell" → `powershell.exe -NoExit -Command claude --dangerously-skip-permissions`
    /// - "cmd" → `cmd.exe /K claude --dangerously-skip-permissions`
    /// - "gitbash" → `bash.exe -c "claude --dangerously-skip-permissions"`
    #[allow(clippy::too_many_arguments)]
    pub fn create_session(
        &self,
        app: AppHandle,
        id: String,
        title: String,
        folder: String,
        shell: String,
        resume_session_id: Option<String>,
        initial_cols: Option<u16>,
        initial_rows: Option<u16>,
    ) -> Result<SessionInfo, ADPError> {
        // Default to 120x40 instead of 80x24 so TUI apps (e.g. Claude CLI)
        // don't render a cramped initial UI before the frontend resize_session
        // call catches up. Frontend can pass exact dimensions for a perfect fit.
        let cols = initial_cols.filter(|c| *c > 0).unwrap_or(120);
        let rows = initial_rows.filter(|r| *r > 0).unwrap_or(40);

        log::info!(
            "Creating session id={}, shell={}, folder={}, size={}x{}",
            id,
            shell,
            folder,
            cols,
            rows
        );

        // Validate the shell executable exists
        let shell_exe = Self::shell_executable(&shell);
        if which_executable(shell_exe).is_none() {
            let msg = format!(
                "Failed to create session {}: shell executable '{}' not found in PATH",
                id, shell_exe
            );
            log::error!("{}", msg);
            return Err(ADPError::new(ADPErrorCode::TerminalSpawnFailed, msg));
        }

        let pty_system = native_pty_system();

        let pty_pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| {
                log::error!("Failed to open PTY for session {}: {}", id, e);
                ADPError::new(
                    ADPErrorCode::TerminalSpawnFailed,
                    format!("Failed to open PTY for session {id}: {e}"),
                )
            })?;

        let mut cmd = CommandBuilder::new(shell_exe);
        for arg in Self::shell_args(&shell, resume_session_id.as_deref()) {
            cmd.arg(arg);
        }
        cmd.cwd(&folder);

        // Disable Claude-Code's flicker-free rendering mode (v2.1.89+).
        // In embedded xterm.js/Tauri terminals, the virtualized scrollback of that
        // mode destroys the user-visible history. Falls back to v2.1.87 behaviour
        // (linear LF-based output), which xterm.js handles correctly.
        // Reference: https://github.com/anthropics/claude-code/issues/41965
        cmd.env("CLAUDE_CODE_NO_FLICKER", "0");

        // Pre-spawn snapshot for deterministic claude-session-id discovery.
        // Skipped when resuming — the UUID is already known and a watcher
        // would just observe the unchanged set then time out.
        let claude_projects_root = if resume_session_id.is_none() {
            dirs::home_dir().map(|h| h.join(".claude").join("projects"))
        } else {
            None
        };
        let pre_spawn_snapshot = claude_projects_root
            .as_ref()
            .map(|root| super::file_reader::snapshot_session_uuids_in(root, &folder))
            .unwrap_or_default();

        let child = pty_pair.slave.spawn_command(cmd).map_err(|e| {
            log::error!(
                "Failed to spawn shell '{}' for session {}: {}",
                shell_exe,
                id,
                e
            );
            ADPError::new(
                ADPErrorCode::TerminalSpawnFailed,
                format!("Failed to spawn shell for session {id}: {e}"),
            )
        })?;

        // Defense-in-Depth: assign the child to our Win32 Job Object so the
        // kernel kills it (cascading to claude.exe + MCP-Server descendants)
        // when our process dies — even on crash / Task-Manager End Task,
        // where the sauberer-Close-Pfad via CloseRequested never runs.
        // No-op on non-Windows. Failures are logged-only by design.
        if let Some(pid) = child.process_id() {
            super::win_job::assign_child(pid);
        }

        // Clone a killer handle BEFORE the child is moved into the waiter
        // thread. close_session uses this to kill the shell deterministically;
        // the child itself stays in the waiter thread so wait() still reaps it.
        let killer = child.clone_killer();

        log::info!(
            "Session {} spawned successfully with shell '{}'",
            id,
            shell_exe
        );

        let writer = pty_pair.master.take_writer().map_err(|e| {
            log::error!("Failed to acquire PTY writer for session {}: {}", id, e);
            ADPError::new(
                ADPErrorCode::TerminalSpawnFailed,
                format!("Failed to acquire PTY writer for session {id}: {e}"),
            )
        })?;

        let mut reader = pty_pair.master.try_clone_reader().map_err(|e| {
            log::error!("Failed to acquire PTY reader for session {}: {}", id, e);
            ADPError::new(
                ADPErrorCode::TerminalSpawnFailed,
                format!("Failed to acquire PTY reader for session {id}: {e}"),
            )
        })?;

        // Pre-spawn git snapshot — registriert einen gc-sicheren Ref unter
        // `refs/agentic-explorer/session-<id>`. Failure ist NIE fatal fuer
        // create_session: ohne Snapshot bleibt nur der Diff-Button leer.
        let folder_path = std::path::PathBuf::from(&folder);
        let is_git_repo = super::diff::is_git_repo(&folder_path);
        let (snapshot_commit, snapshot_at) = if is_git_repo {
            match super::diff::create_session_snapshot(&folder_path, &id) {
                Ok(snap) => {
                    log::info!(
                        "Session {} snapshot ref created at commit {}",
                        id,
                        snap.commit
                    );
                    (Some(snap.commit), Some(snap.created_at))
                }
                Err(e) => {
                    log::warn!("Session {} snapshot failed: {}", id, e);
                    (None, None)
                }
            }
        } else {
            (None, None)
        };

        let info = SessionInfo {
            id: id.clone(),
            title,
            folder,
            shell,
            status: "running".to_string(),
            exit_code: None,
            is_git_repo,
            snapshot_commit,
            snapshot_at,
        };

        let watcher_cancelled = Arc::new(AtomicBool::new(false));
        {
            let mut sessions = self.lock_sessions();
            sessions.insert(
                id.clone(),
                SessionHandle {
                    info: info.clone(),
                    writer,
                    master: pty_pair.master,
                    killer,
                    watcher_cancelled: Arc::clone(&watcher_cancelled),
                },
            );
        }

        // Watcher-Thread: deterministische claude-session-id-discovery.
        // Polls `~/.claude/projects/<slug>/` for the FIRST UUID that did not
        // exist in the pre-spawn snapshot — that UUID belongs to this
        // session's transcript. Replaces the started_at proximity heuristic
        // that mis-paired runtime cards to UUIDs (and persisted the swap).
        // Skipped on resume — UUID is already known via `resume_session_id`.
        if let Some(root) = claude_projects_root {
            let watch_id = id.clone();
            let watch_app = app.clone();
            let watch_folder = info.folder.clone();
            let snapshot = pre_spawn_snapshot;
            let cancel = Arc::clone(&watcher_cancelled);
            thread::spawn(move || {
                Self::run_id_watcher(watch_app, watch_id, root, watch_folder, snapshot, cancel);
            });
        }

        // Reader-Thread: liest PTY-Output und emittiert Events
        let read_id = id.clone();
        let read_app = app.clone();
        thread::spawn(move || {
            log::info!("Session {} reader thread started", read_id);
            let mut buf = [0u8; 4096];
            // Track last emitted status to deduplicate — only emit on transitions.
            // Empty string forces the first detected status to always emit.
            let mut last_emitted_status = String::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        log::info!("Session {} reader: EOF reached", read_id);
                        break;
                    }
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();

                        // Output-Event an Frontend
                        if let Err(e) = read_app.emit(
                            "session-output",
                            SessionOutputEvent {
                                id: read_id.clone(),
                                data: data.clone(),
                            },
                        ) {
                            log::debug!("Session {} failed to emit session-output: {}", read_id, e);
                        }

                        // Status-Heuristik: letzte Zeile pruefen
                        let snippet = if data.len() > 200 {
                            // Find a valid char boundary to avoid panic on multi-byte UTF-8
                            let start = data
                                .char_indices()
                                .rev()
                                .nth(199)
                                .map(|(i, _)| i)
                                .unwrap_or(0);
                            data[start..].to_string()
                        } else {
                            data.clone()
                        };

                        // Only emit session-status when the detected status changes.
                        // This reduces Tauri event traffic from ~100-200/s to ~1-5/s,
                        // eliminating redundant store updates and React re-renders.
                        let status = Self::detect_status(&snippet);
                        if status != last_emitted_status {
                            last_emitted_status = status.clone();
                            if let Err(e) = read_app.emit(
                                "session-status",
                                SessionStatusEvent {
                                    id: read_id.clone(),
                                    status,
                                    snippet: snippet.clone(),
                                },
                            ) {
                                log::debug!(
                                    "Session {} failed to emit session-status: {}",
                                    read_id,
                                    e
                                );
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("Session {} reader error: {}", read_id, e);
                        break;
                    }
                }
            }
            log::info!("Session {} reader thread exiting", read_id);
        });

        // Waiter-Thread: wartet auf Prozess-Ende
        let wait_id = id.clone();
        let wait_app = app;
        thread::spawn(move || {
            log::info!("Session {} waiter thread started", wait_id);
            let mut child = child;
            let result = match child.wait() {
                Ok(status) => {
                    let code = status.exit_code() as i32;
                    let is_normal = code == 0
                        || (cfg!(windows) && (code == -1073741510 || code == -1073741509));

                    if is_normal {
                        log::debug!(
                            "Session {} child process exited normally (code {})",
                            wait_id,
                            code
                        );
                    } else {
                        log::warn!(
                            "Session {} child process exited with unexpected code: {}",
                            wait_id,
                            code
                        );
                    }
                    code
                }
                Err(e) => {
                    log::error!(
                        "Session {} failed to wait for child process: {}",
                        wait_id,
                        e
                    );
                    -1
                }
            };

            if let Err(e) = wait_app.emit(
                "session-exit",
                SessionExitEvent {
                    id: wait_id.clone(),
                    exit_code: result,
                },
            ) {
                log::debug!("Session {} failed to emit session-exit: {}", wait_id, e);
            }
        });

        Ok(info)
    }

    /// Sendet Daten (User-Input) an eine laufende Session.
    pub fn write_to_session(&self, id: &str, data: &str) -> Result<(), ADPError> {
        let mut sessions = self.lock_sessions();
        let session = sessions.get_mut(id).ok_or_else(|| {
            ADPError::new(
                ADPErrorCode::SessionNotFound,
                format!("Session not found: {id}"),
            )
        })?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| ADPError::internal(format!("Failed to write to session {id}: {e}")))?;
        session
            .writer
            .flush()
            .map_err(|e| ADPError::internal(format!("Failed to flush session {id}: {e}")))?;
        Ok(())
    }

    /// Aendert die Terminal-Groesse einer Session.
    pub fn resize_session(&self, id: &str, cols: u16, rows: u16) -> Result<(), ADPError> {
        let sessions = self.lock_sessions();
        let session = sessions.get(id).ok_or_else(|| {
            ADPError::new(
                ADPErrorCode::SessionNotFound,
                format!("Session not found: {id}"),
            )
        })?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| ADPError::internal(format!("Failed to resize session {id}: {e}")))
    }

    /// Schliesst eine Session (killt den Prozess).
    ///
    /// Loescht ausserdem den Snapshot-Ref (`refs/agentic-explorer/session-<id>`).
    /// Fehlt der Ref bereits, ist das kein Hard-Fail — `delete_session_snapshot`
    /// loggt nur eine Warnung.
    pub fn close_session(&self, id: &str) -> Result<(), ADPError> {
        let mut sessions = self.lock_sessions();
        let mut removed = sessions.remove(id).ok_or_else(|| {
            ADPError::new(
                ADPErrorCode::SessionNotFound,
                format!("Session not found: {id}"),
            )
        })?;
        // Watcher fruehzeitig stoppen, damit er fuer eine tote Session kein
        // session-claude-id-resolved mehr emittiert.
        removed.watcher_cancelled.store(true, Ordering::SeqCst);
        // Child deterministisch killen — Drop des MasterPty allein erreicht auf
        // Windows die Grandchildren (claude.exe + MCP-Server) nicht.
        if let Err(e) = removed.killer.kill() {
            log::warn!("Session {} kill failed: {}", id, e);
        }
        let folder_for_cleanup = removed.info.folder.clone();
        let is_git_repo = removed.info.is_git_repo;
        // removed (inkl. master + writer) wird beim Verlassen des Scopes
        // gedroppt → PTY geschlossen. Lock vor dem Git-Call freigeben.
        drop(removed);
        drop(sessions);

        if is_git_repo {
            let folder_path = std::path::PathBuf::from(folder_for_cleanup);
            if let Err(e) = super::diff::delete_session_snapshot(&folder_path, id) {
                log::warn!("Session {} snapshot cleanup failed: {}", id, e);
            }
        }
        Ok(())
    }

    /// Liefert die Info-Struktur einer Session, falls vorhanden.
    /// Wird vom Diff-Command genutzt, um snapshot_commit + folder
    /// nachzuschlagen, ohne den Mutex an den Caller zu reichen.
    pub fn get_session_info(&self, id: &str) -> Option<SessionInfo> {
        let sessions = self.lock_sessions();
        sessions.get(id).map(|s| s.info.clone())
    }

    /// Gibt alle aktiven Sessions zurueck.
    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        let sessions = self.lock_sessions();
        sessions.values().map(|s| s.info.clone()).collect()
    }

    // --- Private Helpers ---

    /// Einziger Mutex-Zugriffspunkt fuer die Session-Map. Bei vergiftetem
    /// Mutex (Panic in einem anderen Thread waehrend des Locks) wird der
    /// Guard via `into_inner()` recovered und eine Warnung geloggt — eine
    /// einzelne gepanickte Operation soll den Session-Manager nicht dauerhaft
    /// unbrauchbar machen. Vereinheitlicht das frueher inkonsistente
    /// Poison-Handling (teils ADPError, teils Recovery).
    fn lock_sessions(&self) -> MutexGuard<'_, HashMap<String, SessionHandle>> {
        self.sessions.lock().unwrap_or_else(|e| {
            log::warn!("SessionManager mutex was poisoned, recovering via into_inner");
            e.into_inner()
        })
    }

    /// Pollt `~/.claude/projects/<slug>/` bis eine neue Session-UUID auftaucht,
    /// das Timeout erreicht ist ODER `cancel` gesetzt wurde (close_session).
    /// Emittiert `session-claude-id-resolved` nur fuer eine noch lebende
    /// Session.
    fn run_id_watcher(
        app: AppHandle,
        id: String,
        root: std::path::PathBuf,
        folder: String,
        snapshot: std::collections::HashSet<String>,
        cancel: Arc<AtomicBool>,
    ) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        let poll = std::time::Duration::from_millis(150);
        loop {
            if cancel.load(Ordering::SeqCst) {
                log::debug!(
                    "Session {} claude-id watcher cancelled (session closed)",
                    id
                );
                return;
            }
            let current = super::file_reader::snapshot_session_uuids_in(&root, &folder);
            if let Some(uuid) = current.difference(&snapshot).next() {
                log::info!("Session {} resolved claudeSessionId={}", id, uuid);
                if let Err(e) = app.emit(
                    "session-claude-id-resolved",
                    SessionClaudeIdEvent {
                        id: id.clone(),
                        claude_session_id: uuid.clone(),
                    },
                ) {
                    log::debug!(
                        "Session {} failed to emit session-claude-id-resolved: {}",
                        id,
                        e
                    );
                }
                return;
            }
            if std::time::Instant::now() >= deadline {
                log::warn!(
                    "Session {} claude-id discovery timeout (no new jsonl in 15s)",
                    id
                );
                return;
            }
            std::thread::sleep(poll);
        }
    }

    fn shell_executable(shell: &str) -> &'static str {
        match shell {
            "powershell" => "powershell.exe",
            "cmd" => "cmd.exe",
            "gitbash" => "bash.exe",
            _ => "powershell.exe",
        }
    }

    fn shell_args(shell: &str, resume_session_id: Option<&str>) -> Vec<String> {
        // Defense-in-depth: only honour a resume ID with the expected charset.
        // Primary validation happens at the Tauri command boundary (commands.rs);
        // if a malformed ID still reaches here (e.g. a direct/test caller) fall
        // back to a fresh session rather than aborting the process with a panic.
        let valid_resume = resume_session_id.filter(|id| {
            !id.is_empty()
                && id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        });
        if valid_resume.is_none() && resume_session_id.is_some() {
            log::error!(
                "shell_args: ignoring resume_session_id with invalid characters: '{}'",
                resume_session_id.unwrap_or_default()
            );
        }
        let claude_cmd = match valid_resume {
            Some(id) => format!("claude --dangerously-skip-permissions --resume {}", id),
            None => "claude --dangerously-skip-permissions".to_string(),
        };
        match shell {
            "powershell" => vec!["-NoExit".to_string(), "-Command".to_string(), claude_cmd],
            "cmd" => vec!["/K".to_string(), claude_cmd],
            "gitbash" => vec!["-c".to_string(), claude_cmd],
            _ => vec!["-NoExit".to_string(), "-Command".to_string(), claude_cmd],
        }
    }

    /// Strips ANSI escape sequences (CSI sequences like \x1b[...m).
    fn strip_ansi(s: &str) -> String {
        let mut result = String::with_capacity(s.len());
        let mut chars = s.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '\x1b' {
                // Skip ESC[ ... (final byte 0x40-0x7E)
                if chars.peek() == Some(&'[') {
                    chars.next(); // consume '['
                    while let Some(&next) = chars.peek() {
                        chars.next();
                        if next.is_ascii() && (0x40..=0x7E).contains(&(next as u8)) {
                            break;
                        }
                    }
                }
            } else {
                result.push(c);
            }
        }
        result
    }

    /// Heuristik: erkennt ob Claude auf Input wartet.
    ///
    /// Prueft den letzten Output-Snippet auf typische Prompt-Muster:
    /// - Endet mit "> " oder "? " (Claude's interaktive Prompts)
    /// - Endet mit "❯ " (Claude CLI Prompt)
    /// - Endet mit "] " (Bracketed-Choice-Prompts wie "[allow/deny] ")
    /// - Enthaelt "(y/n)", "[Y/n]", "(yes/no)", "[yes/no]" (Ja/Nein-Fragen)
    /// - Enthaelt sowohl "allow" als auch "deny" (Tool-Permission-Prompts)
    ///
    /// Erkennt auch Thinking-Indikatoren (Spinner, "Thinking" Text),
    /// um bei ultrathink/langen Denkpausen nicht faelschlich "waiting" zu melden.
    fn detect_status(snippet: &str) -> String {
        let clean = Self::strip_ansi(snippet);
        // Only trim newlines/CR — keep trailing spaces for prompt detection
        let trimmed = clean.trim_end_matches(['\n', '\r']);

        // Thinking indicators: spinner chars or "Thinking" text mean Claude is
        // actively processing — never treat these as "waiting"
        const SPINNER_CHARS: &[char] = &['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let has_thinking_indicator =
            trimmed.ends_with(SPINNER_CHARS) || trimmed.contains("Thinking");

        if has_thinking_indicator {
            return "running".to_string();
        }

        // Tool-Permission-Prompts: enthaelt sowohl "allow" als auch "deny"
        let lower = trimmed.to_lowercase();
        if lower.contains("allow") && lower.contains("deny") {
            return "waiting".to_string();
        }

        if trimmed.ends_with("> ")
            || trimmed.ends_with("? ")
            || trimmed.ends_with("❯ ")
            || trimmed.ends_with("] ")
            || trimmed.ends_with("(y/n)")
            || trimmed.ends_with("[Y/n]")
            || trimmed.ends_with("[y/N]")
            || trimmed.ends_with("(yes/no)")
            || trimmed.ends_with("[yes/no]")
        {
            "waiting".to_string()
        } else {
            "running".to_string()
        }
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for SessionManager {
    fn drop(&mut self) {
        // Alle Sessions sauber beenden beim App-Close.
        let mut sessions = self.lock_sessions();
        let count = sessions.len();
        if count > 0 {
            log::info!(
                "SessionManager: closing {} active sessions on shutdown",
                count
            );
        }
        // Jede Session explizit killen + Watcher abbrechen, bevor der Handle
        // gedroppt wird — analog zu close_session.
        for (id, handle) in sessions.iter_mut() {
            handle.watcher_cancelled.store(true, Ordering::SeqCst);
            if let Err(e) = handle.killer.kill() {
                log::warn!("Session {} kill failed during shutdown: {}", id, e);
            }
        }
        sessions.clear(); // Drop aller SessionHandles → PTY Master geschlossen.
    }
}

/// Exact line-prefix the LLM prints to request an editor open. Guillemets are
/// rare in normal terminal/code output, lowering accidental-trigger risk.
#[allow(dead_code)]
const OPEN_MARKER_PREFIX: &str = "«SMASHQ:open-md»";

/// Returns the path if `line` is exactly an open-marker line. The trimmed line
/// must START with the marker prefix; mid-prose occurrences do not match. Empty
/// paths return None.
#[allow(dead_code)]
fn parse_open_marker(line: &str) -> Option<&str> {
    let rest = line.trim().strip_prefix(OPEN_MARKER_PREFIX)?;
    let path = rest.trim();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

/// Drains complete (`\n`-terminated) lines from `buf`, returning open-paths found
/// in them. A trailing partial line stays buffered for the next PTY chunk —
/// necessary because PTY output arrives in raw 4 KiB chunks, not whole lines.
/// Caps the buffer at 8 KiB so a newline-less stream cannot grow it unbounded.
#[allow(dead_code)]
fn extract_open_paths(buf: &mut String) -> Vec<String> {
    let mut paths = Vec::new();
    while let Some(nl) = buf.find('\n') {
        let line: String = buf.drain(..=nl).collect();
        if let Some(p) = parse_open_marker(&line) {
            paths.push(p.to_string());
        }
    }
    if buf.len() > 8192 {
        buf.clear();
    }
    paths
}

/// True if `path` was opened as `last` within `window`. Debounces redraw/loop
/// spam (e.g. terminal scroll-back re-emitting the same marker line).
#[allow(dead_code)]
fn is_recent_duplicate(
    last: &Option<(String, std::time::Instant)>,
    path: &str,
    now: std::time::Instant,
    window: std::time::Duration,
) -> bool {
    matches!(last, Some((p, t)) if p == path && now.duration_since(*t) < window)
}

/// Check if an executable exists on PATH (simple cross-platform check).
fn which_executable(name: &str) -> Option<std::path::PathBuf> {
    let cmd_name = if cfg!(windows) { "where" } else { "which" };
    let mut cmd = crate::util::silent_command(cmd_name);
    cmd.arg(name);
    crate::util::timed_output(cmd, std::time::Duration::from_secs(5))
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            String::from_utf8(o.stdout)
                .ok()
                .map(|s| std::path::PathBuf::from(s.lines().next().unwrap_or_default().trim()))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(s: &str) -> String {
        SessionManager::detect_status(s)
    }

    // --- Existing patterns: "waiting" ---

    #[test]
    fn waiting_angle_bracket_prompt() {
        assert_eq!(status("Enter something> "), "waiting");
    }

    #[test]
    fn waiting_question_mark_prompt() {
        assert_eq!(status("Continue? "), "waiting");
    }

    #[test]
    fn waiting_chevron_prompt() {
        assert_eq!(status("❯ "), "waiting");
    }

    #[test]
    fn waiting_yn_paren() {
        assert_eq!(status("Proceed (y/n)"), "waiting");
    }

    #[test]
    fn waiting_yn_bracket_upper() {
        assert_eq!(status("Proceed [Y/n]"), "waiting");
    }

    #[test]
    fn waiting_yn_bracket_lower() {
        assert_eq!(status("Proceed [y/N]"), "waiting");
    }

    // --- New patterns: "waiting" ---

    #[test]
    fn waiting_bracket_space() {
        assert_eq!(status("Choose [allow/deny] "), "waiting");
    }

    #[test]
    fn waiting_yes_no_paren() {
        assert_eq!(status("Continue (yes/no)"), "waiting");
    }

    #[test]
    fn waiting_yes_no_bracket() {
        assert_eq!(status("Continue [yes/no]"), "waiting");
    }

    #[test]
    fn waiting_allow_deny_case_insensitive() {
        assert_eq!(status("Do you Allow or Deny this tool?"), "waiting");
    }

    #[test]
    fn waiting_allow_deny_mixed_case() {
        assert_eq!(status("ALLOW / DENY"), "waiting");
    }

    // --- Thinking indicators: "running" ---

    #[test]
    fn running_spinner_char() {
        assert_eq!(status("Processing ⠋"), "running");
    }

    #[test]
    fn running_thinking_text() {
        assert_eq!(status("Thinking about your question..."), "running");
    }

    #[test]
    fn running_thinking_overrides_prompt() {
        // "Thinking" should take priority even if line ends with "> "
        assert_eq!(status("Thinking> "), "running");
    }

    // --- Normal text: "running" ---

    #[test]
    fn running_normal_output() {
        assert_eq!(status("Generating file: index.ts"), "running");
    }

    #[test]
    fn running_colon_space_not_matched() {
        // ": " must NOT trigger waiting (too broad)
        assert_eq!(status("Generating file: "), "running");
    }

    // --- Edge cases ---

    #[test]
    fn running_empty_string() {
        assert_eq!(status(""), "running");
    }

    #[test]
    fn running_whitespace_only() {
        assert_eq!(status("   "), "running");
    }

    #[test]
    fn waiting_with_trailing_newlines() {
        assert_eq!(status("Continue? \n\r\n"), "waiting");
    }

    // --- Regression guard for b92cc60 (Option A scroll-history fix) ---
    //
    // The fix disables Claude-Code's flicker-free rendering mode by setting
    // CLAUDE_CODE_NO_FLICKER=0 on the CommandBuilder before spawn. Because the
    // env var is applied inside the create_session spawn path (which requires
    // a real AppHandle + PTY and cannot be unit-tested in isolation), we pin
    // the source text itself. A deletion or typo in the env-setting line will
    // turn this test red before the regression lands in a release.

    #[test]
    fn claude_flicker_env_is_set_in_spawn_path() {
        let src = include_str!("manager.rs");
        assert!(
            src.contains("CLAUDE_CODE_NO_FLICKER"),
            "CLAUDE_CODE_NO_FLICKER env var setting removed from manager.rs — \
             this is a scroll-history regression guard, see commit b92cc60"
        );
        assert!(
            src.contains(r#"cmd.env("CLAUDE_CODE_NO_FLICKER", "0")"#),
            "CLAUDE_CODE_NO_FLICKER must be set to \"0\" on the CommandBuilder \
             before spawn (commit b92cc60)"
        );
    }

    // --- detect_status: ANSI-wrapped prompts ---

    #[test]
    fn waiting_prompt_behind_ansi_color_codes() {
        // CSI color codes around the prompt must be stripped before matching.
        assert_eq!(status("\x1b[32mContinue? \x1b[0m"), "waiting");
    }

    #[test]
    fn waiting_chevron_with_leading_ansi() {
        assert_eq!(status("\x1b[1;36m❯ "), "waiting");
    }

    #[test]
    fn running_ansi_only_snippet() {
        // Pure escape sequence with no visible text strips to empty → running.
        assert_eq!(status("\x1b[2J\x1b[H"), "running");
    }

    #[test]
    fn waiting_allow_deny_behind_ansi() {
        assert_eq!(
            status("\x1b[33mallow\x1b[0m / \x1b[31mdeny\x1b[0m"),
            "waiting"
        );
    }

    #[test]
    fn waiting_prompt_with_ansi_then_trailing_newline() {
        assert_eq!(status("\x1b[32mProceed (y/n)\x1b[0m\n"), "waiting");
    }

    // --- detect_status: spinner variants (all 10 chars) ---

    #[test]
    fn running_spinner_braille_variants() {
        for spin in ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] {
            assert_eq!(
                status(&format!("Working {spin}")),
                "running",
                "spinner char {spin} should yield running"
            );
        }
    }

    #[test]
    fn running_spinner_overrides_yn_prompt() {
        // Thinking indicator wins even over a (y/n) pattern.
        assert_eq!(status("(y/n) ⠙"), "running");
    }

    #[test]
    fn running_spinner_only() {
        assert_eq!(status("⠏"), "running");
    }

    #[test]
    fn running_thinking_lowercase_not_matched() {
        // "Thinking" is case-sensitive — lowercase must not trigger the override.
        assert_eq!(status("thinking> "), "waiting");
    }

    #[test]
    fn running_thinking_substring_anywhere() {
        assert_eq!(status("Still Thinking deeply, please wait"), "running");
    }

    // --- detect_status: prompt edge cases ---

    #[test]
    fn running_angle_bracket_without_trailing_space() {
        // "> " requires the trailing space — bare ">" is not a prompt.
        assert_eq!(status("value>"), "running");
    }

    #[test]
    fn running_question_mark_without_space() {
        assert_eq!(status("Really?"), "running");
    }

    #[test]
    fn running_chevron_without_space() {
        assert_eq!(status("❯"), "running");
    }

    #[test]
    fn waiting_bracket_space_generic() {
        // Any "] " ending counts as a bracketed-choice prompt.
        assert_eq!(status("[1] "), "waiting");
    }

    #[test]
    fn running_bracket_without_space() {
        assert_eq!(status("done]"), "running");
    }

    #[test]
    fn waiting_prompt_with_multiple_trailing_newlines_and_cr() {
        assert_eq!(status("❯ \r\n\r\n\n"), "waiting");
    }

    #[test]
    fn running_trailing_space_alone_not_prompt() {
        // A line that is just whitespace must not match "> " etc.
        assert_eq!(status("output \n"), "running");
    }

    #[test]
    fn waiting_only_when_allow_and_deny_both_present() {
        // "allow" alone is not enough.
        assert_eq!(status("This will allow the change"), "running");
    }

    #[test]
    fn running_deny_alone_not_matched() {
        assert_eq!(status("Access deny logged"), "running");
    }

    #[test]
    fn waiting_yn_pattern_mid_line() {
        // (y/n) must be at the end — mid-line occurrence does not match.
        assert_eq!(status("Answer (y/n) then press enter"), "running");
    }

    #[test]
    fn waiting_long_snippet_ending_in_prompt() {
        let long = format!("{}❯ ", "x".repeat(500));
        assert_eq!(status(&long), "waiting");
    }

    // --- strip_ansi ---

    #[test]
    fn strip_ansi_removes_csi_color() {
        assert_eq!(SessionManager::strip_ansi("\x1b[31mred\x1b[0m"), "red");
    }

    #[test]
    fn strip_ansi_keeps_plain_text() {
        assert_eq!(SessionManager::strip_ansi("plain text"), "plain text");
    }

    #[test]
    fn strip_ansi_empty_string() {
        assert_eq!(SessionManager::strip_ansi(""), "");
    }

    #[test]
    fn strip_ansi_handles_unicode() {
        assert_eq!(
            SessionManager::strip_ansi("\x1b[1m❯ Müller\x1b[0m"),
            "❯ Müller"
        );
    }

    #[test]
    fn strip_ansi_multiple_sequences() {
        assert_eq!(
            SessionManager::strip_ansi("\x1b[2J\x1b[H\x1b[32mok\x1b[0m"),
            "ok"
        );
    }

    #[test]
    fn strip_ansi_lone_escape_without_bracket() {
        // Bare ESC not followed by '[' is dropped, rest kept.
        assert_eq!(SessionManager::strip_ansi("a\x1bb"), "ab");
    }

    #[test]
    fn strip_ansi_unterminated_csi() {
        // CSI with no final byte consumes to end of string.
        assert_eq!(SessionManager::strip_ansi("text\x1b[999"), "text");
    }

    // --- shell_executable ---

    #[test]
    fn shell_executable_powershell() {
        assert_eq!(
            SessionManager::shell_executable("powershell"),
            "powershell.exe"
        );
    }

    #[test]
    fn shell_executable_cmd() {
        assert_eq!(SessionManager::shell_executable("cmd"), "cmd.exe");
    }

    #[test]
    fn shell_executable_gitbash() {
        assert_eq!(SessionManager::shell_executable("gitbash"), "bash.exe");
    }

    #[test]
    fn shell_executable_unknown_falls_back_to_powershell() {
        assert_eq!(SessionManager::shell_executable("zsh"), "powershell.exe");
        assert_eq!(SessionManager::shell_executable(""), "powershell.exe");
    }

    // --- shell_args ---

    #[test]
    fn shell_args_powershell_no_resume() {
        let args = SessionManager::shell_args("powershell", None);
        assert_eq!(
            args,
            vec![
                "-NoExit".to_string(),
                "-Command".to_string(),
                "claude --dangerously-skip-permissions".to_string(),
            ]
        );
    }

    #[test]
    fn shell_args_cmd_no_resume() {
        let args = SessionManager::shell_args("cmd", None);
        assert_eq!(
            args,
            vec![
                "/K".to_string(),
                "claude --dangerously-skip-permissions".to_string(),
            ]
        );
    }

    #[test]
    fn shell_args_gitbash_no_resume() {
        let args = SessionManager::shell_args("gitbash", None);
        assert_eq!(
            args,
            vec![
                "-c".to_string(),
                "claude --dangerously-skip-permissions".to_string(),
            ]
        );
    }

    #[test]
    fn shell_args_unknown_shell_falls_back_to_powershell_form() {
        let args = SessionManager::shell_args("fish", None);
        assert_eq!(args[0], "-NoExit");
        assert_eq!(args[1], "-Command");
    }

    #[test]
    fn shell_args_valid_resume_id_appended() {
        let args = SessionManager::shell_args("powershell", Some("abc-123_XY"));
        assert_eq!(
            args[2],
            "claude --dangerously-skip-permissions --resume abc-123_XY"
        );
    }

    #[test]
    fn shell_args_empty_resume_id_ignored() {
        let args = SessionManager::shell_args("powershell", Some(""));
        assert_eq!(args[2], "claude --dangerously-skip-permissions");
    }

    #[test]
    fn shell_args_invalid_resume_id_with_space_ignored() {
        let args = SessionManager::shell_args("cmd", Some("bad id"));
        assert_eq!(args[1], "claude --dangerously-skip-permissions");
    }

    #[test]
    fn shell_args_invalid_resume_id_with_shell_metachar_ignored() {
        // Semicolon would be a command-injection vector — must be rejected.
        let args = SessionManager::shell_args("gitbash", Some("id;rm -rf"));
        assert_eq!(args[1], "claude --dangerously-skip-permissions");
    }

    #[test]
    fn shell_args_resume_id_with_dot_rejected() {
        // '.' is not in the allowed charset (alphanumeric, '-', '_').
        let args = SessionManager::shell_args("powershell", Some("a.b"));
        assert_eq!(args[2], "claude --dangerously-skip-permissions");
    }

    #[test]
    fn shell_args_uuid_style_resume_id_accepted() {
        let uuid = "550e8400-e29b-41d4-a716-446655440000";
        let args = SessionManager::shell_args("powershell", Some(uuid));
        assert_eq!(
            args[2],
            format!("claude --dangerously-skip-permissions --resume {uuid}")
        );
    }

    // --- SessionManager / struct construction ---

    #[test]
    fn new_manager_has_no_sessions() {
        let mgr = SessionManager::new();
        assert!(mgr.list_sessions().is_empty());
    }

    #[test]
    fn default_manager_equivalent_to_new() {
        let mgr = SessionManager::default();
        assert!(mgr.list_sessions().is_empty());
    }

    #[test]
    fn get_session_info_missing_returns_none() {
        let mgr = SessionManager::new();
        assert!(mgr.get_session_info("nonexistent").is_none());
    }

    #[test]
    fn write_to_missing_session_errors() {
        let mgr = SessionManager::new();
        let err = mgr.write_to_session("nope", "data").unwrap_err();
        assert_eq!(err.code, ADPErrorCode::SessionNotFound);
    }

    #[test]
    fn resize_missing_session_errors() {
        let mgr = SessionManager::new();
        let err = mgr.resize_session("nope", 80, 24).unwrap_err();
        assert_eq!(err.code, ADPErrorCode::SessionNotFound);
    }

    #[test]
    fn close_missing_session_errors() {
        let mgr = SessionManager::new();
        let err = mgr.close_session("nope").unwrap_err();
        assert_eq!(err.code, ADPErrorCode::SessionNotFound);
    }

    // --- Finding 1: close_session kill path (regression guard) ---
    //
    // The real kill happens inside close_session via the stored ChildKiller,
    // which requires a real spawned PTY child and cannot be unit-tested in
    // isolation. We pin the source text so a deletion of the explicit kill
    // call turns this test red before the regression ships: a per-session
    // close that relies only on master-drop leaks the shell + MCP grandchildren
    // on Windows.
    #[test]
    fn close_session_invokes_killer() {
        let src = include_str!("manager.rs");
        assert!(
            src.contains("removed.killer.kill()"),
            "close_session must explicitly kill the child via the stored killer \
             — dropping the master alone does not terminate grandchildren"
        );
        assert!(
            src.contains("let killer = child.clone_killer();"),
            "a killer handle must be cloned from the child at spawn time so \
             close_session can terminate the shell deterministically"
        );
    }

    // --- Finding 2: watcher cancellation flag ---
    #[test]
    fn close_session_cancels_watcher() {
        let src = include_str!("manager.rs");
        assert!(
            src.contains("removed.watcher_cancelled.store(true, Ordering::SeqCst)"),
            "close_session must set the watcher cancel flag so the claude-id \
             watcher exits early instead of emitting for a dead session"
        );
        assert!(
            src.contains("if cancel.load(Ordering::SeqCst)"),
            "run_id_watcher must poll the cancel flag each iteration"
        );
    }

    // --- Finding 3: single mutex-poison helper ---
    #[test]
    fn all_session_access_routes_through_lock_helper() {
        let src = include_str!("manager.rs");
        // Only the helper itself may call .sessions.lock(); every other accessor
        // must go through lock_sessions(). Examine only the production portion —
        // this test module itself mentions the literal in comments/asserts.
        let prod = src.split("#[cfg(test)]").next().unwrap_or(src);
        let direct_locks = prod.matches(".sessions.lock()").count();
        assert_eq!(
            direct_locks, 1,
            "exactly one .sessions.lock() call must remain (inside \
             lock_sessions); found {direct_locks}"
        );
    }

    #[test]
    fn session_info_serializes_renamed_git_field() {
        let info = SessionInfo {
            id: "s1".to_string(),
            title: "Test".to_string(),
            folder: "/tmp".to_string(),
            shell: "powershell".to_string(),
            status: "running".to_string(),
            exit_code: None,
            is_git_repo: true,
            snapshot_commit: None,
            snapshot_at: None,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"isGitRepo\":true"));
        // None snapshot fields are skipped.
        assert!(!json.contains("snapshotCommit"));
        assert!(!json.contains("snapshotAt"));
    }

    #[test]
    fn session_info_serializes_snapshot_commit_when_present() {
        let info = SessionInfo {
            id: "s2".to_string(),
            title: "T".to_string(),
            folder: "/tmp".to_string(),
            shell: "cmd".to_string(),
            status: "running".to_string(),
            exit_code: Some(0),
            is_git_repo: false,
            snapshot_commit: Some("deadbeef".to_string()),
            snapshot_at: None,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"snapshotCommit\":\"deadbeef\""));
        assert!(json.contains("\"isGitRepo\":false"));
    }

    #[test]
    fn session_output_event_serializes_fields() {
        let ev = SessionOutputEvent {
            id: "s3".to_string(),
            data: "hello".to_string(),
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains("\"id\":\"s3\""));
        assert!(json.contains("\"data\":\"hello\""));
    }

    #[test]
    fn session_exit_event_serializes_exit_code() {
        let ev = SessionExitEvent {
            id: "s4".to_string(),
            exit_code: 1,
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains("\"exit_code\":1"));
    }

    #[test]
    fn session_status_event_serializes_snippet() {
        let ev = SessionStatusEvent {
            id: "s5".to_string(),
            status: "waiting".to_string(),
            snippet: "❯ ".to_string(),
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains("\"status\":\"waiting\""));
        assert!(json.contains("\"snippet\""));
    }

    #[test]
    fn session_claude_id_event_serializes_renamed_field() {
        let ev = SessionClaudeIdEvent {
            id: "s6".to_string(),
            claude_session_id: "uuid-123".to_string(),
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains("\"claudeSessionId\":\"uuid-123\""));
    }

    // --- Sentinel marker parsing (open-md) ---

    #[test]
    fn parse_marker_happy_relative() {
        assert_eq!(
            parse_open_marker("«SMASHQ:open-md» ./tasks/todo.md"),
            Some("./tasks/todo.md")
        );
    }

    #[test]
    fn parse_marker_trims_surrounding_whitespace_and_cr() {
        assert_eq!(
            parse_open_marker("  «SMASHQ:open-md»   C:/x/y.md  \r"),
            Some("C:/x/y.md")
        );
    }

    #[test]
    fn parse_marker_rejects_midline_occurrence() {
        assert_eq!(parse_open_marker("echo «SMASHQ:open-md» x.md"), None);
    }

    #[test]
    fn parse_marker_rejects_empty_path() {
        assert_eq!(parse_open_marker("«SMASHQ:open-md»   "), None);
    }

    #[test]
    fn parse_marker_rejects_plain_text() {
        assert_eq!(parse_open_marker("just some output"), None);
    }

    #[test]
    fn extract_paths_handles_marker_split_across_chunks() {
        // The critical PTY case: marker line arrives in two reads.
        let mut b = String::new();
        b.push_str("noise\n«SMASHQ:open-md» ./a.m");
        let r1 = extract_open_paths(&mut b);
        assert!(r1.is_empty(), "partial marker line must not match yet");
        b.push_str("d\n");
        let r2 = extract_open_paths(&mut b);
        assert_eq!(r2, vec!["./a.md".to_string()]);
        assert!(b.is_empty(), "completed line drained from buffer");
    }

    #[test]
    fn extract_paths_keeps_partial_trailing_line() {
        let mut b = String::new();
        b.push_str("«SMASHQ:open-md» ./done.md\npartial without newline");
        let r = extract_open_paths(&mut b);
        assert_eq!(r, vec!["./done.md".to_string()]);
        assert_eq!(b, "partial without newline");
    }

    #[test]
    fn extract_paths_caps_runaway_buffer() {
        let mut b = "x".repeat(9000); // no newline → exceeds 8 KiB cap
        let r = extract_open_paths(&mut b);
        assert!(r.is_empty());
        assert!(b.is_empty(), "oversized partial buffer is cleared");
    }

    #[test]
    fn dedupe_same_path_within_window_is_duplicate() {
        let base = std::time::Instant::now();
        let last = Some(("/p/a.md".to_string(), base));
        let now = base + std::time::Duration::from_millis(1000);
        assert!(is_recent_duplicate(
            &last,
            "/p/a.md",
            now,
            std::time::Duration::from_millis(1500)
        ));
    }

    #[test]
    fn dedupe_same_path_after_window_is_not_duplicate() {
        let base = std::time::Instant::now();
        let last = Some(("/p/a.md".to_string(), base));
        let now = base + std::time::Duration::from_millis(2000);
        assert!(!is_recent_duplicate(
            &last,
            "/p/a.md",
            now,
            std::time::Duration::from_millis(1500)
        ));
    }

    #[test]
    fn dedupe_different_path_is_not_duplicate() {
        let base = std::time::Instant::now();
        let last = Some(("/p/a.md".to_string(), base));
        assert!(!is_recent_duplicate(
            &last,
            "/p/b.md",
            base,
            std::time::Duration::from_millis(1500)
        ));
    }
}
