//! gh-CLI auth helpers (Issue #38).
//!
//! Two concerns live here because both are about *fixing* GitHub auth state:
//!
//! 1. `open_system_terminal` — opens the platform terminal with a fix command
//!    (`gh auth login` / `gh auth refresh …`). These commands are interactive
//!    (OAuth device flow, TTY required), so the app cannot run them headless;
//!    the best it can do is hand the user a ready-to-run terminal.
//!    SECURITY: the frontend never sends a command string. It sends a closed
//!    discriminator that [`fix_command_for`] maps onto `&'static str` literals
//!    (same pattern as the `PermissionMode` enum) — shell injection is
//!    structurally impossible because no user-influenced byte reaches a shell.
//!
//! 2. `check_gh_auth_status` — parses `gh auth status` into a structured
//!    report (logged in, host, account, token scopes) so the Settings
//!    "System" panel can warn about a missing `read:project` scope *before*
//!    the user opens the Kanban board. The parser is pure and fixture-tested;
//!    stdout AND stderr are combined because gh moved this output between
//!    streams across versions (2.x writes to stdout, older wrote to stderr).

use crate::error::ADPError;
use crate::util::silent_command;
use serde::Serialize;

/// Structured result of `gh auth status` for the Settings "System" panel.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GhAuthStatus {
    pub logged_in: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    /// Token scopes as reported by gh (e.g. `repo`, `read:org`). Empty when
    /// logged out or when the output format was not recognized.
    pub scopes: Vec<String>,
    /// True when the token carries `read:project` or `project` — the scopes
    /// the Projects-v2 Kanban board needs.
    pub has_project_scope: bool,
}

/// Closed allowlist: frontend discriminator → fixed command literal.
///
/// The frontend MUST NOT be able to run arbitrary strings in a terminal, so
/// unknown ids return `None` (surfaced as a structured validation error by
/// `open_system_terminal`). New fix commands are a deliberate extension of
/// this match — never an interpolated parameter.
pub(crate) fn fix_command_for(command_id: &str) -> Option<&'static str> {
    match command_id {
        "gh_login" => Some("gh auth login"),
        "gh_refresh_project_scope" => Some("gh auth refresh -s read:project,project"),
        _ => None,
    }
}

/// Scopes that satisfy the Projects-v2 read requirement. `project` (write)
/// implies read access, so both count.
fn is_project_scope(scope: &str) -> bool {
    scope == "read:project" || scope == "project"
}

/// Pure parser for the combined stdout+stderr of `gh auth status`.
///
/// Handles both known formats:
/// - gh ≥ 2.40: `✓ Logged in to github.com account hossoOG (keyring)` with
///   `- Token scopes: 'gist', 'read:org', 'repo'`
/// - older gh:  `✓ Logged in to github.com as hossoOG (oauth_token)` with
///   `✓ Token scopes: gist, read:org, repo`
///
/// `success` is the process exit status (`gh auth status` exits non-zero when
/// no host has a valid login). If the exit code says "logged in" but the text
/// format is unrecognized, we still report `logged_in: true` with empty
/// scopes — the scope warning the UI then shows leads to `gh auth refresh`,
/// which is the correct remedy in that situation anyway.
///
/// Multi-account note: only the FIRST login block is read; gh lists the
/// active account first.
pub(crate) fn parse_gh_auth_status(success: bool, output: &str) -> GhAuthStatus {
    let mut found_login_line = false;
    let mut host: Option<String> = None;
    let mut account: Option<String> = None;
    let mut scopes: Vec<String> = Vec::new();

    for line in output.lines() {
        let trimmed = line.trim();

        if !found_login_line && trimmed.contains("Logged in to") {
            found_login_line = true;
            let mut tokens = trimmed.split_whitespace().peekable();
            while let Some(tok) = tokens.next() {
                match tok {
                    "to" if host.is_none() => {
                        host = tokens.peek().map(|s| s.to_string());
                    }
                    "account" | "as" if account.is_none() => {
                        account = tokens.peek().map(|s| s.to_string());
                    }
                    _ => {}
                }
            }
        }

        if scopes.is_empty() {
            if let Some((_, rest)) = trimmed.split_once("Token scopes:") {
                scopes = rest
                    .split(',')
                    .map(|s| s.trim().trim_matches('\'').trim().to_string())
                    .filter(|s| !s.is_empty() && s != "none")
                    .collect();
            }
        }
    }

    let logged_in = found_login_line || success;
    let has_project_scope = scopes.iter().any(|s| is_project_scope(s));

    GhAuthStatus {
        logged_in,
        host,
        account,
        scopes,
        has_project_scope,
    }
}

