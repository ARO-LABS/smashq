import { useEffect, useRef, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useLogViewerStore,
  structuredToUnified,
  groupConsecutiveEntries,
  type LogSeverity,
  type LogSource,
  type StructuredEntry,
} from "../../store/logViewerStore";
import {
  logError,
  type LogEntryBroadcast,
  type LogSnapshotResponse,
} from "../../utils/errorLogger";
import { LogEntryRow, LOG_ROW_HEIGHT } from "./LogEntry";
import { LogViewerToolbar } from "./LogViewerToolbar";

// Granular selectors to avoid full re-renders on every state change
const selectEntries = (s: ReturnType<typeof useLogViewerStore.getState>) => s.entries;
const selectSeverityFilter = (s: ReturnType<typeof useLogViewerStore.getState>) => s.severityFilter;
const selectSourceFilter = (s: ReturnType<typeof useLogViewerStore.getState>) => s.sourceFilter;
const selectSearchText = (s: ReturnType<typeof useLogViewerStore.getState>) => s.searchText;
const selectLiveTail = (s: ReturnType<typeof useLogViewerStore.getState>) => s.liveTail;
const selectSessionStart = (s: ReturnType<typeof useLogViewerStore.getState>) => s.sessionStart;
const selectSortOrder = (s: ReturnType<typeof useLogViewerStore.getState>) => s.sortOrder;
const selectScope = (s: ReturnType<typeof useLogViewerStore.getState>) => s.scope;
const selectAddEntries = (s: ReturnType<typeof useLogViewerStore.getState>) => s.addEntries;
const selectClearEntries = (s: ReturnType<typeof useLogViewerStore.getState>) => s.clearEntries;
const selectSetSeverityFilter = (s: ReturnType<typeof useLogViewerStore.getState>) => s.setSeverityFilter;
const selectSetSourceFilter = (s: ReturnType<typeof useLogViewerStore.getState>) => s.setSourceFilter;
const selectSetSearchText = (s: ReturnType<typeof useLogViewerStore.getState>) => s.setSearchText;
const selectToggleLiveTail = (s: ReturnType<typeof useLogViewerStore.getState>) => s.toggleLiveTail;
const selectSetSortOrder = (s: ReturnType<typeof useLogViewerStore.getState>) => s.setSortOrder;
const selectSetScope = (s: ReturnType<typeof useLogViewerStore.getState>) => s.setScope;

