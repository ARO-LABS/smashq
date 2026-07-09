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

/// Outcome of one claude-id watcher poll (see `SessionManager::diff_new_uuid`).
#[derive(Debug, PartialEq)]
enum UuidDiff {
    /// No new session file yet — keep polling.
    None,
    /// Exactly one new file: unambiguously this session's UUID.
    One(String),
    /// Two or more new files in one poll window (parallel fresh spawns in the
    /// same folder) — guessing would corrupt the persisted mapping.
    Ambiguous(usize),
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
    /// `shell` ist eine Preference ("auto" | "powershell" | "cmd" | "gitbash" |
    /// "bash" | "zsh") und wird via [`resolve_shell_pref`] plattformbewusst auf
    /// eine konkrete Shell aufgeloest — Windows: `powershell.exe -NoExit
    /// -Command claude …`, macOS/Linux: Login-Shell wie `zsh -l -c "claude …"`.
    /// Die aufgeloeste Shell (nie "auto") landet in `SessionInfo.shell`.
    #[allow(clippy::too_many_arguments)]
    pub fn create_session(
        &self,
        app: AppHandle,
        id: String,
        title: String,
        folder: String,
        shell: String,
        permission_mode: String,
        resume_session_id: Option<String>,
        initial_cols: Option<u16>,
        initial_rows: Option<u16>,
    ) -> Result<SessionInfo, ADPError> {
        // Default to 120x40 instead of 80x24 so TUI apps (e.g. Claude CLI)
        // don't render a cramped initial UI before the frontend resize_session
        // call catches up. Frontend can pass exact dimensions for a perfect fit.
        let cols = initial_cols.filter(|c| *c > 0).unwrap_or(120);
        let rows = initial_rows.filter(|r| *r > 0).unwrap_or(40);

        // Roh-String von der Grenze sofort ins geschlossene Enum — ab hier
        // existiert nur noch der validierte Wert.
        let permission_mode = PermissionMode::from_pref(&permission_mode);

        // Resolve the user preference ("auto", legacy values, platform-foreign
        // shells) into a concrete shell for THIS platform before anything else
        // — every downstream consumer (exe lookup, args, SessionInfo) sees
        // only concrete values.
        let platform = ShellPlatform::current();
        // Resolve the preference to a shell whose executable is actually on
        // PATH, degrading to the platform default when the preferred one is
        // missing — this is what keeps a legacy Windows "powershell" favorite
        // (which maps to the usually-absent `pwsh` on macOS) from silently
        // killing the session start. Only errors when nothing usable exists.
        let (shell, shell_exe) = match resolve_available_shell(&shell, platform, |exe| {
            which_executable(exe).is_some()
        }) {
            Some((resolved, exe)) => (resolved.to_string(), exe),
            None => {
                let msg = format!(
                        "Failed to create session {}: no usable shell found on PATH for preference '{}' (platform {:?})",
                        id, shell, platform
                    );
                log::error!("{}", msg);
                return Err(ADPError::new(ADPErrorCode::TerminalSpawnFailed, msg));
            }
        };

        // Every session launches `claude` (see shell_args) — guard its presence
        // before opening a PTY, so a missing binary yields an actionable,
        // classifiable error instead of a dead "command not found" terminal.
        ensure_claude_available(|exe| which_executable(exe).is_some())?;

        log::info!(
            "Creating session id={}, shell={}, folder={}, size={}x{}",
            id,
            shell,
            folder,
            cols,
            rows
        );

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
        for arg in shell_args(
            &shell,
            platform,
            resume_session_id.as_deref(),
            permission_mode,
        ) {
            cmd.arg(arg);
        }
        cmd.cwd(&folder);

        // Disable Claude-Code's flicker-free rendering mode (v2.1.89+).
        // In embedded xterm.js/Tauri terminals, the virtualized scrollback of that
        // mode destroys the user-visible history. Falls back to v2.1.87 behaviour
        // (linear LF-based output), which xterm.js handles correctly.
        // Reference: https://github.com/anthropics/claude-code/issues/41965
        cmd.env("CLAUDE_CODE_NO_FLICKER", "0");

        // Advertise a color-capable terminal to the PTY children. A macOS
        // Finder/Dock (launchd) launch inherits no TERM, so claude & co. treat
        // stdout as a dumb terminal and disable ANSI colors — the "keine Farben"
        // half of issue #8. xterm.js emulates a truecolor xterm; say so.
        for &(key, val) in terminal_env(platform) {
            cmd.env(key, val);
        }

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
            // Holds an incomplete trailing UTF-8 sequence that a read split at the
            // 4096-byte boundary, so the next read can complete it (issue #8).
            // Bounded to <4 bytes by valid_utf8_prefix_len.
            let mut carry: Vec<u8> = Vec::new();
            // Track last emitted status to deduplicate — only emit on transitions.
            // Empty string forces the first detected status to always emit.
            let mut last_emitted_status = String::new();
            // Emit one session-output event; a dead window is logged, not fatal.
            let emit_output = |data: &str| {
                if let Err(e) = read_app.emit(
                    "session-output",
                    SessionOutputEvent {
                        id: read_id.clone(),
                        data: data.to_string(),
                    },
                ) {
                    log::debug!("Session {} failed to emit session-output: {}", read_id, e);
                }
            };
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // Flush a char truncated by EOF instead of dropping it.
                        if let Some(data) = flush_pty_carry(&mut carry) {
                            emit_output(&data);
                        }
                        log::info!("Session {} reader: EOF reached", read_id);
                        break;
                    }
                    Ok(n) => {
                        // Reassemble a multibyte char split across the 4096-byte
                        // read boundary (issue #8). None = the whole read was an
                        // incomplete continuation → wait for the rest.
                        let data = match decode_pty_chunk(&mut carry, &buf[..n]) {
                            Some(data) => data,
                            None => continue,
                        };

                        emit_output(&data);

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
                        // Flush held-back bytes before teardown, mirroring EOF.
                        if let Some(data) = flush_pty_carry(&mut carry) {
                            emit_output(&data);
                        }
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
    /// Diff the current session-uuid snapshot against the pre-spawn one.
    ///
    /// `HashSet::difference().next()` is NON-deterministic when two fresh
    /// spawns in the same folder land inside one poll window — two watchers
    /// could emit swapped (or the same) UUIDs, and the corrupted mapping
    /// would be persisted and deterministically resumed wrong on every
    /// restart. Emit only on an unambiguous single new file; with 2+ the
    /// frontend's time-anchored scan fallback decides instead.
    fn diff_new_uuid(
        current: &std::collections::HashSet<String>,
        snapshot: &std::collections::HashSet<String>,
    ) -> UuidDiff {
        let mut fresh = current.difference(snapshot);
        match (fresh.next(), fresh.next()) {
            (None, _) => UuidDiff::None,
            (Some(one), None) => UuidDiff::One(one.clone()),
            (Some(_), Some(_)) => UuidDiff::Ambiguous(current.difference(snapshot).count()),
        }
    }

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
            match Self::diff_new_uuid(&current, &snapshot) {
                UuidDiff::None => {}
                UuidDiff::One(uuid) => {
                    log::info!("Session {} resolved claudeSessionId={}", id, uuid);
                    if let Err(e) = app.emit(
                        "session-claude-id-resolved",
                        SessionClaudeIdEvent {
                            id: id.clone(),
                            claude_session_id: uuid,
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
                UuidDiff::Ambiguous(n) => {
                    log::warn!(
                        "Session {} claude-id ambiguous: {} new session files in one poll window — skipping deterministic resolve, frontend scan fallback decides",
                        id,
                        n
                    );
                    return;
                }
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

/// Zielplattform fuer die Shell-Aufloesung. Als Parameter modelliert (statt
/// `cfg!` in den Funktionen), damit macOS/Linux-Verhalten auf jeder
/// CI-Plattform unit-testbar bleibt.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ShellPlatform {
    Windows,
    MacOs,
    Linux,
}

impl ShellPlatform {
    pub fn current() -> Self {
        if cfg!(windows) {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::MacOs
        } else {
            Self::Linux
        }
    }

    /// Plattform-Default, auf den "auto" und plattformfremde Werte aufloesen.
    fn default_shell(self) -> &'static str {
        match self {
            Self::Windows => "powershell",
            Self::MacOs => "zsh",
            Self::Linux => "bash",
        }
    }
}

/// Loest eine Shell-Preference ("auto", Settings-Wert, Legacy-Favorit) auf
/// eine konkrete, auf dieser Plattform sinnvolle Shell auf. Gibt nie "auto"
/// zurueck; plattformfremde Werte (z.B. "cmd" auf macOS) fallen auf den
/// Plattform-Default zurueck statt den Spawn scheitern zu lassen.
fn resolve_shell_pref(pref: &str, platform: ShellPlatform) -> &'static str {
    match (pref, platform) {
        ("powershell", _) => "powershell",
        ("cmd", ShellPlatform::Windows) => "cmd",
        ("gitbash", ShellPlatform::Windows) => "gitbash",
        // Auf Unix ist Git Bash schlicht bash — Legacy-Favoriten aus einer
        // Windows-Installation bleiben damit nutzbar.
        ("gitbash", _) => "bash",
        ("bash", _) => "bash",
        ("zsh", _) => "zsh",
        _ => platform.default_shell(), // "auto", unbekannt, plattformfremd
    }
}

/// Executable-Name fuer eine bereits aufgeloeste Shell. Windows behaelt die
/// expliziten `.exe`-Namen (bash.exe = Git Bash); Unix nutzt PATH-Namen,
/// PowerShell heisst dort `pwsh`.
fn shell_executable(shell: &str, platform: ShellPlatform) -> &'static str {
    match platform {
        ShellPlatform::Windows => match shell {
            "powershell" => "powershell.exe",
            "cmd" => "cmd.exe",
            "gitbash" | "bash" => "bash.exe",
            "zsh" => "zsh.exe",
            _ => "powershell.exe",
        },
        _ => match shell {
            "powershell" => "pwsh",
            "zsh" => "zsh",
            _ => "bash",
        },
    }
}

/// Resolve a shell preference to a concrete `(shell, executable)` pair whose
/// executable is actually present on PATH, degrading to the platform default
/// shell when the preferred one is missing.
///
/// This is the PATH-aware guard that keeps a session start from dying on a
/// platform-foreign preference. The canonical trigger: favorites hardcode
/// shell `"powershell"` (see `settingsStore.ts` `addFavorite`), which
/// [`shell_executable`] maps to `pwsh` on Unix. On a Mac without PowerShell
/// installed the old code hard-failed with "shell executable 'pwsh' not found"
/// and the frontend swallowed the error — the user clicked a favorite and
/// nothing happened. We now fall back to zsh/bash instead. A Mac user who DID
/// install pwsh still gets it (the fallback only fires when the preferred shell
/// is genuinely absent).
///
/// `is_installed` probes PATH; production passes
/// `|exe| which_executable(exe).is_some()`, tests inject a stub. Returns `None`
/// only when neither the preferred shell nor the platform default is available,
/// so `create_session` can surface a precise error.
fn resolve_available_shell(
    pref: &str,
    platform: ShellPlatform,
    is_installed: impl Fn(&str) -> bool,
) -> Option<(&'static str, &'static str)> {
    let shell = resolve_shell_pref(pref, platform);
    let exe = shell_executable(shell, platform);
    if is_installed(exe) {
        return Some((shell, exe));
    }

    let default = platform.default_shell();
    let default_exe = shell_executable(default, platform);
    if is_installed(default_exe) {
        log::warn!(
            "Shell '{}' (exe '{}') not found on PATH; falling back to platform default '{}' (exe '{}')",
            shell,
            exe,
            default,
            default_exe
        );
        return Some((default, default_exe));
    }

    None
}

/// Guard: `claude` must be resolvable on PATH before a session spawns. Without
/// it the PTY launches a shell that instantly prints "command not found" and
/// exits — the user is left staring at a dead terminal with no actionable hint.
/// Fail early instead, with a structured error the frontend classifies via the
/// `claude_missing` details string (same pattern as `gh_missing` — NO new
/// `ADPErrorCode` variant). `TerminalSpawnFailed` matches every sibling error
/// in `create_session`; the details string is the real discriminator.
///
/// Pure + injected `is_installed` probe so it is unit-testable; `create_session`
/// passes the real `|exe| which_executable(exe).is_some()`.
fn ensure_claude_available(is_installed: impl Fn(&str) -> bool) -> Result<(), ADPError> {
    if is_installed("claude") {
        Ok(())
    } else {
        Err(ADPError::new(
            ADPErrorCode::TerminalSpawnFailed,
            "Claude CLI wurde nicht auf dem PATH gefunden. Installieren mit: \
             npm install -g @anthropic-ai/claude-code",
        )
        .with_details("claude_missing"))
    }
}

/// Permission-Modus, mit dem eine neue Claude-Session startet. Geschlossenes
/// Enum — der einzige Weg, wie ein User-String die claude-Kommandozeile
/// beeinflusst, ist `from_pref` (mappt Unbekanntes auf den sichersten Modus).
/// So kann selbst ein manipulierter String nur einen der vier festen Flags
/// (oder keinen) erzeugen; Shell-Injection ist strukturell ausgeschlossen —
/// dieselbe Defense-in-depth wie der `--resume`-Charset-Guard unten.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionMode {
    Default,
    Auto,
    Plan,
    Bypass,
}

impl PermissionMode {
    /// Roh-String von der IPC-Grenze → geschlossenes Enum. Fail-safe: alles
    /// Unbekannte (inkl. "default") wird `Default`, NIE `Bypass`.
    pub fn from_pref(s: &str) -> Self {
        match s {
            "auto" => Self::Auto,
            "plan" => Self::Plan,
            "bypass" => Self::Bypass,
            _ => Self::Default,
        }
    }

