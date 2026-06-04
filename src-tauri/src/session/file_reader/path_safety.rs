// src-tauri/src/session/file_reader/path_safety.rs
//
// Path-traversal guards: resolve user-supplied relative paths inside a trusted
// base and prove the result stays within it (canonicalize-based, TOCTOU-aware).

use crate::error::ADPError;
use std::path::{Path, PathBuf};

/// Shared path-traversal protection: resolve `sub` inside `base` and verify
/// the result stays within `base` after canonicalization.
pub(crate) fn safe_resolve_with_base(base: &Path, sub: &str) -> Result<PathBuf, ADPError> {
    let target = base.join(sub);

    let canon_base = base.canonicalize().map_err(|e| {
        ADPError::file_io(format!(
            "Failed to resolve base '{}': {}",
            base.display(),
            e
        ))
    })?;

    if target.exists() {
        let canon_target = target
            .canonicalize()
            .map_err(|e| ADPError::file_io(format!("Failed to resolve target '{}': {}", sub, e)))?;

        if !canon_target.starts_with(&canon_base) {
            return Err(ADPError::validation(format!(
                "Path traversal detected: target is outside {}",
                base.display()
            )));
        }
        Ok(canon_target)
    } else {
        // File doesn't exist yet — canonicalize parent + append filename
        // to prevent symlink attacks (TOCTOU) on write operations
        if let Some(parent) = target.parent() {
            if parent.exists() {
                let canon_parent = parent.canonicalize().map_err(|e| {
                    ADPError::file_io(format!(
                        "Failed to resolve parent '{}': {}",
                        parent.display(),
                        e
                    ))
                })?;
                if !canon_parent.starts_with(&canon_base) {
                    return Err(ADPError::validation(format!(
                        "Path traversal detected: target is outside {}",
                        base.display()
                    )));
                }
                let file_name = target
                    .file_name()
                    .ok_or_else(|| ADPError::validation("Invalid file name"))?;
                Ok(canon_parent.join(file_name))
            } else {
                // Parent doesn't exist either — validate by collapsing components
                let mut resolved = canon_base.clone();
                for component in std::path::Path::new(sub).components() {
                    match component {
                        std::path::Component::Normal(c) => resolved.push(c),
                        std::path::Component::ParentDir => {
                            resolved.pop();
                            if !resolved.starts_with(&canon_base) {
                                return Err(ADPError::validation(format!(
                                    "Path traversal detected: target is outside {}",
                                    base.display()
                                )));
                            }
                        }
                        std::path::Component::CurDir => {}
                        _ => {
                            return Err(ADPError::validation("Invalid path component"));
                        }
                    }
                }
                if !resolved.starts_with(&canon_base) {
                    return Err(ADPError::validation(format!(
                        "Path traversal detected: target is outside {}",
                        base.display()
                    )));
                }
                Ok(resolved)
            }
        } else {
            Err(ADPError::validation("Invalid path: no parent directory"))
        }
    }
}

/// Canonicalize and validate that resolved_path is inside base_folder.
pub(crate) fn safe_resolve(folder: &str, relative_path: &str) -> Result<PathBuf, ADPError> {
    let base = PathBuf::from(folder);
    if !base.is_dir() {
        return Err(ADPError::file_io(format!(
            "Failed to resolve path: folder does not exist: {}",
            folder
        )));
    }
    safe_resolve_with_base(&base, relative_path)
}

/// Resolve a path inside ~/.claude/ with traversal protection.
pub(crate) fn safe_resolve_user_claude(relative_path: &str) -> Result<PathBuf, ADPError> {
    // Reject traversal attempts even before checking directory existence
    if relative_path.contains("..") {
        return Err(ADPError::validation(
            "Path traversal detected: '..' not allowed in relative path",
        ));
    }

    let home =
        dirs::home_dir().ok_or_else(|| ADPError::file_io("Cannot determine home directory"))?;
    let claude_dir = home.join(".claude");

    if !claude_dir.is_dir() {
        // ~/.claude/ doesn't exist — return non-existent path, caller handles empty result
        // Still validate: only allow simple relative paths (no traversal)
        return Ok(claude_dir.join(relative_path));
    }
    safe_resolve_with_base(&claude_dir, relative_path)
}

