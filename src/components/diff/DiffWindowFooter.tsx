import { ICONS, ICON_SIZE } from "../../utils/icons";
import type { DiffViewMode, SessionDiff } from "./types";

interface DiffWindowFooterProps {
  diff: SessionDiff | null;
  mode: DiffViewMode;
  onModeChange: (mode: DiffViewMode) => void;
  onRefresh: () => void;
  refreshing: boolean;
  /** True wenn die Session geschlossen wurde — Refresh disabled, Hinweis-Text. */
  frozen: boolean;
}

function formatTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Footer-Leiste des Diff-Windows.
 * - Refresh-Button (links)
 * - Snapshot-/Compute-Stats (Mitte)
 * - Side/Inline-Toggle (rechts)
 *
 * Number-Formatting per CLAUDE.md: `ms` fuer Durations.
 */
export function DiffWindowFooter({
  diff,
  mode,
  onModeChange,
  onRefresh,
  refreshing,
  frozen,
}: DiffWindowFooterProps) {
  const RefreshIcon = ICONS.action.refresh;
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-t border-neutral-700 bg-surface-base text-xs">
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing || frozen}
        className="inline-flex items-center gap-1.5 px-2 py-1 text-neutral-300 hover:text-accent hover:bg-hover-overlay transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Diff neu laden"
        title={frozen ? "Session beendet — Diff eingefroren" : "Diff neu laden"}
      >
        <RefreshIcon
          className={`${ICON_SIZE.card} ${refreshing ? "animate-spin" : ""}`}
          aria-hidden="true"
        />
        <span>Aktualisieren</span>
      </button>

      <div className="flex-1 flex items-center gap-3 font-mono text-neutral-400">
        <span>Snapshot {formatTime(diff?.snapshotAt)}</span>
        {diff && (
          <>
            <span>{diff.computeMs} ms</span>
            <span>{diff.files.length} Datei{diff.files.length === 1 ? "" : "en"}</span>
            {diff.truncated && (
              <span className="text-warning">Gekuerzt — Budget erreicht</span>
            )}
          </>
        )}
        {frozen && <span className="text-warning">Session beendet</span>}
      </div>

      <div
        role="radiogroup"
        aria-label="Diff-Ansicht waehlen"
        className="flex items-stretch border border-neutral-700 divide-x divide-neutral-700"
      >
        <button
          type="button"
          role="radio"
          aria-checked={mode === "side"}
          onClick={() => onModeChange("side")}
          className={`px-2 py-1 transition-colors ${
            mode === "side"
              ? "bg-accent-a15 text-accent"
              : "text-neutral-400 hover:bg-hover-overlay"
          }`}
        >
          Side-by-Side
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "inline"}
          onClick={() => onModeChange("inline")}
          className={`px-2 py-1 transition-colors ${
            mode === "inline"
              ? "bg-accent-a15 text-accent"
              : "text-neutral-400 hover:bg-hover-overlay"
          }`}
        >
          Inline
        </button>
      </div>
    </div>
  );
}
