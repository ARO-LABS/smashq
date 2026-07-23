import React, { useEffect, useRef } from "react";
import { ICONS } from "../../utils/icons";
import { formatElapsed } from "../../utils/format";
import {
  formatDateTime,
  formatModel,
  formatRelativeDate,
  type ClaudeSessionSummary,
} from "./sessionHistoryHelpers";

const GitBranch = ICONS.git.branch;
const Bot = ICONS.library.agent;
const MessageSquare = ICONS.git.comment;
const Clock = ICONS.tasks.clock;
const Play = ICONS.action.run;
const Trash2 = ICONS.action.trash;
const Pencil = ICONS.action.edit;

export interface SessionHistoryRowProps {
  session: ClaudeSessionSummary;
  effectiveTitle: string;
  /** Original-Erstnachricht — nur gesetzt, wenn ein Rename-Override den Titel ersetzt. */
  preview: string | null;
  /** Läuft gerade als Live-Session — Aktionen gesperrt (Doppel-Resume-Schutz). */
  isActive: boolean;
  deletePending: boolean;
  onResume?: () => void;
  onRename: () => void;
  onDelete: () => void;
  /** Inline-Rename (Task 5): Zustand lebt im Viewer, damit nur eine Zeile editiert. */
  isEditing: boolean;
  editValue: string;
  onEditChange: (value: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
}

/** Dauer aus Start/Ende — „–" wenn Zeitstempel fehlen oder inkonsistent sind. */
function formatDuration(startIso: string, endIso: string): string {
  if (!startIso || !endIso) return "–";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 0) return "–";
  return formatElapsed(ms);
}

/**
 * Eine Zeile der Session-History. Hover blendet die Aktionen ein
 * (`group-hover`), `focus-within` hält sie für Tastatur-Nutzer sichtbar —
 * opacity entfernt Buttons nicht aus dem a11y-Baum, deshalb bleiben
 * Title-Queries in Tests stabil.
 */
export const SessionHistoryRow: React.FC<SessionHistoryRowProps> = ({
  session,
  effectiveTitle,
  preview,
  isActive,
  deletePending,
  onResume,
  onRename,
  onDelete,
  isEditing,
  editValue,
  onEditChange,
  onEditCommit,
  onEditCancel,
}) => {
  const editInputRef = useRef<HTMLInputElement>(null);

  // Auto-Fokus + Text markiert, sobald der Edit-Modus startet (Pin-Rename-Muster)
  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditing]);

  return (
    <div className="group flex flex-col gap-0.5 px-4 py-2 mx-1.5 rounded-md hover:bg-hover-overlay transition-colors">
      {/* Titelzeile */}
      <div className="flex items-center gap-2">
        {isActive && (
          <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" aria-hidden="true" />
        )}
        {isEditing ? (
          <input
            ref={editInputRef}
            type="text"
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            onBlur={onEditCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEditCommit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onEditCancel();
              }
            }}
            aria-label="Session-Titel bearbeiten"
            className="flex-1 min-w-0 bg-surface-raised border border-accent rounded-sm px-2 text-xs font-medium text-neutral-200 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          />
        ) : (
          <span
            className="flex-1 truncate text-xs font-medium text-neutral-200"
            title={effectiveTitle}
          >
            {effectiveTitle}
          </span>
        )}
        {isActive ? (
          <span className="px-1.5 py-px rounded-full bg-success/15 text-success text-[9.5px] font-bold tracking-wide uppercase shrink-0">
            Aktiv
          </span>
        ) : isEditing ? null : (
          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {onResume && (
              <button
                onClick={onResume}
                className="p-1 rounded hover:bg-accent-a15 text-neutral-400 hover:text-accent transition-colors"
                title="Session fortsetzen"
              >
                <Play className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={onRename}
              className="p-1 rounded hover:bg-hover-overlay text-neutral-400 hover:text-neutral-200 transition-colors"
              title="Session umbenennen"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onDelete}
              disabled={deletePending}
              className={
                "p-1 rounded hover:bg-error/10 text-neutral-400 hover:text-error transition-colors " +
                (deletePending ? "opacity-40 cursor-not-allowed" : "")
              }
              title="Session löschen (in den Papierkorb)"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Vorschau: Original-Erstnachricht, nur bei Rename-Override */}
      {preview && (
        <div className="truncate text-[11px] text-neutral-500">{`„${preview}“`}</div>
      )}

      {/* Metazeile — bei aktiven Sessions Sperr-Hinweis, beim Editieren Tastatur-Hinweis */}
      {isActive ? (
        <div className="text-[10.5px] text-neutral-500">
          Läuft gerade — Fortsetzen und Löschen gesperrt
        </div>
      ) : isEditing ? (
        <div className="text-[10.5px] text-neutral-500">Enter übernehmen · Escape verwerfen</div>
      ) : (
        <div className="flex items-center gap-3 flex-wrap text-[10.5px] text-neutral-500 tabular-nums">
          <span title={formatDateTime(session.started_at)}>
            {formatRelativeDate(session.started_at)}
          </span>
          <span className="flex items-center gap-1" title="Dauer">
            <Clock className="w-2.5 h-2.5" />
            {formatDuration(session.started_at, session.ended_at)}
          </span>
          <span className="flex items-center gap-1" title="User-Prompts">
            <MessageSquare className="w-2.5 h-2.5" />
            {session.user_turns}
          </span>
          {session.subagent_count > 0 && (
            <span className="flex items-center gap-1" title="Subagents">
              <Bot className="w-2.5 h-2.5" />
              {session.subagent_count}
            </span>
          )}
          {session.git_branch && (
            <span
              className="flex items-center gap-1 truncate max-w-[120px]"
              title={session.git_branch}
            >
              <GitBranch className="w-2.5 h-2.5 shrink-0" />
              {session.git_branch}
            </span>
          )}
          {session.model && (
            <span className="text-neutral-500" title={session.model}>
              {formatModel(session.model)}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
