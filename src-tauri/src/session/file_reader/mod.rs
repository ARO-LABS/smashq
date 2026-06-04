// src-tauri/src/session/file_reader/mod.rs
//
// File-reader subsystem, split into focused submodules (pure code-motion).
// The public module path `session::file_reader::*` is preserved via re-exports
// below so external callers resolve UNCHANGED. Only SIX symbols are consumed
// from outside this directory; the re-export surface is scoped to exactly that
// external contract:
//
//   - session::file_reader::commands::*        (Tauri command handlers — `pub mod` below)
//   - session::file_reader::snapshot_session_uuids_in / wait_for_new_session_uuid (manager.rs + tests)
//   - session::file_reader::find_project_dir_in / folder_to_project_dir_name /
//     parse_session_jsonl_str / scan_sessions_for_project_in              (tests)
//
// All other items stay module-private or `pub(crate)`; cross-submodule users
// import them directly via `use super::<submodule>::…`.

mod path_safety;
mod session_delete;
mod session_discovery;
mod session_history;

pub mod commands;

// Re-export ONLY the symbols external callers (manager.rs + tests/) reference,
// so the public path stays `session::file_reader::X` for exactly those.
pub use session_discovery::{snapshot_session_uuids_in, wait_for_new_session_uuid};
pub use session_history::{
    find_project_dir_in, folder_to_project_dir_name, parse_session_jsonl_str,
    scan_sessions_for_project_in,
};