/// Entry for a skill directory containing a SKILL.md file.
#[derive(serde::Serialize)]
pub struct SkillDirEntry {
    pub dir_name: String,
    pub content: String,
    pub has_reference_dir: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn setup_temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("Failed to create temp dir")
    }

    // --- safe_resolve_with_base tests ---

    #[test]
    fn test_safe_resolve_normal_existing_file() {
        let tmp = setup_temp_dir();
        let base = tmp.path();
        fs::write(base.join("hello.txt"), "content").unwrap();

        let result = safe_resolve_with_base(base, "hello.txt");
        assert!(result.is_ok());
        assert!(result.unwrap().ends_with("hello.txt"));
    }

    #[test]
    fn test_safe_resolve_blocks_parent_traversal() {
        let tmp = setup_temp_dir();
        let base = tmp.path();

        let result = safe_resolve_with_base(base, "../../../etc/passwd");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.message.contains("Path traversal detected"));
    }

    #[test]
    fn test_safe_resolve_blocks_dotdot_in_middle() {
        let tmp = setup_temp_dir();
        let base = tmp.path();
        fs::create_dir_all(base.join("subdir")).unwrap();

        let result = safe_resolve_with_base(base, "subdir/../../etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn test_safe_resolve_allows_nonexistent_file() {
        let tmp = setup_temp_dir();
        let base = tmp.path();

        let result = safe_resolve_with_base(base, "new-file.txt");
        assert!(result.is_ok());
        let resolved = result.unwrap();
        assert!(resolved.starts_with(base.canonicalize().unwrap()));
    }

    #[test]
    fn test_safe_resolve_allows_nested_nonexistent() {
        let tmp = setup_temp_dir();
        let base = tmp.path();

        let result = safe_resolve_with_base(base, "new-dir/new-file.txt");
        assert!(result.is_ok());
    }

    #[test]
    fn test_safe_resolve_blocks_traversal_in_nonexistent_path() {
        let tmp = setup_temp_dir();
        let base = tmp.path();

        let result = safe_resolve_with_base(base, "foo/../../secret.txt");
        assert!(result.is_err());
    }

    #[test]
    fn test_safe_resolve_curdir_is_harmless() {
        let tmp = setup_temp_dir();
        let base = tmp.path();
        fs::write(base.join("test.txt"), "data").unwrap();

        let result = safe_resolve_with_base(base, "./test.txt");
        assert!(result.is_ok());
    }

    // --- safe_resolve_user_claude tests ---

    #[test]
    fn test_user_claude_blocks_traversal() {
        let result = safe_resolve_user_claude("../../etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().message.contains("traversal"));
    }

    #[test]
    fn test_user_claude_allows_simple_path() {
        let result = safe_resolve_user_claude("settings.json");
        // Should succeed (even if ~/.claude doesn't exist — returns non-existent path)
        assert!(result.is_ok());
    }

    // --- safe_resolve / safe_resolve_user_claude — additional edge cases ---

    #[test]
    fn safe_resolve_errors_when_folder_not_a_directory() {
        let tmp = setup_temp_dir();
        let file = tmp.path().join("a-file.txt");
        std::fs::write(&file, "x").unwrap();
        // folder arg points to a FILE → is_dir() false → file_io error.
        let result = safe_resolve(&file.to_string_lossy(), "child.txt");
        assert!(result.is_err());
        assert!(result.unwrap_err().message.contains("does not exist"));
    }

    #[test]
    fn safe_resolve_errors_for_nonexistent_folder() {
        let result = safe_resolve("/no/such/folder/at/all", "child.txt");
        assert!(result.is_err());
    }

    #[test]
    fn safe_resolve_user_claude_rejects_dotdot_anywhere() {
        // ".." detected before any filesystem check.
        let result = safe_resolve_user_claude("skills/../../../secret");
        assert!(result.is_err());
        assert!(result.unwrap_err().message.contains("traversal"));
    }

    #[test]
    fn safe_resolve_user_claude_allows_nested_simple_path() {
        let result = safe_resolve_user_claude("skills/my-skill/SKILL.md");
        assert!(result.is_ok());
    }

    #[test]
    fn safe_resolve_with_base_blocks_absolute_subpath() {
        // An absolute `sub` makes PathBuf::join replace base entirely.
        let tmp = setup_temp_dir();
        let abs = if cfg!(windows) {
            "C:\\Windows\\System32"
        } else {
            "/etc"
        };
        let result = safe_resolve_with_base(tmp.path(), abs);
        // Must NOT resolve to something inside tmp → error.
        assert!(result.is_err());
    }

    #[test]
    fn skill_dir_entry_serializes_all_fields() {
        let entry = SkillDirEntry {
            dir_name: "my-skill".to_string(),
            content: "# Skill".to_string(),
            has_reference_dir: true,
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["dir_name"], "my-skill");
        assert_eq!(json["content"], "# Skill");
        assert_eq!(json["has_reference_dir"], true);
    }
}
