import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { tauriStorage, getLoadedFavorites, getLoadedFavoriteGroups, getLoadedNotes, registerNoteFlush } from "./tauriStorage";
import { useUIStore } from "./uiStore";
import { logError, flushBeforeGateClose } from "../utils/errorLogger";
import { broadcastPreferencesChange } from "../utils/preferencesBroadcast";
import { isAccentName, normalizeAccentName, type AccentName } from "../utils/sessionAccent";

// ============================================================================
// Types
// ============================================================================

export interface FavoriteGroup {
  id: string;        // "grp-<ts>-<rand>"
  label: string;
  sortIndex: number; // 1000er steps
}

export interface FavoriteFolder {
  id: string;
  path: string;
  label: string;
  /**
   * Shell preference for Quick-Start sessions from this favorite. Defaults to
   * "auto" so the Rust backend resolves it per-platform (zsh on macOS, bash on
   * Linux, powershell on Windows) — a hardcoded Windows shell here used to make
   * Quick Start fail silently on macOS (favorites resolved to the absent
   * `pwsh`). The Windows-specific values remain valid for existing favorites.
   */
  shell: "auto" | "powershell" | "cmd" | "gitbash" | "bash" | "zsh";
  addedAt: number;
  lastUsedAt: number;
  // NEW (v5):
  groupId: string | null;
  sortIndex: number;
}

export interface ThemeSettings {
  mode: "dark" | "light";
  accentColor: string;
  reducedMotion: boolean;
  animationSpeed: number;
  /**
   * Opt-in: derive the xterm terminal theme from the app's design tokens so it
   * follows the light/dark switch. Default `false` — off, the terminal keeps
   * xterm's own defaults and never repaints on an app-mode toggle, so a running
   * program's colour expectations are not overridden. See SessionTerminal.tsx.
   */
  syncTerminalTheme: boolean;
}

export interface NotificationSettings {
  enabled: boolean;
  pipelineComplete: boolean;
  pipelineError: boolean;
  qaGateResult: boolean;
  costAlert: boolean;
}

export interface SoundSettings {
  enabled: boolean;
  volume: number;
}

export interface PipelineSettings {
  defaultMode: "mock" | "real";
  maxConcurrentWorktrees: number;
  autoRetryOnError: boolean;
  logBufferSize: number;
}

/**
 * Logging + UI toggles for daily-use performance.
 * All default to `false` — power-users opt in when actively debugging.
 */
export interface AppPreferencesSettings {
  /** Frontend-Logging aktiv? Speist den geteilten 1000-Eintrag-Log-Store. Toast-Output bleibt unabhängig. */
  frontendLogging: boolean;
  /** Disk-Persistenz aktiv? Schreibt app-log.ndjson (Frontend + Backend) via Tauri-Command. */
  backendFileLogging: boolean;
  /** perfLogger (IPC-Latenz, Render-Zeit) aktiv? Bereits DEV-only, dieses Toggle gated zusätzlich. */
  performanceProfiler: boolean;
  /**
   * xterm-Scrollback-Limit pro Terminal (Zeilen). Default 25_000 — eine
   * Claude-CLI-Session mit Tool-Calls + TUI-Repaints kann 5-10× mehr
   * Output produzieren als typische Shells, daher höher als der
   * xterm-Default (1000). Empfohlene Werte: 5_000 / 10_000 / 25_000 / 50_000.
   * Memory-Kosten: ~12 Bytes pro Cell × cols × scrollback. 25k @ 200 cols
   * ≈ 63 MB pro Terminal. 50k ≈ 126 MB.
   */
  scrollbackLines: number;
}

/** Allowed presets for the Settings-UI scrollback selector. */
export const SCROLLBACK_PRESETS = [5_000, 10_000, 25_000, 50_000] as const;
export type ScrollbackPreset = (typeof SCROLLBACK_PRESETS)[number];

/** Clamp + sanitize a candidate scrollback value to a known-safe preset. */
export function sanitizeScrollbackLines(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 25_000;
  }
  // Allow any positive integer in a sane band; UI only exposes presets.
  // Hard ceiling 100k to prevent settings-tampering OOM.
  return Math.max(1_000, Math.min(100_000, Math.floor(value)));
}

/** Erlaubte Permission-Modi fuer neue Sessions (Settings-UI + Persist). */
export const PERMISSION_MODES = ["default", "auto", "plan", "bypass"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/**
 * Coerce a persisted/UI permission-mode candidate to a known mode. Fail-safe
 * to "default" (Claudes Nachfragen) — NIE zu "bypass" — bei Unbekanntem,
 * falschem Typ oder fehlendem Feld. Geteilt zwischen Store-Default, migrate
 * und merge/onRehydrate (Issue-#209-Klasse).
 */
export function sanitizePermissionMode(value: unknown): PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value as string)
    ? (value as PermissionMode)
    : "default";
}

/**
 * Coerce persisted preferences into a clean AppPreferencesSettings. Strict
 * `=== true` on the bool gates: a corrupt string "true" would render the UI
 * toggle as on while the Rust bool-deserialization rejects it — logging
 * looks active but the file stays empty (silent loss). Shared by migrate
 * (schema bump) and onRehydrateStorage (same-version corruption recovery,
 * Issue-#209 class).
 */
export function sanitizePreferences(raw: unknown): AppPreferencesSettings {
  const p =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    frontendLogging: p.frontendLogging === true,
    backendFileLogging: p.backendFileLogging === true,
    performanceProfiler: p.performanceProfiler === true,
    scrollbackLines: sanitizeScrollbackLines(p.scrollbackLines),
  };
}

/** Floating-window size in CSS pixels. Used by NotesPanel via useDraggableWindow. */
export interface WindowSize {
  w: number;
  h: number;
}

/** Default size for the Notizen floating window (matches pre-resize layout). */
export const DEFAULT_NOTES_WINDOW_SIZE: WindowSize = { w: 384, h: 288 };

/**
 * Clamp + sanitize a candidate notes-window size. Bounds:
 *   width  in [280, 2400]
 *   height in [200, 1600]
 * Falls back to DEFAULT_NOTES_WINDOW_SIZE on any corruption (NaN, negative,
 * wrong type, missing field). Mirrors the sanitizeScrollbackLines pattern.
 */
export function sanitizeNotesWindowSize(value: unknown): WindowSize {
  const def = DEFAULT_NOTES_WINDOW_SIZE;
  if (!value || typeof value !== "object") return def;
  const v = value as Record<string, unknown>;
  const rawW = typeof v.w === "number" && Number.isFinite(v.w) ? v.w : def.w;
  const rawH = typeof v.h === "number" && Number.isFinite(v.h) ? v.h : def.h;
  return {
    w: Math.max(280, Math.min(2400, Math.floor(rawW))),
    h: Math.max(200, Math.min(1600, Math.floor(rawH))),
  };
}

/** Default size for the Tasks floating window. */
export const DEFAULT_TASKS_WINDOW_SIZE: WindowSize = { w: 348, h: 348 };

/**
 * Clamp + sanitize a candidate tasks-window size. Bounds:
 *   width  in [280, 2400]
 *   height in [200, 1600]
 * Falls back to DEFAULT_TASKS_WINDOW_SIZE on any corruption (NaN, negative,
 * wrong type, missing field). Mirrors sanitizeNotesWindowSize 1:1.
 */
export function sanitizeTasksWindowSize(value: unknown): WindowSize {
  const def = DEFAULT_TASKS_WINDOW_SIZE;
  if (!value || typeof value !== "object") return def;
  const v = value as Record<string, unknown>;
  const rawW = typeof v.w === "number" && Number.isFinite(v.w) ? v.w : def.w;
  const rawH = typeof v.h === "number" && Number.isFinite(v.h) ? v.h : def.h;
  return {
    w: Math.max(280, Math.min(2400, Math.floor(rawW))),
    h: Math.max(200, Math.min(1600, Math.floor(rawH))),
  };
}