    /// Nur &'static-str-Literale — kein User-Text erreicht je die Shell.
    /// Fuehrendes Leerzeichen, damit `format!("claude{}", flag)` sauber joint.
    fn claude_flag(self) -> &'static str {
        match self {
            Self::Default => "",
            Self::Auto => " --permission-mode auto",
            Self::Plan => " --permission-mode plan",
            Self::Bypass => " --dangerously-skip-permissions",
        }
    }
}

fn shell_args(
    shell: &str,
    platform: ShellPlatform,
    resume_session_id: Option<&str>,
    mode: PermissionMode,
) -> Vec<String> {
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
    let mode_flag = mode.claude_flag();
    let claude_cmd = match valid_resume {
        Some(id) => format!("claude{} --resume {}", mode_flag, id),
        None => format!("claude{}", mode_flag),
    };
    match (shell, platform) {
        ("cmd", _) => vec!["/K".to_string(), claude_cmd],
        // Git Bash auf Windows: non-login wie bisher (Profil-Sourcing dort
        // langsam und fuer PATH unnoetig).
        ("gitbash" | "bash" | "zsh", ShellPlatform::Windows) => {
            vec!["-c".to_string(), claude_cmd]
        }
        // Unix: Login-Shell (-l) ist Pflicht — GUI-Apps erben auf macOS nicht
        // den User-PATH, erst .zprofile/.bash_profile bringen homebrew- und
        // npm-global-Pfade rein, ohne die `claude` nicht gefunden wird.
        ("gitbash" | "bash" | "zsh", _) => {
            vec!["-l".to_string(), "-c".to_string(), claude_cmd]
        }
        // "powershell" und alles Unbekannte: PowerShell-Form (pwsh nutzt
        // dieselben Flags).
        _ => vec!["-NoExit".to_string(), "-Command".to_string(), claude_cmd],
    }
}

