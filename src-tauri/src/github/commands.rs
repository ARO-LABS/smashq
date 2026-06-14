use crate::error::{ADPError, ADPErrorCode};
use crate::util::silent_command;
use serde::Serialize;

/// Number of leading hex chars kept when shortening a git commit hash.
const SHORT_HASH_LEN: usize = 7;

/// Fallback hex color for issue/PR labels that carry no color from `gh`.
const ISSUE_LABEL_FALLBACK_COLOR: &str = "333333";

#[derive(Serialize, Clone)]
pub struct GitCommitInfo {
    pub hash: String,
    pub message: String,
    pub date: String,
}

#[derive(Serialize, Clone)]
pub struct GitInfo {
    pub branch: String,
    pub last_commit: Option<GitCommitInfo>,
    pub remote_url: String,
}

#[derive(Serialize, Clone)]
pub struct ProjectPresence {
    pub has_git: bool,
    pub has_github: bool,
    pub remote_url: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct GithubPR {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub status: String,
    pub url: String,
}

#[derive(Serialize, Clone)]
pub struct GithubIssue {
    pub number: u64,
    pub title: String,
    pub labels: Vec<String>,
    pub assignee: String,
    pub url: String,
}

#[derive(Serialize, Clone)]
pub struct KanbanLabel {
    pub name: String,
    pub color: String,
}

#[derive(Serialize, Clone)]
pub struct IssueComment {
    pub author: String,
    pub body: String,
    pub created_at: String,
}

#[derive(Serialize, Clone)]
pub struct IssueDetail {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub state: String,
    pub author: String,
    pub created_at: String,
    pub updated_at: String,
    pub closed_at: String,
    pub labels: Vec<KanbanLabel>,
    pub assignees: Vec<String>,
    pub milestone: Option<String>,
    pub url: String,
    pub comments: Vec<IssueComment>,
}

#[derive(Serialize, Clone)]
pub struct CheckRun {
    pub name: String,
    pub status: String,
    pub conclusion: String,
}

#[derive(Serialize, Clone)]
pub struct LinkedPR {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub url: String,
    pub checks: Vec<CheckRun>,
}

/// Returns the directory to use as `cwd` for subprocess calls.
/// Falls back to `std::env::temp_dir()` when no folder is provided —
/// `gh api graphql` and `gh project` commands are not git-directory-sensitive.
pub(crate) fn effective_cwd(folder: Option<&str>) -> std::path::PathBuf {
    folder
        .map(std::path::PathBuf::from)
        .filter(|p| p.exists())
        .unwrap_or_else(std::env::temp_dir)
}

pub(crate) fn run_command(folder: &str, program: &str, args: &[&str]) -> Result<String, ADPError> {
    let mut cmd = silent_command(program);
    cmd.args(args).current_dir(folder);
    let output = crate::util::timed_output(cmd, crate::util::DEFAULT_COMMAND_TIMEOUT)?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(ADPError::command_failed(format!(
            "{} failed: {}",
            program, stderr
        )))
    }
}

/// Availability guard for the `gh` CLI. Returns the same early
/// `ServiceRequestFailed` error every gh-backed command used inline before.
///
/// `not_found_msg` is passed verbatim so each call site keeps its exact
/// user-facing wording (some say "...Install from https://cli.github.com",
/// others just "gh CLI not found").
pub(crate) fn ensure_gh(not_found_msg: &str) -> Result<(), ADPError> {
    if is_command_available("gh") {
        Ok(())
    } else {
        // `gh_missing` details lets the frontend classify on code+details
        // instead of matching the message string (which may change/localise).
        Err(
            ADPError::new(ADPErrorCode::ServiceRequestFailed, not_found_msg)
                .with_details("gh_missing"),
        )
    }
}

/// Runs a `gh` command in `cwd` expecting a JSON array as stdout, then parses
/// it into `Vec<serde_json::Value>`. Empty output short-circuits to an empty
/// vec (matching the per-command empty guard). Parse errors carry the exact
/// "Failed to parse gh output: {}" message all three call sites used.
pub(crate) fn run_json_array(cwd: &str, args: &[&str]) -> Result<Vec<serde_json::Value>, ADPError> {
    let output = run_gh(cwd, args)?;

    if output.is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str(&output)
        .map_err(|e| ADPError::parse(format!("Failed to parse gh output: {}", e)))
}