/**
 * Sanitize the persisted `lastSeenVersion` (whats-new gating). Any non-string
 * or empty value degrades to null — null means "fresh install": the whats-new
 * modal is skipped and only the stamp is written.
 */
export function sanitizeLastSeenVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface ApiKeyMetadataEntry {
  id: string;
  provider: string;
  label: string;
  redactedKey: string;
  addedAt: number;
  lastUsedAt?: number;
  isValid: boolean;
}

/** User-pinned Markdown document inside a project folder. */
export interface PinnedDoc {
  id: string;
  /** Path relative to the project folder, forward-slashes, no `..`. */
  relativePath: string;
  /** Display label — defaults to the filename, user-editable. */
  label: string;
  addedAt: number;
}

// Session restore types
import type { SessionShell, LayoutMode } from "./sessionStore";

export interface RestorableSession {
  folder: string;
  title: string;
  shell: SessionShell;
  claudeSessionId?: string;      // Claude CLI Session-UUID fuer Resume
  /**
   * Original creation time (ms epoch) of the session card. Time anchor for
   * the restore-side scan fallback: when no claudeSessionId was persisted
   * (app quit before discovery finished), restore picks the history entry
   * whose started_at is CLOSEST to this anchor instead of blindly resuming
   * the newest session in the folder (wrong-session-restore bug).
   * Optional: absent on pre-anchor snapshots.
   */
  createdAt?: number;
  /**
   * Permission-Mode, mit dem die Session erzeugt wurde (Restart-Treue über
   * App-Neustarts hinweg, Issue #13). Optional: Legacy-Snapshots ohne Feld
   * fallen beim Restore auf den aktuellen Settings-Default zurück.
   */
  permissionMode?: PermissionMode;
}

export interface SessionRestoreData {
  enabled: boolean;
  sessions: RestorableSession[];
  /** Folder-key of the active session (stable across restore failures). */
  activeFolder: string | null;
  layoutMode: LayoutMode;
  /** Folder-keys of sessions shown in the grid. */
  gridFolders: string[];
}

/** Normalize a project folder path for use as a Record key. */
export function normalizeProjectKey(folder: string): string {
  return folder.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "");
}

/** Validate a relative path for a pinned document. Returns null if valid, else an error message. */
export function validatePinnedPath(relativePath: string): string | null {
  if (!relativePath || typeof relativePath !== "string") return "Pfad darf nicht leer sein";
  const trimmed = relativePath.trim();
  if (!trimmed) return "Pfad darf nicht leer sein";
  // Reject absolute paths (Windows: C:\, /foo, \\share)
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    return "Pfad muss relativ zum Projektordner sein";
  }
  // Reject traversal
  const normalized = trimmed.replace(/\\/g, "/");
  if (normalized.split("/").some((seg) => seg === "..")) {
    return "Path-Traversal nicht erlaubt ('..' im Pfad)";
  }
  // Only markdown extensions
  if (!/\.(md|markdown)$/i.test(normalized)) {
    return "Nur .md- oder .markdown-Dateien können angepinnt werden";
  }
  return null;
}

// ============================================================================
// State Interface
// ============================================================================

export interface SettingsState {
  theme: ThemeSettings;
  notifications: NotificationSettings;
  sound: SoundSettings;
  pipeline: PipelineSettings;
  preferences: AppPreferencesSettings;
  apiKeys: ApiKeyMetadataEntry[];
  favorites: FavoriteFolder[];
  favoriteGroups: FavoriteGroup[];
  locale: "de" | "en";
  defaultShell: "auto" | "powershell" | "bash" | "cmd" | "zsh";
  defaultPermissionMode: PermissionMode;
  defaultProjectPath: string;
  globalNotes: string;
  projectNotes: Record<string, string>;
  /** Pinned docs per project (key: normalized folder path). */
  pinnedDocs: Record<string, PinnedDoc[]>;
  /** Session restore state — persisted to restore sessions on next startup. */
  sessionRestore: SessionRestoreData;
  /** User-defined titles for Claude session IDs (history/resume override). */
  sessionTitleOverrides: Record<string, string>;
  /**
   * Rename intent keyed by the INTERNAL (stable-from-birth) session id, held
   * until the async `claudeSessionId` is known and the intent can be flushed
   * into `sessionTitleOverrides`. In-memory only (NOT persisted): the internal
   * id is regenerated each run, so persisting it across restarts is worthless.
   * Closes the rename-before-discovery gap where the override write was skipped.
   */
  pendingTitleOverrides: Record<string, string>;
  /**
   * App-Version, zu der das "Was ist neu"-Modal zuletzt gezeigt (bzw. beim
   * Erststart gestempelt) wurde. null = Erstinstallation. Gestempelt wird
   * beim ANZEIGEN, nicht beim Bestaetigen — verhindert Re-Show nach Crash.
   */
  lastSeenVersion: string | null;
  /** Per-Session-Akzentfarbe (key: claudeSessionId, value: AccentName). */
  sessionAccents: Record<string, string>;
  /**
   * Per-Projekt-Akzentfarbe (key: folder path, value: AccentName). Geteilt
   * zwischen Favorit UND allen Sessions desselben Ordners — "färbe das Projekt".
   * Schlägt in der Auflösung den Legacy-Per-Session-Override und den Hash.
   */
  folderAccents: Record<string, string>;
  /** Persisted size of the floating notes window. */
  notesWindowSize: WindowSize;
  /** Persisted size of the floating tasks window. */
  tasksWindowSize: WindowSize;

  // Actions
  setTheme: (partial: Partial<ThemeSettings>) => void;
  setNotifications: (partial: Partial<NotificationSettings>) => void;
  setSound: (partial: Partial<SoundSettings>) => void;
  setPipeline: (partial: Partial<PipelineSettings>) => void;
  setPreferences: (partial: Partial<AppPreferencesSettings>) => void;
  setLocale: (locale: "de" | "en") => void;
  setDefaultShell: (shell: SettingsState["defaultShell"]) => void;
  setDefaultPermissionMode: (mode: PermissionMode) => void;
  setDefaultProjectPath: (path: string) => void;
  setGlobalNotes: (notes: string) => void;
  setProjectNotes: (folder: string, notes: string) => void;

  setSessionRestore: (data: SessionRestoreData) => void;
  setSessionTitleOverride: (sessionId: string, title: string) => void;
  clearSessionTitleOverride: (sessionId: string) => void;
  /** Record a rename under the internal session id until the UUID resolves. */
  setPendingTitleOverride: (sessionId: string, title: string) => void;
  /**
   * Move a pending rename intent onto its resolved Claude UUID and clear it.
   * No-op when there is no pending entry for `sessionId`. Called at every seam
   * where a session gains a `claudeSessionId` (discovery, resolve, restore).
   */
  flushPendingTitleOverride: (sessionId: string, claudeSessionId: string) => void;
  setSessionAccent: (claudeSessionId: string, name: string) => void;
  clearSessionAccent: (claudeSessionId: string) => void;
  setFolderAccent: (folder: string, name: string) => void;
  clearFolderAccent: (folder: string) => void;
  /**
   * Remove all restore-state tied to a Claude session UUID — invoked AFTER
   * the session has been moved to the OS trash so persisted UI state does
   * not keep a dangling reference to a no-longer-existing transcript.
   * Cleans both `sessionRestore.sessions[]` (resume-on-startup list) and
   * `sessionTitleOverrides[id]` (custom-name map). No-op if neither has
   * an entry for this id.
   */
  removeRestorableSessionByClaudeId: (claudeSessionId: string) => void;

  setNotesWindowSize: (size: WindowSize) => void;
  setTasksWindowSize: (size: WindowSize) => void;
  setLastSeenVersion: (version: string) => void;

  addApiKeyMetadata: (entry: ApiKeyMetadataEntry) => void;
  removeApiKeyMetadata: (id: string) => void;
  updateApiKeyMetadata: (id: string, partial: Partial<Omit<ApiKeyMetadataEntry, "id">>) => void;