/// Terminal-Environment fuer die PTY-Children. xterm.js emuliert ein
/// truecolor-faehiges xterm — das muss den Programmen im PTY aber aktiv
/// mitgeteilt werden. Kritisch auf macOS/Linux: wird die App aus Finder/Dock
/// bzw. via `.desktop` (launchd) gestartet, erbt sie KEIN `TERM` (anders als
/// eine Shell aus Terminal.app). Ohne `TERM` faellt `supports-color` (chalk,
/// und damit Claude Code) auf Level 0 zurueck → gar keine ANSI-Farben. Das ist
/// dieselbe "GUI-Launch strippt die Environment"-Klasse wie beim Login-Shell-
/// PATH-Fix in [`shell_args`]: die Login-Shell holt den PATH zurueck, aber
/// `TERM` zu setzen ist Aufgabe des Terminal-Emulators (= wir). Siehe Issue #8.
///
/// Windows bleibt bewusst leer: unter ConPTY nutzt `supports-color` den
/// OS-Version-Zweig und ignoriert `TERM`; PowerShell/cmd ebenso. Ein gesetztes
/// `TERM` waere dort bestenfalls ein No-op — wir fassen die heute
/// funktionierende Windows-Farbausgabe nicht an.
fn terminal_env(platform: ShellPlatform) -> &'static [(&'static str, &'static str)] {
    match platform {
        ShellPlatform::Windows => &[],
        ShellPlatform::MacOs | ShellPlatform::Linux => {
            &[("TERM", "xterm-256color"), ("COLORTERM", "truecolor")]
        }
    }
}

