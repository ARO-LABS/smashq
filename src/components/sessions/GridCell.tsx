import { Maximize2, X, GitBranch } from "lucide-react";
import { useSessionStore } from "../../store/sessionStore";
import { useGitBranch } from "../../hooks/useGitBranch";
import { DiffActionButton } from "../diff/DiffActionButton";
import { TasksPanel } from "../shared/TasksPanel";

interface GridCellChromeProps {
  sessionId: string;
  onMaximize: () => void;
  onRemove: () => void;
}

/**
 * GridCellChrome — schwebende Mini-Pille im top-right einer Grid-Zelle.
 *
 * Pre-2026-05-22 war das eine 28px horizontale Bar oberhalb des Terminals.
 * Seitdem: Floating-Pill (gleiche Sprache wie der Single-Mode TerminalToolbar),
 * positioniert absolute top-2 right-2 innerhalb des Cell-Wrappers.
 *
 * Der Cell-Wrapper (in SessionManagerView) ist `relative` + handhabt das
 * onClick fuer Focus-via-Cell-Click. Der Focus-State wird visuell durch
 * `ring-2 ring-accent` am Cell-Wrapper signalisiert — kein border am Chrome.
 */
export function GridCellChrome({
  sessionId,
  onMaximize,
  onRemove,
}: GridCellChromeProps) {
  const session = useSessionStore((s) => s.sessions.find((sess) => sess.id === sessionId));
  const branch = useGitBranch(session?.folder);

  return (
    <div
      data-testid={`grid-cell-chrome-${sessionId}`}
      className="absolute top-2 right-2 z-10 flex items-center gap-1 px-1 py-0.5 rounded-md bg-surface-base shadow-hairline opacity-60 hover:opacity-100 transition-opacity"
    >
      {branch && (
        <span
          data-testid="git-branch-chip"
          title={branch}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-neutral-800 text-[10px] text-neutral-400 max-w-[120px]"
        >
          <GitBranch className="w-3 h-3 shrink-0" />
          <span className="truncate">{branch}</span>
        </span>
      )}
      <DiffActionButton
        sessionId={sessionId}
        iconSize="inline"
        padding="p-1"
        errorSource="GridCell.openDiff"
      />
      <TasksPanel
        variant="grid-tile"
        folder={session?.folder}
        sessionId={sessionId}
      />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMaximize();
        }}
        className="p-1 rounded-md text-neutral-500 hover:text-accent hover:bg-hover-overlay transition-colors"
        aria-label="Maximieren"
        title="Maximieren"
      >
        <Maximize2 className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="p-1 rounded-md text-neutral-500 hover:text-error hover:bg-hover-overlay transition-colors"
        aria-label="Aus Grid entfernen"
        title="Aus Grid entfernen"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
