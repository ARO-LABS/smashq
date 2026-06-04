// src-tauri/src/session/commands.rs

use super::manager::SessionManager;
use crate::error::ADPError;
use std::sync::Arc;
use tauri::{AppHandle, State};

// Alle Commands im mod-Block wegen rustc 1.94 E0255 Workaround (siehe CLAUDE.md)
#[allow(clippy::module_inception)]
pub mod commands {
    use super::*;

    #[tauri::command]
    #[allow(clippy::too_many_arguments)]
    pub async fn create_session(
        app: AppHandle,
        manager: State<'_, Arc<SessionManager>>,
        id: String,
        folder: String,
        title: Option<String>,
        shell: Option<String>,
        resume_session_id: Option<String>,
        initial_cols: Option<u16>,
        initial_rows: Option<u16>,
    ) -> Result<super::super::manager::SessionInfo, ADPError> {
        log::debug!(
            "create_session called: id={}, folder={}, shell={:?}, resume={:?}, size={:?}x{:?}",
            id,
            folder,
            shell,
            resume_session_id,
            initial_cols,
            initial_rows
        );

        // Validate folder exists and is a directory
        crate::validation::validate_folder(&folder).map_err(|e| {
            log::error!("Failed to create session {}: {}", id, e);
            e
        })?;

        // Validate resume_session_id to prevent shell injection
        if let Some(ref sid) = resume_session_id {
            crate::validation::validate_session_id(sid).map_err(|e| {
                log::error!("Failed to create session {}: {}", id, e);
                e
            })?;
        }

        let title = title.unwrap_or_else(|| {
            std::path::Path::new(&folder)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Session".to_string())
        });
        let shell = shell.unwrap_or_else(|| "powershell".to_string());

        manager.create_session(
            app,
            id,
            title,
            folder,
            shell,
            resume_session_id,
            initial_cols,
            initial_rows,
        )
    }

    #[tauri::command]
    pub async fn write_session(
        manager: State<'_, Arc<SessionManager>>,
        id: String,
        data: String,
    ) -> Result<(), ADPError> {
        log::debug!("write_session called: id={}, data_len={}", id, data.len());
        manager.write_to_session(&id, &data)
    }

    #[tauri::command]
    pub async fn resize_session(
        manager: State<'_, Arc<SessionManager>>,
        id: String,
        cols: u16,
        rows: u16,
    ) -> Result<(), ADPError> {
        log::debug!(
            "resize_session called: id={}, cols={}, rows={}",
            id,
            cols,
            rows
        );
        manager.resize_session(&id, cols, rows)
    }

    #[tauri::command]
    pub async fn close_session(
        app: AppHandle,
        manager: State<'_, Arc<SessionManager>>,
        id: String,
    ) -> Result<(), ADPError> {
        use tauri::Emitter;
        log::info!("close_session called: id={}", id);
        let result = manager.close_session(&id);
        // Notifies any open diff-window for this session that the session
        // is gone — Diff-Window flips its banner + disables Refresh.
        if let Err(e) = app.emit(&format!("session-deleted/{}", id), id.clone()) {
            log::debug!("Failed to emit session-deleted/{}: {}", id, e);
        }
        result
    }

    #[tauri::command]
    pub async fn list_sessions(
        manager: State<'_, Arc<SessionManager>>,
    ) -> Result<Vec<super::super::manager::SessionInfo>, ADPError> {
        log::debug!("list_sessions called");
        Ok(manager.list_sessions())
    }

    /// Scan for git worktrees in a project folder.
    #[tauri::command]
    pub async fn scan_worktrees(
        folder: String,
    ) -> Result<Vec<super::super::worktree::WorktreeInfo>, ADPError> {
        log::debug!("scan_worktrees called: folder={}", folder);
        super::super::worktree::scan_worktrees_in_folder(&folder)
    }

    /// Diff zwischen Session-Snapshot und aktuellem Working-Tree.
    /// Liefert ein `SessionDiff` mit File-Liste, Stats und (sofern unter
    /// Budget) den eigentlichen Datei-Inhalten.
    #[tauri::command]
    pub async fn get_session_diff(
        manager: State<'_, Arc<SessionManager>>,
        session_id: String,
    ) -> Result<super::super::diff::SessionDiff, ADPError> {
        log::debug!("get_session_diff called: session_id={}", session_id);
        crate::validation::validate_session_id(&session_id)?;

        let info = manager.get_session_info(&session_id).ok_or_else(|| {
            ADPError::new(
                crate::error::ADPErrorCode::SessionNotFound,
                format!("Session not found: {session_id}"),
            )
        })?;
        if !info.is_git_repo {
            return Err(ADPError::new(
                crate::error::ADPErrorCode::CommandExecutionFailed,
                "Session folder is not a git repository",
            ));
        }
        let commit = info.snapshot_commit.as_ref().ok_or_else(|| {
            ADPError::new(
                crate::error::ADPErrorCode::CommandExecutionFailed,
                "Session has no snapshot commit",
            )
        })?;
        let snapshot_at = info.snapshot_at.ok_or_else(|| {
            ADPError::new(
                crate::error::ADPErrorCode::CommandExecutionFailed,
                "Session has no snapshot timestamp",
            )
        })?;
        let folder = std::path::PathBuf::from(&info.folder);
        super::super::diff::compute_session_diff(&folder, &session_id, commit, snapshot_at)
    }

    /// Schneller Probe-Check: Existiert aktuell ein Diff zwischen
    /// Session-Snapshot und Working-Tree? Wird vom Frontend reaktiv (nach
    /// PTY-Output-Settle, Status-Wechsel) aufgerufen, um das Diff-Icon
    /// dynamisch zu zeigen/auszublenden. Sub-50ms typisch — keine
    /// Content-Reads, nur Git-Exit-Codes + Untracked-Liste.
    #[tauri::command]
    pub async fn session_has_diff(
        manager: State<'_, Arc<SessionManager>>,
        session_id: String,
    ) -> Result<bool, ADPError> {
        crate::validation::validate_session_id(&session_id)?;
        let Some(info) = manager.get_session_info(&session_id) else {
            // Session unbekannt → kein Diff (Race: Tab geschlossen waehrend Probe lief).
            return Ok(false);
        };
        if !info.is_git_repo {
            return Ok(false);
        }
        let Some(commit) = info.snapshot_commit.as_ref() else {
            return Ok(false);
        };
        let folder = std::path::PathBuf::from(&info.folder);
        Ok(super::super::diff::has_session_diff(&folder, commit))
    }

    /// Oeffnet das Diff-Window fuer eine Session, oder fokussiert es,
    /// falls bereits offen. Label: `diff-<sessionId>`.
    #[tauri::command]
    pub async fn open_session_diff_window(
        app: tauri::AppHandle,
        session_id: String,
    ) -> Result<(), ADPError> {
        use tauri::{Manager, WebviewWindowBuilder};

        log::info!("open_session_diff_window called: session_id={}", session_id);
        crate::validation::validate_session_id(&session_id)?;

        let label = format!("diff-{}", session_id);
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.set_focus();
            return Ok(());
        }

        let url = format!("index.html?view=diff&sessionId={}", session_id);
        WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(url.into()))
            .title("Smashq — Diff")
            .inner_size(1200.0, 800.0)
            .resizable(true)
            .build()
            .map_err(|e| ADPError::internal(format!("Failed to create diff window: {}", e)))?;
        Ok(())
    }
}
