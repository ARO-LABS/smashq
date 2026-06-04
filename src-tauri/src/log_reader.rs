use crate::error::ADPError;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;

fn log_file_path() -> PathBuf {
    if let Some(data_dir) = std::env::var_os("LOCALAPPDATA") {
        let dir = PathBuf::from(data_dir).join("smashq");
        return dir.join("smashq.log");
    }
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("smashq.log")
}

#[allow(clippy::module_inception)]
pub mod commands {
    use super::*;

    #[tauri::command]
    pub fn read_backend_log(max_lines: Option<usize>) -> Result<Vec<String>, ADPError> {
        let path = log_file_path();
        let max = max_lines.unwrap_or(500);

        let file = std::fs::File::open(&path).map_err(|e| {
            ADPError::file_io(format!(
                "Failed to open log file '{}': {}",
                path.display(),
                e
            ))
        })?;

        let reader = BufReader::new(file);
        let all_lines: Vec<String> = reader.lines().map_while(Result::ok).collect();

        let start = all_lines.len().saturating_sub(max);
        Ok(all_lines[start..].to_vec())
    }
}
