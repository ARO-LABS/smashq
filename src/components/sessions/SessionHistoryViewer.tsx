import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, GitBranch, Bot, MessageSquare, Clock, Play, Trash2 } from "lucide-react";
import { getErrorMessage } from "../../utils/adpError";
import { logError } from "../../utils/errorLogger";
import { formatElapsed } from "../../utils/format";
import { useSettingsStore } from "../../store/settingsStore";
import { useUIStore } from "../../store/uiStore";

// ============================================================================
// Types (matches Rust ClaudeSessionSummary)
// ============================================================================

interface ClaudeSessionSummary {
  session_id: string;
  title: string;
  started_at: string;
  ended_at: string;
  model: string;
  user_turns: number;
  total_messages: number;
  subagent_count: number;
  git_branch: string;
  cwd: string;
}

// ============================================================================
// Props
// ============================================================================

interface SessionHistoryViewerProps {
  folder: string;
  onResumeSession?: (sessionId: string, cwd: string, title?: string) => void;
}

// ============================================================================
// Helpers
// ============================================================================

function formatDateTime(isoString: string): string {
  if (!isoString) return "–";
  const date = new Date(isoString);
  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(startIso: string, endIso: string): string {
  if (!startIso || !endIso) return "–";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 0) return "–";
  return formatElapsed(ms);
}

function formatModel(model: string): string {
  if (!model) return "";
  if (model.includes("opus")) return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku")) return "Haiku";
  return model;
}

function formatRelativeDate(isoString: string): string {
  if (!isoString) return "";
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Heute";
  if (diffDays === 1) return "Gestern";
  if (diffDays < 7) return `Vor ${diffDays} Tagen`;
  return formatDateTime(isoString);
}

// ============================================================================
// Component
// ============================================================================

