// src-tauri/src/session/folder_actions.rs

use crate::error::ADPError;
use crate::util::silent_command;

// Commands im mod-Block wegen rustc 1.94 E0255 Workaround (siehe CLAUDE.md)
#[allow(clippy::module_inception)]
pub mod commands {
    use super::*;

    #[tauri::command]
    pub async fn open_folder_in_explorer(path: String) -> Result<(), ADPError> {
        let folder = std::path::Path::new(&path);
        if !folder.exists() {
            return Err(ADPError::validation(format!(
                "Path does not exist: {}",
                path
            )));
        }

        #[cfg(target_os = "windows")]
        {
            silent_command("explorer")
                .arg(&path)
                .spawn()
                .map_err(|e| ADPError::command_failed(format!("Failed to open Explorer: {}", e)))?;
        }
        #[cfg(target_os = "macos")]
        {
            silent_command("open")
                .arg(&path)
                .spawn()
                .map_err(|e| ADPError::command_failed(format!("Failed to open Finder: {}", e)))?;
        }
        #[cfg(target_os = "linux")]
        {
            silent_command("xdg-open").arg(&path).spawn().map_err(|e| {
                ADPError::command_failed(format!("Failed to open file manager: {}", e))
            })?;
        }

        log::info!("Opened folder in explorer: {}", path);
        Ok(())
    }

    #[tauri::command]
    pub async fn open_terminal_in_folder(path: String) -> Result<(), ADPError> {
        let folder = std::path::Path::new(&path);
        if !folder.exists() {
            return Err(ADPError::validation(format!(
                "Path does not exist: {}",
                path
            )));
        }
        if !folder.is_dir() {
            return Err(ADPError::validation(format!(
                "Path is not a directory: {}",
                path
            )));
        }

        #[cfg(target_os = "windows")]
        {
            silent_command("cmd")
                .args([
                    "/C",
                    "start",
                    "",
                    "cmd",
                    "/K",
                    &format!("cd /d \"{}\"", path),
                ])
                .current_dir(&path)
                .spawn()
                .map_err(|e| ADPError::command_failed(format!("Failed to open terminal: {}", e)))?;
        }
        #[cfg(target_os = "macos")]
        {
            silent_command("open")
                .args(["-a", "Terminal", &path])
                .spawn()
                .map_err(|e| ADPError::command_failed(format!("Failed to open Terminal: {}", e)))?;
        }
        #[cfg(target_os = "linux")]
        {
            silent_command("x-terminal-emulator")
                .current_dir(&path)
                .spawn()
                .map_err(|e| ADPError::command_failed(format!("Failed to open terminal: {}", e)))?;
        }

        log::info!("Opened terminal in folder: {}", path);
        Ok(())
    }
}
