import { create } from "zustand";
import { logWarn } from "../utils/errorLogger";
import { recordPerf } from "../utils/perfLogger";
import {
  MAX_GRID_SLOTS,
  pickGridFocus,
  foldActiveIntoComposition,
} from "../components/sessions/sessionGridLayout";

// ============================================================================
// Types
// ============================================================================

// "bash"/"zsh" seit der macOS-Unterstuetzung — das Rust-Backend loest die
// Preference plattformbewusst auf und echot die konkrete Shell zurueck.
export type SessionShell = "powershell" | "cmd" | "gitbash" | "bash" | "zsh";

export type LayoutMode = "single" | "grid";

export type SessionStatus =
  | "starting"     // PTY wird gespawnt
  | "running"      // Claude laeuft, Output kommt
  | "waiting"      // Claude wartet auf User-Input (Heuristik)
  | "done"         // Prozess beendet, Exit-Code 0
  | "error";       // Prozess beendet, Exit-Code != 0

export interface ClaudeSession {
  id: string;
  title: string;
  displayId?: string;            // 4-Char Base36 (z.B. "3K2X") — visuelle Disambiguation,
                                 // auto-generiert bei Create, gecleared bei Rename.
  folder: string;
  shell: SessionShell;
  claudeSessionId?: string;      // Claude CLI Session-UUID fuer Resume
  status: SessionStatus;
  createdAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  lastOutputAt: number;          // Fuer "wartet"-Heuristik
  lastOutputSnippet: string;     // Letzte ~200 Zeichen fuer Status-Anzeige
  /** Set bei Session-Start vom Rust-Backend — gibt an, ob ein Snapshot moeglich war. */
  isGitRepo?: boolean;
  /** Snapshot-Commit-Hash, der dem Diff-Window als Baseline dient. */
  snapshotCommit?: string;
  /**
   * Live-State: existiert aktuell ein Diff zwischen Snapshot und Working-Tree?
   * `undefined` = noch nicht geprueft, `false` = clean, `true` = Aenderungen vorhanden.
   * Reaktiv aktualisiert via `session-output` debounce + `session-status`-Transitions.
   * Kontrolliert die Sichtbarkeit des Diff-Icons auf der Session-Card.
   */
  hasDiff?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_SESSIONS = 8;
const DISPLAY_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const DISPLAY_ID_LENGTH = 4;
const DISPLAY_ID_MAX_ATTEMPTS = 100;

/**
 * Generates a 4-Char Base36 display-ID, kollisionsfrei gegen die existierenden Sessions.
 * 36^4 = 1.679.616 Kombinationen — bei realistischen Session-Counts (<100) faktisch immer beim ersten Versuch unique.
 * Re-Roll-Loop schuetzt vor dem astronomisch unwahrscheinlichen Kollisionsfall.
 */
export function generateUniqueDisplayId(existingSessions: ClaudeSession[]): string {
  const taken = new Set(
    existingSessions
      .map((s) => s.displayId)
      .filter((d): d is string => Boolean(d)),
  );
  for (let attempt = 0; attempt < DISPLAY_ID_MAX_ATTEMPTS; attempt++) {
    let candidate = "";
    for (let i = 0; i < DISPLAY_ID_LENGTH; i++) {
      candidate += DISPLAY_ID_ALPHABET[Math.floor(Math.random() * DISPLAY_ID_ALPHABET.length)];
    }
    if (!taken.has(candidate)) return candidate;
  }
  // Fall-through: ~1.6M aktive Sessions noetig — praktisch unerreichbar. Letzten Kandidat zurueckgeben.
  return Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(DISPLAY_ID_LENGTH, "0");
}

// ============================================================================
// State Interface
// ============================================================================

export interface SessionState {
  sessions: ClaudeSession[];
  activeSessionId: string | null;

  // Layout state (transient — not persisted)
  layoutMode: LayoutMode;
  gridSessionIds: string[];
  focusedGridSessionId: string | null;