const SessionHistoryViewer: React.FC<SessionHistoryViewerProps> = ({ folder, onResumeSession }) => {
  const [sessions, setSessions] = useState<ClaudeSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const sessionTitleOverrides = useSettingsStore((s) => s.sessionTitleOverrides);
  const removeRestorableSessionByClaudeId = useSettingsStore(
    (s) => s.removeRestorableSessionByClaudeId,
  );
  const addToast = useUIStore((s) => s.addToast);

  const loadSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<ClaudeSessionSummary[]>("scan_claude_sessions", { folder });
      setSessions(result ?? []);
    } catch (err) {
      logError("SessionHistoryViewer.scanSessions", err);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Move the session to the OS trash. Optimistic — the row disappears
   * immediately; on backend failure we re-insert at its original position
   * via a functional setSessions so cross-session races never resurrect
   * an already-deleted sibling: rolling back to a closure-captured
   * snapshot would overwrite parallel optimistic removals and produce
   * ghost rows in the UI.
   *
   * `pendingDeletes` blocks redundant re-clicks on the same row while a
   * delete is in-flight; the trash button reflects this via `disabled`.
   *
   * The toast offers a "Memory pruefen"-action that jumps to the Library
   * tab where projektweite Memory-Eintraege gepflegt werden — die Library
   * ist Single Source of Truth fuer Memory-Hygiene.
   */
  const handleDelete = async (sessionId: string, title: string) => {
    if (pendingDeletes.has(sessionId)) return;

    const removed = sessions.find((s) => s.session_id === sessionId);
    const originalIndex = sessions.findIndex((s) => s.session_id === sessionId);
    if (!removed || originalIndex < 0) return;

    setPendingDeletes((cur) => {
      const next = new Set(cur);
      next.add(sessionId);
      return next;
    });
    setSessions((current) => current.filter((s) => s.session_id !== sessionId));

    try {
      await invoke("delete_claude_session", { folder, sessionId });
      removeRestorableSessionByClaudeId(sessionId);
      addToast({
        type: "success",
        title: "Session geloescht",
        message: title,
        duration: 8000,
        action: {
          label: "Memory pruefen",
          onClick: () =>
            invoke("open_detached_window", { view: "library", title: "Bibliothek" }).catch(
              (err) => logError("SessionHistoryViewer.openLibrary", err),
            ),
        },
      });
    } catch (err) {
      setSessions((current) => {
        if (current.some((s) => s.session_id === sessionId)) return current;
        const next = [...current];
        const safeIdx = Math.min(originalIndex, next.length);
        next.splice(safeIdx, 0, removed);
        return next;
      });
      logError("SessionHistoryViewer.deleteSession", err);
      addToast({
        type: "error",
        title: "Loeschen fehlgeschlagen",
        message: getErrorMessage(err),
        duration: 8000,
      });
    } finally {
      setPendingDeletes((cur) => {
        const next = new Set(cur);
        next.delete(sessionId);
        return next;
      });
    }
  };

  useEffect(() => {
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on folder change
  }, [folder]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-400 text-sm py-8">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
        Sessions werden geladen...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-sm py-8 gap-2">
        <span className="text-error">Fehler beim Laden: {error}</span>
        <button
          onClick={loadSessions}
          className="text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          Erneut versuchen
        </button>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-400 text-sm py-8">
        Keine Claude-Sessions fuer dieses Projekt gefunden
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-2 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <span className="ae-body-sm">
          {sessions.length} {sessions.length === 1 ? "Session" : "Sessions"}
        </span>
        <button
          onClick={loadSessions}
          className="text-xs text-neutral-500 hover:text-neutral-200 transition-colors px-2 py-0.5 rounded hover:bg-hover-overlay"
          title="Neu laden"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* Session list */}
      <div className="flex flex-col gap-1.5">
        {sessions.map((session) => {
          const overrideTitle = sessionTitleOverrides[session.session_id]?.trim();
          const effectiveTitle = overrideTitle || session.title;

          return (
            <div
              key={session.session_id}
              className="bg-surface-raised border border-neutral-700 rounded-none px-3 py-2 text-sm group"
            >
            {/* Title + Resume button */}
            <div className="flex items-start gap-2">
              <div className="text-neutral-200 font-medium leading-snug line-clamp-2 flex-1">
                {effectiveTitle}
              </div>
              {onResumeSession && (
                <button
                  onClick={() => onResumeSession(session.session_id, session.cwd, effectiveTitle)}
                  className="shrink-0 mt-0.5 p-1 rounded hover:bg-accent-a15 text-neutral-400 hover:text-accent transition-colors opacity-0 group-hover:opacity-100"
                  title="Session fortsetzen"
                >
                  <Play className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => handleDelete(session.session_id, effectiveTitle)}
                disabled={pendingDeletes.has(session.session_id)}
                className={
                  "shrink-0 mt-0.5 p-1 rounded hover:bg-error/10 text-neutral-400 hover:text-error transition-colors " +
                  (pendingDeletes.has(session.session_id)
                    ? "opacity-40 cursor-not-allowed"
                    : "opacity-0 group-hover:opacity-100")
                }
                title="Session loeschen (in den Papierkorb)"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Metadata row */}
            <div className="flex items-center gap-3 mt-1.5 text-xs text-neutral-400 flex-wrap">
              <span title={formatDateTime(session.started_at)}>
                {formatRelativeDate(session.started_at)}
              </span>
              <span className="flex items-center gap-1" title="Dauer">
                <Clock className="w-3 h-3" />
                {formatDuration(session.started_at, session.ended_at)}
              </span>
              <span className="flex items-center gap-1" title="User-Prompts">
                <MessageSquare className="w-3 h-3" />
                {session.user_turns}
              </span>
              {session.subagent_count > 0 && (
                <span className="flex items-center gap-1" title="Subagents">
                  <Bot className="w-3 h-3" />
                  {session.subagent_count}
                </span>
              )}
              {session.git_branch && (
                <span className="flex items-center gap-1 truncate max-w-[120px]" title={session.git_branch}>
                  <GitBranch className="w-3 h-3 shrink-0" />
                  {session.git_branch}
                </span>
              )}
              {session.model && (
                <span className="text-neutral-500" title={session.model}>
                  {formatModel(session.model)}
                </span>
              )}
            </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SessionHistoryViewer;
