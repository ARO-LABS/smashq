import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ICONS } from "../../utils/icons";
import { getErrorMessage } from "../../utils/adpError";
import { logError } from "../../utils/errorLogger";
import { useSettingsStore } from "../../store/settingsStore";
import { useSessionStore } from "../../store/sessionStore";
import { useUIStore } from "../../store/uiStore";
import { SessionHistoryRow } from "./SessionHistoryRow";
import {
  buildRunningClaudeIds,
  groupSessionsByTime,
  matchesHistoryQuery,
} from "./sessionHistoryHelpers";

const RefreshCw = ICONS.action.refresh;
const SearchIcon = ICONS.action.search;
const ClearIcon = ICONS.action.close;

// ============================================================================
// Types (matches Rust ClaudeSessionSummary)
// ============================================================================

export interface ClaudeSessionSummary {
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

/** Summary + abgeleitete Anzeige-Felder (Override-Titel, Rename-Vorschau). */
type EnrichedSummary = ClaudeSessionSummary & {
  effectiveTitle: string;
  preview: string | null;
};

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

/** Balkenbreiten der drei Skeleton-Zeilen (Titel / Vorschau / Meta). */
const SKELETON_WIDTHS: ReadonlyArray<readonly [string, string, string]> = [
  ["72%", "46%", "58%"],
  ["58%", "64%", "40%"],
  ["82%", "38%", "52%"],
];

// ============================================================================
// Component
// ============================================================================

const SessionHistoryViewer: React.FC<SessionHistoryViewerProps> = ({ folder, onResumeSession }) => {
  const [sessions, setSessions] = useState<ClaudeSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const sessionTitleOverrides = useSettingsStore((s) => s.sessionTitleOverrides);
  const removeRestorableSessionByClaudeId = useSettingsStore(
    (s) => s.removeRestorableSessionByClaudeId,
  );
  const addToast = useUIStore((s) => s.addToast);
  const liveSessions = useSessionStore((s) => s.sessions);
  const runningIds = useMemo(() => buildRunningClaudeIds(liveSessions), [liveSessions]);

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
      <div
        aria-label="Sessions werden geladen"
        className="flex flex-col h-full overflow-y-auto pb-2"
      >
        <div className="px-4 py-3 text-[11px] font-semibold tracking-widest uppercase text-neutral-500">
          Sessions werden geladen …
        </div>
        {SKELETON_WIDTHS.map((widths, i) => (
          <div key={i} className="flex flex-col gap-1.5 px-4 py-2 mx-1.5">
            <div className="h-[11px] rounded bg-hover-overlay" style={{ width: widths[0] }} />
            <div className="h-[9px] rounded bg-hover-overlay" style={{ width: widths[1] }} />
            <div className="h-[8px] rounded bg-hover-overlay" style={{ width: widths[2] }} />
          </div>
        ))}
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

  const enriched: EnrichedSummary[] = sessions.map((s) => {
    const overrideTitle = sessionTitleOverrides[s.session_id]?.trim();
    const effectiveTitle = overrideTitle || s.title;
    // Vorschau nur, wenn ein Override den Titel ersetzt — der Rust-Scanner
    // nutzt bereits die erste User-Nachricht als Titel, sonst wäre die
    // Vorschau eine reine Dopplung.
    const preview = overrideTitle && s.title !== effectiveTitle ? s.title : null;
    return { ...s, effectiveTitle, preview };
  });
  const filtered = enriched.filter((s) => matchesHistoryQuery(s, s.effectiveTitle, query));
  const groups = groupSessionsByTime(filtered);
  const hasQuery = query.trim().length > 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-2">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[11px] font-semibold tracking-widest uppercase text-neutral-500">
          {hasQuery
            ? `${filtered.length} von ${sessions.length} Sessions`
            : `${sessions.length} ${sessions.length === 1 ? "Session" : "Sessions"}`}
        </span>
        <div className="flex items-center gap-1">
          {/* Task 6: Hier kommt der Auswahlmodus-Toggle hin (Mehrfachauswahl + Bulk-Delete). */}
          <button
            onClick={loadSessions}
            className="text-xs text-neutral-500 hover:text-neutral-200 transition-colors px-2 py-0.5 rounded hover:bg-hover-overlay"
            title="Neu laden"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Suche */}
      <div className="mx-3 mb-1 flex items-center gap-2 px-2.5 py-1.5 bg-surface-raised border border-neutral-800 rounded-md">
        <SearchIcon className="w-3 h-3 text-neutral-500 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Titel oder Branch durchsuchen …"
          className="flex-1 min-w-0 bg-transparent text-xs text-neutral-200 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset rounded-sm"
        />
        {query.length > 0 && (
          <button
            onClick={() => setQuery("")}
            aria-label="Suche leeren"
            className="p-0.5 rounded text-neutral-500 hover:text-neutral-200 transition-colors shrink-0"
          >
            <ClearIcon className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Liste: Gruppen oder Kein-Treffer-Zustand */}
      {filtered.length === 0 && hasQuery ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-1 px-4 py-8 text-center">
          <SearchIcon className="w-4 h-4 text-neutral-600" />
          <span className="text-xs text-neutral-400">{`Keine Session passt zu „${query}“.`}</span>
          <span className="text-[11px] text-neutral-500">Suchbegriff ändern oder leeren.</span>
        </div>
      ) : (
        groups.map((group) => (
          <React.Fragment key={group.key}>
            <div
              data-testid={`history-group-${group.key}`}
              className="flex items-baseline gap-1.5 px-4 pt-3 pb-1 text-[10px] font-bold tracking-widest uppercase text-neutral-500"
            >
              <span>{group.label}</span>
              <span className="font-mono font-medium opacity-70">{group.sessions.length}</span>
            </div>
            {group.sessions.map((s) => (
              <SessionHistoryRow
                key={s.session_id}
                session={s}
                effectiveTitle={s.effectiveTitle}
                preview={s.preview}
                isActive={runningIds.has(s.session_id)}
                deletePending={pendingDeletes.has(s.session_id)}
                onResume={
                  onResumeSession
                    ? () => onResumeSession(s.session_id, s.cwd, s.effectiveTitle)
                    : undefined
                }
                onRename={() => {}} // Task 5: Inline-Rename-Input wird hier angebunden
                onDelete={() => handleDelete(s.session_id, s.effectiveTitle)}
                formatRelativeDate={formatRelativeDate}
                formatDateTime={formatDateTime}
                formatModel={formatModel}
              />
            ))}
          </React.Fragment>
        ))
      )}
    </div>
  );
};

export default SessionHistoryViewer;
