//! Windows Job Object wrapper for crash-safe session cleanup.
//!
//! Wenn die App sauber via X-Button geschlossen wird, läuft der
//! CloseRequested-Handler in `lib.rs` durch und ruft `close_session()`
//! für jede aktive Session — kein Job-Object nötig. Crashed der Prozess
//! oder wird er via Task-Manager force-killed, übernimmt der Kernel
//! via `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: alle Job-Mitglieder werden
//! beim Schließen des Job-Handles (= App-Prozess-Exit) atomar terminiert,
//! kaskadierend zu allen Nested-Job-Mitgliedern (claude.exe spawnt
//! vermutlich ein eigenes Job für seine MCP-Server, das via Inheritance
//! im Outer-Job hängt → kill cascadet ein Level tiefer).
//!
//! Failures sind defensiv: jeder API-Call der scheitert wird geloggt
//! aber NIE als Error propagiert. JobObject ist Defense-in-Depth, nicht
//! eine Precondition für Session-Spawn.

#[cfg(windows)]
mod imp {
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::{CloseHandle, FALSE, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    // Singleton-Job für die App-Lifetime. HANDLE ist in windows-sys 0.59
    // ein `*mut c_void` — Pointer sind !Send/!Sync per default, deshalb
    // speichern wir sie als usize (numerisches Äquivalent) und casten beim
    // Lesen zurück. Sentinel 0 = "Job-Creation fehlgeschlagen", assign_child
    // wird in dem Fall ein no-op.
    static JOB: OnceLock<usize> = OnceLock::new();

    fn get_or_create_job() -> HANDLE {
        let raw = *JOB.get_or_init(|| {
            // SAFETY: alle Pointer sind null (default-Security, no-name),
            // SetInformationJobObject erhält eine valide initialisierte
            // Struct mit korrekter cbSize. Failures werden geloggt aber
            // nicht propagiert — degradiert graceful auf "kein Job".
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    log::error!("CreateJobObjectW failed; crash-cleanup defense disabled");
                    return 0;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as _,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if ok == 0 {
                    log::error!(
                        "SetInformationJobObject failed: {} — closing handle, cascading cleanup disabled",
                        std::io::Error::last_os_error()
                    );
                    CloseHandle(job);
                    return 0;
                }
                log::info!("App Job Object created (kill-on-job-close active)");
                job as usize
            }
        });
        raw as HANDLE
    }

    /// Assigns a child process to the App's singleton Job Object so the
    /// kernel kills it (and its descendants) when our process dies.
    /// Failures are logged but never returned as errors — JobObject is
    /// a defense-in-depth, not a precondition.
    pub fn assign_child(child_pid: u32) {
        let job = get_or_create_job();
        if job.is_null() {
            return;
        }
        // SAFETY: OpenProcess + AssignProcessToJobObject + CloseHandle in
        // korrektem Lifecycle. Handle wird via CloseHandle freigegeben,
        // auch wenn das Assignment scheitert. Early-return bei Handle-Null
        // springt vor CloseHandle weil es nichts zu schließen gibt.
        unsafe {
            let h = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, FALSE, child_pid);
            if h.is_null() {
                log::warn!(
                    "OpenProcess({}) failed for Job assignment — pid won't cascade-cleanup",
                    child_pid
                );
                return;
            }
            let ok = AssignProcessToJobObject(job, h);
            if ok == 0 {
                log::warn!(
                    "AssignProcessToJobObject failed for pid {} — pid won't cascade-cleanup",
                    child_pid
                );
            } else {
                log::debug!("Pid {} assigned to App Job Object", child_pid);
            }
            CloseHandle(h);
        }
    }
}

#[cfg(windows)]
pub use imp::assign_child;

#[cfg(not(windows))]
pub fn assign_child(_child_pid: u32) {
    // No-op on non-Windows. POSIX process-groups and portable_pty's
    // kill-on-drop default handle orphan-prevention differently;
    // this wrapper exists only for Windows-specific cleanup gaps.
}
