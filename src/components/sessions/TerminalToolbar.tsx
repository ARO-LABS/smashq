import { useState } from "react";
import { ICONS } from "../../utils/icons";
import type { LayoutMode } from "../../store/sessionStore";
import { useGitBranch } from "../../hooks/useGitBranch";
import { DiffActionButton } from "../diff/DiffActionButton";
import { TasksPanel } from "../shared/TasksPanel";
import { restartSession } from "./hooks/sessionRestart";

const LayoutList = ICONS.action.listView;
const LayoutGrid = ICONS.action.detach;
const PanelRightOpen = ICONS.action.panelOpen;
const PanelRightClose = ICONS.action.panelClose;
const GitBranch = ICONS.git.branch;
const Restart = ICONS.action.retry;

interface TerminalToolbarProps {
  layoutMode: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
  folder?: string;
  /** Active session id — when present, enables the Git-cluster diff button. */
  sessionId?: string;
  configPanelOpen?: boolean;
  onToggleConfigPanel?: () => void;
}

/**
 * Floating overlay-toolbar — reclaimed vertical space by removing the dedicated
 * 36px horizontal bar above the terminal. Sits absolute-positioned top-right
 * inside the terminal container with opacity-80 at rest (unobtrusive) and
 * opacity-100 on hover (full visibility). All controls (branch-chip, config-
 * toggle, layout-toggle) fit in a single rounded-md pill.
 *
 * Parent must position itself `relative` so this child anchors correctly.
 * The active-session title is intentionally NOT rendered — that signal lives
 * in the sidebar SessionCard. Grid-count is conveyed by the layout-toggle's
 * own active-state.
 */
export function TerminalToolbar({
  layoutMode,
  onLayoutChange,
  folder,
  sessionId,
  configPanelOpen,
  onToggleConfigPanel,
}: TerminalToolbarProps) {
  const branch = useGitBranch(folder);
  // Reine Optik (Button disabled + aria-busy) — die WAHRHEIT gegen
  // Doppelklicks ist der Modul-Level-Guard in restartSession (gleiches
  // Muster wie SessionCard, Issue #49).
  const [isRestarting, setIsRestarting] = useState(false);

  return (
    <div
      className="absolute top-2 right-2 z-10 flex items-center gap-1 px-1 py-0.5 rounded-md bg-surface-base shadow-hairline opacity-80 hover:opacity-100 transition-opacity"
      data-testid="terminal-toolbar"
    >
      {/* Git cluster: branch chip + diff button */}
      {branch && (
        <span
          data-testid="git-branch-chip"
          title={branch}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-neutral-800 text-[10px] text-neutral-400 max-w-[140px]"
        >
          <GitBranch className="w-3 h-3 shrink-0" />
          <span className="truncate">{branch}</span>
        </span>
      )}
      {sessionId && (
        <DiffActionButton
          sessionId={sessionId}
          iconSize="inline"
          padding="p-1"
          errorSource="TerminalToolbar.openDiff"
        />
      )}
      <TasksPanel variant="window" folder={folder} sessionId={sessionId} />

      {/* Restart — resumed dieselbe Claude-Konversation (Issue #49); gleiche
          Aktion wie der Neustart-Button in der SessionCard. */}
      {sessionId && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (isRestarting) return;
            setIsRestarting(true);
            // Fire-and-forget: restartSession guards double-clicks itself and
            // surfaces failures via toast — local state is cosmetics only.
            void restartSession(sessionId).finally(() => setIsRestarting(false));
          }}
          disabled={isRestarting}
          aria-busy={isRestarting}
          className="p-1 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-hover-overlay transition-colors disabled:opacity-50"
          aria-label="Session neu starten"
          title="Session neu starten"
        >
          <Restart className="w-4 h-4" />
        </button>
      )}

      {/* Config panel toggle — only in single mode */}
      {layoutMode === "single" && onToggleConfigPanel && (
        <button
          onClick={onToggleConfigPanel}
          className={`p-1 rounded-md transition-colors ${
            configPanelOpen
              ? "text-accent bg-accent-a10"
              : "text-neutral-500 hover:text-neutral-300 hover:bg-hover-overlay"
          }`}
          aria-label={configPanelOpen ? "Konfig-Panel schließen" : "Konfig-Panel öffnen"}
          title={configPanelOpen ? "Konfig-Panel schließen" : "Konfig-Panel öffnen"}
        >
          {configPanelOpen ? (
            <PanelRightClose className="w-4 h-4" />
          ) : (
            <PanelRightOpen className="w-4 h-4" />
          )}
        </button>
      )}

      {/* Concept-B rounded segmented control: single icon-button slot with
          internal divider, no manual separator/border-resets needed. */}
      <div className="flex items-stretch rounded-md shadow-hairline overflow-hidden bg-surface-raised">
        <button
          onClick={() => onLayoutChange("single")}
          className={`p-1 transition-colors ${
            layoutMode === "single"
              ? "bg-accent-a10 text-accent"
              : "text-neutral-500 hover:text-neutral-300 hover:bg-hover-overlay"
          }`}
          aria-label="Einzelansicht"
          title="Einzelansicht"
        >
          <LayoutList className="w-4 h-4" />
        </button>
        <button
          onClick={() => onLayoutChange("grid")}
          className={`p-1 transition-colors ${
            layoutMode === "grid"
              ? "bg-accent-a10 text-accent"
              : "text-neutral-500 hover:text-neutral-300 hover:bg-hover-overlay"
          }`}
          aria-label="Grid-Ansicht"
          title="Grid-Ansicht"
        >
          <LayoutGrid className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