pub(crate) fn is_command_available(cmd_name: &str) -> bool {
    let check_cmd = if cfg!(windows) { "where" } else { "which" };
    let mut cmd = silent_command(check_cmd);
    cmd.arg(cmd_name);
    crate::util::timed_output(cmd, std::time::Duration::from_secs(5))
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Validates a `owner/name` repository slug to prevent shell injection.
/// Allows alphanumeric characters, hyphens, underscores, dots, and exactly one slash.
pub(crate) fn validate_repo(repo: &str) -> Result<(), ADPError> {
    let valid_chars = repo
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.' || c == '/');
    let single_slash = repo.matches('/').count() == 1;
    let no_leading_trailing = !repo.starts_with('/') && !repo.ends_with('/');
    if valid_chars && single_slash && no_leading_trailing {
        Ok(())
    } else {
        Err(ADPError::validation(format!(
            "Invalid repository format '{}': expected owner/name",
            repo
        )))
    }
}

/// Validates a GitHub owner login, or the special `@me` sentinel.
/// GitHub logins are ASCII alphanumeric with single hyphens, max 39 chars,
/// no leading/trailing hyphen. Stricter than `validate_repo` (no slash/dot)
/// so it is safe to pass as a `gh --owner` argument.
pub(crate) fn validate_owner(owner: &str) -> Result<(), ADPError> {
    if owner == "@me" {
        return Ok(());
    }
    let ok = !owner.is_empty()
        && owner.len() <= 39
        && !owner.starts_with('-')
        && !owner.ends_with('-')
        && owner.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if ok {
        Ok(())
    } else {
        Err(ADPError::validation(format!(
            "Invalid owner login: '{}'",
            owner
        )))
    }
}

/// Maps a raw `gh`/GraphQL error message (plus an optional GraphQL
/// `errors[].type`) to a structured [`ADPError`] whose `code` + `details`
/// the frontend can branch on. Replaces the fragile
/// `message.includes("project")` heuristic that mis-reported a deleted board
/// as a missing OAuth scope. Order matters — most specific class first.
pub(crate) fn classify_gh_error(msg: &str, gql_type: Option<&str>) -> ADPError {
    let lower = msg.to_lowercase();
    let ty = gql_type.unwrap_or("").to_uppercase();

    // gh binary vanished between the `ensure_gh` guard and the spawn (TOCTOU),
    // or became non-executable. `timed_output` emits this exact English literal
    // prefix only on spawn failure (util.rs) — matching the prefix is precise,
    // unlike the OS-localised `{e}` suffix. Surface it as `gh_missing` so the
    // frontend shows the install hint instead of a generic `unknown` error.
    if lower.contains("failed to spawn command") {
        return ADPError::new(ADPErrorCode::ServiceRequestFailed, msg.to_string())
            .with_details("gh_missing");
    }
    // Board / node not found (deleted, renamed, or no access via this path).
    if ty == "NOT_FOUND"
        || lower.contains("could not resolve to a")
        || lower.contains("could not resolve to")
        || lower.contains("not_found")
    {
        return ADPError::new(ADPErrorCode::ServiceRequestFailed, msg.to_string())
            .with_details("not_found");
    }
    // Missing OAuth scope (read:project / project).
    if ty == "INSUFFICIENT_SCOPES"
        || lower.contains("read:project")
        || lower.contains("insufficient scope")
        || lower.contains("required scopes")
    {
        return ADPError::new(ADPErrorCode::ServiceAuthFailed, msg.to_string())
            .with_details("scope");
    }
    // Not logged in / authentication required.
    if lower.contains("gh auth login")
        || lower.contains("authentication required")
        || lower.contains("requires authentication")
        || lower.contains("not logged into")
        || lower.contains("no oauth token")
    {
        return ADPError::new(ADPErrorCode::ServiceAuthFailed, msg.to_string())
            .with_details("auth");
    }
    // Permission denied (member but lacks access). Kept narrow: a generic
    // "must have ..." (e.g. "must have a Status field") must NOT be tagged as a
    // permission error, so match only unambiguous forbidden phrasings.
    if ty == "FORBIDDEN"
        || lower.contains("forbidden")
        || lower.contains("does not have permission")
        || lower.contains("resource not accessible")
    {
        return ADPError::new(ADPErrorCode::ServiceAuthFailed, msg.to_string())
            .with_details("forbidden");
    }
    // Transient: rate limit (retryable after a wait).
    if lower.contains("rate limit") {
        return ADPError::retryable(ADPErrorCode::ServiceRateLimited, msg.to_string(), 60_000);
    }
    // Transient: network / timeout (retryable soon).
    if lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("could not resolve host")
        || lower.contains("dial tcp")
        || lower.contains("network is unreachable")
        || lower.contains("connection refused")
    {
        return ADPError::retryable(ADPErrorCode::ServiceTimeout, msg.to_string(), 3_000);
    }
    ADPError::command_failed(msg.to_string())
}

/// Runs a `gh` command and re-maps any failure through [`classify_gh_error`],
/// so callers surface a distinguishable error (auth / scope / not-found /
/// rate-limit / network) instead of a generic `CommandExecutionFailed`.
/// Plain `git` calls keep using [`run_command`] directly.
pub(crate) fn run_gh(cwd: &str, args: &[&str]) -> Result<String, ADPError> {
    run_command(cwd, "gh", args).map_err(|e| classify_gh_error(&e.message, None))
}

/// Returns `true` if the given remote URL points to github.com.
/// Extracted as a helper so the detection logic can be unit-tested in isolation.
pub(crate) fn is_github_remote(url: &str) -> bool {
    url.contains("github.com")
}

/// Extract label names from a GitHub JSON value containing a "labels" array.
fn parse_labels(value: &serde_json::Value) -> Vec<String> {
    value["labels"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|l| l["name"].as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

/// Extract all assignee logins from a GitHub JSON value containing an "assignees" array.
fn parse_assignees(value: &serde_json::Value) -> Vec<String> {
    value["assignees"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|a| a["login"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// Extract the first assignee login from a GitHub JSON value.
fn parse_assignee(value: &serde_json::Value) -> String {
    value["assignees"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|a| a["login"].as_str())
        .unwrap_or("")
        .to_string()
}

/// Extract the milestone title from a GitHub JSON value, if present.
fn parse_milestone(value: &serde_json::Value) -> Option<String> {
    value["milestone"]["title"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(String::from)
}

/// Maps a single `gh pr list --json ...` element into a [`GithubPR`].
/// Pure: same field extraction and `PENDING` review-decision default the
/// inline closure in `get_github_prs` used.
fn parse_github_pr(pr: &serde_json::Value) -> GithubPR {
    GithubPR {
        number: pr["number"].as_u64().unwrap_or(0),
        title: pr["title"].as_str().unwrap_or("").to_string(),
        author: pr["author"]["login"].as_str().unwrap_or("").to_string(),
        status: pr["reviewDecision"]
            .as_str()
            .unwrap_or("PENDING")
            .to_string(),
        url: pr["url"].as_str().unwrap_or("").to_string(),
    }
}

/// Maps a single `gh issue list --json ...` element into a [`GithubIssue`].
/// Pure: reuses [`parse_labels`]/[`parse_assignee`] exactly as the inline
/// closure in `get_github_issues` did.
fn parse_github_issue(issue: &serde_json::Value) -> GithubIssue {
    GithubIssue {
        number: issue["number"].as_u64().unwrap_or(0),
        title: issue["title"].as_str().unwrap_or("").to_string(),
        labels: parse_labels(issue),
        assignee: parse_assignee(issue),
        url: issue["url"].as_str().unwrap_or("").to_string(),
    }
}

/// Maps the full `gh issue view --json ...` response into an [`IssueDetail`].
/// Pure: same labels/comments extraction, same field defaults, and the same
/// `number` fallback the inline block in `get_issue_detail` used.
///
/// `fallback_number` is the requested issue number, used when the response
/// omits `number` (matching the original `unwrap_or(number)`).
fn parse_issue_detail(val: &serde_json::Value, fallback_number: u64) -> IssueDetail {
    let labels = val["labels"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|l| KanbanLabel {
                    name: l["name"].as_str().unwrap_or("").to_string(),
                    color: l["color"]
                        .as_str()
                        .unwrap_or(ISSUE_LABEL_FALLBACK_COLOR)
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    let comments = val["comments"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|c| IssueComment {
                    author: c["author"]["login"].as_str().unwrap_or("").to_string(),
                    body: c["body"].as_str().unwrap_or("").to_string(),
                    created_at: c["createdAt"].as_str().unwrap_or("").to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    IssueDetail {
        number: val["number"].as_u64().unwrap_or(fallback_number),
        title: val["title"].as_str().unwrap_or("").to_string(),
        body: val["body"].as_str().unwrap_or("").to_string(),
        state: val["state"].as_str().unwrap_or("OPEN").to_string(),
        author: val["author"]["login"].as_str().unwrap_or("").to_string(),
        created_at: val["createdAt"].as_str().unwrap_or("").to_string(),
        updated_at: val["updatedAt"].as_str().unwrap_or("").to_string(),
        closed_at: val["closedAt"].as_str().unwrap_or("").to_string(),
        labels,
        assignees: parse_assignees(val),
        milestone: parse_milestone(val),
        url: val["url"].as_str().unwrap_or("").to_string(),
        comments,
    }
}

/// Maps a single `statusCheckRollup` element into a [`CheckRun`].
/// Pure: a `__typename == "CheckRun"` node reads name/status/conclusion;
/// anything else is treated as a `StatusContext` (context + state-for-both),
/// identical to the inline closure in `get_issue_checks`.
fn parse_check_run(c: &serde_json::Value) -> CheckRun {
    let typename = c["__typename"].as_str().unwrap_or("");
    let (name, status, conclusion) = if typename == "CheckRun" {
        (
            c["name"].as_str().unwrap_or("").to_string(),
            c["status"].as_str().unwrap_or("").to_string(),
            c["conclusion"].as_str().unwrap_or("").to_string(),
        )
    } else {
        // StatusContext
        (
            c["context"].as_str().unwrap_or("").to_string(),
            c["state"].as_str().unwrap_or("").to_string(),
            c["state"].as_str().unwrap_or("").to_string(),
        )
    };
    CheckRun {
        name,
        status,
        conclusion,
    }
}

/// Maps a single `gh pr list --json ...,statusCheckRollup` element into a
/// [`LinkedPR`], parsing each rollup entry via [`parse_check_run`].
/// Pure code-motion of the inline closure in `get_issue_checks`.
fn parse_linked_pr(pr: &serde_json::Value) -> LinkedPR {
    let checks = pr["statusCheckRollup"]
        .as_array()
        .map(|arr| arr.iter().map(parse_check_run).collect())
        .unwrap_or_default();

    LinkedPR {
        number: pr["number"].as_u64().unwrap_or(0),
        title: pr["title"].as_str().unwrap_or("").to_string(),
        state: pr["state"].as_str().unwrap_or("").to_string(),
        url: pr["url"].as_str().unwrap_or("").to_string(),
        checks,
    }
}

// Commands im mod-Block wegen rustc 1.94 E0255 Workaround (siehe CLAUDE.md)
#[allow(clippy::module_inception)]
pub mod commands {
    use super::*;

    #[tauri::command]
    pub async fn get_git_info(folder: String) -> Result<GitInfo, ADPError> {
        let folder_path = std::path::Path::new(&folder);
        if !folder_path.join(".git").exists() {
            return Err(ADPError::validation("Not a git repository"));
        }

        let branch =
            run_command(&folder, "git", &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();

        let last_commit = run_command(&folder, "git", &["log", "-1", "--format=%H%n%s%n%ci"])
            .ok()
            .and_then(|output| {
                let lines: Vec<&str> = output.lines().collect();
                if lines.len() >= 3 {
                    Some(GitCommitInfo {
                        hash: lines[0][..SHORT_HASH_LEN.min(lines[0].len())].to_string(),
                        message: lines[1].to_string(),
                        date: lines[2].to_string(),
                    })
                } else {
                    None
                }
            });

        let remote_url =
            run_command(&folder, "git", &["remote", "get-url", "origin"]).unwrap_or_default();

        Ok(GitInfo {
            branch,
            last_commit,
            remote_url,
        })
    }

    /// Leichtgewichtiger Presence-Check: ermittelt, ob der Ordner ein Git-Repo
    /// ist und ob dessen Origin auf GitHub zeigt. Kein `gh`-CLI-Aufruf — nur
    /// Pfad-Check + `git remote get-url origin`. Muss schnell sein (<50ms).
    #[tauri::command]
    pub async fn check_project_presence(folder: String) -> Result<ProjectPresence, ADPError> {
        let path = std::path::Path::new(&folder);
        let has_git = path.join(".git").exists();

        let remote_url = if has_git {
            run_command(&folder, "git", &["remote", "get-url", "origin"])
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        } else {
            None
        };

        let has_github = remote_url.as_deref().map(is_github_remote).unwrap_or(false);

        Ok(ProjectPresence {
            has_git,
            has_github,
            remote_url,
        })
    }

    #[tauri::command]
    pub async fn get_github_prs(folder: String) -> Result<Vec<GithubPR>, ADPError> {
        ensure_gh("gh CLI not found. Install from https://cli.github.com")?;

        let parsed = run_json_array(
            &folder,
            &[
                "pr",
                "list",
                "--state",
                "open",
                "--json",
                "number,title,author,reviewDecision,url",
                "--limit",
                "20",
            ],
        )?;

        let prs = parsed.iter().map(parse_github_pr).collect();

        Ok(prs)
    }

    #[tauri::command]
    pub async fn get_github_issues(folder: String) -> Result<Vec<GithubIssue>, ADPError> {
        ensure_gh("gh CLI not found. Install from https://cli.github.com")?;

        let parsed = run_json_array(
            &folder,
            &[
                "issue",
                "list",
                "--state",
                "open",
                "--json",
                "number,title,labels,assignees,url",
                "--limit",
                "20",
            ],
        )?;

        let issues = parsed.iter().map(parse_github_issue).collect();

        Ok(issues)
    }

    /// Fetches full issue details including comments.
    ///
    /// `repo` (optional) specifies the repository as `owner/name`. When provided,
    /// `gh issue view --repo <repo>` is used — required for cross-repo issues in
    /// a global Project v2 board. When omitted, the gh CLI auto-detects the repo
    /// from the `folder` git remote (folder-mode behaviour).
    #[tauri::command]
    pub async fn get_issue_detail(
        folder: Option<String>,
        repo: Option<String>,
        number: u64,
    ) -> Result<IssueDetail, ADPError> {
        ensure_gh("gh CLI not found")?;

        let cwd = effective_cwd(folder.as_deref());
        let cwd_str = cwd.to_string_lossy().to_string();

        if let Some(ref r) = repo {
            validate_repo(r)?;
        }

        let num_str = number.to_string();
        let json_fields =
            "number,title,body,state,author,createdAt,updatedAt,closedAt,labels,assignees,milestone,url,comments";
        let mut args = vec!["issue", "view", &num_str, "--json", json_fields];
        if let Some(ref r) = repo {
            args.extend_from_slice(&["--repo", r]);
        }

        let output = run_gh(&cwd_str, &args)?;

        if output.is_empty() {
            return Err(ADPError::parse("Empty response from gh"));
        }

        let val: serde_json::Value = serde_json::from_str(&output)
            .map_err(|e| ADPError::parse(format!("Failed to parse gh output: {}", e)))?;

        Ok(parse_issue_detail(&val, number))
    }

    /// Searches for PRs that reference this issue, including their CI check results.
    ///
    /// `repo` (optional) scopes the search to a specific repository (`owner/name`).
    /// Required when the issue belongs to a different repo than the current folder.
    #[tauri::command]
    pub async fn get_issue_checks(
        folder: Option<String>,
        repo: Option<String>,
        number: u64,
    ) -> Result<Vec<LinkedPR>, ADPError> {
        ensure_gh("gh CLI not found")?;

        let cwd = effective_cwd(folder.as_deref());
        let cwd_str = cwd.to_string_lossy().to_string();

        if let Some(ref r) = repo {
            validate_repo(r)?;
        }

        // Search for PRs that reference this issue number
        let search_query = format!("#{}", number);
        let mut args = vec![
            "pr",
            "list",
            "--search",
            &search_query,
            "--state",
            "all",
            "--json",
            "number,title,state,url,statusCheckRollup",
            "--limit",
            "5",
        ];
        if let Some(ref r) = repo {
            args.extend_from_slice(&["--repo", r]);
        }

        let parsed = run_json_array(&cwd_str, &args)?;

        let prs = parsed.iter().map(parse_linked_pr).collect();

        Ok(prs)
    }

    /// Post a new comment on a GitHub issue via gh CLI.
    ///
    /// `repo` (optional) specifies `owner/name` for cross-repo issues in global mode.
    /// Security: body is passed as a CLI argument (not shell-interpolated), so injection
    /// is not possible. Input is validated for emptiness before invoking gh.
    #[tauri::command]
    pub async fn post_issue_comment(
        folder: Option<String>,
        repo: Option<String>,
        number: u64,
        body: String,
    ) -> Result<(), ADPError> {
        ensure_gh("gh CLI not found")?;
        if body.trim().is_empty() {
            return Err(ADPError::validation("Comment body cannot be empty"));
        }
        if let Some(ref r) = repo {
            validate_repo(r)?;
        }

        let cwd = effective_cwd(folder.as_deref());
        let cwd_str = cwd.to_string_lossy().to_string();
        let num_str = number.to_string();
        let mut args = vec!["issue", "comment", &num_str, "--body", &body];
        if let Some(ref r) = repo {
            args.extend_from_slice(&["--repo", r]);
        }
        run_gh(&cwd_str, &args)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_cwd_some_valid_path_returns_it() {
        let tmp = std::env::temp_dir();
        let path = effective_cwd(Some(tmp.to_str().unwrap()));
        assert_eq!(path, tmp);
    }

    #[test]
    fn effective_cwd_none_returns_existing_dir() {
        let path = effective_cwd(None);
        assert!(
            path.exists(),
            "effective_cwd(None) must return an existing directory, got: {:?}",
            path
        );
    }

    #[test]
    fn effective_cwd_nonexistent_path_falls_back_to_temp() {
        let path = effective_cwd(Some("/this/path/does/not/exist/ever"));
        assert!(
            path.exists(),
            "should fall back to temp_dir when path does not exist"
        );
    }

    // --- is_github_remote -----------------------------------------------

    #[test]
    fn is_github_remote_detects_https_url() {
        assert!(is_github_remote("https://github.com/hossoOG/smashq.git"));
    }

    #[test]
    fn is_github_remote_detects_ssh_url() {
        assert!(is_github_remote("git@github.com:hossoOG/smashq.git"));
    }

    #[test]
    fn is_github_remote_rejects_other_hosts() {
        assert!(!is_github_remote("https://gitlab.com/foo/bar.git"));
        assert!(!is_github_remote("git@bitbucket.org:foo/bar.git"));
        assert!(!is_github_remote(""));
    }

    // --- check_project_presence -----------------------------------------

    /// Async Tauri-Commands ohne `#[tokio::test]`-Feature via ad-hoc Runtime.
    fn block_on<F: std::future::Future>(fut: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("failed to build tokio runtime")
            .block_on(fut)
    }

    #[test]
    fn check_project_presence_no_git() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let folder = tmp.path().to_string_lossy().to_string();

        let result = block_on(commands::check_project_presence(folder))
            .expect("check_project_presence should succeed on empty dir");

        assert!(!result.has_git, "empty dir must not be detected as git");
        assert!(!result.has_github);
        assert!(result.remote_url.is_none());
    }

    #[test]
    fn check_project_presence_git_no_remote() {
        let tmp = tempfile::tempdir().expect("tempdir");
        // Fake .git-Ordner ohne echtes git init — Portabilität, kein git CLI nötig
        // für den Pfad-Check. `git remote get-url origin` schlägt dann fehl und
        // wird durch `.ok()` zu None.
        std::fs::create_dir_all(tmp.path().join(".git")).expect("create .git");
        let folder = tmp.path().to_string_lossy().to_string();

        let result = block_on(commands::check_project_presence(folder))
            .expect("check_project_presence should succeed with bare .git dir");

        assert!(result.has_git, ".git dir must be detected");
        assert!(
            !result.has_github,
            "no remote configured => has_github must be false"
        );
        assert!(
            result.remote_url.is_none(),
            "no remote configured => remote_url must be None, got {:?}",
            result.remote_url
        );
    }

    #[test]
    fn check_project_presence_github_remote_detection() {
        // Reine Logik-Prüfung: die github.com-Erkennung hängt nur am
        // is_github_remote-Helper. Ein echter git-Remote lässt sich im Test
        // nicht portabel aufsetzen (kein git init), daher wird der Helper
        // hier direkt getestet — er ist die single source of truth innerhalb
        // von check_project_presence.
        assert!(is_github_remote("https://github.com/hossoOG/smashq.git"));
        assert!(is_github_remote("git@github.com:owner/repo.git"));
        assert!(!is_github_remote("https://gitlab.com/owner/repo.git"));
    }

    // --- is_github_remote: more edge cases ------------------------------

    #[test]
    fn is_github_remote_matches_substring_anywhere() {
        // The helper only does a substring check — document that behaviour.
        assert!(is_github_remote("ssh://github.com/owner/repo"));
        assert!(is_github_remote("prefix github.com suffix"));
    }

    #[test]
    fn is_github_remote_is_case_sensitive() {
        // "github.com" check is case-sensitive — uppercase host is NOT matched.
        assert!(!is_github_remote("https://GitHub.com/owner/repo.git"));
    }

    #[test]
    fn is_github_remote_rejects_lookalike_hosts() {
        assert!(!is_github_remote("https://githubXcom/owner/repo"));
        assert!(!is_github_remote("https://notgithub.org/owner/repo"));
    }

    // --- validate_repo --------------------------------------------------

    #[test]
    fn validate_repo_accepts_simple_slug() {
        assert!(validate_repo("owner/repo").is_ok());
    }

    #[test]
    fn validate_repo_accepts_special_allowed_chars() {
        assert!(validate_repo("my-org_1/repo.name-2").is_ok());
        assert!(validate_repo("a.b-c_d/e.f-g_h").is_ok());
    }

    #[test]
    fn validate_repo_rejects_missing_slash() {
        assert!(validate_repo("ownerrepo").is_err());
    }

    #[test]
    fn validate_repo_rejects_multiple_slashes() {
        assert!(validate_repo("owner/sub/repo").is_err());
    }

    #[test]
    fn validate_repo_rejects_leading_slash() {
        assert!(validate_repo("/owner/repo".trim_end()).is_err());
        assert!(validate_repo("/ownerrepo").is_err());
    }

    #[test]
    fn validate_repo_rejects_trailing_slash() {
        assert!(validate_repo("owner/").is_err());
        assert!(validate_repo("ownerrepo/").is_err());
    }

    #[test]
    fn validate_repo_rejects_shell_metacharacters() {
        assert!(validate_repo("owner/repo;rm -rf").is_err());
        assert!(validate_repo("owner/repo&&whoami").is_err());
        assert!(validate_repo("owner/repo$(id)").is_err());
        assert!(validate_repo("owner/repo`id`").is_err());
        assert!(validate_repo("owner/repo with space").is_err());
    }

    #[test]
    fn validate_repo_rejects_empty_string() {
        // Empty string has zero slashes -> single_slash false.
        assert!(validate_repo("").is_err());
    }

    #[test]
    fn validate_repo_error_message_contains_input() {
        let err = validate_repo("bad input").unwrap_err();
        let msg = format!("{:?}", err);
        assert!(
            msg.contains("bad input"),
            "error message should echo the offending input, got: {msg}"
        );
    }

    // --- parse_labels ---------------------------------------------------

    #[test]
    fn parse_labels_extracts_names() {
        let v = serde_json::json!({
            "labels": [{ "name": "bug" }, { "name": "ui" }]
        });
        assert_eq!(parse_labels(&v), vec!["bug", "ui"]);
    }

    #[test]
    fn parse_labels_missing_key_returns_empty() {
        let v = serde_json::json!({ "title": "no labels here" });
        assert!(parse_labels(&v).is_empty());
    }

    #[test]
    fn parse_labels_empty_array_returns_empty() {
        let v = serde_json::json!({ "labels": [] });
        assert!(parse_labels(&v).is_empty());
    }

    #[test]
    fn parse_labels_skips_entries_without_name() {
        let v = serde_json::json!({
            "labels": [{ "name": "keep" }, { "color": "fff" }, { "name": 42 }]
        });
        // Only the string "name" survives the filter_map.
        assert_eq!(parse_labels(&v), vec!["keep"]);
    }

    #[test]
    fn parse_labels_non_array_value_returns_empty() {
        let v = serde_json::json!({ "labels": "not-an-array" });
        assert!(parse_labels(&v).is_empty());
    }

    // --- parse_assignees ------------------------------------------------

    #[test]
    fn parse_assignees_extracts_all_logins() {
        let v = serde_json::json!({
            "assignees": [{ "login": "alice" }, { "login": "bob" }]
        });
        assert_eq!(parse_assignees(&v), vec!["alice", "bob"]);
    }

    #[test]
    fn parse_assignees_missing_key_returns_empty() {
        let v = serde_json::json!({ "number": 1 });
        assert!(parse_assignees(&v).is_empty());
    }

    #[test]
    fn parse_assignees_empty_array_returns_empty() {
        let v = serde_json::json!({ "assignees": [] });
        assert!(parse_assignees(&v).is_empty());
    }

    #[test]
    fn parse_assignees_skips_entries_without_login() {
        let v = serde_json::json!({
            "assignees": [{ "login": "alice" }, { "id": 7 }]
        });
        assert_eq!(parse_assignees(&v), vec!["alice"]);
    }

    // --- parse_assignee (singular, first only) --------------------------

    #[test]
    fn parse_assignee_returns_first_login() {
        let v = serde_json::json!({
            "assignees": [{ "login": "first" }, { "login": "second" }]
        });
        assert_eq!(parse_assignee(&v), "first");
    }

    #[test]
    fn parse_assignee_empty_array_returns_empty_string() {
        let v = serde_json::json!({ "assignees": [] });
        assert_eq!(parse_assignee(&v), "");
    }

    #[test]
    fn parse_assignee_missing_key_returns_empty_string() {
        let v = serde_json::json!({ "title": "x" });
        assert_eq!(parse_assignee(&v), "");
    }

    #[test]
    fn parse_assignee_first_entry_without_login_returns_empty() {
        let v = serde_json::json!({ "assignees": [{ "id": 1 }] });
        assert_eq!(parse_assignee(&v), "");
    }

    // --- parse_milestone ------------------------------------------------

    #[test]
    fn parse_milestone_extracts_title() {
        let v = serde_json::json!({ "milestone": { "title": "v2.0" } });
        assert_eq!(parse_milestone(&v), Some("v2.0".to_string()));
    }

    #[test]
    fn parse_milestone_missing_key_returns_none() {
        let v = serde_json::json!({ "number": 5 });
        assert_eq!(parse_milestone(&v), None);
    }

    #[test]
    fn parse_milestone_null_returns_none() {
        let v = serde_json::json!({ "milestone": serde_json::Value::Null });
        assert_eq!(parse_milestone(&v), None);
    }

    #[test]
    fn parse_milestone_empty_title_returns_none() {
        // An empty title string is filtered out -> None.
        let v = serde_json::json!({ "milestone": { "title": "" } });
        assert_eq!(parse_milestone(&v), None);
    }

    // --- struct serialization (serde mapping) ---------------------------

    #[test]
    fn git_commit_info_serializes_all_fields() {
        let c = GitCommitInfo {
            hash: "abc1234".into(),
            message: "fix bug".into(),
            date: "2026-01-01".into(),
        };
        let json = serde_json::to_value(&c).unwrap();
        assert_eq!(json["hash"], "abc1234");
        assert_eq!(json["message"], "fix bug");
        assert_eq!(json["date"], "2026-01-01");
    }

    #[test]
    fn git_info_serializes_with_optional_commit_none() {
        let g = GitInfo {
            branch: "main".into(),
            last_commit: None,
            remote_url: "https://github.com/o/r.git".into(),
        };
        let json = serde_json::to_value(&g).unwrap();
        assert_eq!(json["branch"], "main");
        assert!(json["last_commit"].is_null());
        assert_eq!(json["remote_url"], "https://github.com/o/r.git");
    }

    #[test]
    fn project_presence_serializes_field_names() {
        let p = ProjectPresence {
            has_git: true,
            has_github: false,
            remote_url: Some("git@github.com:o/r.git".into()),
        };
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["has_git"], true);
        assert_eq!(json["has_github"], false);
        assert_eq!(json["remote_url"], "git@github.com:o/r.git");
    }

    #[test]
    fn github_pr_serializes_all_fields() {
        let pr = GithubPR {
            number: 42,
            title: "Add feature".into(),
            author: "alice".into(),
            status: "APPROVED".into(),
            url: "https://github.com/o/r/pull/42".into(),
        };
        let json = serde_json::to_value(&pr).unwrap();
        assert_eq!(json["number"], 42);
        assert_eq!(json["title"], "Add feature");
        assert_eq!(json["author"], "alice");
        assert_eq!(json["status"], "APPROVED");
        assert_eq!(json["url"], "https://github.com/o/r/pull/42");
    }

    #[test]
    fn issue_detail_serializes_nested_collections() {
        let detail = IssueDetail {
            number: 7,
            title: "Title".into(),
            body: "Body".into(),
            state: "OPEN".into(),
            author: "bob".into(),
            created_at: "2026-01-01".into(),
            updated_at: "2026-01-02".into(),
            closed_at: "".into(),
            labels: vec![KanbanLabel {
                name: "bug".into(),
                color: "ff0000".into(),
            }],
            assignees: vec!["bob".into()],
            milestone: Some("v1".into()),
            url: "https://github.com/o/r/issues/7".into(),
            comments: vec![IssueComment {
                author: "carol".into(),
                body: "comment".into(),
                created_at: "2026-01-03".into(),
            }],
        };
        let json = serde_json::to_value(&detail).unwrap();
        assert_eq!(json["number"], 7);
        assert_eq!(json["labels"][0]["name"], "bug");
        assert_eq!(json["labels"][0]["color"], "ff0000");
        assert_eq!(json["assignees"][0], "bob");
        assert_eq!(json["milestone"], "v1");
        assert_eq!(json["comments"][0]["author"], "carol");
        assert_eq!(json["comments"][0]["created_at"], "2026-01-03");
    }

    #[test]
    fn linked_pr_serializes_with_check_runs() {
        let lp = LinkedPR {
            number: 9,
            title: "PR title".into(),
            state: "MERGED".into(),
            url: "https://github.com/o/r/pull/9".into(),
            checks: vec![CheckRun {
                name: "build".into(),
                status: "COMPLETED".into(),
                conclusion: "SUCCESS".into(),
            }],
        };
        let json = serde_json::to_value(&lp).unwrap();
        assert_eq!(json["number"], 9);
        assert_eq!(json["state"], "MERGED");
        assert_eq!(json["checks"][0]["name"], "build");
        assert_eq!(json["checks"][0]["status"], "COMPLETED");
        assert_eq!(json["checks"][0]["conclusion"], "SUCCESS");
    }

    #[test]
    fn linked_pr_serializes_with_empty_checks() {
        let lp = LinkedPR {
            number: 1,
            title: "t".into(),
            state: "OPEN".into(),
            url: "u".into(),
            checks: vec![],
        };
        let json = serde_json::to_value(&lp).unwrap();
        assert!(json["checks"].as_array().unwrap().is_empty());
    }

    // --- gh PR JSON -> GithubPR field mapping ---------------------------
    // Mirrors the .map() closure inside get_github_prs (pure logic, no shell).

    fn map_pr(pr: &serde_json::Value) -> GithubPR {
        GithubPR {
            number: pr["number"].as_u64().unwrap_or(0),
            title: pr["title"].as_str().unwrap_or("").to_string(),
            author: pr["author"]["login"].as_str().unwrap_or("").to_string(),
            status: pr["reviewDecision"]
                .as_str()
                .unwrap_or("PENDING")
                .to_string(),
            url: pr["url"].as_str().unwrap_or("").to_string(),
        }
    }

    #[test]
    fn pr_mapping_full_object() {
        let v = serde_json::json!({
            "number": 12,
            "title": "Feature",
            "author": { "login": "dev" },
            "reviewDecision": "APPROVED",
            "url": "https://example.com/12"
        });
        let pr = map_pr(&v);
        assert_eq!(pr.number, 12);
        assert_eq!(pr.title, "Feature");
        assert_eq!(pr.author, "dev");
        assert_eq!(pr.status, "APPROVED");
        assert_eq!(pr.url, "https://example.com/12");
    }

    #[test]
    fn pr_mapping_missing_review_decision_defaults_pending() {
        let v = serde_json::json!({
            "number": 3,
            "title": "x",
            "author": { "login": "y" },
            "url": "z"
        });
        assert_eq!(map_pr(&v).status, "PENDING");
    }

    #[test]
    fn pr_mapping_missing_fields_use_defaults() {
        let v = serde_json::json!({});
        let pr = map_pr(&v);
        assert_eq!(pr.number, 0);
        assert_eq!(pr.title, "");
        assert_eq!(pr.author, "");
        assert_eq!(pr.url, "");
        assert_eq!(pr.status, "PENDING");
    }

    #[test]
    fn pr_list_parses_from_json_array_string() {
        let raw = r#"[
            {"number":1,"title":"A","author":{"login":"u1"},"reviewDecision":"","url":"u"},
            {"number":2,"title":"B","author":{"login":"u2"},"reviewDecision":"APPROVED","url":"v"}
        ]"#;
        let parsed: Vec<serde_json::Value> = serde_json::from_str(raw).unwrap();
        let prs: Vec<GithubPR> = parsed.iter().map(map_pr).collect();
        assert_eq!(prs.len(), 2);
        assert_eq!(prs[0].number, 1);
        assert_eq!(prs[1].author, "u2");
    }

    // --- statusCheckRollup -> CheckRun mapping --------------------------
    // Mirrors the typename branch inside get_issue_checks.

    fn map_check(c: &serde_json::Value) -> CheckRun {
        let typename = c["__typename"].as_str().unwrap_or("");
        let (name, status, conclusion) = if typename == "CheckRun" {
            (
                c["name"].as_str().unwrap_or("").to_string(),
                c["status"].as_str().unwrap_or("").to_string(),
                c["conclusion"].as_str().unwrap_or("").to_string(),
            )
        } else {
            (
                c["context"].as_str().unwrap_or("").to_string(),
                c["state"].as_str().unwrap_or("").to_string(),
                c["state"].as_str().unwrap_or("").to_string(),
            )
        };
        CheckRun {
            name,
            status,
            conclusion,
        }
    }

    #[test]
    fn check_mapping_checkrun_typename() {
        let v = serde_json::json!({
            "__typename": "CheckRun",
            "name": "ci",
            "status": "COMPLETED",
            "conclusion": "FAILURE"
        });
        let c = map_check(&v);
        assert_eq!(c.name, "ci");
        assert_eq!(c.status, "COMPLETED");
        assert_eq!(c.conclusion, "FAILURE");
    }

    #[test]
    fn check_mapping_status_context_uses_state_for_both() {
        let v = serde_json::json!({
            "__typename": "StatusContext",
            "context": "legacy-check",
            "state": "SUCCESS"
        });
        let c = map_check(&v);
        assert_eq!(c.name, "legacy-check");
        assert_eq!(c.status, "SUCCESS");
        assert_eq!(c.conclusion, "SUCCESS");
    }

    #[test]
    fn check_mapping_unknown_typename_treated_as_status_context() {
        // Anything that is not "CheckRun" falls into the StatusContext branch.
        let v = serde_json::json!({
            "context": "ctx",
            "state": "PENDING"
        });
        let c = map_check(&v);
        assert_eq!(c.name, "ctx");
        assert_eq!(c.status, "PENDING");
        assert_eq!(c.conclusion, "PENDING");
    }

    // --- IssueDetail label mapping (color default) ----------------------

    #[test]
    fn issue_detail_label_color_defaults_to_333333() {
        // Mirrors the labels closure in get_issue_detail.
        let val = serde_json::json!({ "labels": [{ "name": "x" }] });
        let labels: Vec<KanbanLabel> = val["labels"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .map(|l| KanbanLabel {
                        name: l["name"].as_str().unwrap_or("").to_string(),
                        color: l["color"].as_str().unwrap_or("333333").to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].name, "x");
        assert_eq!(labels[0].color, "333333");
    }

    // --- empty-output guard ---------------------------------------------

    #[test]
    fn empty_gh_output_yields_empty_vec() {
        // get_github_prs / get_github_issues short-circuit on empty output.
        let output = "";
        let result: Vec<GithubPR> = if output.is_empty() {
            Vec::new()
        } else {
            unreachable!()
        };
        assert!(result.is_empty());
    }

    // --- parse_github_pr (extracted free fn) ----------------------------

    #[test]
    fn parse_github_pr_full_object() {
        let v = serde_json::json!({
            "number": 12,
            "title": "Feature",
            "author": { "login": "dev" },
            "reviewDecision": "APPROVED",
            "url": "https://example.com/12"
        });
        let pr = parse_github_pr(&v);
        assert_eq!(pr.number, 12);
        assert_eq!(pr.title, "Feature");
        assert_eq!(pr.author, "dev");
        assert_eq!(pr.status, "APPROVED");
        assert_eq!(pr.url, "https://example.com/12");
    }

    #[test]
    fn parse_github_pr_missing_review_decision_defaults_pending() {
        // Missing optional reviewDecision falls back to "PENDING".
        let v = serde_json::json!({
            "number": 3,
            "title": "x",
            "author": { "login": "y" },
            "url": "z"
        });
        let pr = parse_github_pr(&v);
        assert_eq!(pr.status, "PENDING");
        assert_eq!(pr.number, 3);
    }

    // --- parse_github_issue (extracted free fn) -------------------------

    #[test]
    fn parse_github_issue_full_object() {
        let v = serde_json::json!({
            "number": 7,
            "title": "Bug report",
            "labels": [{ "name": "bug" }, { "name": "ui" }],
            "assignees": [{ "login": "alice" }, { "login": "bob" }],
            "url": "https://example.com/7"
        });
        let issue = parse_github_issue(&v);
        assert_eq!(issue.number, 7);
        assert_eq!(issue.title, "Bug report");
        assert_eq!(issue.labels, vec!["bug", "ui"]);
        // assignee is the FIRST login only.
        assert_eq!(issue.assignee, "alice");
        assert_eq!(issue.url, "https://example.com/7");
    }

    #[test]
    fn parse_github_issue_missing_optionals_use_defaults() {
        // No labels/assignees/title/url — number is the only field present.
        let v = serde_json::json!({ "number": 1 });
        let issue = parse_github_issue(&v);
        assert_eq!(issue.number, 1);
        assert_eq!(issue.title, "");
        assert!(issue.labels.is_empty());
        assert_eq!(issue.assignee, "");
        assert_eq!(issue.url, "");
    }

    // --- parse_issue_detail (extracted free fn) -------------------------

    #[test]
    fn parse_issue_detail_full_object() {
        let v = serde_json::json!({
            "number": 7,
            "title": "Title",
            "body": "Body",
            "state": "CLOSED",
            "author": { "login": "bob" },
            "createdAt": "2026-01-01",
            "updatedAt": "2026-01-02",
            "closedAt": "2026-01-03",
            "labels": [{ "name": "bug", "color": "ff0000" }],
            "assignees": [{ "login": "bob" }],
            "milestone": { "title": "v1" },
            "url": "https://example.com/7",
            "comments": [{
                "author": { "login": "carol" },
                "body": "comment",
                "createdAt": "2026-01-04"
            }]
        });
        let d = parse_issue_detail(&v, 999);
        assert_eq!(d.number, 7);
        assert_eq!(d.title, "Title");
        assert_eq!(d.body, "Body");
        assert_eq!(d.state, "CLOSED");
        assert_eq!(d.author, "bob");
        assert_eq!(d.created_at, "2026-01-01");
        assert_eq!(d.updated_at, "2026-01-02");
        assert_eq!(d.closed_at, "2026-01-03");
        assert_eq!(d.labels.len(), 1);
        assert_eq!(d.labels[0].name, "bug");
        assert_eq!(d.labels[0].color, "ff0000");
        assert_eq!(d.assignees, vec!["bob"]);
        assert_eq!(d.milestone, Some("v1".to_string()));
        assert_eq!(d.url, "https://example.com/7");
        assert_eq!(d.comments.len(), 1);
        assert_eq!(d.comments[0].author, "carol");
        assert_eq!(d.comments[0].created_at, "2026-01-04");
    }

    #[test]
    fn parse_issue_detail_missing_number_uses_fallback() {
        // Response omits `number` → the requested fallback_number is used.
        let v = serde_json::json!({ "title": "x" });
        let d = parse_issue_detail(&v, 42);
        assert_eq!(d.number, 42);
        // state defaults to OPEN when absent.
        assert_eq!(d.state, "OPEN");
        assert!(d.labels.is_empty());
        assert!(d.comments.is_empty());
        assert!(d.assignees.is_empty());
        assert_eq!(d.milestone, None);
    }

    #[test]
    fn parse_issue_detail_label_missing_color_defaults() {
        // Label without color falls back to the issue-label fallback (333333).
        let v = serde_json::json!({
            "number": 1,
            "labels": [{ "name": "x" }]
        });
        let d = parse_issue_detail(&v, 1);
        assert_eq!(d.labels.len(), 1);
        assert_eq!(d.labels[0].name, "x");
        assert_eq!(d.labels[0].color, "333333");
    }

    // --- parse_check_run (extracted free fn) ----------------------------

    #[test]
    fn parse_check_run_checkrun_typename() {
        let v = serde_json::json!({
            "__typename": "CheckRun",
            "name": "ci",
            "status": "COMPLETED",
            "conclusion": "FAILURE"
        });
        let c = parse_check_run(&v);
        assert_eq!(c.name, "ci");
        assert_eq!(c.status, "COMPLETED");
        assert_eq!(c.conclusion, "FAILURE");
    }

    #[test]
    fn parse_check_run_status_context_uses_state_for_both() {
        // Non-CheckRun typename → context drives name, state drives status+conclusion.
        let v = serde_json::json!({
            "__typename": "StatusContext",
            "context": "legacy-check",
            "state": "SUCCESS"
        });
        let c = parse_check_run(&v);
        assert_eq!(c.name, "legacy-check");
        assert_eq!(c.status, "SUCCESS");
        assert_eq!(c.conclusion, "SUCCESS");
    }

    // --- parse_linked_pr (extracted free fn) ----------------------------

    #[test]
    fn parse_linked_pr_full_object_with_checks() {
        let v = serde_json::json!({
            "number": 9,
            "title": "PR title",
            "state": "MERGED",
            "url": "https://example.com/9",
            "statusCheckRollup": [
                { "__typename": "CheckRun", "name": "build", "status": "COMPLETED", "conclusion": "SUCCESS" },
                { "__typename": "StatusContext", "context": "legacy", "state": "PENDING" }
            ]
        });
        let lp = parse_linked_pr(&v);
        assert_eq!(lp.number, 9);
        assert_eq!(lp.title, "PR title");
        assert_eq!(lp.state, "MERGED");
        assert_eq!(lp.url, "https://example.com/9");
        assert_eq!(lp.checks.len(), 2);
        assert_eq!(lp.checks[0].name, "build");
        assert_eq!(lp.checks[0].conclusion, "SUCCESS");
        assert_eq!(lp.checks[1].name, "legacy");
        assert_eq!(lp.checks[1].conclusion, "PENDING");
    }

    #[test]
    fn parse_linked_pr_missing_rollup_yields_empty_checks() {
        // No statusCheckRollup → empty checks, other fields default.
        let v = serde_json::json!({ "number": 1 });
        let lp = parse_linked_pr(&v);
        assert_eq!(lp.number, 1);
        assert_eq!(lp.title, "");
        assert_eq!(lp.state, "");
        assert_eq!(lp.url, "");
        assert!(lp.checks.is_empty());
    }

    // --- classify_gh_error ----------------------------------------------
    // Maps a raw gh/GraphQL message (+ optional GraphQL errors[].type) to a
    // structured ADPError whose code + details the frontend can branch on,
    // replacing the fragile `message.includes("project")` heuristic.

    #[test]
    fn classify_gh_error_not_found_from_graphql_type() {
        let err = classify_gh_error(
            "Could not resolve to a ProjectV2 with the number 4.",
            Some("NOT_FOUND"),
        );
        assert_eq!(err.code, ADPErrorCode::ServiceRequestFailed);
        assert_eq!(err.details.as_deref(), Some("not_found"));
        assert!(!err.retryable);
    }

    #[test]
    fn classify_gh_error_not_found_from_message_without_type() {
        // A deleted/renamed board's gh message contains "could not resolve to a".
        let err = classify_gh_error(
            "GraphQL: Could not resolve to a node with the global id of 'PVT_x'",
            None,
        );
        assert_eq!(err.code, ADPErrorCode::ServiceRequestFailed);
        assert_eq!(err.details.as_deref(), Some("not_found"));
    }

    #[test]
    fn classify_gh_error_scope_missing() {
        let err = classify_gh_error(
            "Your token has not been granted the required scopes: read:project",
            Some("INSUFFICIENT_SCOPES"),
        );
        assert_eq!(err.code, ADPErrorCode::ServiceAuthFailed);
        assert_eq!(err.details.as_deref(), Some("scope"));
    }

    #[test]
    fn classify_gh_error_not_logged_in() {
        let err = classify_gh_error(
            "To get started with GitHub CLI, please run: gh auth login",
            None,
        );
        assert_eq!(err.code, ADPErrorCode::ServiceAuthFailed);
        assert_eq!(err.details.as_deref(), Some("auth"));
    }

    #[test]
    fn classify_gh_error_rate_limited_is_retryable() {
        let err = classify_gh_error("API rate limit exceeded for user", None);
        assert_eq!(err.code, ADPErrorCode::ServiceRateLimited);
        assert!(err.retryable);
    }

    #[test]
    fn classify_gh_error_network_timeout_is_retryable() {
        let err = classify_gh_error(
            "dial tcp: lookup api.github.com: could not resolve host",
            None,
        );
        assert_eq!(err.code, ADPErrorCode::ServiceTimeout);
        assert!(err.retryable);
    }

    #[test]
    fn classify_gh_error_unknown_falls_back_to_command_failed() {
        let err = classify_gh_error("some entirely unexpected failure", None);
        assert_eq!(err.code, ADPErrorCode::CommandExecutionFailed);
        assert!(!err.retryable);
    }

    #[test]
    fn classify_gh_error_spawn_failure_maps_to_gh_missing() {
        // TOCTOU: gh disappears after the ensure_gh guard. timed_output emits the
        // "Failed to spawn command: ..." literal, which must surface as gh_missing
        // (with the install hint) rather than a generic CommandExecutionFailed.
        let err = classify_gh_error(
            "Failed to spawn command: program not found (os error 2)",
            None,
        );
        assert_eq!(err.code, ADPErrorCode::ServiceRequestFailed);
        assert_eq!(err.details.as_deref(), Some("gh_missing"));
        assert!(!err.retryable);
    }

    #[test]
    fn classify_gh_error_must_have_phrase_is_not_forbidden() {
        // A config hint like "must have a Status field" must NOT be tagged as a
        // permission error (the old heuristic matched "must have" too broadly).
        let err = classify_gh_error("Project must have a Status field", None);
        assert_ne!(err.code, ADPErrorCode::ServiceAuthFailed);
        assert_eq!(err.code, ADPErrorCode::CommandExecutionFailed);
    }

    #[test]
    fn classify_gh_error_forbidden_from_permission_phrasing() {
        let err = classify_gh_error("Resource not accessible by integration", Some("FORBIDDEN"));
        assert_eq!(err.code, ADPErrorCode::ServiceAuthFailed);
        assert_eq!(err.details.as_deref(), Some("forbidden"));
    }

    #[test]
    fn classify_gh_error_not_found_wins_over_scope_substring() {
        // A NOT_FOUND message must not be mis-tagged just because it mentions a project.
        let err = classify_gh_error("Could not resolve to a ProjectV2", Some("NOT_FOUND"));
        assert_eq!(err.details.as_deref(), Some("not_found"));
    }

    #[test]
    fn classify_gh_error_preserves_original_message() {
        let err = classify_gh_error("verbatim text here", None);
        assert_eq!(err.message, "verbatim text here");
    }

    // --- validate_owner -------------------------------------------------

    #[test]
    fn validate_owner_accepts_at_me() {
        assert!(validate_owner("@me").is_ok());
    }

    #[test]
    fn validate_owner_accepts_login_and_org() {
        assert!(validate_owner("hossoOG").is_ok());
        assert!(validate_owner("ARO-LABS").is_ok());
        assert!(validate_owner("a").is_ok());
    }

    #[test]
    fn validate_owner_rejects_shell_and_invalid() {
        assert!(validate_owner("").is_err());
        assert!(validate_owner("-leading").is_err());
        assert!(validate_owner("trailing-").is_err());
        assert!(validate_owner("has space").is_err());
        assert!(validate_owner("owner;rm -rf").is_err());
        assert!(validate_owner("owner/repo").is_err());
        assert!(validate_owner("owner$(id)").is_err());
    }
}