  addFavorite: (path: string, label?: string) => void;
  removeFavorite: (id: string) => void;
  updateFavoriteLastUsed: (id: string) => void;
  moveFavorite: (favId: string, targetGroupId: string | null, targetIndex: number) => void;
  reorderFavorites: (groupId: string | null, orderedIds: string[]) => void;

  addFavoriteGroup: (label: string) => string;
  renameFavoriteGroup: (id: string, label: string) => void;
  removeFavoriteGroup: (id: string, cascade: "unassign" | "delete") => void;
  reorderFavoriteGroups: (orderedIds: string[]) => void;

  /** Pin a markdown file from a project folder. Returns error message or null on success. */
  addPinnedDoc: (folder: string, relativePath: string, label?: string) => string | null;
  removePinnedDoc: (folder: string, pinId: string) => void;
  renamePinnedDoc: (folder: string, pinId: string, label: string) => void;

  resetToDefaults: () => void;
}

// ============================================================================
// Defaults
// ============================================================================

const defaultTheme: ThemeSettings = {
  mode: "dark",
  accentColor: "oklch(72% 0.14 230)", // accent azure
  reducedMotion: false,
  animationSpeed: 1.0,
  syncTerminalTheme: false,
};

const defaultNotifications: NotificationSettings = {
  enabled: true,
  pipelineComplete: true,
  pipelineError: true,
  qaGateResult: true,
  costAlert: true,
};

const defaultSound: SoundSettings = {
  enabled: false,
  volume: 0.5,
};

const defaultPipeline: PipelineSettings = {
  defaultMode: "mock",
  maxConcurrentWorktrees: 5,
  autoRetryOnError: false,
  logBufferSize: 200,
};

const defaultPreferences: AppPreferencesSettings = {
  frontendLogging: false,
  backendFileLogging: false,
  performanceProfiler: false,
  scrollbackLines: 25_000,
};

const defaultSessionRestore: SessionRestoreData = {
  enabled: true,
  sessions: [],
  activeFolder: null,
  layoutMode: "single",
  gridFolders: [],
};

// UUID-v4 regex (lowercase only — Claude CLI writes lowercase).
// Issue #209: persisted `claudeSessionId` must be format-validated so a
// tampered or stale settings.json cannot inject arbitrary strings into
// the `--resume <UUID>` Tauri command.
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Validate the persisted `sessionRestore` payload during hydration.
 *
 * Filters entries with invalid `claudeSessionId` (wrong type, malformed
 * UUID) AND deduplicates by `claudeSessionId` (first-seen wins, mirrors
 * the persist-time dedup in `sessionRestoreSync.ts`). Entries with
 * `claudeSessionId === undefined` are LEGITIMATE pre-discovery state
 * and are preserved unchanged.
 *
 * Called from BOTH `migrate` (schema upgrades) and `onRehydrateStorage`
 * (every hydration) so validation runs even when version matches and
 * migrate is bypassed.
 */
export function validateSessionRestore(raw: unknown): SessionRestoreData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaultSessionRestore;
  }
  const r = raw as Record<string, unknown>;
  const sessions = Array.isArray(r.sessions) ? r.sessions : [];
  const seenClaudeIds = new Set<string>();
  const cleanSessions: RestorableSession[] = [];
  for (const s of sessions) {
    if (!s || typeof s !== "object") continue;
    const entry = s as Record<string, unknown>;
    if (
      typeof entry.folder !== "string" ||
      typeof entry.title !== "string" ||
      typeof entry.shell !== "string"
    ) {
      continue;
    }
    let claudeSessionId: string | undefined;
    if (entry.claudeSessionId !== undefined) {
      if (typeof entry.claudeSessionId !== "string") continue;
      if (!UUID_V4_RE.test(entry.claudeSessionId)) continue;
      if (seenClaudeIds.has(entry.claudeSessionId)) continue;
      seenClaudeIds.add(entry.claudeSessionId);
      claudeSessionId = entry.claudeSessionId;
    }
    // createdAt is only a heuristic anchor — corrupt values degrade to
    // undefined (legacy behavior) instead of dropping the whole entry.
    const createdAt =
      typeof entry.createdAt === "number" &&
      Number.isFinite(entry.createdAt) &&
      entry.createdAt > 0
        ? entry.createdAt
        : undefined;
    // Unbekannt/korrupt/fehlend → undefined, Eintrag bleibt erhalten. Bewusst
    // NICHT sanitizePermissionMode: dessen "default"-Fail-safe würde Legacy-
    // Einträge auf "default" festnageln, statt sie beim Restore dem aktuellen
    // Settings-Default folgen zu lassen (undefined = "kein eigener Modus").
    const permissionMode = (PERMISSION_MODES as readonly string[]).includes(
      entry.permissionMode as string,
    )
      ? (entry.permissionMode as PermissionMode)
      : undefined;
    cleanSessions.push({
      folder: entry.folder,
      title: entry.title,
      shell: entry.shell as RestorableSession["shell"],
      claudeSessionId,
      createdAt,
      permissionMode,
    });
  }
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : defaultSessionRestore.enabled,
    sessions: cleanSessions,
    activeFolder: typeof r.activeFolder === "string" ? r.activeFolder : null,
    layoutMode: r.layoutMode === "grid" ? "grid" : "single",
    gridFolders: Array.isArray(r.gridFolders)
      ? r.gridFolders.filter((f): f is string => typeof f === "string")
      : [],
  };
}

// ============================================================================
// File persistence (Documents/Smashq/)
// ============================================================================

const isTauri = "__TAURI_INTERNALS__" in window;

// Debounce note saves to prevent excessive file I/O on every keystroke
const noteTimers = new Map<string, ReturnType<typeof setTimeout>>();
const NOTE_SAVE_DEBOUNCE_MS = 800;

function debouncedSaveNoteFile(noteKey: string, content: string): void {
  if (!isTauri) return;
  const existing = noteTimers.get(noteKey);
  if (existing) clearTimeout(existing);
  noteTimers.set(noteKey, setTimeout(() => {
    noteTimers.delete(noteKey);
    invoke("save_note_file", { noteKey, content }).catch((err) => {
      logError("settingsStore.saveNoteFile", err);
      window.dispatchEvent(new CustomEvent("storage-save-error", {
        detail: { error: `Note save failed: ${err}` },
      }));
    });
  }, NOTE_SAVE_DEBOUNCE_MS));
}

/** Flush all pending note saves immediately. */
function flushPendingNoteSaves(): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const [noteKey, timer] of noteTimers) {
    clearTimeout(timer);
    noteTimers.delete(noteKey);
    // We don't have the content in the timer, so read from store state
    const state = useSettingsStore.getState();
    const content = noteKey === "global"
      ? state.globalNotes
      : state.projectNotes[noteKey] ?? "";
    if (content) {
      promises.push(
        invoke("save_note_file", { noteKey, content })
          .then(() => {})
          .catch((err) => logError("settingsStore.noteFlush", err))
      );
    }
  }
  return Promise.all(promises).then(() => {});
}

// Register note flush so tauriStorage.flushPendingSaves() can call it
registerNoteFlush(flushPendingNoteSaves);

// ============================================================================
// remapAccentsRecord — extracted for testability
// ============================================================================

/** Cleaned accent-record: Legacy "cyan"→"azure" remap, unbekannte/leere verworfen. */
export function remapAccentsRecord(raw: unknown): Record<string, AccentName> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .map(([k, v]) => [k, normalizeAccentName(v)] as const)
      .filter((e): e is [string, AccentName] => typeof e[0] === "string" && !!e[0].trim() && e[1] !== null),
  );
}

// ============================================================================
// _settingsMigrate — extracted for testability
// ============================================================================