/// Byte length of the leading run of `bytes` that is COMPLETE, valid UTF-8.
/// Only an INCOMPLETE trailing multibyte sequence is held back (excluded from
/// the returned length) so the next PTY read can complete it; a genuinely
/// invalid byte is NOT held back (it is included so the caller's lossy decode
/// replaces it immediately), which keeps the reader's carry buffer bounded to
/// <4 bytes.
///
/// Fixes issue #8: a PTY read fills a fixed 4096-byte buffer and can split a
/// multibyte char (e.g. box-drawing `─`, 3 bytes) across the boundary; decoding
/// each chunk independently with `from_utf8_lossy` would turn the split bytes
/// into U+FFFD and change the column count, desyncing Claude Code's TUI.
fn valid_utf8_prefix_len(bytes: &[u8]) -> usize {
    match std::str::from_utf8(bytes) {
        Ok(_) => bytes.len(),
        Err(e) => match e.error_len() {
            // Valid up to here, then an INCOMPLETE trailing sequence → hold it back.
            None => e.valid_up_to(),
            // A genuine invalid byte → do NOT hold back (would carry forever);
            // include everything so the lossy decode replaces it now.
            Some(_) => bytes.len(),
        },
    }
}

/// Stateful UTF-8 decode step for the PTY reader thread. Prepends bytes held
/// back from the previous read (a multibyte char the 4096-byte boundary split),
/// returns the COMPLETE-UTF-8 prefix to emit, and leaves any new incomplete tail
/// in `carry` for the next read. Returns `None` when there is no complete char
/// yet (the whole read was a partial continuation) — the caller reads more.
/// See issue #8: decoding each raw chunk independently with `from_utf8_lossy`
/// would corrupt a split char into U+FFFD and shift the column count.
fn decode_pty_chunk(carry: &mut Vec<u8>, chunk: &[u8]) -> Option<String> {
    let mut bytes = std::mem::take(carry);
    bytes.extend_from_slice(chunk);
    let split = valid_utf8_prefix_len(&bytes);
    *carry = bytes.split_off(split);
    if bytes.is_empty() {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).to_string())
}

/// Drain any bytes still held in `carry` (a char truncated by EOF or a read
/// error) as a best-effort lossy decode so nothing is silently dropped. Returns
/// `None` when the carry is empty.
fn flush_pty_carry(carry: &mut Vec<u8>) -> Option<String> {
    if carry.is_empty() {
        return None;
    }
    let bytes = std::mem::take(carry);
    Some(String::from_utf8_lossy(&bytes).to_string())
}

/// Eintrag fuer die Shell-Auswahl in den Settings — nur real installierte
/// Shells (PATH-Probe) landen hier; "auto" ergaenzt das Frontend selbst.
#[derive(Clone, serde::Serialize)]
pub struct ShellOption {
    pub id: String,
    pub label: String,
}

/// Probt, welche der plattformueblichen Shells tatsaechlich installiert sind.
pub fn detect_available_shells() -> Vec<ShellOption> {
    let platform = ShellPlatform::current();
    let candidates: &[(&str, &str)] = match platform {
        ShellPlatform::Windows => &[
            ("powershell", "PowerShell"),
            ("cmd", "CMD"),
            ("bash", "Git Bash"),
            ("zsh", "Zsh"),
        ],
        ShellPlatform::MacOs => &[
            ("zsh", "Zsh"),
            ("bash", "Bash"),
            ("powershell", "PowerShell (pwsh)"),
        ],
        ShellPlatform::Linux => &[
            ("bash", "Bash"),
            ("zsh", "Zsh"),
            ("powershell", "PowerShell (pwsh)"),
        ],
    };
    candidates
        .iter()
        .filter(|(id, _)| which_executable(shell_executable(id, platform)).is_some())
        .map(|(id, label)| ShellOption {
            id: (*id).to_string(),
            label: (*label).to_string(),
        })
        .collect()
}

