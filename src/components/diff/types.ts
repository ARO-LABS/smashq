/**
 * Wire-Types fuer das Session-Diff-Window.
 *
 * Spiegel der Rust-Structs aus `src-tauri/src/session/diff.rs`. Die Camel-Case-
 * Renames passieren in Rust via `#[serde(rename = "...")]` — TS sieht die
 * Felder hier direkt im erwarteten Format.
 */

export type DiffFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked";

export interface DiffFile {
  path: string;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
  oldContent?: string;
  newContent?: string;
  /** True wenn File ueber Performance-Budget liegt — kein Inhalt geliefert. */
  oversize: boolean;
}

export interface SessionDiff {
  sessionId: string;
  snapshotCommit: string;
  /** ISO-8601 timestamp from Rust `chrono::DateTime<Utc>`. */
  snapshotAt: string;
  computedAt: string;
  computeMs: number;
  files: DiffFile[];
  /** True wenn Diff-Gesamt-Budget (5 MB) erreicht wurde. */
  truncated: boolean;
}

export type DiffViewMode = "side" | "inline";