/// Spawns the platform terminal running `cmd` (an allowlisted literal).
///
/// Windows: Windows Terminal (`wt`) when on PATH, else a plain `cmd /K`
/// console — both via `start` so the terminal detaches from the app process.
/// macOS: Terminal.app via `osascript do script` (an `open -a Terminal` can
/// only open a folder, not run a command). Safe to embed because allowlisted
/// commands contain no quotes/backslashes (guarded by a unit test below).
/// Linux: best effort via the `x-terminal-emulator` alternatives symlink.
fn spawn_terminal_with(cmd: &str) -> Result<(), ADPError> {
    #[cfg(target_os = "windows")]
    {
        let use_wt = crate::github::commands::is_command_available("wt");
        let mut launcher = silent_command("cmd");
        if use_wt {
            launcher.args(["/C", "start", "", "wt", "cmd", "/K", cmd]);
        } else {
            launcher.args(["/C", "start", "", "cmd", "/K", cmd]);
        }
        launcher
            .spawn()
            .map_err(|e| ADPError::command_failed(format!("Failed to open terminal: {}", e)))?;
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!("tell application \"Terminal\" to do script \"{}\"", cmd);
        silent_command("osascript")
            .args([
                "-e",
                "tell application \"Terminal\" to activate",
                "-e",
                &script,
            ])
            .spawn()
            .map_err(|e| ADPError::command_failed(format!("Failed to open Terminal: {}", e)))?;
    }
    #[cfg(target_os = "linux")]
    {
        silent_command("x-terminal-emulator")
            .args(["-e", "sh", "-c", &format!("{cmd}; exec sh")])
            .spawn()
            .map_err(|e| ADPError::command_failed(format!("Failed to open terminal: {}", e)))?;
    }

    log::info!("Opened system terminal with fix command: {}", cmd);
    Ok(())
}

// Commands im mod-Block wegen rustc E0255-Workaround (siehe CLAUDE.md).
#[allow(clippy::module_inception)]
pub mod commands {
    use super::*;

    /// Opens the system terminal with an allowlisted fix command.
    /// `command_id` is a closed discriminator — unknown values are rejected
    /// with a structured validation error BEFORE anything is spawned.
    #[tauri::command]
    pub async fn open_system_terminal(command_id: String) -> Result<(), ADPError> {
        let cmd = fix_command_for(&command_id).ok_or_else(|| {
            ADPError::validation(format!("Unknown terminal command id: '{}'", command_id))
                .with_details("unknown_command_id")
        })?;
        spawn_terminal_with(cmd)
    }

