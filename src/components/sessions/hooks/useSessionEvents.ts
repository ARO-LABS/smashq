import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { createEventTracker } from "../../../utils/perfLogger";
import { useSessionStore } from "../../../store/sessionStore";
import { logError, logWarn } from "../../../utils/errorLogger";
import { createClaudeIdDiscovery } from "./claudeIdDiscovery";

// Re-export the discovery helper + type from their new home so existing
// importers (and unit tests) keep their `from "./useSessionEvents"` path.
export {
  pickBestHistoryMatch,
  type ClaudeHistoryEntry,
} from "./claudeIdDiscovery";

const trackSessionOutput = createEventTracker("session-output");

// session-output coalescing: cap the per-session buffer, debounce the store write,
// and trim the persisted tail so lastOutput stays a short snippet.
const OUTPUT_BUFFER_MAX_CHARS = 500;
const OUTPUT_SNIPPET_TAIL_CHARS = 200;
const OUTPUT_DEBOUNCE_MS = 300;

/**
 * Fragt das Rust-Backend, ob die Session aktuell einen Diff zum Snapshot
 * hat, und spielt das Ergebnis in den Store ein. Schluckt Fehler still —
 * Diff-Probes sind opportunistisch, eine fehlgeschlagene Probe darf nie
 * den Session-Manager stoeren. Race-safe: prueft im Result-Handler, ob
 * die Session ueberhaupt noch existiert.
 *
 * Seit 2026-05-27 nur noch von Status-Event-Handler getriggert (running,
 * waiting, done, error). Die frühere Output-Chunk-Debounce-Loop wurde
 * entfernt — sie hat pro 2h-Session ~1900 Probes erzeugt; die Status-Pfade
 * decken Live-Updates ausreichend ab und der lazy-scan im DiffActionButton
 * holt verspätete Refreshes on-demand.
 */
async function probeSessionHasDiff(sessionId: string): Promise<void> {
  try {
    const hasDiff = await invoke<boolean>("session_has_diff", { sessionId });
    if (!useSessionStore.getState().sessions.some((s) => s.id === sessionId)) {
      // Session waehrend Probe geschlossen — Setter wuerde no-op machen,
      // aber expliziter Guard erspart den Map-Walk.
      return;
    }
    useSessionStore.getState().setSessionHasDiff(sessionId, hasDiff);
  } catch (err) {
    logWarn("useSessionEvents.probeDiff", String(err));
  }
}

/**
 * Registers Tauri event listeners for core session lifecycle:
 * session-output, session-exit, session-claude-id-resolved, session-status.
 *
 * The claudeSessionId-discovery state machine (retry/claim/scan dedup, the
 * deterministic event path, the started_at-proximity fallback, and the
 * cross-store title-override write) lives behind the `claudeIdDiscovery`
 * factory — this hook only registers listeners and delegates to it.
 *
 * Agent/pipeline events (agent-detected, agent-completed, etc.) are
 * disabled — the pipeline feature is not production-ready.
 */