function _settingsMigrate(persisted: unknown, _fromVersion: number): SettingsState {
  // Deep-merge persisted data with defaults so new fields get defaults
  // while existing values are preserved. This prevents undefined fields
  // when the schema grows between app versions.
  const defaults = {
    theme: defaultTheme,
    notifications: defaultNotifications,
    sound: defaultSound,
    pipeline: defaultPipeline,
    preferences: defaultPreferences,
    apiKeys: [],
    favorites: [] as FavoriteFolder[],
    favoriteGroups: [] as FavoriteGroup[],
    locale: "de" as const,
    defaultShell: "auto" as const,
    defaultPermissionMode: "default" as const,
    defaultProjectPath: "",
    globalNotes: "",
    projectNotes: {},
    pinnedDocs: {} as Record<string, PinnedDoc[]>,
    sessionRestore: defaultSessionRestore,
    sessionTitleOverrides: {} as Record<string, string>,
    pendingTitleOverrides: {} as Record<string, string>,
    lastSeenVersion: null as string | null,
    sessionAccents: {} as Record<string, string>,
    folderAccents: {} as Record<string, string>,
    notesWindowSize: DEFAULT_NOTES_WINDOW_SIZE,
    tasksWindowSize: DEFAULT_TASKS_WINDOW_SIZE,
  };
  if (!persisted || typeof persisted !== "object") return defaults as unknown as SettingsState;
  const p = persisted as Record<string, unknown>;

  // showProtokolleTab (v8) entfällt ab v9 — Tab-Sichtbarkeit leitet sich jetzt
  // aus frontendLogging || backendFileLogging ab (SessionPanelDock). Altfeld aus
  // der persistierten preferences strippen, damit der Defaults-Spread es nicht
  // wieder einsetzt und settings.json sauber bleibt.
  const rawPrefs = (p.preferences && typeof p.preferences === "object" && !Array.isArray(p.preferences)
    ? (p.preferences as Record<string, unknown>)
    : {});
  const { showProtokolleTab: _dropShowProtokolleTab, ...prefsWithoutLegacy } = rawPrefs;

  // Validate apiKeys structure: ApiKeyMetadataEntry[]. Mirrors validatePinnedDocs
  // below — a tampered or stale settings.json must not widen unknown[] into a
  // typed ApiKeyMetadataEntry[] without per-element shape checks. Malformed
  // entries are dropped (defense in depth, same posture as validateSessionRestore).
  const validateApiKeys = (raw: unknown): ApiKeyMetadataEntry[] => {
    if (!Array.isArray(raw)) return defaults.apiKeys;
    return raw.filter((k): k is ApiKeyMetadataEntry =>
      k != null &&
      typeof k === "object" &&
      typeof (k as ApiKeyMetadataEntry).id === "string" &&
      typeof (k as ApiKeyMetadataEntry).provider === "string" &&
      typeof (k as ApiKeyMetadataEntry).label === "string" &&
      typeof (k as ApiKeyMetadataEntry).redactedKey === "string" &&
      typeof (k as ApiKeyMetadataEntry).addedAt === "number" &&
      typeof (k as ApiKeyMetadataEntry).isValid === "boolean" &&
      ((k as ApiKeyMetadataEntry).lastUsedAt === undefined ||
        typeof (k as ApiKeyMetadataEntry).lastUsedAt === "number")
    );
  };

  // Validate pinnedDocs structure: Record<string, PinnedDoc[]>
  const validatePinnedDocs = (raw: unknown): Record<string, PinnedDoc[]> => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const result: Record<string, PinnedDoc[]> = {};
    for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(val)) continue;
      const pins = val.filter((pin): pin is PinnedDoc =>
        pin != null &&
        typeof pin === "object" &&
        typeof (pin as PinnedDoc).id === "string" &&
        typeof (pin as PinnedDoc).relativePath === "string" &&
        typeof (pin as PinnedDoc).label === "string" &&
        typeof (pin as PinnedDoc).addedAt === "number" &&
        // Re-validate path at load time (defense in depth)
        validatePinnedPath((pin as PinnedDoc).relativePath) === null
      );
      if (pins.length > 0) result[key] = pins;
    }
    return result;
  };

  // v4 → v5: add groupId + sortIndex to existing favorites, sort by lastUsedAt desc
  let migratedFavorites: FavoriteFolder[];
  if (Array.isArray(p.favorites)) {
    const sorted = [...p.favorites].sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
      ((b.lastUsedAt as number) ?? 0) - ((a.lastUsedAt as number) ?? 0)
    );
    migratedFavorites = sorted.map((f: Record<string, unknown>, i: number): FavoriteFolder => ({
      ...(f as Omit<FavoriteFolder, "groupId" | "sortIndex">),
      groupId: f.groupId !== undefined ? (f.groupId as string | null) : null,
      sortIndex: typeof f.sortIndex === "number" && Number.isFinite(f.sortIndex as number)
        ? (f.sortIndex as number)
        : i * 1000,
    }));
  } else {
    migratedFavorites = defaults.favorites;
  }

  let migratedGroups: FavoriteGroup[] = Array.isArray(p.favoriteGroups)
    ? (p.favoriteGroups as FavoriteGroup[])
    : defaults.favoriteGroups;

  // v6→v7 back-compat: favorites briefly lived in favorites.json (the failed
  // single-source experiment, b948dd6). If the settings blob carries none but
  // a legacy favorites.json was loaded at startup, adopt it ONCE here. This is
  // version-gated (migrate only runs on a version change), so a stale
  // favorites.json can never resurrect deleted favorites on later launches —
  // from v7 on, settings.json (partialize) is the sole source and
  // favorites.json is never read or written again.
  if (migratedFavorites.length === 0 && migratedGroups.length === 0) {
    const legacyFavs = getLoadedFavorites();
    const legacyGroups = getLoadedFavoriteGroups();
    if (Array.isArray(legacyFavs) && legacyFavs.length > 0) {
      migratedFavorites = legacyFavs;
    }
    if (Array.isArray(legacyGroups) && legacyGroups.length > 0) {
      migratedGroups = legacyGroups;
    }
  }

  return {
    theme: { ...defaults.theme, ...(p.theme && typeof p.theme === "object" ? p.theme : {}) },
    notifications: { ...defaults.notifications, ...(p.notifications && typeof p.notifications === "object" ? p.notifications : {}) },
    sound: { ...defaults.sound, ...(p.sound && typeof p.sound === "object" ? p.sound : {}) },
    pipeline: { ...defaults.pipeline, ...(p.pipeline && typeof p.pipeline === "object" ? p.pipeline : {}) },
    preferences: sanitizePreferences(prefsWithoutLegacy),
    apiKeys: validateApiKeys(p.apiKeys),
    favorites: migratedFavorites,
    favoriteGroups: migratedGroups,
    locale: p.locale === "de" || p.locale === "en" ? p.locale : defaults.locale,
    defaultShell: ["auto", "powershell", "bash", "cmd", "zsh"].includes(p.defaultShell as string) ? p.defaultShell as SettingsState["defaultShell"] : defaults.defaultShell,
    defaultPermissionMode: sanitizePermissionMode(p.defaultPermissionMode),
    defaultProjectPath: typeof p.defaultProjectPath === "string" ? p.defaultProjectPath : defaults.defaultProjectPath,
    globalNotes: typeof p.globalNotes === "string" ? p.globalNotes : defaults.globalNotes,
    projectNotes: p.projectNotes && typeof p.projectNotes === "object" && !Array.isArray(p.projectNotes) ? p.projectNotes as Record<string, string> : defaults.projectNotes,
    pinnedDocs: validatePinnedDocs(p.pinnedDocs),
    // Validate sessionRestore at migrate-time too (defense in depth —
    // schema upgrades fire here, content upgrades in onRehydrateStorage).
    sessionRestore: validateSessionRestore(p.sessionRestore),
    sessionTitleOverrides: p.sessionTitleOverrides && typeof p.sessionTitleOverrides === "object" && !Array.isArray(p.sessionTitleOverrides)
      ? Object.fromEntries(
        Object.entries(p.sessionTitleOverrides as Record<string, unknown>).filter(
          ([k, v]) => typeof k === "string" && !!k.trim() && typeof v === "string" && !!v.trim(),
        ),
      )
      : defaults.sessionTitleOverrides,
    sessionAccents: remapAccentsRecord(p.sessionAccents),
    folderAccents: remapAccentsRecord(p.folderAccents),
    notesWindowSize: sanitizeNotesWindowSize(p.notesWindowSize),
    tasksWindowSize: sanitizeTasksWindowSize(p.tasksWindowSize),
    // Upgrade-vs-Neuinstallation: migrate laeuft NUR, wenn bereits ein
    // persistierter Blob existiert — also nur fuer Bestands-User. Fehlt
    // lastSeenVersion hier (Upgrade von pre-v12), MUSS der Sentinel "0.0.0"
    // gesetzt werden, nicht null: null liest useWhatsNew als "frische
    // Installation" und ueberspringt das Whats-New-Modal still — beim
    // v1.0.23-Rollout sah dadurch kein einziger Bestands-User das Fenster.
    // Echte Neuinstallationen haben keinen Blob, migrate laeuft nie, der
    // Store-Default null bleibt (Modal korrekt unterdrueckt).
    lastSeenVersion: sanitizeLastSeenVersion(p.lastSeenVersion) ?? "0.0.0",
  } as unknown as SettingsState; // Actions are added by Zustand during merge
}