  // Actions
  addSession: (params: {
    id: string;
    title: string;
    displayId?: string;
    folder: string;
    shell: SessionShell;
    claudeSessionId?: string;
    isGitRepo?: boolean;
    snapshotCommit?: string;
  }) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  updateStatus: (id: string, status: SessionStatus) => void;
  setExitCode: (id: string, exitCode: number) => void;
  renameSession: (id: string, title: string) => void;
  setClaudeSessionId: (id: string, claudeSessionId: string) => void;
  updateLastOutput: (id: string, snippet: string) => void;
  setSessionHasDiff: (id: string, hasDiff: boolean) => void;
  reorderSessions: (orderedIds: string[]) => void;

  // Layout actions
  setLayoutMode: (mode: LayoutMode) => void;
  addToGrid: (id: string) => void;
  removeFromGrid: (id: string) => void;
  setFocusedGridSession: (id: string | null) => void;
  maximizeGridSession: (id: string) => void;
}

// ============================================================================
// Transition Guard
// ============================================================================

const TERMINAL_STATUSES: ReadonlySet<SessionStatus> = new Set(["done", "error"]);

/**
 * Returns false if `from` is a terminal state — done/error sessions are final.
 * All forward transitions from non-terminal states are allowed.
 */
function canTransition(_from: SessionStatus, _to: SessionStatus): boolean {
  return !TERMINAL_STATUSES.has(_from);
}

// ============================================================================
// Store
// ============================================================================

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: null,
  layoutMode: "single",
  gridSessionIds: [],
  focusedGridSessionId: null,

  addSession: (params) =>
    set((state) => {
      if (state.sessions.some((s) => s.id === params.id)) return state;
      if (state.sessions.length >= MAX_SESSIONS) {
        logWarn("sessionStore", `Max sessions (${MAX_SESSIONS}) erreicht.`);
        return state;
      }
      const session: ClaudeSession = {
        id: params.id,
        title: params.title,
        displayId: params.displayId,
        folder: params.folder,
        shell: params.shell,
        claudeSessionId: params.claudeSessionId,
        status: "starting",
        createdAt: Date.now(),
        finishedAt: null,
        exitCode: null,
        lastOutputAt: Date.now(),
        lastOutputSnippet: "",
        isGitRepo: params.isGitRepo,
        snapshotCommit: params.snapshotCommit,
      };
      return {
        sessions: [...state.sessions, session],
        activeSessionId: params.id,
      };
    }),

  removeSession: (id) =>
    set((state) => {
      const remaining = state.sessions.filter((s) => s.id !== id);
      const newGridIds = state.gridSessionIds.filter((gid) => gid !== id);
      return {
        sessions: remaining,
        activeSessionId:
          state.activeSessionId === id
            ? (remaining[remaining.length - 1]?.id ?? null)
            : state.activeSessionId,
        gridSessionIds: newGridIds,
        focusedGridSessionId:
          state.focusedGridSessionId === id
            ? (newGridIds[0] ?? null)
            : state.focusedGridSessionId,
        layoutMode: newGridIds.length === 0 && state.layoutMode === "grid" ? "single" : state.layoutMode,
      };
    }),

  setActiveSession: (id) =>
    set((state) => {
      if (id === null) return { activeSessionId: null };
      if (state.sessions.some((s) => s.id === id)) return { activeSessionId: id };
      return state;
    }),

  updateStatus: (id, status) =>
    set((state) => {
      const t0 = performance.now();
      const session = state.sessions.find((s) => s.id === id);
      if (!session) return state;
      // Skip redundant updates — avoids Zustand notifications when status is unchanged.
      if (session.status === status) return state;
      if (!canTransition(session.status, status)) {
        logWarn("sessionStore", `Ignored invalid transition ${session.status}→${status} for session ${id}`);
        return state;
      }
      const result = {
        sessions: state.sessions.map((s) =>
          s.id === id
            ? {
                ...s,
                status,
                finishedAt:
                  status === "done" || status === "error"
                    ? Date.now()
                    : status === "running" || status === "starting" || status === "waiting"
                      ? null
                      : s.finishedAt,
              }
            : s
        ),
      };
      recordPerf("store-update", "updateStatus", performance.now() - t0);
      return result;
    }),

