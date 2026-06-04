use crate::error::{ADPError, ADPErrorCode};
use std::process::{Command, Output, Stdio};
use std::time::Duration;

/// Default timeout for external commands (30 seconds).
pub const DEFAULT_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

/// Creates a Command with hidden console window on Windows.
/// Use this instead of `Command::new()` for any background CLI call
/// to prevent a console window from briefly flashing on screen.
pub fn silent_command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Execute a pre-configured Command with a timeout.
/// Spawns the process, polls `try_wait` in a loop, and kills on timeout.
/// Pipes stdout/stderr automatically so output can be captured.
///
/// stdout and stderr are drained on dedicated threads while we poll, so a
/// child that writes more than the OS pipe buffer (~64 KB) cannot block on
/// `write()` and stall until the timeout — e.g. `git show` of a medium file
/// or a large `gh` JSON response.
pub fn timed_output(mut cmd: Command, timeout: Duration) -> Result<Output, ADPError> {
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| ADPError::command_failed(format!("Failed to spawn command: {}", e)))?;

    // Drain both pipes concurrently. Each thread reads to EOF, which arrives
    // when the child exits (or is killed) and its write ends close.
    fn drain(
        pipe: Option<impl std::io::Read + Send + 'static>,
    ) -> std::thread::JoinHandle<Vec<u8>> {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_end(&mut buf);
            }
            buf
        })
    }
    let stdout_handle = drain(child.stdout.take());
    let stderr_handle = drain(child.stderr.take());

    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = stdout_handle.join().unwrap_or_default();
                let stderr = stderr_handle.join().unwrap_or_default();
                return Ok(Output {
                    status,
                    stdout,
                    stderr,
                });
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait(); // Reap the process
                                          // Killing closes the pipes, so the drain threads unblock.
                    let _ = stdout_handle.join();
                    let _ = stderr_handle.join();
                    return Err(ADPError::new(
                        ADPErrorCode::ServiceTimeout,
                        format!("Command timed out after {}s", timeout.as_secs()),
                    ));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                return Err(ADPError::command_failed(format!(
                    "Error waiting for command: {}",
                    e
                )));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a portable shell command that the host OS can always run.
    fn shell_command(script: &str) -> Command {
        #[cfg(target_os = "windows")]
        {
            let mut cmd = silent_command("cmd");
            cmd.args(["/C", script]);
            cmd
        }
        #[cfg(not(target_os = "windows"))]
        {
            let mut cmd = silent_command("sh");
            cmd.args(["-c", script]);
            cmd
        }
    }

    #[test]
    fn default_timeout_is_thirty_seconds() {
        assert_eq!(DEFAULT_COMMAND_TIMEOUT, Duration::from_secs(30));
    }

    #[test]
    fn silent_command_uses_the_given_program() {
        let cmd = silent_command("git");
        assert_eq!(cmd.get_program(), "git");
    }

    #[test]
    fn timed_output_errors_when_the_program_cannot_be_spawned() {
        let cmd = silent_command("definitely-not-a-real-binary-xyz123");
        let result = timed_output(cmd, Duration::from_secs(5));
        assert!(result.is_err());
    }

    #[test]
    fn timed_output_captures_stdout_of_a_fast_command() {
        let cmd = shell_command("echo hello-from-test");
        let output = timed_output(cmd, Duration::from_secs(10)).unwrap();
        assert!(output.status.success());
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains("hello-from-test"));
    }

    #[test]
    fn timed_output_kills_a_command_that_exceeds_the_timeout() {
        // Spawn the sleeping process DIRECTLY (no shell wrapper). `child.kill()`
        // must terminate the very process that holds the pipe — a surviving
        // grandchild would keep the drain threads blocked until it exits.
        #[cfg(target_os = "windows")]
        let cmd = {
            let mut c = silent_command("ping");
            c.args(["127.0.0.1", "-n", "10"]);
            c
        };
        #[cfg(not(target_os = "windows"))]
        let cmd = {
            let mut c = silent_command("sleep");
            c.arg("10");
            c
        };

        let start = std::time::Instant::now();
        let result = timed_output(cmd, Duration::from_millis(200));
        // Must error out — and do so quickly, not after the full 10s sleep.
        assert!(result.is_err());
        assert!(start.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn timed_output_reports_a_nonzero_exit_status() {
        let cmd = shell_command("exit 3");
        let output = timed_output(cmd, Duration::from_secs(10)).unwrap();
        assert!(!output.status.success());
    }
}
