// src-tauri/src/validation.rs
//
// Centralized input validation for Tauri commands.
// All user-supplied IDs, paths, and strings should be validated here.

use crate::error::ADPError;

/// Validate a session ID (used in PTY resume).
/// Only alphanumeric chars, hyphens, and underscores allowed.
pub fn validate_session_id(id: &str) -> Result<(), ADPError> {
    if id.is_empty() {
        return Err(ADPError::validation("Session ID must not be empty"));
    }
    if id.len() > 256 {
        return Err(ADPError::validation("Session ID too long (max 256 chars)"));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(ADPError::validation(format!(
            "Invalid session ID '{}' — only alphanumeric characters, hyphens, and underscores are allowed",
            id
        )));
    }
    Ok(())
}

/// Validate a folder path exists and is a directory.
pub fn validate_folder(folder: &str) -> Result<(), ADPError> {
    if folder.is_empty() {
        return Err(ADPError::validation("Folder path must not be empty"));
    }
    let path = std::path::Path::new(folder);
    if !path.is_dir() {
        return Err(ADPError::validation(format!(
            "Folder does not exist or is not a directory: {}",
            folder
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- validate_session_id ---

    #[test]
    fn test_valid_session_ids() {
        assert!(validate_session_id("abc-123").is_ok());
        assert!(validate_session_id("session_42").is_ok());
        assert!(validate_session_id("a").is_ok());
    }

    #[test]
    fn test_empty_session_id() {
        assert!(validate_session_id("").is_err());
    }

    #[test]
    fn test_session_id_with_special_chars() {
        assert!(validate_session_id("$(rm -rf /)").is_err());
        assert!(validate_session_id("test;ls").is_err());
        assert!(validate_session_id("test`whoami`").is_err());
        assert!(validate_session_id("../../../etc/passwd").is_err());
    }

    #[test]
    fn test_session_id_too_long() {
        let long_id = "a".repeat(257);
        assert!(validate_session_id(&long_id).is_err());
    }

    // --- validate_folder ---

    #[test]
    fn test_empty_folder() {
        assert!(validate_folder("").is_err());
    }

    #[test]
    fn test_nonexistent_folder() {
        assert!(validate_folder("/nonexistent/path/xyz").is_err());
    }

    // --- validate_session_id: boundaries & edge cases ---

    #[test]
    fn test_session_id_max_length_boundary() {
        // 256 chars is the documented maximum — must still be accepted.
        let max_id = "a".repeat(256);
        assert!(validate_session_id(&max_id).is_ok());
    }

    #[test]
    fn test_session_id_rejects_dot() {
        // Session IDs reject dots (file-path IDs would allow them).
        assert!(validate_session_id("session.1").is_err());
    }

    #[test]
    fn test_session_id_rejects_whitespace() {
        assert!(validate_session_id("session 1").is_err());
        assert!(validate_session_id("\tsession").is_err());
    }

    #[test]
    fn test_session_id_rejects_unicode() {
        // Only ASCII alphanumerics are permitted.
        assert!(validate_session_id("sessiön").is_err());
        assert!(validate_session_id("セッション").is_err());
    }

    #[test]
    fn test_session_id_accepts_uppercase_and_digits() {
        assert!(validate_session_id("ABC-123_def").is_ok());
    }

    // --- validate_folder: happy path & file rejection ---

    #[test]
    fn test_validate_folder_accepts_existing_directory() {
        // `cargo test` runs with the crate root as CWD — "." is always a dir.
        assert!(validate_folder(".").is_ok());
    }

    #[test]
    fn test_validate_folder_rejects_file_path() {
        // Cargo.toml exists in the crate root but is a file, not a directory.
        assert!(validate_folder("Cargo.toml").is_err());
    }
}
