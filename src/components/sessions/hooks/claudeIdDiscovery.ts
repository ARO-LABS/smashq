import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../../../store/sessionStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { logError, logWarn } from "../../../utils/errorLogger";

// Private type — backend already sends started_at, only the TS type was missing
export interface ClaudeHistoryEntry {
  session_id: string;
  started_at: string; // ISO-8601, e.g. "2026-04-13T10:05:00.000Z"
}

const DISCOVERY_MAX_RETRIES = 5;
const DISCOVERY_RETRY_DELAY_MS = 3_000;
// 10s covers the gap between React session creation (Date.now()) and the moment
// Claude CLI writes started_at to its session file, plus any clock skew
const DISCOVERY_TIMESTAMP_TOLERANCE_MS = 10_000;

/**
 * Pick the best history entry to attach to a session by Claude session UUID.
 *
 * Two callers (this hook and tests) need this exact logic, so it lives as a
 * pure helper. The previous implementation took `history.find()` over a
 * timestamp window — i.e. the *newest unclaimed* entry. That misassigns
 * UUIDs when multiple sessions are spawned in quick succession in the same
 * folder: the first discovery to dispatch latches onto the newest jsonl,
 * even though that jsonl belongs to the most recently started card.
 *
 * Correct heuristic: pick the unclaimed entry whose `started_at` is
 * **closest** to `sessionCreatedAt` — Claude CLI writes its session file
 * a few hundred ms after spawn, so the closest match is the right one.
 *
 * Returns null when no candidate falls inside the tolerance window or all
 * candidates are already claimed.
 */
export function pickBestHistoryMatch(
  history: readonly ClaudeHistoryEntry[],
  sessionCreatedAt: number,
  isClaimed: (sessionId: string) => boolean,
  toleranceMs: number = DISCOVERY_TIMESTAMP_TOLERANCE_MS,
): ClaudeHistoryEntry | null {
  let best: { entry: ClaudeHistoryEntry; diff: number } | null = null;

  for (const entry of history) {
    if (isClaimed(entry.session_id)) continue;
    const ts = new Date(entry.started_at).getTime();
    if (Number.isNaN(ts)) continue;
    const diff = Math.abs(ts - sessionCreatedAt);
    if (diff > toleranceMs) continue;
    if (!best || diff < best.diff) {
      best = { entry, diff };
    }
  }

  return best?.entry ?? null;
}

/**
 * The claudeSessionId-discovery state machine, lifted out of
 * `useSessionEvents` into a factory so the hook stays a thin listener
 * registrar. The factory OWNS the three mutable closures the machine needs
 * (`retryMap`, `claimedIds`, `scannedSessions`), the recursive `setTimeout`
 * retry loop, BOTH resolution paths (the deterministic
 * `session-claude-id-resolved` event AND the `started_at`-proximity scan
 * fallback), and the single cross-store write seam (sessionStore.setClaudeSessionId
 * + settingsStore.setSessionTitleOverride).
 *
 * One instance is created per `useSessionEvents` effect run; `cleanup()`
 * cancels every pending retry timer and resets state — mirroring the
 * original hook's single-cleanup semantics (StrictMode / hot-reload safe).
 */
export interface ClaudeIdDiscovery {
  /**
   * Handle a `session-status` event payload. On the first "running" status
   * for a session without a claudeSessionId, schedules scan-based discovery
   * after the standard retry delay.
   */
  onSessionStatus: (id: string, status: string) => void;
  /**
   * Handle a deterministic `session-claude-id-resolved` event: write the
   * resolved UUID to the store and (if absent) seed the title override.
   */
  onResolvedEvent: (id: string, claudeSessionId: string) => void;
  /**
   * Cancel all pending retry timers and reset claim/scan/retry state. Called
   * from the hook's single effect-cleanup on unmount / deps-change.
   */
  cleanup: () => void;
}