  setExitCode: (id, exitCode) =>
    set((state) => {
      const session = state.sessions.find((s) => s.id === id);
      if (!session) return state;
      if (TERMINAL_STATUSES.has(session.status)) {
        logWarn("sessionStore", `Ignored setExitCode on terminal session ${id} (${session.status})`);
        return state;
      }
      return {
        sessions: state.sessions.map((s) =>
          s.id === id
            ? {
                ...s,
                exitCode,
                status: exitCode === 0 ? "done" : "error",
                finishedAt: Date.now(),
              }
            : s
        ),
      };
    }),

  renameSession: (id, title) =>
    set((state) => ({
      // Rename = User uebernimmt explizit den Titel. Auto-displayId wird damit obsolet
      // und gecleared, sodass der manuelle Name allein die Disambiguation traegt.
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, title, displayId: undefined } : s
      ),
    })),

  setClaudeSessionId: (id, claudeSessionId) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, claudeSessionId } : s
      ),
    })),

  updateLastOutput: (id, snippet) =>
    set((state) => {
      const t0 = performance.now();
      const result = {
        sessions: state.sessions.map((s) =>
          s.id === id
            ? { ...s, lastOutputAt: Date.now(), lastOutputSnippet: snippet }
            : s
        ),
      };
      recordPerf("store-update", "updateLastOutput", performance.now() - t0);
      return result;
    }),

  setSessionHasDiff: (id, hasDiff) =>
    set((state) => {
      const session = state.sessions.find((s) => s.id === id);
      // Skip redundante Updates — vermeidet Zustand-Notifications (und damit
      // React-Re-Renders aller subscribed Cards) wenn der Probe-Wert sich
      // gegenueber dem letzten Stand nicht geaendert hat.
      if (!session || session.hasDiff === hasDiff) return state;
      return {
        sessions: state.sessions.map((s) =>
          s.id === id ? { ...s, hasDiff } : s
        ),
      };
    }),

  reorderSessions: (orderedIds) =>
    set((state) => {
      const byId = new Map(state.sessions.map((s) => [s.id, s]));
      const reordered = orderedIds
        .map((id) => byId.get(id))
        .filter((s): s is ClaudeSession => s !== undefined);
      const seen = new Set(orderedIds);
      const remaining = state.sessions.filter((s) => !seen.has(s.id));
      return { sessions: [...reordered, ...remaining] };
    }),

  // Layout actions
  setLayoutMode: (mode) =>
    set((state) => {
      if (mode === "grid") {
        const existingIds = new Set(state.sessions.map((s) => s.id));

        // 1) Preserve the previous grid composition if any of its sessions still exist.
        //    This keeps the user's hand-curated grid (count + identity + order = slot
        //    assignment via GRID_AREAS) across single↔grid toggles. Without this,
        //    every switch back to grid wiped the selection and re-applied first-4-active.
        //    "Expand current view to grid": fold the just-viewed activeSessionId into
        //    the preserved composition (append with room, evict-last when full) so the
        //    grid button lands the user on the session they were working on.
        const preserved = state.gridSessionIds.filter((id) => existingIds.has(id));
        if (preserved.length > 0) {
          const activeIfExists =
            state.activeSessionId && existingIds.has(state.activeSessionId)
              ? state.activeSessionId
              : null;
          const composition = foldActiveIntoComposition(
            preserved,
            activeIfExists,
            MAX_GRID_SLOTS
          );
          return {
            layoutMode: mode,
            gridSessionIds: composition,
            focusedGridSessionId: pickGridFocus(
              state.activeSessionId,
              state.focusedGridSessionId,
              composition
            ),
          };
        }
        // 2) Fallback: auto-fill with up to MAX_GRID_SLOTS active/waiting/starting
        //    sessions (first run, or all previously-gridded sessions were closed).
        const activeIds = state.sessions
          .filter((s) => s.status === "running" || s.status === "waiting" || s.status === "starting")
          .slice(0, MAX_GRID_SLOTS)
          .map((s) => s.id);
        const gridIds =
          activeIds.length > 0 ? activeIds : state.activeSessionId ? [state.activeSessionId] : [];

        // Empty-grid deadlock guard: refusing the transition is safer than landing
        // in layoutMode="grid" with gridSessionIds=[]. That state is a UI dead-end
        // — no terminals render, the only escape is the toolbar toggle, and the
        // next addSession would land in grid even if the user expected single.
        // Stays in whatever mode was before; the next addSession can flip later.
        if (gridIds.length === 0) {
          return state;
        }

        return {
          layoutMode: mode,
          gridSessionIds: gridIds,
          focusedGridSessionId: pickGridFocus(
            state.activeSessionId,
            state.focusedGridSessionId,
            gridIds
          ),
        };
      }
      return { layoutMode: mode };
    }),

  addToGrid: (id) =>
    set((state) => {
      // Existence guard prevents dangling grid members regardless of caller
      // correctness — SessionManagerView.resolveGridArea / isVisible look up
      // by session id, and a phantom id would silently allocate a grid slot
      // with no terminal to render in it.
      if (!state.sessions.some((s) => s.id === id)) return state;
      if (state.gridSessionIds.length >= MAX_GRID_SLOTS) return state;
      if (state.gridSessionIds.includes(id)) return state;
      return {
        gridSessionIds: [...state.gridSessionIds, id],
        focusedGridSessionId: id,
      };
    }),

  removeFromGrid: (id) =>
    set((state) => {
      const newIds = state.gridSessionIds.filter((gid) => gid !== id);
      return {
        gridSessionIds: newIds,
        focusedGridSessionId:
          state.focusedGridSessionId === id
            ? (newIds[0] ?? null)
            : state.focusedGridSessionId,
        layoutMode: newIds.length === 0 ? "single" : state.layoutMode,
      };
    }),

  setFocusedGridSession: (id) =>
    set({ focusedGridSessionId: id }),

  maximizeGridSession: (id) =>
    set({
      layoutMode: "single",
      activeSessionId: id,
    }),
}));

