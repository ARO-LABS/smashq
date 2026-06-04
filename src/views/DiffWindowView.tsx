import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, GitCompare } from "lucide-react";
import { DiffFileList } from "../components/diff/DiffFileList";
import { DiffMergeView } from "../components/diff/DiffMergeView";
import { DiffWindowFooter } from "../components/diff/DiffWindowFooter";
import type { DiffViewMode, SessionDiff } from "../components/diff/types";
import { Button } from "../components/ui/Button";
import { logError } from "../utils/errorLogger";

interface DiffWindowViewProps {
  sessionId: string | null;
}

/**
 * Top-Level-View des Session-Diff-Windows.
 *
 * Lifecycle:
 *  - Mount: invoke `get_session_diff` mit der URL-Session-ID, lokalen State setzen.
 *  - Auto-Refresh-on-Focus: Listener auf `tauri://focus` → refresh, ausser frozen.
 *  - Session-Close: Listener auf `session-deleted/<id>` → frozen-Banner anzeigen.
 *
 * State bleibt komplett lokal — das Diff-Window haengt nicht am Haupt-Fenster-Zustand,
 * weil es eine eigene WebviewWindow ist und der `?view=diff`-Pivot in main.tsx
 * den Store-Bootstrap ueberspringt.
 */
export function DiffWindowView({ sessionId }: DiffWindowViewProps) {
  const [diff, setDiff] = useState<SessionDiff | null>(null);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [viewMode, setViewMode] = useState<DiffViewMode>("side");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);
  const frozenRef = useRef(false);

  const loadDiff = useCallback(async () => {
    if (!sessionId) {
      setError("Keine Session-ID in URL — Diff-Window kann nicht laden.");
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      const next = await invoke<SessionDiff>("get_session_diff", { sessionId });
      setDiff(next);
      setSelectedFileIndex((prev) => {
        if (!next.files.length) return 0;
        return Math.min(prev, next.files.length - 1);
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
      setError(msg);
      logError("DiffWindowView.loadDiff", err);
    } finally {
      setRefreshing(false);
    }
  }, [sessionId]);

  // Initial load
  useEffect(() => {
    loadDiff().catch((e) => logError("DiffWindowView.initial", e));
  }, [loadDiff]);

  // session-deleted event → freeze
  useEffect(() => {
    if (!sessionId) return;
    let unlistenFn: (() => void) | null = null;
    listen<unknown>(`session-deleted/${sessionId}`, () => {
      frozenRef.current = true;
      setFrozen(true);
    })
      .then((u) => {
        unlistenFn = u;
      })
      .catch((err) => logError("DiffWindowView.sessionDeleted", err));
    return () => {
      unlistenFn?.();
    };
  }, [sessionId]);

  // Auto-Refresh-on-Focus — Tauri emit `tauri://focus` when window regains focus.
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    listen<unknown>("tauri://focus", () => {
      if (frozenRef.current) return;
      loadDiff().catch((e) => logError("DiffWindowView.onFocus", e));
    })
      .then((u) => {
        unlistenFn = u;
      })
      .catch((err) => logError("DiffWindowView.focusListener", err));
    return () => {
      unlistenFn?.();
    };
  }, [loadDiff]);

  const selectedFile = diff?.files[selectedFileIndex] ?? null;
  // "Folder is not a git repository" ist kein echter Fehler — der User hat das
  // Icon auf einer Non-Git-Session geklickt. Sanfter Info-State statt rotem
  // Alert mit nutzlosem Retry-Button (re-invoke would yield the same error).
  const isNonGitInfo = error !== null && /not a git repository/i.test(error);

  return (
    <div className="flex flex-col h-screen w-screen bg-surface-base text-neutral-200">
      <div className="px-4 py-3 border-b border-neutral-700 flex items-center gap-2">
        <h1 className="text-xs font-bold uppercase tracking-widest text-neutral-300">
          Session-Diff
        </h1>
        {sessionId && (
          <span className="font-mono text-[10px] text-neutral-500 truncate">
            {sessionId}
          </span>
        )}
      </div>

      {frozen && (
        <div
          role="status"
          className="px-4 py-2 border-b border-warning bg-warning-a10 text-xs text-warning"
        >
          Session beendet — Diff eingefroren. Refresh deaktiviert.
        </div>
      )}

      {error && isNonGitInfo && (
        <div
          role="status"
          className="px-4 py-3 border-b border-neutral-700 bg-neutral-800 text-xs text-neutral-300"
        >
          Ordner ist kein Git-Repository — kein Diff verfuegbar.
        </div>
      )}

      {error && !isNonGitInfo && (
        <div
          role="alert"
          className="m-3 rounded-md border border-error bg-error/10 px-4 py-3 flex flex-col gap-2"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-error shrink-0" aria-hidden="true" />
            <span className="text-sm font-medium text-error">Diff konnte nicht geladen werden</span>
          </div>
          <p className="text-xs text-neutral-400">
            Die Session ist moeglicherweise nicht mehr aktiv oder das Backend antwortet nicht.
            Technische Details: <code className="font-mono text-[11px] text-neutral-300">{error}</code>
          </p>
          <div className="flex gap-2 mt-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => loadDiff().catch((e) => logError("DiffWindowView.retry", e))}
              disabled={refreshing}
            >
              Erneut versuchen
            </Button>
            <Button variant="ghost" size="sm" onClick={() => window.close()}>
              Fenster schliessen
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="w-72 border-r border-neutral-700 shrink-0">
          <DiffFileList
            files={diff?.files ?? []}
            selectedIndex={selectedFileIndex}
            onSelect={setSelectedFileIndex}
          />
        </div>
        <div className="flex-1 min-w-0">
          {selectedFile ? (
            <DiffMergeView file={selectedFile} mode={viewMode} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-8">
              <GitCompare className="w-10 h-10 text-neutral-600" strokeWidth={1.5} aria-hidden="true" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-neutral-300">
                  {refreshing ? "Lade Diff..." : "Keine Datei ausgewaehlt"}
                </p>
                <p className="text-xs text-neutral-500 max-w-xs">
                  {refreshing
                    ? "Einen Moment, das Diff wird aus dem Worktree geladen."
                    : "Waehle links eine geaenderte Datei, um den Diff anzuzeigen."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <DiffWindowFooter
        diff={diff}
        mode={viewMode}
        onModeChange={setViewMode}
        onRefresh={() => loadDiff().catch((e) => logError("DiffWindowView.refresh", e))}
        refreshing={refreshing}
        frozen={frozen}
      />
    </div>
  );
}