export function createClaudeIdDiscovery(): ClaudeIdDiscovery {
  const scannedSessions = new Set<string>();
  // Tracks retry attempts and pending timer IDs per session tab-id
  const retryMap = new Map<
    string,
    { count: number; timerId: ReturnType<typeof setTimeout> }
  >();
  // Tracks claudeSessionIds already claimed by another tab in this factory
  // instance. Combined with a live sessionStore check below, the pair survives
  // an effect remount (StrictMode / hot-reload) — a fresh Set wouldn't see
  // older sessions, but the store does.
  const claimedIds = new Set<string>();

  /**
   * True if the given Claude UUID is already attached to some session
   * — either claimed locally in this discovery wave, or already persisted
   * on a session in the store (defense across effect remounts).
   */
  function isClaudeIdClaimed(sessionId: string): boolean {
    if (claimedIds.has(sessionId)) return true;
    return useSessionStore
      .getState()
      .sessions.some((s) => s.claudeSessionId === sessionId);
  }

  async function discoverClaudeSessionId(
    id: string,
    attempt: number,
  ): Promise<void> {
    const session = useSessionStore
      .getState()
      .sessions.find((s) => s.id === id);
    // Abort if session was removed or already has an ID assigned
    if (!session || session.claudeSessionId) return;

    try {
      const history = await invoke<ClaudeHistoryEntry[]>(
        "scan_claude_sessions",
        { folder: session.folder },
      );

      if (history && history.length > 0) {
        // Pick the unclaimed entry whose started_at is closest to
        // session.createdAt — Claude CLI writes the session file shortly
        // after spawn, so the closest jsonl is the right one. Avoids the
        // "newest first" misassignment when 3 sessions spawn within 1s.
        const match = pickBestHistoryMatch(
          history,
          session.createdAt,
          isClaudeIdClaimed,
        );

        if (match) {
          claimedIds.add(match.session_id);
          retryMap.delete(id);
          useSessionStore.getState().setClaudeSessionId(id, match.session_id);

          // Only write title override if none exists yet — never overwrite a
          // user-set override with an auto-discovered default title (bug fix)
          const overrides = useSettingsStore.getState().sessionTitleOverrides;
          // Re-fetch session after setClaudeSessionId in case it was updated
          const refreshedSession = useSessionStore
            .getState()
            .sessions.find((s) => s.id === id);
          if (refreshedSession?.title?.trim() && !overrides[match.session_id]) {
            useSettingsStore
              .getState()
              .setSessionTitleOverride(match.session_id, refreshedSession.title);
          }
          return;
        }
      }
    } catch {
      logWarn(
        "useSessionEvents",
        `Claude-Session-ID für "${session.folder}" nicht ermittelt (Versuch ${attempt})`,
      );
    }

    // No match found — retry up to DISCOVERY_MAX_RETRIES times
    const nextAttempt = attempt + 1;
    if (nextAttempt <= DISCOVERY_MAX_RETRIES) {
      const timerId = setTimeout(() => {
        discoverClaudeSessionId(id, nextAttempt).catch((e) =>
          logError("useSessionEvents.discovery.retry", e),
        );
      }, DISCOVERY_RETRY_DELAY_MS);
      retryMap.set(id, { count: nextAttempt, timerId });
    } else {
      retryMap.delete(id);
      logWarn(
        "useSessionEvents",
        `Discovery für "${session.folder}" nach ${DISCOVERY_MAX_RETRIES} Versuchen aufgegeben`,
      );
    }
  }

  function onSessionStatus(id: string, status: string): void {
    // Once a session is running, detect its Claude CLI session ID
    if (status === "running" && !scannedSessions.has(id)) {
      scannedSessions.add(id);
      const session = useSessionStore
        .getState()
        .sessions.find((s) => s.id === id);
      if (session && !session.claudeSessionId) {
        // Delay to let Claude CLI create its session file, then start discovery
        const timerId = setTimeout(() => {
          discoverClaudeSessionId(id, 1).catch((e) =>
            logError("useSessionEvents.discovery", e),
          );
        }, DISCOVERY_RETRY_DELAY_MS);
        retryMap.set(id, { count: 1, timerId });
      }
    }
  }

  function onResolvedEvent(id: string, claudeSessionId: string): void {
    // Deterministic claudeSessionId resolution emitted by the Rust watcher
    // thread once the freshly-spawned session's jsonl file appears in
    // ~/.claude/projects/<slug>/. Replaces the started_at proximity heuristic
    // for fresh spawns — the heuristic stays only as a fallback path for
    // edge cases (resume scans, watcher timeout). The check `!session` and
    // the override-existence guard mirror the discovery path so behaviour
    // stays consistent regardless of which path resolved first.
    const session = useSessionStore
      .getState()
      .sessions.find((s) => s.id === id);
    if (!session) return;

    useSessionStore.getState().setClaudeSessionId(id, claudeSessionId);

    const overrides = useSettingsStore.getState().sessionTitleOverrides;
    if (session.title?.trim() && !overrides[claudeSessionId]) {
      useSettingsStore
        .getState()
        .setSessionTitleOverride(claudeSessionId, session.title);
    }
  }

  function cleanup(): void {
    // Cancel any pending discovery retries to prevent stale callbacks after unmount
    retryMap.forEach(({ timerId }) => clearTimeout(timerId));
    retryMap.clear();
    scannedSessions.clear();
    claimedIds.clear();
  }

  return { onSessionStatus, onResolvedEvent, cleanup };
}
