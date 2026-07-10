//! In-App prerequisite check (Issue #10).
//!
//! Reports whether the external tools a Smashq session depends on — `claude`,
//! `git`, `gh` — plus the platform default shell are present on PATH, with
//! their resolved locations. The Settings "System" panel renders this; the
//! session-start guard in `session::manager` reuses the same PATH probe.
//!
//! All probing goes through the session manager's `which_executable`, so the
//! paths reported here match exactly what session spawning resolves. On macOS
//! the process PATH is already hydrated from the login shell at startup
//! (`lib.rs`), so a Finder/Dock launch sees the same PATH here as a login shell.

use crate::error::ADPError;
use serde::Serialize;

/// Presence + resolved path for one required external tool.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub found: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

impl ToolStatus {
    /// `found` is derived from the probe result: a resolved path means present.
    fn from_path(path: Option<String>) -> Self {
        Self {
            found: path.is_some(),
            path,
        }
    }
}

/// Aggregate prerequisite report. `shell_name` is the concrete platform default
/// shell (e.g. "zsh", "powershell") the "auto" preference resolves to.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrerequisiteStatus {
    pub claude: ToolStatus,
    pub git: ToolStatus,
    pub gh: ToolStatus,
    pub shell: ToolStatus,
    pub shell_name: String,
}

/// Pure builder: `probe` resolves a command name to its PATH location (`None` =
/// missing). Injected so the unit tests exercise every found/missing combo
/// without touching the real PATH. `shell_name`/`shell_exe` come from the
/// platform default-shell mapping (`default_shell_probe`).
fn build_status(
    probe: impl Fn(&str) -> Option<String>,
    shell_name: &str,
    shell_exe: &str,
) -> PrerequisiteStatus {
    PrerequisiteStatus {
        claude: ToolStatus::from_path(probe("claude")),
        git: ToolStatus::from_path(probe("git")),
        gh: ToolStatus::from_path(probe("gh")),
        shell: ToolStatus::from_path(probe(shell_exe)),
        shell_name: shell_name.to_string(),
    }
}

/// Production probe: PATH lookup via the session manager's `which_executable`,
/// stringified. Shared with session spawning so reported paths never drift.
fn probe_path(name: &str) -> Option<String> {
    crate::session::manager::which_executable(name).map(|p| p.display().to_string())
}

// Commands im mod-Block wegen rustc E0255-Workaround (siehe CLAUDE.md).
#[allow(clippy::module_inception)]
pub mod commands {
    use super::*;

    /// Reports whether `claude`, `git`, `gh` and the platform default shell are
    /// on PATH, with resolved paths. Pure PATH probes — no session side effects.
    #[tauri::command]
    pub async fn check_prerequisites() -> Result<PrerequisiteStatus, ADPError> {
        let (shell_name, shell_exe) = crate::session::manager::default_shell_probe();
        Ok(build_status(probe_path, shell_name, shell_exe))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_tools_found_reports_found_with_paths() {
        let probe = |name: &str| Some(format!("/usr/bin/{name}"));
        let s = build_status(probe, "zsh", "zsh");
        assert!(s.claude.found);
        assert_eq!(s.claude.path.as_deref(), Some("/usr/bin/claude"));
        assert!(s.git.found);
        assert!(s.gh.found);
        assert!(s.shell.found);
        assert_eq!(s.shell_name, "zsh");
    }

    #[test]
    fn claude_missing_reports_not_found_without_path() {
        let probe = |name: &str| {
            if name == "claude" {
                None
            } else {
                Some(format!("/usr/bin/{name}"))
            }
        };
        let s = build_status(probe, "powershell", "powershell.exe");
        assert!(!s.claude.found);
        assert!(s.claude.path.is_none());
        assert!(s.git.found);
        assert!(s.gh.found);
        assert_eq!(s.shell_name, "powershell");
    }

    #[test]
    fn status_serializes_camel_case_and_skips_none_path() {
        // Only git present: verifies camelCase `shellName`, nested `found`,
        // and that a missing tool omits the `path` key entirely.
        let probe = |name: &str| {
            if name == "git" {
                Some("/usr/bin/git".to_string())
            } else {
                None
            }
        };
        let s = build_status(probe, "bash", "bash");
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["shellName"], "bash");
        assert_eq!(json["git"]["found"], true);
        assert_eq!(json["git"]["path"], "/usr/bin/git");
        assert_eq!(json["claude"]["found"], false);
        assert!(json["claude"].get("path").is_none());
    }
}