// ============================================================================
// Selectors
// ============================================================================

export const selectActiveSession = (state: SessionState) =>
  state.sessions.find((s) => s.id === state.activeSessionId);

/**
 * The session whose project context is currently in focus, layout-aware.
 *
 * In grid layout the user focuses cells via `focusedGridSessionId` WITHOUT
 * changing `activeSessionId` (the two IDs are deliberately independent — see
 * the grid/single separation in this store). Project-scoped panels (notes,
 * library config, kanban folder) must follow the focused grid cell, not the
 * last-maximized session. Falls back to `activeSessionId` when no grid cell is
 * focused, and always uses `activeSessionId` in single mode — so single-mode
 * behaviour is unchanged.
 */
export const selectEffectiveSession = (state: SessionState) => {
  const id =
    state.layoutMode === "grid"
      ? (state.focusedGridSessionId ?? state.activeSessionId)
      : state.activeSessionId;
  return state.sessions.find((s) => s.id === id);
};

export const selectSessionCounts = (state: SessionState) => ({
  active: state.sessions.filter((s) => s.status === "running" || s.status === "starting").length,
  waiting: state.sessions.filter((s) => s.status === "waiting").length,
  done: state.sessions.filter((s) => s.status === "done").length,
  error: state.sessions.filter((s) => s.status === "error").length,
  total: state.sessions.length,
});
