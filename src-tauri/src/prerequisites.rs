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

/// Host OS family + CPU architecture for the Settings "About" panel. Values are
/// `std::env::consts` compile-time facts — a desktop bundle is built per target,
/// so they accurately describe the running binary. Intentionally no OS *version*
/// number (that would need an extra crate); the About panel shows family + arch.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsInfo {
    pub os: String,
    pub arch: String,
}

/// Map `std::env::consts::OS` to a human label; unknown values pass through.
fn display_os(os: &str) -> String {
    match os {
        "macos" => "macOS",
        "windows" => "Windows",
        "linux" => "Linux",
        other => other,
    }
    .to_string()
}

/// Map `std::env::consts::ARCH` to a human label; unknown values pass through.
fn display_arch(arch: &str) -> String {
    match arch {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    }
    .to_string()
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

    /// Host OS family + CPU architecture for the Settings "About" panel.
    /// Pure compile-time facts — no side effects, no PATH probing.
    #[tauri::command]
    pub fn get_os_info() -> OsInfo {
        OsInfo {
            os: display_os(std::env::consts::OS),
            arch: display_arch(std::env::consts::ARCH),
        }
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

    #[test]
    fn display_os_maps_known_targets() {
        assert_eq!(display_os("macos"), "macOS");
        assert_eq!(display_os("windows"), "Windows");
        assert_eq!(display_os("linux"), "Linux");
    }

    #[test]
    fn display_os_passes_through_unknown() {
        assert_eq!(display_os("freebsd"), "freebsd");
    }

    #[test]
    fn display_arch_maps_known_targets() {
        assert_eq!(display_arch("aarch64"), "arm64");
        assert_eq!(display_arch("x86_64"), "x64");
    }

    #[test]
    fn display_arch_passes_through_unknown() {
        assert_eq!(display_arch("riscv64"), "riscv64");
    }

    #[test]
    fn os_info_is_non_empty_and_serializes_camel_case() {
        let info = commands::get_os_info();
        assert!(!info.os.is_empty());
        assert!(!info.arch.is_empty());
        let json = serde_json::to_value(&info).unwrap();
        assert!(json.get("os").is_some());
        assert!(json.get("arch").is_some());
    }
}
