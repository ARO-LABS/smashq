use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

pub mod error;
pub mod github;
pub mod log_reader;
pub mod session;
pub mod settings;
pub mod util;
pub mod validation;

/// Runtime flag for the env_logger format closure: when false, the closure
/// short-circuits the file write (stderr stays in debug builds for cargo run).
/// Initial value is set in `run()` from the persisted preference if present,
/// otherwise from `cfg!(debug_assertions)`. Default `false` means a fresh
/// install never creates a log file at all.
pub static LOGGING_ENABLED: AtomicBool = AtomicBool::new(false);

/// Lazy-opened log file. Created on the FIRST allowed write. Opt-out users
/// (gate stays `false`) never create the file, never spend any disk.
static LOG_FILE: OnceLock<Option<Mutex<std::fs::File>>> = OnceLock::new();

fn open_log_file_lazy() -> Option<Mutex<std::fs::File>> {
    let path = log_file_path();
    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        Ok(f) => Some(Mutex::new(f)),
        Err(e) => {
            eprintln!("[smashq] Failed to open log file {}: {}", path.display(), e);
            None
        }
    }
}

/// Reads the persisted `preferences.backendFileLogging` from settings.json.
/// Returns `Some(true)`/`Some(false)` if the user has an explicit setting,
/// `None` if the file is missing or unreadable. Caller decides the fallback.
fn read_persisted_backend_logging() -> Option<bool> {
    let doc_dir = dirs::document_dir()?;
    let path = doc_dir.join("Smashq").join("settings.json");
    let content = std::fs::read_to_string(&path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    json.get("state")?
        .get("preferences")?
        .get("backendFileLogging")?
        .as_bool()
}

fn init_logging() {
    use env_logger::Builder;
    use log::LevelFilter;
    use std::io::Write;

    let mut builder = Builder::new();
    builder.format(|buf, record| {
        let gate_on = LOGGING_ENABLED.load(Ordering::Relaxed);
        let dev_mode = cfg!(debug_assertions);

        // Release: gate applies to BOTH stderr and file.
        // Debug:   stderr always works for cargo run; file follows the gate.
        if !dev_mode && !gate_on {
            return Ok(());
        }

        let msg = format!(
            "[{}] [{}] [{}] {}",
            chrono::Utc::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            record.level(),
            record.module_path().unwrap_or("unknown"),
            record.args()
        );
        writeln!(buf, "{}", msg)?;

        // File write only when the gate is on (any build). Lazy-open so that
        // opt-out users do not even create the file.
        if gate_on {
            if let Some(file_mutex) = LOG_FILE.get_or_init(open_log_file_lazy) {
                if let Ok(mut f) = file_mutex.lock() {
                    let _ = writeln!(f, "{}", msg);
                }
            }
        }
        Ok(())
    });

    // In debug/dev builds, log INFO+; in release, only WARN+
    builder.filter_level(if cfg!(debug_assertions) {
        LevelFilter::Info
    } else {
        LevelFilter::Warn
    });

    if builder.try_init().is_err() {
        eprintln!("[smashq] Logger already initialized, skipping.");
    }
}

fn log_file_path() -> std::path::PathBuf {
    // Try to use the app's local data dir, fallback to cwd
    if let Some(data_dir) = std::env::var_os("LOCALAPPDATA") {
        let dir = std::path::PathBuf::from(data_dir).join("smashq");
        if std::fs::create_dir_all(&dir).is_ok() {
            return dir.join("smashq.log");
        }
    }
    std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("smashq.log")
}

mod commands {
    use super::{Ordering, LOGGING_ENABLED};
    use crate::error::ADPError;

    /// Frontend-driven toggle for the env_logger format-closure gate.
    /// Setting this to false silences both stderr and file output without
    /// rebuilding the subscriber, so it can flip at runtime without restart.
    #[tauri::command]
    pub fn set_file_logging_enabled(enabled: bool) -> Result<(), ADPError> {
        LOGGING_ENABLED.store(enabled, Ordering::Relaxed);
        Ok(())
    }

    #[tauri::command]
    pub async fn open_log_window(app: tauri::AppHandle) -> Result<(), ADPError> {
        use tauri::{Manager, WebviewWindowBuilder};

        if let Some(win) = app.get_webview_window("log-viewer") {
            let _ = win.set_focus();
            return Ok(());
        }

        WebviewWindowBuilder::new(
            &app,
            "log-viewer",
            tauri::WebviewUrl::App("index.html?view=logs".into()),
        )
        .title("Smashq — Logs")
        .inner_size(900.0, 600.0)
        .resizable(true)
        .build()
        .map_err(|e| ADPError::internal(format!("Failed to create log window: {}", e)))?;

        Ok(())
    }

    #[tauri::command]
    pub async fn open_detached_window(
        app: tauri::AppHandle,
        view: String,
        title: String,
    ) -> Result<(), ADPError> {
        use tauri::{Manager, WebviewWindowBuilder};

        let label = format!("detached-{}", view);

        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.set_focus();
            return Ok(());
        }

        WebviewWindowBuilder::new(
            &app,
            &label,
            tauri::WebviewUrl::App(format!("index.html?view={}", view).into()),
        )
        .title(format!("Smashq — {}", title))
        .inner_size(1200.0, 800.0)
        .resizable(true)
        .build()
        .map_err(|e| ADPError::internal(format!("Failed to create {} window: {}", view, e)))?;

        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Set the file-logging gate BEFORE init_logging registers the format
    // closure. If the user has explicit settings, honor them; otherwise
    // default to debug-on / release-off so opt-out users never create a
    // log file at all.
    let initial_logging = read_persisted_backend_logging().unwrap_or(cfg!(debug_assertions));
    LOGGING_ENABLED.store(initial_logging, Ordering::Relaxed);

    init_logging();
    log::info!("Agentic Dashboard starting up");

    let session_manager = std::sync::Arc::new(session::manager::SessionManager::new());
    let session_manager_cleanup = session_manager.clone();

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin({
            let mut updater = tauri_plugin_updater::Builder::new();
            match option_env!("UPDATER_GITHUB_TOKEN") {
                Some(token) if !token.is_empty() => {
                    updater = updater
                        .header("Authorization", format!("token {}", token))
                        .expect("invalid Authorization header");
                    log::info!("Auto-updater initialized with auth token");
                }
                _ => {
                    log::info!("Auto-updater initialized without auth token (public repo mode)");
                }
            }
            updater.build()
        })
        .plugin(tauri_plugin_process::init())
        .manage(session_manager)
        .invoke_handler(tauri::generate_handler![
            commands::open_log_window,
            commands::open_detached_window,
            commands::set_file_logging_enabled,
            // Session-Commands
            session::commands::commands::create_session,
            session::commands::commands::write_session,
            session::commands::commands::resize_session,
            session::commands::commands::close_session,
            // Folder actions
            session::folder_actions::commands::open_folder_in_explorer,
            session::folder_actions::commands::open_terminal_in_folder,
            // File reader (Agent Config Viewer)
            session::file_reader::commands::read_project_file,
            session::file_reader::commands::write_project_file,
            session::file_reader::commands::list_project_dir,
            session::file_reader::commands::read_user_claude_file,
            session::file_reader::commands::list_user_claude_dir,
            session::file_reader::commands::list_skill_dirs,
            session::file_reader::commands::scan_claude_sessions,
            session::file_reader::commands::delete_claude_session,
            session::file_reader::commands::resolve_project_root,
            // Worktree scanning
            session::commands::commands::scan_worktrees,
            // Session diff (per-session git snapshot)
            session::commands::commands::get_session_diff,
            session::commands::commands::session_has_diff,
            session::commands::commands::open_session_diff_window,
            // GitHub integration
            github::commands::commands::get_git_info,
            github::commands::commands::check_project_presence,
            github::commands::commands::get_github_prs,
            github::commands::commands::get_github_issues,
            github::commands::commands::get_issue_detail,
            github::commands::commands::get_issue_checks,
            github::commands::commands::post_issue_comment,
            // Projects v2 Kanban
            github::project::commands::list_user_projects,
            github::project::commands::get_project_board,
            github::project::commands::move_project_item,
            // Log reader
            log_reader::commands::read_backend_log,
            // ICS calendar export
            session::ics_export::commands::export_task_ics,
            // User settings (Documents/Smashq/)
            settings::commands::load_user_settings,
            settings::commands::save_user_settings,
            settings::commands::load_favorites_file,
            settings::commands::save_favorites_file,
            settings::commands::load_notes,
            settings::commands::save_note_file,
            settings::commands::load_tasks,
            settings::commands::save_tasks,
        ])
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Nur beim Schließen des Hauptfensters alle Sessions beenden
                if window.label() == "main" {
                    let sessions = session_manager_cleanup.list_sessions();
                    for s in &sessions {
                        if let Err(e) = session_manager_cleanup.close_session(&s.id) {
                            log::error!("Failed to close session {} on shutdown: {}", s.id, e);
                        }
                    }
                    if !sessions.is_empty() {
                        log::info!("Closed {} sessions on window close.", sessions.len());
                    }
                }
            }
        })
        .run(tauri::generate_context!());

    match result {
        Ok(()) => log::info!("Agentic Dashboard exited cleanly"),
        Err(e) => {
            log::error!("Tauri application failed to run: {}", e);
            eprintln!("Fatal: Tauri application failed to run: {}", e);
            std::process::exit(1);
        }
    }
}