// ============================================================================
// _settingsValidate — extracted for testability
// ============================================================================

function _settingsValidate(state: Partial<SettingsState>): {
  favorites: FavoriteFolder[];
  favoriteGroups: FavoriteGroup[];
} {
  const rawGroups = Array.isArray(state.favoriteGroups) ? state.favoriteGroups : [];
  const seenGroupIds = new Set<string>();
  const validGroups: FavoriteGroup[] = [];
  for (const g of rawGroups) {
    if (!g || typeof g !== "object") continue;
    const entry = g as unknown as Record<string, unknown>;
    if (typeof entry.id !== "string" || !entry.id) continue;
    if (typeof entry.label !== "string") continue;
    if (seenGroupIds.has(entry.id)) continue; // first wins
    seenGroupIds.add(entry.id);
    validGroups.push({
      id: entry.id,
      label: entry.label,
      sortIndex: typeof entry.sortIndex === "number" && Number.isFinite(entry.sortIndex as number)
        ? entry.sortIndex as number
        : (validGroups.length * 1000),
    });
  }

  const rawFavorites = Array.isArray(state.favorites) ? state.favorites : [];
  const validFavorites: FavoriteFolder[] = rawFavorites
    .map((f, i) => {
      if (!f || typeof f !== "object") return null;
      const entry = f as FavoriteFolder;
      const groupId: string | null =
        entry.groupId != null && !seenGroupIds.has(entry.groupId)
          ? null
          : entry.groupId;
      const sortIndex =
        typeof entry.sortIndex === "number" && Number.isFinite(entry.sortIndex)
          ? entry.sortIndex
          : i * 1000;
      if (groupId === entry.groupId && sortIndex === entry.sortIndex) return entry;
      return { ...entry, groupId, sortIndex };
    })
    .filter((f): f is FavoriteFolder => f !== null);

  return { favorites: validFavorites, favoriteGroups: validGroups };
}