/// Resolve the platform's default shell to its `(name, executable)` pair for
/// the prerequisite check, reusing the exact `default_shell` + `shell_executable`
/// mapping `create_session` applies to an "auto" preference — so the reported
/// shell matches what a new session would actually launch.
pub fn default_shell_probe() -> (&'static str, &'static str) {
    let platform = ShellPlatform::current();
    let shell = platform.default_shell();
    (shell, shell_executable(shell, platform))
}

/// Check if an executable exists on PATH (simple cross-platform check).
/// `pub(crate)` so `prerequisites.rs` reuses the same probe session spawning
/// uses — one PATH lookup yields both presence and the resolved path.
pub(crate) fn which_executable(name: &str) -> Option<std::path::PathBuf> {
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

    // --- diff_new_uuid: deterministic claude-id watcher resolve ---

    fn uuid_set(ids: &[&str]) -> std::collections::HashSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn diff_new_uuid_resolves_single_new_file() {
        let snapshot = uuid_set(&["old-1", "old-2"]);
        let current = uuid_set(&["old-1", "old-2", "fresh"]);
        assert_eq!(
            SessionManager::diff_new_uuid(&current, &snapshot),
            UuidDiff::One("fresh".to_string())
        );
    }

    #[test]
    fn diff_new_uuid_reports_no_change_while_polling() {
        let snapshot = uuid_set(&["old-1"]);
        let current = uuid_set(&["old-1"]);
        assert_eq!(
            SessionManager::diff_new_uuid(&current, &snapshot),
            UuidDiff::None
        );
    }

    #[test]
    fn diff_new_uuid_refuses_to_guess_on_two_new_files() {
        // Two parallel fresh spawns in the same folder within one poll window:
        // any pick here could swap the mapping — must report Ambiguous.
        let snapshot = uuid_set(&["old-1"]);
        let current = uuid_set(&["old-1", "fresh-a", "fresh-b"]);
        assert_eq!(
            SessionManager::diff_new_uuid(&current, &snapshot),
            UuidDiff::Ambiguous(2)
        );
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

    // --- terminal_env: color-capable terminal for the PTY children (issue #8) ---

    #[test]
    fn terminal_env_unix_advertises_truecolor_xterm() {
        // macOS/Linux GUI launch (launchd/.desktop) inherits no TERM, so the
        // shell and claude disable ANSI color. xterm.js emulates a truecolor
        // xterm — advertise exactly that to the PTY children.
        for platform in [ShellPlatform::MacOs, ShellPlatform::Linux] {
            let env = terminal_env(platform);
            assert!(
                env.contains(&("TERM", "xterm-256color")),
                "TERM must advertise xterm-256color on {:?} (issue #8: no colors on macOS)",
                platform
            );
            assert!(
                env.contains(&("COLORTERM", "truecolor")),
                "COLORTERM must advertise truecolor on {:?}",
                platform
            );
        }
    }

    #[test]
    fn terminal_env_windows_is_left_untouched() {
        // ConPTY + supports-color's Windows (OS-version) branch don't consult
        // TERM; keep the already-working Windows color behaviour untouched.
        assert!(
            terminal_env(ShellPlatform::Windows).is_empty(),
            "Windows terminal env must stay empty — TERM is a no-op under ConPTY"
        );
    }

    #[test]
    fn terminal_env_is_applied_in_spawn_path() {
        // Like the CLAUDE_CODE_NO_FLICKER guard above: the env pairs are set
        // inside the create_session spawn path (real AppHandle + PTY, not
        // unit-testable in isolation), so we pin the source text. Removing the
        // loop that applies terminal_env would silently bring back issue #8.
        let src = include_str!("manager.rs");
        assert!(
            src.contains("terminal_env(platform)"),
            "terminal_env(platform) must be applied to the CommandBuilder before \
             spawn — without TERM the macOS Finder/Dock launch shows no colors (issue #8)"
        );
    }

    // --- valid_utf8_prefix_len: PTY read UTF-8 boundary handling (issue #8) ---

    #[test]
    fn utf8_prefix_ascii_passthrough() {
        assert_eq!(valid_utf8_prefix_len(b"hello"), 5);
    }

    #[test]
    fn utf8_prefix_complete_multibyte_not_split() {
        // box-drawing ─ (U+2500) is 3 bytes; a complete char must not be held back.
        let s = "a─b";
        assert_eq!(valid_utf8_prefix_len(s.as_bytes()), s.len());
    }

    #[test]
    fn utf8_prefix_holds_back_incomplete_tail() {
        // "═" (U+2550) = E2 95 90. "x" + the first 2 of those 3 bytes: the ASCII
        // "x" is complete (len 1); the 2 partial bytes must be held back.
        let mut v = b"x".to_vec();
        v.extend_from_slice(&"═".as_bytes()[..2]);
        assert_eq!(valid_utf8_prefix_len(&v), 1);
    }

    #[test]
    fn utf8_prefix_invalid_byte_not_carried() {
        // A genuine invalid byte must NOT be held back (else the carry buffer
        // would grow unbounded) — included so from_utf8_lossy replaces it now.
        assert_eq!(valid_utf8_prefix_len(b"a\xFFb"), 3);
    }

    // --- decode_pty_chunk / flush_pty_carry: the reader's stateful carry (issue #8) ---

    #[test]
    fn decode_pty_chunk_passes_complete_input_through() {
        let mut carry = Vec::new();
        assert_eq!(decode_pty_chunk(&mut carry, b"hi").as_deref(), Some("hi"));
        assert!(carry.is_empty());
    }

    #[test]
    fn decode_pty_chunk_none_leaves_partial_in_carry() {
        // First 2 bytes of the 4-byte "😀" (F0 9F 98 80): nothing complete yet.
        let mut carry = Vec::new();
        assert_eq!(decode_pty_chunk(&mut carry, &[0xF0, 0x9F]), None);
        assert_eq!(carry, vec![0xF0, 0x9F]);
    }

    #[test]
    fn decode_pty_chunk_reassembles_4byte_emoji_at_every_split() {
        // "😀" = F0 9F 98 80. A read boundary can fall at any of the 3 interior
        // positions; each must reconstruct exactly one char, never corrupting it.
        let full = "😀".as_bytes();
        for split_at in 1..full.len() {
            let mut carry = Vec::new();
            assert_eq!(
                decode_pty_chunk(&mut carry, &full[..split_at]),
                None,
                "split_at={split_at}: no complete char in the first half yet"
            );
            assert_eq!(
                decode_pty_chunk(&mut carry, &full[split_at..]).as_deref(),
                Some("😀"),
                "split_at={split_at}: second half completes the char"
            );
            assert!(carry.is_empty(), "split_at={split_at}: nothing left over");
        }
    }

    #[test]
    fn flush_pty_carry_empty_is_none() {
        let mut carry: Vec<u8> = Vec::new();
        assert_eq!(flush_pty_carry(&mut carry), None);
    }

    #[test]
    fn flush_pty_carry_lossy_decodes_and_drains_partial() {
        // A dangling partial (EOF/read-error mid-char) is flushed lossily, not
        // silently dropped, and the carry is drained afterwards.
        let mut carry = vec![0xE2, 0x95]; // first 2 bytes of "═"
        let out = flush_pty_carry(&mut carry);
        assert!(
            out.as_deref().is_some_and(|s| !s.is_empty()),
            "partial flushed as a replacement char"
        );
        assert!(carry.is_empty(), "carry drained after flush");
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

    // --- resolve_shell_pref ---

    #[test]
    fn resolve_auto_picks_platform_default() {
        assert_eq!(
            resolve_shell_pref("auto", ShellPlatform::Windows),
            "powershell"
        );
        assert_eq!(resolve_shell_pref("auto", ShellPlatform::MacOs), "zsh");
        assert_eq!(resolve_shell_pref("auto", ShellPlatform::Linux), "bash");
    }

    #[test]
    fn resolve_concrete_prefs_pass_through() {
        assert_eq!(
            resolve_shell_pref("powershell", ShellPlatform::Windows),
            "powershell"
        );
        assert_eq!(resolve_shell_pref("cmd", ShellPlatform::Windows), "cmd");
        assert_eq!(resolve_shell_pref("zsh", ShellPlatform::MacOs), "zsh");
        assert_eq!(resolve_shell_pref("bash", ShellPlatform::Linux), "bash");
    }

    #[test]
    fn resolve_platform_foreign_prefs_fall_back_to_default() {
        // Windows-only Shells auf Unix duerfen den Spawn nicht scheitern lassen.
        assert_eq!(resolve_shell_pref("cmd", ShellPlatform::MacOs), "zsh");
        assert_eq!(resolve_shell_pref("cmd", ShellPlatform::Linux), "bash");
        // Legacy-Favoriten mit "gitbash" laufen auf Unix als bash weiter.
        assert_eq!(resolve_shell_pref("gitbash", ShellPlatform::MacOs), "bash");
        assert_eq!(
            resolve_shell_pref("gitbash", ShellPlatform::Windows),
            "gitbash"
        );
    }

    #[test]
    fn resolve_unknown_pref_falls_back_to_default() {
        assert_eq!(
            resolve_shell_pref("fish", ShellPlatform::Windows),
            "powershell"
        );
        assert_eq!(resolve_shell_pref("", ShellPlatform::MacOs), "zsh");
    }

    // --- resolve_available_shell (PATH-aware fallback) ---
    //
    // Regression guard for the macOS session-start bug: favorites hardcode
    // shell "powershell" (settingsStore.ts addFavorite), which resolves to the
    // `pwsh` executable on Unix. On a Mac without PowerShell installed, the old
    // create_session errored out ("shell executable 'pwsh' not found") and the
    // frontend swallowed it — the user saw nothing happen. resolve_available_shell
    // now falls back to the platform default when the preferred shell is missing.

    #[test]
    fn available_shell_falls_back_when_pwsh_missing_on_macos() {
        // Only zsh is installed (typical Mac): a legacy "powershell" favorite
        // must degrade to zsh instead of failing the spawn.
        let installed = |exe: &str| exe == "zsh";
        assert_eq!(
            resolve_available_shell("powershell", ShellPlatform::MacOs, installed),
            Some(("zsh", "zsh"))
        );
    }

    #[test]
    fn available_shell_prefers_pwsh_when_installed() {
        // A Mac user who DID install PowerShell still gets pwsh — the fallback
        // only triggers when the preferred shell is genuinely absent.
        let installed = |_: &str| true;
        assert_eq!(
            resolve_available_shell("powershell", ShellPlatform::MacOs, installed),
            Some(("powershell", "pwsh"))
        );
    }

    #[test]
    fn available_shell_passes_through_installed_default() {
        let installed = |_: &str| true;
        assert_eq!(
            resolve_available_shell("auto", ShellPlatform::MacOs, installed),
            Some(("zsh", "zsh"))
        );
    }

    #[test]
    fn available_shell_none_when_nothing_is_installed() {
        // Neither pwsh nor the zsh fallback exist — surface the failure so
        // create_session returns a precise error rather than spawning garbage.
        let installed = |_: &str| false;
        assert_eq!(
            resolve_available_shell("powershell", ShellPlatform::MacOs, installed),
            None
        );
    }

    #[test]
    fn available_shell_windows_powershell_unchanged() {
        // Windows behavior is untouched: powershell.exe is the resolved exe.
        let installed = |_: &str| true;
        assert_eq!(
            resolve_available_shell("powershell", ShellPlatform::Windows, installed),
            Some(("powershell", "powershell.exe"))
        );
    }

    // --- ensure_claude_available (session-start prerequisite guard, #10) ---

    #[test]
    fn ensure_claude_ok_when_installed() {
        assert!(ensure_claude_available(|_| true).is_ok());
    }

    #[test]
    fn ensure_claude_errors_with_claude_missing_details() {
        // Only "claude" is absent; the guard must surface a classifiable error.
        let err = ensure_claude_available(|exe| exe != "claude").unwrap_err();
        assert_eq!(err.code, ADPErrorCode::TerminalSpawnFailed);
        assert_eq!(err.details.as_deref(), Some("claude_missing"));
        assert!(!err.retryable);
    }

    #[test]
    fn create_session_guards_missing_claude_in_spawn_path() {
        // The guard call lives in the real create_session spawn path (needs a
        // PTY + AppHandle, not unit-testable in isolation), so we pin the
        // source text — like the CLAUDE_CODE_NO_FLICKER / terminal_env guards.
        let src = include_str!("manager.rs");
        assert!(
            src.contains("ensure_claude_available(|exe| which_executable(exe).is_some())?"),
            "create_session must guard on claude presence before spawning the PTY"
        );
    }

    // --- shell_executable ---

    #[test]
    fn shell_executable_windows_keeps_exe_names() {
        assert_eq!(
            shell_executable("powershell", ShellPlatform::Windows),
            "powershell.exe"
        );
        assert_eq!(shell_executable("cmd", ShellPlatform::Windows), "cmd.exe");
        assert_eq!(
            shell_executable("gitbash", ShellPlatform::Windows),
            "bash.exe"
        );
        assert_eq!(shell_executable("bash", ShellPlatform::Windows), "bash.exe");
        assert_eq!(shell_executable("zsh", ShellPlatform::Windows), "zsh.exe");
    }

    #[test]
    fn shell_executable_unix_uses_path_names() {
        // Der Mac-Bug: vorher wurde hier powershell.exe/bash.exe gesucht.
        assert_eq!(shell_executable("zsh", ShellPlatform::MacOs), "zsh");
        assert_eq!(shell_executable("bash", ShellPlatform::MacOs), "bash");
        assert_eq!(shell_executable("powershell", ShellPlatform::MacOs), "pwsh");
        assert_eq!(shell_executable("bash", ShellPlatform::Linux), "bash");
    }

    // --- PermissionMode ---

    #[test]
    fn permission_mode_from_pref_maps_known_values() {
        assert_eq!(PermissionMode::from_pref("auto"), PermissionMode::Auto);
        assert_eq!(PermissionMode::from_pref("plan"), PermissionMode::Plan);
        assert_eq!(PermissionMode::from_pref("bypass"), PermissionMode::Bypass);
        assert_eq!(
            PermissionMode::from_pref("default"),
            PermissionMode::Default
        );
    }

    #[test]
    fn permission_mode_from_pref_unknown_falls_back_to_default() {
        // Fail-safe: garbage/empty darf NIE Bypass werden.
        assert_eq!(PermissionMode::from_pref(""), PermissionMode::Default);
        assert_eq!(PermissionMode::from_pref("YOLO"), PermissionMode::Default);
        assert_eq!(
            PermissionMode::from_pref("--dangerously"),
            PermissionMode::Default
        );
    }

    // --- shell_args ---

    #[test]
    fn shell_args_powershell_no_resume() {
        let args = shell_args(
            "powershell",
            ShellPlatform::Windows,
            None,
            PermissionMode::Bypass,
        );
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
        let args = shell_args("cmd", ShellPlatform::Windows, None, PermissionMode::Bypass);
        assert_eq!(
            args,
            vec![
                "/K".to_string(),
                "claude --dangerously-skip-permissions".to_string(),
            ]
        );
    }

    #[test]
    fn shell_args_gitbash_windows_stays_non_login() {
        let args = shell_args(
            "gitbash",
            ShellPlatform::Windows,
            None,
            PermissionMode::Bypass,
        );
        assert_eq!(
            args,
            vec![
                "-c".to_string(),
                "claude --dangerously-skip-permissions".to_string(),
            ]
        );
    }

    #[test]
    fn shell_args_unix_shells_are_login_shells() {
        // -l ist der zweite Mac-Fix: ohne Login-Shell fehlt GUI-Apps der
        // User-PATH (homebrew/npm-global) und `claude` wird nicht gefunden.
        for shell in ["zsh", "bash"] {
            let args = shell_args(shell, ShellPlatform::MacOs, None, PermissionMode::Bypass);
            assert_eq!(
                args,
                vec![
                    "-l".to_string(),
                    "-c".to_string(),
                    "claude --dangerously-skip-permissions".to_string(),
                ]
            );
        }
    }

    #[test]
    fn shell_args_unknown_shell_falls_back_to_powershell_form() {
        let args = shell_args("fish", ShellPlatform::Windows, None, PermissionMode::Bypass);
        assert_eq!(args[0], "-NoExit");
        assert_eq!(args[1], "-Command");
    }

    #[test]
    fn shell_args_valid_resume_id_appended() {
        let args = shell_args(
            "powershell",
            ShellPlatform::Windows,
            Some("abc-123_XY"),
            PermissionMode::Bypass,
        );
        assert_eq!(
            args[2],
            "claude --dangerously-skip-permissions --resume abc-123_XY"
        );
    }

    #[test]
    fn shell_args_empty_resume_id_ignored() {
        let args = shell_args(
            "powershell",
            ShellPlatform::Windows,
            Some(""),
            PermissionMode::Bypass,
        );
        assert_eq!(args[2], "claude --dangerously-skip-permissions");
    }

    #[test]
    fn shell_args_invalid_resume_id_with_space_ignored() {
        let args = shell_args(
            "cmd",
            ShellPlatform::Windows,
            Some("bad id"),
            PermissionMode::Bypass,
        );
        assert_eq!(args[1], "claude --dangerously-skip-permissions");
    }

    #[test]
    fn shell_args_invalid_resume_id_with_shell_metachar_ignored() {
        // Semicolon would be a command-injection vector — must be rejected.
        // Auf Unix steckt das Kommando in args[2] (nach -l -c).
        let args = shell_args(
            "zsh",
            ShellPlatform::MacOs,
            Some("id;rm -rf"),
            PermissionMode::Bypass,
        );
        assert_eq!(args[2], "claude --dangerously-skip-permissions");
    }

    #[test]
    fn shell_args_resume_id_with_dot_rejected() {
        // '.' is not in the allowed charset (alphanumeric, '-', '_').
        let args = shell_args(
            "powershell",
            ShellPlatform::Windows,
            Some("a.b"),
            PermissionMode::Bypass,
        );
        assert_eq!(args[2], "claude --dangerously-skip-permissions");
    }

    #[test]
    fn shell_args_uuid_style_resume_id_accepted() {
        let uuid = "550e8400-e29b-41d4-a716-446655440000";
        let args = shell_args(
            "powershell",
            ShellPlatform::Windows,
            Some(uuid),
            PermissionMode::Bypass,
        );
        assert_eq!(
            args[2],
            format!("claude --dangerously-skip-permissions --resume {uuid}")
        );
    }

    #[test]
    fn shell_args_default_mode_emits_no_flag() {
        let args = shell_args(
            "powershell",
            ShellPlatform::Windows,
            None,
            PermissionMode::Default,
        );
        assert_eq!(args[2], "claude");
    }

    #[test]
    fn shell_args_auto_mode_emits_permission_flag() {
        let args = shell_args(
            "powershell",
            ShellPlatform::Windows,
            None,
            PermissionMode::Auto,
        );
        assert_eq!(args[2], "claude --permission-mode auto");
    }

    #[test]
    fn shell_args_plan_mode_emits_permission_flag() {
        let args = shell_args(
            "powershell",
            ShellPlatform::Windows,
            None,
            PermissionMode::Plan,
        );
        assert_eq!(args[2], "claude --permission-mode plan");
    }

    #[test]
    fn shell_args_bypass_mode_emits_dangerous_flag() {
        let args = shell_args(
            "powershell",
            ShellPlatform::Windows,
            None,
            PermissionMode::Bypass,
        );
        assert_eq!(args[2], "claude --dangerously-skip-permissions");
    }

    #[test]
    fn shell_args_mode_and_resume_combine() {
        let args = shell_args(
            "powershell",
            ShellPlatform::Windows,
            Some("abc-123_XY"),
            PermissionMode::Auto,
        );
        assert_eq!(args[2], "claude --permission-mode auto --resume abc-123_XY");
    }

    #[test]
    fn shell_args_default_mode_and_resume_combine() {
        let args = shell_args(
            "powershell",
            ShellPlatform::Windows,
            Some("abc-123_XY"),
            PermissionMode::Default,
        );
        assert_eq!(args[2], "claude --resume abc-123_XY");
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
}