export function useSessionEvents(): void {
  const lastOutputTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const outputBuffers = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const unlisteners: Array<Promise<() => void>> = [];
    const timers = lastOutputTimers.current;
    const buffers = outputBuffers.current;
    const discovery = createClaudeIdDiscovery();

    // session-output -> update lastOutput in store
    function handleOutput(event: { payload?: { id?: unknown; data?: unknown } }): void {
      try {
        trackSessionOutput();
        const id = event?.payload?.id;
        const data = event?.payload?.data;
        if (typeof id !== "string" || typeof data !== "string") return;

        let currentBuf = buffers.get(id) || "";
        currentBuf += data;
        if (currentBuf.length > OUTPUT_BUFFER_MAX_CHARS)
          currentBuf = currentBuf.slice(-OUTPUT_BUFFER_MAX_CHARS);
        buffers.set(id, currentBuf);

        if (!timers.has(id)) {
          timers.set(
            id,
            setTimeout(() => {
              const snippet =
                buffers.get(id)?.slice(-OUTPUT_SNIPPET_TAIL_CHARS) ?? "";
              useSessionStore.getState().updateLastOutput(id, snippet);
              timers.delete(id);
            }, OUTPUT_DEBOUNCE_MS),
          );
        }
      } catch (err) {
        logError("useSessionEvents.sessionOutput", err);
      }
    }
    unlisteners.push(
      listen<{ id: string; data: string }>("session-output", handleOutput),
    );

    // session-exit -> set exit code
    function handleExit(event: { payload?: { id?: unknown; exit_code?: unknown } }): void {
      try {
        const id = event?.payload?.id;
        const exitCode = event?.payload?.exit_code;
        // exit_code is an `unknown` payload field. A bare null-check + `as number`
        // cast let a string / NaN / Infinity through and corrupt the store.
        // Guard the real type before writing; non-finite numbers are dropped.
        if (typeof id !== "string") return;
        if (typeof exitCode !== "number" || !Number.isFinite(exitCode)) return;
        useSessionStore.getState().setExitCode(id, exitCode);
      } catch (err) {
        logError("useSessionEvents.sessionExit", err);
      }
    }
    unlisteners.push(
      listen<{ id: string; exit_code: number }>("session-exit", handleExit),
    );

    // session-claude-id-resolved -> deterministic UUID resolution (event path)
    function handleResolved(event: {
      payload?: { id?: unknown; claudeSessionId?: unknown };
    }): void {
      try {
        const id = event?.payload?.id;
        const claudeSessionId = event?.payload?.claudeSessionId;
        if (typeof id !== "string" || typeof claudeSessionId !== "string") {
          return;
        }
        discovery.onResolvedEvent(id, claudeSessionId);
      } catch (err) {
        logError("useSessionEvents.claudeIdResolved", err);
      }
    }
    unlisteners.push(
      listen<{ id: string; claudeSessionId: string }>(
        "session-claude-id-resolved",
        handleResolved,
      ),
    );

    // session-status -> update status, probe diff, detect Claude session ID
    function handleStatus(event: { payload?: { id?: unknown; status?: unknown } }): void {
      try {
        const id = event?.payload?.id;
        const status = event?.payload?.status;
        if (typeof id !== "string" || typeof status !== "string") return;
        if (
          status === "starting" ||
          status === "running" ||
          status === "waiting" ||
          status === "done" ||
          status === "error"
        ) {
          useSessionStore.getState().updateStatus(id, status);
        }

        // Status-Transitionen, die "Session lebt jetzt" signalisieren → Diff
        // pruefen. Vier Faelle abgedeckt:
        //   - running:        frische oder restored Session, die ohne Output
        //                     starten kann (Restore-Pfad → Icon fehlte sonst).
        //   - waiting:        Claude wartet auf User-Input, vorherige Aktion
        //                     evtl. mit Dateiaenderungen abgeschlossen.
        //   - done | error:   Prozess terminiert, evtl. ohne Output-Tail.
        // Probe ist idempotent (Rust laeuft `git diff --quiet`, billig) und
        // setSessionHasDiff ist redundanz-geguarded — mehrfaches Feuern ist
        // unschaedlich. Race-safe: probeSessionHasDiff prueft Session-Existenz.
        if (
          status === "running" ||
          status === "waiting" ||
          status === "done" ||
          status === "error"
        ) {
          probeSessionHasDiff(id).catch((e) =>
            logError("useSessionEvents.probeDiff.statusChange", e),
          );
        }
        // Once a session is running, detect its Claude CLI session ID
        discovery.onSessionStatus(id, status);
      } catch (err) {
        logError("useSessionEvents.sessionStatus", err);
      }
    }
    unlisteners.push(
      listen<{ id: string; status: string }>("session-status", handleStatus),
    );

    return () => {
      unlisteners.forEach((p) =>
        p
          .then((unlisten) => unlisten())
          .catch((e) => logError("useSessionEvents.cleanup", e)),
      );
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      buffers.clear();
      discovery.cleanup();
    };
  }, []);
}