// ============================================================================
// Store (with persist middleware)
// ============================================================================

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: defaultTheme,
      notifications: defaultNotifications,
      sound: defaultSound,
      pipeline: defaultPipeline,
      preferences: defaultPreferences,
      apiKeys: [],
      favorites: [],
      favoriteGroups: [],
      locale: "de",
      defaultShell: "auto",
      defaultPermissionMode: "default",
      defaultProjectPath: "",
      globalNotes: "",
      projectNotes: {},
      pinnedDocs: {},
      sessionRestore: defaultSessionRestore,
      sessionTitleOverrides: {},
      pendingTitleOverrides: {},
      lastSeenVersion: null,
      sessionAccents: {},
      folderAccents: {},
      notesWindowSize: DEFAULT_NOTES_WINDOW_SIZE,
      tasksWindowSize: DEFAULT_TASKS_WINDOW_SIZE,

      setLastSeenVersion: (version) =>
        set({ lastSeenVersion: sanitizeLastSeenVersion(version) }),

      setNotesWindowSize: (size) =>
        set({ notesWindowSize: sanitizeNotesWindowSize(size) }),

      setTasksWindowSize: (size) =>
        set({ tasksWindowSize: sanitizeTasksWindowSize(size) }),

      setSessionRestore: (data) => set({ sessionRestore: data }),

      setSessionTitleOverride: (sessionId, title) =>
        set((state) => {
          const key = sessionId.trim();
          const value = title.trim();
          if (!key || !value) return state;
          if (state.sessionTitleOverrides[key] === value) return state;
          return {
            sessionTitleOverrides: {
              ...state.sessionTitleOverrides,
              [key]: value,
            },
          };
        }),

      clearSessionTitleOverride: (sessionId) =>
        set((state) => {
          const key = sessionId.trim();
          if (!key || !(key in state.sessionTitleOverrides)) return state;
          const next = { ...state.sessionTitleOverrides };
          delete next[key];
          return { sessionTitleOverrides: next };
        }),

      setPendingTitleOverride: (sessionId, title) =>
        set((state) => {
          const key = sessionId.trim();
          const value = title.trim();
          if (!key || !value) return state;
          if (state.pendingTitleOverrides[key] === value) return state;
          return {
            pendingTitleOverrides: {
              ...state.pendingTitleOverrides,
              [key]: value,
            },
          };
        }),

      flushPendingTitleOverride: (sessionId, claudeSessionId) =>
        set((state) => {
          const sid = sessionId.trim();
          const uuid = claudeSessionId.trim();
          const pending = state.pendingTitleOverrides[sid];
          if (!sid || !uuid || !pending) return state;

          const nextPending = { ...state.pendingTitleOverrides };
          delete nextPending[sid];

          // Intent authoritative — write it under the resolved UUID. Skip the
          // override write (but still consume the pending) when it already holds
          // the same value, to avoid a redundant persist notification.
          if (state.sessionTitleOverrides[uuid] === pending) {
            return { pendingTitleOverrides: nextPending };
          }
          return {
            sessionTitleOverrides: {
              ...state.sessionTitleOverrides,
              [uuid]: pending,
            },
            pendingTitleOverrides: nextPending,
          };
        }),

      setSessionAccent: (claudeSessionId, name) =>
        set((state) => {
          const key = claudeSessionId.trim();
          if (!key || !isAccentName(name)) return state;
          if (state.sessionAccents[key] === name) return state;
          return { sessionAccents: { ...state.sessionAccents, [key]: name } };
        }),

      clearSessionAccent: (claudeSessionId) =>
        set((state) => {
          const key = claudeSessionId.trim();
          if (!key || !(key in state.sessionAccents)) return state;
          const next = { ...state.sessionAccents };
          delete next[key];
          return { sessionAccents: next };
        }),

      setFolderAccent: (folder, name) =>
        set((state) => {
          const key = folder.trim();
          if (!key || !isAccentName(name)) return state;
          if (state.folderAccents[key] === name) return state;
          return { folderAccents: { ...state.folderAccents, [key]: name } };
        }),

      clearFolderAccent: (folder) =>
        set((state) => {
          const key = folder.trim();
          if (!key || !(key in state.folderAccents)) return state;
          const next = { ...state.folderAccents };
          delete next[key];
          return { folderAccents: next };
        }),

      removeRestorableSessionByClaudeId: (claudeSessionId) =>
        set((state) => {
          const id = claudeSessionId.trim();
          if (!id) return state;

          const filteredSessions = state.sessionRestore.sessions.filter(
            (s) => s.claudeSessionId !== id,
          );
          const sessionsChanged =
            filteredSessions.length !== state.sessionRestore.sessions.length;
          const overridesChanged = id in state.sessionTitleOverrides;

          if (!sessionsChanged && !overridesChanged) return state;

          const updates: Partial<SettingsState> = {};

          if (sessionsChanged) {
            updates.sessionRestore = {
              ...state.sessionRestore,
              sessions: filteredSessions,
            };
          }

          if (overridesChanged) {
            const nextOverrides = { ...state.sessionTitleOverrides };
            delete nextOverrides[id];
            updates.sessionTitleOverrides = nextOverrides;
          }

          return updates;
        }),

      setTheme: (partial) => {
        set((state) => ({
          theme: { ...state.theme, ...partial },
        }));
        // Propagate to other windows (detached Bibliothek/Kanban/Editor/...),
        // which each run a separate store instance. The receiver applies via
        // raw setState (wireRuntimeGates.applyRemotePartial) so there is no echo loop.
        void broadcastPreferencesChange({ theme: partial });
      },

      setNotifications: (partial) => {
        set((state) => ({
          notifications: { ...state.notifications, ...partial },
        }));
        // The settings window is a secondary window without disk-write rights
        // (tauriStorage isMainWindow guard) — the broadcast is the only path
        // by which the value reaches the persisting main window.
        void broadcastPreferencesChange({ settingsSync: { notifications: partial } });
      },

      setSound: (partial) => {
        set((state) => ({
          sound: { ...state.sound, ...partial },
        }));
        void broadcastPreferencesChange({ settingsSync: { sound: partial } });
      },

      setPipeline: (partial) =>
        set((state) => ({
          pipeline: { ...state.pipeline, ...partial },
        })),

      setPreferences: (partial) => {
        let didChange = false;
        set((state) => {
          const next = { ...state.preferences, ...partial };
          // Sync backend logging toggle with Rust side. The store update is
          // the source of truth; on invoke failure we surface a toast so the
          // user knows the Rust side may be out of sync (deliberate choice
          // over silently rolling back the toggle and causing UI flicker).
          if (
            isTauri &&
            partial.backendFileLogging !== undefined &&
            partial.backendFileLogging !== state.preferences.backendFileLogging
          ) {
            const wantedValue = partial.backendFileLogging;
            const syncGate = () =>
              invoke("set_file_logging_enabled", { enabled: wantedValue }).catch((err) => {
                logError("settingsStore.setBackendFileLogging", err);
                // Lazy import of uiStore to avoid a hard dep at module init.
                import("./uiStore").then(({ useUIStore }) => {
                  useUIStore.getState().addToast({
                    type: "error",
                    title: "Backend-Logging-Toggle fehlgeschlagen",
                    message: `Datei-Logging konnte nicht auf ${wantedValue ? "an" : "aus"} gesetzt werden. Bitte App neu starten.`,
                    duration: 10000,
                  });
                }).catch(() => { /* uiStore unreachable — already logged */ });
              });
            if (wantedValue) {
              void syncGate();
            } else {
              // Drain buffered frontend entries while the Rust gate is still
              // open — flipping first would reject the final batch (entries
              // logged while the toggle was on).
              void flushBeforeGateClose(() => syncGate().then(() => undefined));
            }
          }
          didChange = Object.keys(partial).some(
            (k) => state.preferences[k as keyof AppPreferencesSettings] !== next[k as keyof AppPreferencesSettings],
          );
          return { preferences: next };
        });
        // Broadcast to other webviews. Receivers filter their own echoes
        // via sourceWindow and apply via raw setState, so no loop.
        if (didChange) {
          void broadcastPreferencesChange(partial);
        }
      },

      setLocale: (locale) => set({ locale }),

      setDefaultShell: (shell) => {
        set({ defaultShell: shell });
        // See setNotifications: broadcast is the secondary-window persistence path.
        void broadcastPreferencesChange({ settingsSync: { defaultShell: shell } });
      },

      setDefaultPermissionMode: (mode) => {
        const sanitized = sanitizePermissionMode(mode);
        set({ defaultPermissionMode: sanitized });
        void broadcastPreferencesChange({ settingsSync: { defaultPermissionMode: sanitized } });
      },

      setDefaultProjectPath: (path) => {
        set({ defaultProjectPath: path });
        void broadcastPreferencesChange({ settingsSync: { defaultProjectPath: path } });
      },

      setGlobalNotes: (notes) => {
        set({ globalNotes: notes });
        debouncedSaveNoteFile("global", notes);
      },

      setProjectNotes: (folder, notes) =>
        set((state) => {
          const key = folder.replace(/\\/g, "/").toLowerCase();
          debouncedSaveNoteFile(key, notes);
          return {
            projectNotes: { ...state.projectNotes, [key]: notes },
          };
        }),

      addApiKeyMetadata: (entry) =>
        set((state) => ({
          apiKeys: [...state.apiKeys, entry],
        })),

      removeApiKeyMetadata: (id) =>
        set((state) => ({
          apiKeys: state.apiKeys.filter((k) => k.id !== id),
        })),

      updateApiKeyMetadata: (id, partial) =>
        set((state) => ({
          apiKeys: state.apiKeys.map((k) =>
            k.id === id ? { ...k, ...partial } : k
          ),
        })),

      // NOTE: favorite/group reducers are PURE state transformers. Persistence
      // to favorites.json + the cross-window broadcast are handled centrally by
      // a single store subscription (see end of file). This is what makes
      // favorites.json the single source of truth: there is exactly ONE writer,
      // reading the final consistent state — no per-reducer save call to forget
      // or to pair the wrong (favorites, groups) tuple.
      addFavorite: (path, label) => {
        let duplicateLabel: string | null = null;
        set((state) => {
          const duplicate = state.favorites.find((f) => f.path === path);
          if (duplicate) {
            duplicateLabel = duplicate.label;
            return state;
          }
          const folderName = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "folder";
          const nextSortIndex = state.favorites.length > 0
            ? Math.max(...state.favorites.map((f) => f.sortIndex ?? 0)) + 1000
            : 0;
          const favorite: FavoriteFolder = {
            id: `fav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            path,
            label: label ?? folderName,
            // "auto": let the backend pick the right shell per platform. A
            // hardcoded "powershell" here made Quick Start fail on macOS.
            shell: "auto",
            addedAt: Date.now(),
            lastUsedAt: Date.now(),
            groupId: null,
            sortIndex: nextSortIndex,
          };
          return { favorites: [...state.favorites, favorite] };
        });
        // Duplicate path → no state change → the persist subscription stays
        // silent (reference-equality guard). Surface WHY nothing was added.
        if (duplicateLabel) {
          useUIStore.getState().addToast({
            type: "info",
            title: "Favorit existiert bereits",
            message: `„${duplicateLabel}" zeigt schon auf diesen Ordner.`,
            duration: 4000,
          });
        }
      },

      removeFavorite: (id) =>
        set((state) => ({ favorites: state.favorites.filter((f) => f.id !== id) })),

      updateFavoriteLastUsed: (id) =>
        set((state) => ({
          favorites: state.favorites.map((f) =>
            f.id === id ? { ...f, lastUsedAt: Date.now() } : f
          ),
        })),

      moveFavorite: (favId, targetGroupId, targetIndex) => {
        set((state) => {
          const fav = state.favorites.find((f) => f.id === favId);
          if (!fav) return state;

          // Siblings already in the destination group (sorted current order).
          const destOthers = state.favorites
            .filter((f) => f.groupId === targetGroupId && f.id !== favId)
            .sort((a, b) => a.sortIndex - b.sortIndex);

          const clampedIdx = Math.max(0, Math.min(targetIndex, destOthers.length));
          const destOrdered = [
            ...destOthers.slice(0, clampedIdx),
            { ...fav, groupId: targetGroupId },
            ...destOthers.slice(clampedIdx),
          ];

          // Reindex the destination group on 1000er steps.
          const reindexedDest = destOrdered.map((f, i) => ({ ...f, sortIndex: i * 1000 }));

          // Everyone NOT in the destination group AND not the moved item stays put.
          const rest = state.favorites.filter(
            (f) => f.groupId !== targetGroupId && f.id !== favId
          );

          return { favorites: [...rest, ...reindexedDest] };
        });
      },

      reorderFavorites: (groupId, orderedIds) => {
        set((state) => {
          // Map current items in the group by ID for lookup.
          const inGroup = new Map(
            state.favorites.filter((f) => f.groupId === groupId).map((f) => [f.id, f])
          );

          // Items in the explicit order from orderedIds. Drops unknown IDs.
          const reindexedInGroup = orderedIds
            .map((id, i) => {
              const f = inGroup.get(id);
              return f ? { ...f, sortIndex: i * 1000 } : null;
            })
            .filter((f): f is FavoriteFolder => f !== null);

          // Safety net: any group member not present in orderedIds gets appended at the end.
          const seen = new Set(orderedIds);
          const tail: FavoriteFolder[] = [];
          let tailIdx = orderedIds.length;
          for (const [id, f] of inGroup) {
            if (!seen.has(id)) {
              tail.push({ ...f, sortIndex: tailIdx * 1000 });
              tailIdx++;
            }
          }

          // Other groups untouched.
          const rest = state.favorites.filter((f) => f.groupId !== groupId);

          return { favorites: [...rest, ...reindexedInGroup, ...tail] };
        });
      },

      addFavoriteGroup: (label) => {
        const trimmed = label.trim();
        if (!trimmed) return "";
        const id = `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        set((state) => {
          const nextSortIndex = state.favoriteGroups.length > 0
            ? Math.max(...state.favoriteGroups.map((g) => g.sortIndex)) + 1000
            : 0;
          const newGroup: FavoriteGroup = { id, label: trimmed, sortIndex: nextSortIndex };
          return { favoriteGroups: [...state.favoriteGroups, newGroup] };
        });
        return id;
      },

      renameFavoriteGroup: (id, label) =>
        set((state) => {
          const trimmed = label.trim();
          if (!trimmed) return state;
          return {
            favoriteGroups: state.favoriteGroups.map((g) =>
              g.id === id ? { ...g, label: trimmed } : g
            ),
          };
        }),

      removeFavoriteGroup: (id, cascade) => {
        set((state) => {
          const updatedGroups = state.favoriteGroups.filter((g) => g.id !== id);
          let updatedFavs: FavoriteFolder[];
          if (cascade === "delete") {
            updatedFavs = state.favorites.filter((f) => f.groupId !== id);
          } else {
            updatedFavs = state.favorites.map((f) =>
              f.groupId === id ? { ...f, groupId: null } : f
            );
          }
          return { favoriteGroups: updatedGroups, favorites: updatedFavs };
        });
      },

      reorderFavoriteGroups: (orderedIds) => {
        set((state) => {
          const byId = new Map(state.favoriteGroups.map((g) => [g.id, g]));
          const reordered: FavoriteGroup[] = [];
          orderedIds.forEach((id, i) => {
            const g = byId.get(id);
            if (g) {
              reordered.push({ ...g, sortIndex: i * 1000 });
              byId.delete(id);
            }
          });
          // Append any groups not in orderedIds (safety net — keep their sortIndex)
          const remaining = state.favoriteGroups.filter((g) => byId.has(g.id));
          return { favoriteGroups: [...reordered, ...remaining] };
        });
      },

      addPinnedDoc: (folder, relativePath, label) => {
        const validationError = validatePinnedPath(relativePath);
        if (validationError) return validationError;

        const normalized = relativePath.replace(/\\/g, "/").trim();
        const key = normalizeProjectKey(folder);
        const state = useSettingsStore.getState();
        const existing = state.pinnedDocs[key] ?? [];

        // Deduplicate by relativePath
        if (existing.some((p) => p.relativePath === normalized)) {
          return "Diese Datei ist bereits angepinnt";
        }

        const filename = normalized.split("/").pop() ?? normalized;
        const pin: PinnedDoc = {
          id: `pin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          relativePath: normalized,
          label: label?.trim() || filename,
          addedAt: Date.now(),
        };

        set((s) => ({
          pinnedDocs: {
            ...s.pinnedDocs,
            [key]: [...existing, pin],
          },
        }));
        return null;
      },

      removePinnedDoc: (folder, pinId) =>
        set((state) => {
          const key = normalizeProjectKey(folder);
          const existing = state.pinnedDocs[key] ?? [];
          const filtered = existing.filter((p) => p.id !== pinId);
          if (filtered.length === existing.length) return state;
          const next = { ...state.pinnedDocs };
          if (filtered.length === 0) {
            delete next[key];
          } else {
            next[key] = filtered;
          }
          return { pinnedDocs: next };
        }),

      renamePinnedDoc: (folder, pinId, label) =>
        set((state) => {
          const key = normalizeProjectKey(folder);
          const existing = state.pinnedDocs[key] ?? [];
          const trimmed = label.trim();
          if (!trimmed) return state;
          const updated = existing.map((p) => (p.id === pinId ? { ...p, label: trimmed } : p));
          return {
            pinnedDocs: { ...state.pinnedDocs, [key]: updated },
          };
        }),

      resetToDefaults: () =>
        set((state) => ({
          theme: defaultTheme,
          notifications: defaultNotifications,
          sound: defaultSound,
          pipeline: defaultPipeline,
          preferences: defaultPreferences,
          locale: "de",
          defaultShell: "auto",
          defaultPermissionMode: "default",
          defaultProjectPath: "",
          // apiKeys, favorites, globalNotes, projectNotes, sessionRestore, sessionTitleOverrides, sessionAccents and folderAccents are intentionally NOT reset
          apiKeys: state.apiKeys,
          favorites: state.favorites,
          globalNotes: state.globalNotes,
          projectNotes: state.projectNotes,
          sessionRestore: state.sessionRestore,
          sessionTitleOverrides: state.sessionTitleOverrides,
          sessionAccents: state.sessionAccents,
          folderAccents: state.folderAccents,
        })),
    }),
    {
      name: "agenticexplorer-settings",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        theme: state.theme,
        notifications: state.notifications,
        sound: state.sound,
        pipeline: state.pipeline,
        preferences: state.preferences,
        apiKeys: state.apiKeys,
        // favorites + favoriteGroups persist HERE, in settings.json, via the
        // same persist-middleware writer that reliably saves every other field
        // (notes, sessionRestore, accents). The earlier "favorites.json single
        // source" design (b948dd6) moved them onto a separate file written by a
        // lone `hasHydrated()`-gated store.subscribe — that writer never fired
        // in production builds, so favorites silently vanished on every restart
        // (favorites.json was never created on disk). Reverting to partialize
        // is the single source again: ONE file, written by the proven path.
        // No divergence risk — favorites.json is now read ONCE for back-compat
        // in the v6→v7 migration and never written again.
        favorites: state.favorites,
        favoriteGroups: state.favoriteGroups,
        locale: state.locale,
        defaultShell: state.defaultShell,
        defaultPermissionMode: state.defaultPermissionMode,
        defaultProjectPath: state.defaultProjectPath,
        globalNotes: state.globalNotes,
        projectNotes: state.projectNotes,
        pinnedDocs: state.pinnedDocs,
        sessionRestore: state.sessionRestore,
        sessionTitleOverrides: state.sessionTitleOverrides,
        sessionAccents: state.sessionAccents,
        folderAccents: state.folderAccents,
        notesWindowSize: state.notesWindowSize,
        tasksWindowSize: state.tasksWindowSize,
        lastSeenVersion: state.lastSeenVersion,
      }),
      // v11: added theme.syncTerminalTheme (default false). The migrate merge
      // `{ ...defaults.theme, ...p.theme }` fills it for existing users. No
      // onRehydrateStorage heal needed: a missing boolean is not the data-loss
      // (Issue #209) class — read sites default it with `?? false`.
      // v12: added lastSeenVersion (whats-new gating, default null). Migrate
      // sanitizes via sanitizeLastSeenVersion; onRehydrateStorage heals
      // same-version corruption (non-string → null → modal shows once more,
      // harmless fail-open).
      // v13: added defaultPermissionMode (neue Sessions starten mit gewaehltem
      // Permission-Modus, default "default" = Claudes Nachfragen). Migrate
      // sanitizt via sanitizePermissionMode; merge heilt same-version-Corruption.
      // Bewusste Verhaltensaenderung: Bestands-User (bisher hart Bypass) werden
      // auf "default" geseedet — siehe CHANGELOG.
      // RestorableSession.permissionMode (Restart-Treue, PR #44) kam OHNE
      // Versions-Bump dazu: rein optionales Feld, validateSessionRestore läuft
      // versionsunabhängig in migrate UND onRehydrateStorage; alte Snapshots
      // lesen sich als undefined (→ Settings-Default), es ist nichts zu seeden.
      version: 13,
      migrate: (persisted: unknown, fromVersion: number) => _settingsMigrate(persisted, fromVersion),
      // SYNCHRONOUS heal of the rehydrated state. This runs DURING rehydration
      // and its return value feeds the very first render — unlike
      // onRehydrateStorage, which is an async after-callback that fires too late
      // to fix what the UI already painted. A favorite pointing at a deleted
      // group (dangling groupId) is otherwise invisible: it is filtered out of
      // "ungrouped" (groupId !== null) AND has no group to render under. Fail-
      // open here by reparenting orphans to ungrouped so they are ALWAYS shown.
      merge: (persisted: unknown, current: SettingsState): SettingsState => {
        const merged = { ...current, ...(persisted as Partial<SettingsState>) } as SettingsState;
        const validated = _settingsValidate(merged);
        return {
          ...merged,
          favorites: validated.favorites,
          favoriteGroups: validated.favoriteGroups,
          defaultPermissionMode: sanitizePermissionMode(merged.defaultPermissionMode),
        };
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          logError("settingsStore.hydration", error);
          return;
        }
        // Merge notes from their dedicated files. favorites/favoriteGroups are
        // NOT loaded here anymore — they live in the settings.json persist blob
        // (partialize) and arrive via `merge`. The legacy favorites.json is
        // consulted only once, in the v6→v7 migrate step (back-compat).
        const fileNotes = getLoadedNotes();
        const patches: Partial<SettingsState> = {};

        if (fileNotes) {
          if (fileNotes.global) {
            patches.globalNotes = fileNotes.global;
          }
          // MERGE, not replace: settings.json's already-hydrated `projectNotes`
          // (state.projectNotes, written on a 300ms debounce) is normally at
          // least as fresh as the per-note .md files (800ms debounce) — so it
          // wins on key collision. The file only backfills keys missing
          // entirely from the hydrated state (e.g. a crash before the
          // settings.json debounce fired). A full replace here previously let
          // a stale/lagging file value clobber a fresher in-memory one, and —
          // combined with a since-fixed filename-encoding bug — could wipe out
          // unrelated project notes entirely. See tasks/lessons.md.
          if (Object.keys(fileNotes.project).length > 0) {
            patches.projectNotes = { ...fileNotes.project, ...(state?.projectNotes ?? {}) };
          }
        }

        // ALWAYS validate sessionRestore on hydration (not just on schema
        // bump). The migrate function only fires when the persisted version
        // differs from the current schema version; validation must run
        // regardless to catch tampered or corrupt entries from same-version
        // payloads (Issue #209).
        if (state) {
          const validatedRestore = validateSessionRestore(state.sessionRestore);
          if (JSON.stringify(validatedRestore) !== JSON.stringify(state.sessionRestore)) {
            patches.sessionRestore = validatedRestore;
          }

          // Same-version-recovery for lastSeenVersion (whats-new gating):
          // a tampered non-string value would break the === comparison in
          // useWhatsNew. Heal to null (fail-open: modal shows once more).
          const sanitizedLastSeen = sanitizeLastSeenVersion(state.lastSeenVersion);
          if (sanitizedLastSeen !== state.lastSeenVersion) {
            patches.lastSeenVersion = sanitizedLastSeen;
          }

          // Same-version-recovery for notesWindowSize: if a tampered
          // settings.json carries NaN/negative/out-of-range values, the
          // migrate path is skipped on matching schema versions. Sanitize
          // here so the hook always sees a usable WindowSize.
          const validatedSize = sanitizeNotesWindowSize(state.notesWindowSize);
          if (
            validatedSize.w !== state.notesWindowSize?.w ||
            validatedSize.h !== state.notesWindowSize?.h
          ) {
            patches.notesWindowSize = validatedSize;
          }

          // Same-version-recovery for tasksWindowSize: mirrors notesWindowSize pattern.
          const validatedTasksSize = sanitizeTasksWindowSize(state.tasksWindowSize);
          if (
            validatedTasksSize.w !== state.tasksWindowSize?.w ||
            validatedTasksSize.h !== state.tasksWindowSize?.h
          ) {
            patches.tasksWindowSize = validatedTasksSize;
          }

          // Validate favoriteGroups + favorites for dangling groupIds and NaN
          // sortIndexes (same-version corruption recovery). Operates on the
          // hydrated settings.json state. When a heal changes anything, the
          // patch flows through setState below and re-persists to settings.json
          // via the persist middleware — no separate favorites.json write.
          const validated = _settingsValidate(state);
          if (JSON.stringify(validated.favorites) !== JSON.stringify(state.favorites)) {
            patches.favorites = validated.favorites;
          }
          if (JSON.stringify(validated.favoriteGroups) !== JSON.stringify(state.favoriteGroups)) {
            patches.favoriteGroups = validated.favoriteGroups;
          }

          // Same-version recovery für preferences: strikte bool-Koersion der
          // Logging-Gates. Ein korrupter String "true" zeigt die Checkbox als
          // an, waehrend Rusts bool-Deserialisierung ihn ablehnt — Logging
          // wirkt aktiv, die Datei bleibt leer (Issue-#209-Klasse).
          const cleanedPrefs = sanitizePreferences(state.preferences);
          if (JSON.stringify(cleanedPrefs) !== JSON.stringify(state.preferences)) {
            patches.preferences = cleanedPrefs;
          }

          // Same-version recovery für sessionAccents: Legacy-"cyan" remappen,
          // unbekannte AccentNames droppen.
          const cleanedAccents = remapAccentsRecord(state.sessionAccents);
          if (JSON.stringify(cleanedAccents) !== JSON.stringify(state.sessionAccents ?? {})) {
            patches.sessionAccents = cleanedAccents;
          }

          // Same-version recovery für folderAccents: Legacy-"cyan" remappen,
          // unbekannte AccentNames droppen.
          const cleanedFolderAccents = remapAccentsRecord(state.folderAccents);
          if (JSON.stringify(cleanedFolderAccents) !== JSON.stringify(state.folderAccents ?? {})) {
            patches.folderAccents = cleanedFolderAccents;
          }
        }

        if (Object.keys(patches).length > 0) {
          // Defer to a microtask. onRehydrateStorage can run SYNCHRONOUSLY
          // inside create(persist(...)) when storage.getItem returns a sync
          // value (real Tauri: cache hit; localStorage fallback: always sync).
          // At that point the `useSettingsStore` const is still in its Temporal
          // Dead Zone — referencing it here throws "Cannot access
          // 'useSettingsStore' before initialization" (minified: 'p'), surfaced
          // as the settingsStore.hydration error. Running setState one microtask
          // later (after create() returns and the const is bound) applies the
          // heal patches safely, still before first paint.
          void Promise.resolve().then(() => useSettingsStore.setState(patches));
        }
      },
    }
  )
);

// Favorites/favoriteGroups persist through the standard persist middleware
// (partialize → settings.json), exactly like every other field — no separate
// writer, no hasHydrated gate. The old favorites.json subscription writer
// lived here; it never fired in production builds, silently dropping every
// favorite on restart. Removed in v7.

// ============================================================================
// Test-only export hooks (not used in production code paths)
// ============================================================================

/** Expose migrate logic for unit-testing without going through persist. */
export function useSettingsStoreMigrateForTest(persisted: unknown, fromVersion: number): SettingsState {
  return _settingsMigrate(persisted, fromVersion);
}

/** Expose validate logic for unit-testing without triggering onRehydrateStorage. */
export function useSettingsStoreValidateForTest(state: unknown): {
  favorites: FavoriteFolder[];
  favoriteGroups: FavoriteGroup[];
} {
  return _settingsValidate(state as Partial<SettingsState>);
}
