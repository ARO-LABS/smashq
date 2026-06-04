// src-tauri/src/session/worktree.rs
//
// Git worktree scanning. Relocated here from the removed `agent_detector`
// module — the dead agent-detection feature was deleted, but the worktree
// scanner is live (consumed by the WorktreeViewer config-panel tab via the
// `scan_worktrees` Tauri command).

/// Worktree scan result — one entry per git worktree.
#[derive(Clone, Debug, serde::Serialize)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub is_main: bool,
}

/// Scan a project folder for git worktrees.
/// Uses `git worktree list --porcelain` for reliable parsing.
pub fn scan_worktrees_in_folder(folder: &str) -> Result<Vec<WorktreeInfo>, crate::error::ADPError> {
    let mut cmd = crate::util::silent_command("git");
    cmd.args(["worktree", "list", "--porcelain"])
        .current_dir(folder);
    let output = crate::util::timed_output(cmd, crate::util::DEFAULT_COMMAND_TIMEOUT)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(crate::error::ADPError::command_failed(format!(
            "git worktree list failed: {}",
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut worktrees = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_branch: Option<String> = None;
    let mut is_bare = false;

    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("worktree ") {
            if let Some(path) = current_path.take() {
                if !is_bare {
                    worktrees.push(WorktreeInfo {
                        path,
                        branch: current_branch.take(),
                        is_main: worktrees.is_empty(),
                    });
                }
            }
            current_path = Some(rest.to_string());
            current_branch = None;
            is_bare = false;
        } else if let Some(rest) = line.strip_prefix("branch ") {
            let branch = rest.to_string();
            current_branch = Some(branch.replace("refs/heads/", ""));
        } else if line == "bare" {
            is_bare = true;
        }
    }

    if let Some(path) = current_path {
        if !is_bare {
            worktrees.push(WorktreeInfo {
                path,
                branch: current_branch,
                is_main: worktrees.is_empty(),
            });
        }
    }

    Ok(worktrees)
}