    /// Reports the gh auth state (logged in, host, account, token scopes) for
    /// the Settings "System" panel. Never passes `--show-token`; the token
    /// itself stays untouched. gh missing on PATH surfaces as the same
    /// structured `gh_missing` error every gh-backed command uses.
    #[tauri::command]
    pub async fn check_gh_auth_status() -> Result<GhAuthStatus, ADPError> {
        crate::github::commands::ensure_gh("gh CLI not found")?;

        let mut cmd = silent_command("gh");
        cmd.args(["auth", "status"])
            .current_dir(std::env::temp_dir());
        let output = crate::util::timed_output(cmd, crate::util::DEFAULT_COMMAND_TIMEOUT)?;

        // gh moved this report between stdout and stderr across versions —
        // combine both so the parser sees it either way.
        let combined = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        Ok(parse_gh_auth_status(output.status.success(), &combined))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Async Tauri-Commands ohne `#[tokio::test]`-Feature via ad-hoc Runtime.
    fn block_on<F: std::future::Future>(fut: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("failed to build tokio runtime")
            .block_on(fut)
    }

    // --- fix_command_for (allowlist) ------------------------------------

    #[test]
    fn allowlist_maps_known_ids_to_exact_literals() {
        assert_eq!(fix_command_for("gh_login"), Some("gh auth login"));
        assert_eq!(
            fix_command_for("gh_refresh_project_scope"),
            Some("gh auth refresh -s read:project,project")
        );
    }

    #[test]
    fn allowlist_rejects_unknown_and_injection_attempts() {
        assert_eq!(fix_command_for(""), None);
        assert_eq!(fix_command_for("rm -rf /"), None);
        assert_eq!(fix_command_for("gh_login; rm -rf /"), None);
        assert_eq!(fix_command_for("gh auth login"), None); // raw command, not an id
        assert_eq!(fix_command_for("GH_LOGIN"), None); // case-sensitive
    }

    #[test]
    fn allowlisted_commands_contain_no_shell_metacharacters() {
        // The macOS path embeds the literal inside an AppleScript string and
        // the Windows path inside a `cmd /K` line. This guard keeps future
        // allowlist additions injection-safe by construction.
        for id in ["gh_login", "gh_refresh_project_scope"] {
            let cmd = fix_command_for(id).unwrap();
            assert!(
                cmd.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | ':' | ',' | '.')),
                "unsafe character in allowlisted command: {cmd}"
            );
        }
    }

    #[test]
    fn open_system_terminal_rejects_unknown_id_with_structured_error() {
        // Unknown discriminator must fail validation BEFORE any spawn happens.
        let err = block_on(commands::open_system_terminal("evil; rm -rf /".into()))
            .expect_err("unknown id must be rejected");
        assert_eq!(err.code, crate::error::ADPErrorCode::SchemaValidationFailed);
        assert_eq!(err.details.as_deref(), Some("unknown_command_id"));
    }

    // --- parse_gh_auth_status fixtures ----------------------------------

    /// Real gh 2.96 output (piped, Windows), scope list WITHOUT read:project.
    const FIXTURE_LOGGED_IN_NO_PROJECT: &str = "github.com\n  \u{2713} Logged in to github.com account hossoOG (keyring)\n  - Active account: true\n  - Git operations protocol: https\n  - Token: gho_************************************\n  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'\n";

    /// Same shape WITH read:project granted.
    const FIXTURE_LOGGED_IN_WITH_PROJECT: &str = "github.com\n  \u{2713} Logged in to github.com account hossoOG (keyring)\n  - Active account: true\n  - Git operations protocol: https\n  - Token: gho_************************************\n  - Token scopes: 'gist', 'read:org', 'read:project', 'repo', 'workflow'\n";

    /// Older gh format: `as <login>`, unquoted scopes, checkmark bullets.
    const FIXTURE_OLD_FORMAT: &str = "github.com\n  \u{2713} Logged in to github.com as hossoOG (oauth_token)\n  \u{2713} Git operations for github.com configured to use https protocol.\n  \u{2713} Token: gho_****\n  \u{2713} Token scopes: gist, read:org, repo\n";

    /// Logged out: gh exits non-zero with this message.
    const FIXTURE_LOGGED_OUT: &str =
        "You are not logged into any GitHub hosts. To log in, run: gh auth login\n";

    #[test]
    fn parse_logged_in_without_project_scope() {
        let s = parse_gh_auth_status(true, FIXTURE_LOGGED_IN_NO_PROJECT);
        assert!(s.logged_in);
        assert_eq!(s.host.as_deref(), Some("github.com"));
        assert_eq!(s.account.as_deref(), Some("hossoOG"));
        assert_eq!(s.scopes, vec!["gist", "read:org", "repo", "workflow"]);
        assert!(!s.has_project_scope, "must flag the missing read:project");
    }

    #[test]
    fn parse_logged_in_with_project_scope() {
        let s = parse_gh_auth_status(true, FIXTURE_LOGGED_IN_WITH_PROJECT);
        assert!(s.logged_in);
        assert!(s.has_project_scope);
        assert!(s.scopes.iter().any(|sc| sc == "read:project"));
    }

    #[test]
    fn parse_write_project_scope_counts_as_project_access() {
        let out = "github.com\n  \u{2713} Logged in to github.com account x (keyring)\n  - Token scopes: 'project', 'repo'\n";
        let s = parse_gh_auth_status(true, out);
        assert!(s.has_project_scope, "'project' (write) implies read access");
    }

    #[test]
    fn parse_old_as_format_and_unquoted_scopes() {
        let s = parse_gh_auth_status(true, FIXTURE_OLD_FORMAT);
        assert!(s.logged_in);
        assert_eq!(s.host.as_deref(), Some("github.com"));
        assert_eq!(s.account.as_deref(), Some("hossoOG"));
        assert_eq!(s.scopes, vec!["gist", "read:org", "repo"]);
        assert!(!s.has_project_scope);
    }

    #[test]
    fn parse_logged_out() {
        let s = parse_gh_auth_status(false, FIXTURE_LOGGED_OUT);
        assert!(!s.logged_in);
        assert_eq!(s.host, None);
        assert_eq!(s.account, None);
        assert!(s.scopes.is_empty());
        assert!(!s.has_project_scope);
    }

    #[test]
    fn parse_empty_output_with_failure_exit_is_logged_out() {
        let s = parse_gh_auth_status(false, "");
        assert!(!s.logged_in);
        assert!(s.scopes.is_empty());
    }

    #[test]
    fn parse_scopes_none_yields_empty_list() {
        let out = "github.com\n  \u{2713} Logged in to github.com account x (keyring)\n  - Token scopes: none\n";
        let s = parse_gh_auth_status(true, out);
        assert!(s.logged_in);
        assert!(s.scopes.is_empty());
        assert!(!s.has_project_scope);
    }

    #[test]
    fn parse_unrecognized_format_trusts_success_exit_code() {
        // A future gh format change must not report a logged-in user as
        // logged out (which would tell them to run gh auth login for nothing).
        let s = parse_gh_auth_status(true, "some future output format");
        assert!(s.logged_in);
        assert!(s.scopes.is_empty());
    }

    #[test]
    fn parse_project_substring_in_other_scope_does_not_count() {
        // Exact token match only — a hypothetical scope merely containing
        // "project" must not satisfy the check.
        let out = "github.com\n  \u{2713} Logged in to github.com account x (keyring)\n  - Token scopes: 'projectx', 'repo'\n";
        let s = parse_gh_auth_status(true, out);
        assert!(!s.has_project_scope);
    }

    #[test]
    fn gh_auth_status_serializes_camel_case() {
        let s = parse_gh_auth_status(true, FIXTURE_LOGGED_IN_NO_PROJECT);
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["loggedIn"], true);
        assert_eq!(json["host"], "github.com");
        assert_eq!(json["account"], "hossoOG");
        assert_eq!(json["hasProjectScope"], false);
        assert!(json["scopes"].as_array().unwrap().len() == 4);
    }

    #[test]
    fn gh_auth_status_omits_none_host_and_account() {
        let s = parse_gh_auth_status(false, FIXTURE_LOGGED_OUT);
        let json = serde_json::to_value(&s).unwrap();
        assert!(json.get("host").is_none());
        assert!(json.get("account").is_none());
        assert_eq!(json["loggedIn"], false);
    }
}