export function LogViewer() {
  const entries = useLogViewerStore(selectEntries);
  const severityFilter = useLogViewerStore(selectSeverityFilter);
  const sourceFilter = useLogViewerStore(selectSourceFilter);
  const searchText = useLogViewerStore(selectSearchText);
  const liveTail = useLogViewerStore(selectLiveTail);
  const sessionStart = useLogViewerStore(selectSessionStart);
  const sortOrder = useLogViewerStore(selectSortOrder);
  const scope = useLogViewerStore(selectScope);
  const addEntries = useLogViewerStore(selectAddEntries);
  const clearEntries = useLogViewerStore(selectClearEntries);
  const setSeverityFilter = useLogViewerStore(selectSetSeverityFilter);
  const setSourceFilter = useLogViewerStore(selectSetSourceFilter);
  const setSearchText = useLogViewerStore(selectSetSearchText);
  const toggleLiveTail = useLogViewerStore(selectToggleLiveTail);
  const setSortOrder = useLogViewerStore(selectSetSortOrder);
  const setScope = useLogViewerStore(selectSetScope);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Load backend logs (can be triggered manually via refresh button or
  // automatically on mount). addEntries dedupes incoming entries against
  // those already in the store, so re-reading the same file is a no-op.
  const loadBackendLogs = useCallback(() => {
    invoke<StructuredEntry[]>("read_structured_log", { maxLines: 500 })
      .then((rows) => {
        const parsed = rows.map(structuredToUnified);
        if (parsed.length > 0) addEntries(parsed);
      })
      .catch((err) => logError("LogViewer.readStructuredLog", err));
  }, [addEntries]);

  // Hard truncate: window.confirm (established destructive-action pattern,
  // cf. ConfigPanelTabList), then Rust wipes file + rotated, then clear the view.
  const handleClear = useCallback(() => {
    if (!window.confirm("Gesamtes Protokoll unwiderruflich löschen (Datei + Verlauf)?")) return;
    invoke<void>("clear_structured_log")
      .then(() => clearEntries())
      .catch((err) => logError("LogViewer.clearLog", err));
  }, [clearEntries]);

  useEffect(() => {
    // Frontend logs flow into logViewerStore directly via errorLogger —
    // no separate subscription needed. Just refresh the on-disk structured
    // log on every mount; the store handles dedup.
    loadBackendLogs();
  }, [loadBackendLogs]);

  // Live event subscription: each backend log line arrives as a `log-line`
  // event (gated by backendFileLogging on the Rust side). Only subscribe while
  // live-tail is on; the store dedups any overlap with the initial read batch.
  useEffect(() => {
    if (!liveTail) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<StructuredEntry>("log-line", (e) => {
      if (!e.payload) return;
      addEntries([structuredToUnified(e.payload)]);
    })
      .then((u) => {
        // Cleanup may have already run while listen() was in flight (Live-
        // Toggle / unmount / StrictMode double-mount) → tear down now,
        // otherwise the listener leaks and bypasses the live-tail gate.
        if (cancelled) u();
        else unlisten = u;
      })
      .catch((err) => logError("LogViewer.listenLogLine", err));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [liveTail, addEntries]);

  // Cross-window sync: each webview holds its own logViewerStore instance, so
  // main-window frontend entries never reach this (detached) window on their
  // own. Subscribe to live entry broadcasts, then request a mount-time
  // snapshot from every other window; the store dedup (timestamp+source+
  // message) and MAX_ENTRIES cap bound the merge. sourceWindow filters the
  // echo of this window's own broadcasts.
  useEffect(() => {
    let unlistenEntry: (() => void) | undefined;
    let unlistenSnapshot: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const [{ listen, emit }, { getCurrentWindow }] = await Promise.all([
        import("@tauri-apps/api/event"),
        import("@tauri-apps/api/window"),
      ]);
      const myLabel = getCurrentWindow().label;
      const uEntry = await listen<LogEntryBroadcast>("frontend-log-entry", (e) => {
        if (!e.payload || e.payload.sourceWindow === myLabel) return;
        addEntries([structuredToUnified(e.payload.entry)]);
      });
      const uSnap = await listen<LogSnapshotResponse>("log-snapshot-response", (e) => {
        if (!e.payload || e.payload.sourceWindow === myLabel) return;
        addEntries(e.payload.entries ?? []);
      });
      if (cancelled) {
        uEntry();
        uSnap();
        return;
      }
      unlistenEntry = uEntry;
      unlistenSnapshot = uSnap;
      // Listener stehen — jetzt die Historie aller Fenster anfordern.
      await emit("log-snapshot-request", { sourceWindow: myLabel });
    })().catch((err) => logError("LogViewer.crossWindowLogs", err));
    return () => {
      cancelled = true;
      unlistenEntry?.();
      unlistenSnapshot?.();
    };
  }, [addEntries]);

  // Filter entries, then group consecutive identical ones
  const grouped = useMemo(() => {
    const lowerSearch = searchText.toLowerCase();
    const filtered = entries.filter((e) => {
      if (scope === "session" && e.timestamp < sessionStart) return false;
      if (!severityFilter.has(e.severity)) return false;
      if (!sourceFilter.has(e.source)) return false;
      if (lowerSearch && !e.message.toLowerCase().includes(lowerSearch)) return false;
      return true;
    });
    // Group on chronological order (consecutive-dedup depends on it). "desc"
    // reverses for newest-on-top; "asc" keeps chronological (oldest on top).
    const groups = groupConsecutiveEntries(filtered);
    return sortOrder === "desc" ? groups.reverse() : groups;
  }, [entries, severityFilter, sourceFilter, searchText, scope, sessionStart, sortOrder]);

  // Virtualizer for performant rendering
  const virtualizer = useVirtualizer({
    count: grouped.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LOG_ROW_HEIGHT,
    overscan: 20,
    // Dynamic measurement: expanded stack traces and wrapped messages are
    // taller than the 32px estimate. Without this, fixed offsets overlap.
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  // Auto-scroll to the top when liveTail is on — newest entry is at index 0.
  useEffect(() => {
    if (liveTail && grouped.length > 0) {
      virtualizer.scrollToIndex(0, { align: "start" });
    }
  }, [grouped.length, liveTail, virtualizer]);

  const toggleSeverity = (key: LogSeverity) => {
    const next = new Set(severityFilter);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSeverityFilter(next);
  };

  const toggleSource = (key: LogSource) => {
    const next = new Set(sourceFilter);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSourceFilter(next);
  };

  return (
    <div className="flex flex-col h-full bg-surface-base">
      <LogViewerToolbar
        severityFilter={severityFilter}
        sourceFilter={sourceFilter}
        searchText={searchText}
        liveTail={liveTail}
        sortOrder={sortOrder}
        scope={scope}
        onToggleSeverity={toggleSeverity}
        onToggleSource={toggleSource}
        onSearchChange={setSearchText}
        onToggleLiveTail={toggleLiveTail}
        onSetSortOrder={setSortOrder}
        onSetScope={setScope}
        onRefresh={loadBackendLogs}
        onClear={handleClear}
      />

      {/* Entry count */}
      <div className="flex items-center justify-between px-4 py-1 text-[10px] text-neutral-500 border-b border-neutral-800">
        <span>
          {grouped.length} Gruppen von {entries.length} Einträgen
        </span>
      </div>

      {/* Virtualized log list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {grouped.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-neutral-500 text-sm">
            Keine Logs vorhanden
          </div>
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={grouped[virtualRow.index].id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <LogEntryRow entry={grouped[virtualRow.index]} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
