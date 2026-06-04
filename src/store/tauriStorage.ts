import { invoke } from "@tauri-apps/api/core";
import type { StateStorage } from "zustand/middleware";
import { getErrorMessage } from "../utils/adpError";
import { logError, logWarn } from "../utils/errorLogger";
import { wrapInvoke } from "../utils/perfLogger";
import type { FavoriteFolder, FavoriteGroup } from "./settingsStore";

/**
 * Custom Zustand storage adapter that persists to Documents/Smashq/settings.json
 * via Tauri commands, so data survives app reinstalls.
 *
 * Falls back to localStorage when running outside Tauri (e.g. dev in browser).
 */

const isTauri = "__TAURI_INTERNALS__" in window;

// In-memory cache for synchronous getItem calls (Zustand requires sync API)
const cache = new Map<string, string>();

let initialized = false;

// Cached during initTauriStorage. `null` while unknown → setItem fails open
// (allows the write); once resolved, only "main" window persists settings.
// Prevents the M-01 data-loss race where a detached window's incidental
// state mutation overwrites the main window's just-toggled preferences.
let isMainWindow: boolean | null = null;

const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
const SAVE_DEBOUNCE_MS = 300; // coalesce rapid writes

// Loaded favorites and notes from their dedicated files (available after init)
let loadedFavorites: FavoriteFolder[] | null = null;
let loadedFavoriteGroups: FavoriteGroup[] | null = null;
let loadedNotes: { global: string; project: Record<string, string> } | null = null;

/**
 * Single point of format-detection for favorites.json.
 * Handles v1 (flat array) and v2 ({ version, groups, items }) transparently.
 */
export function parseFavoritesFile(raw: string): {
  groups: FavoriteGroup[];
  items: FavoriteFolder[];
} {
  if (!raw.trim()) return { groups: [], items: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { groups: [], items: [] };
  }
  // v1: flat array → wrap as items, empty groups
  if (Array.isArray(parsed)) {
    return { groups: [], items: parsed as FavoriteFolder[] };
  }
  // v2: { version, groups, items }
  if (
    parsed &&
    typeof parsed === "object" &&
    "items" in (parsed as object) &&
    Array.isArray((parsed as { items: unknown }).items)
  ) {
    const p = parsed as { groups?: unknown; items: unknown[] };
    return {
      groups: Array.isArray(p.groups) ? (p.groups as FavoriteGroup[]) : [],
      items: p.items as FavoriteFolder[],
    };
  }
  return { groups: [], items: [] };
}

// Eagerly load settings from Tauri on startup
let initPromise: Promise<void> | null = null;

export function initTauriStorage(): Promise<void> {
  if (!isTauri) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = Promise.all([
    invoke<string>("load_user_settings"),
    invoke<string>("load_favorites_file"),
    invoke<string>("load_notes"),
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      isMainWindow = getCurrentWindow().label === "main";
    }).catch(() => {
      // Best-effort: if we can't determine, assume main (fail-open).
      isMainWindow = true;
    }),
  ])
    .then(([settingsData, favoritesData, notesData, _windowLabel]) => {
      void _windowLabel; // resolved by side-effect in the import.then above
      if (settingsData) {
        cache.set("agenticexplorer-settings", settingsData);
      }

      // Parse favorites from dedicated file (handles v1 flat array + v2 object)
      if (favoritesData) {
        const parsed = parseFavoritesFile(favoritesData);
        loadedFavorites = parsed.items;
        loadedFavoriteGroups = parsed.groups;
        if (parsed.items.length === 0 && parsed.groups.length === 0 && favoritesData.trim()) {
          logWarn("tauriStorage", "favorites.json: unrecognized format, using empty state");
        }
      }

      // Parse notes from dedicated files
      if (notesData) {
        try {
          const raw = JSON.parse(notesData) as Record<string, string>;
          const globalNotes = raw["global"] ?? "";
          const projectNotes: Record<string, string> = {};
          for (const [key, value] of Object.entries(raw)) {
            if (key !== "global") {
              projectNotes[key] = value;
            }
          }
          loadedNotes = { global: globalNotes, project: projectNotes };
        } catch {
          logWarn("tauriStorage", "Failed to parse notes");
        }
      }
    })
    .then(() => {
      initialized = true;
    })
    .catch((err: unknown) => {
      logWarn("tauriStorage", `Failed to load settings from disk: ${getErrorMessage(err)}`);
      initialized = true;
    });

  return initPromise;
}

/** Returns favorites loaded from favorites.json (available after initTauriStorage resolves) */
export function getLoadedFavorites(): FavoriteFolder[] | null {
  return loadedFavorites;
}

/** Returns favorite groups loaded from favorites.json (available after initTauriStorage resolves) */
export function getLoadedFavoriteGroups(): FavoriteGroup[] | null {
  return loadedFavoriteGroups;
}

/** Returns notes loaded from notes/ directory (available after initTauriStorage resolves) */
export function getLoadedNotes(): { global: string; project: Record<string, string> } | null {
  return loadedNotes;
}

export const tauriStorage: StateStorage = {
  getItem(name: string): string | null {
    if (!isTauri) {
      const value = localStorage.getItem(name);
      // Migration: fall back to old persist key if new key has no data
      if (value === null && name === "agenticexplorer-settings") {
        return localStorage.getItem("agentic-dashboard-settings");
      }
      return value;
    }
    if (!initialized) {
      logWarn("tauriStorage", `getItem called before init completed for: ${name}`);
    }
    const cached = cache.get(name);
    // Migration: fall back to old persist key if new key has no data
    if (cached === undefined && name === "agenticexplorer-settings") {
      return cache.get("agentic-dashboard-settings") ?? null;
    }
    return cached ?? null;
  },

  setItem(name: string, value: string): void {
    if (!isTauri) {
      localStorage.setItem(name, value);
      return;
    }
    cache.set(name, value);

    // Scope-guard: secondary windows update the local cache (so their
    // selectors see fresh values) but DO NOT write to disk. Disk write is
    // a main-window prerogative — preferences-changed broadcasts handle
    // sync across windows. `null` (still resolving) fails open.
    if (isMainWindow === false) {
      return;
    }

    // Per-key debounce: coalesce rapid writes, always save latest value
    const existing = pendingSaves.get(name);
    if (existing) clearTimeout(existing);
    pendingSaves.set(name, setTimeout(() => {
      pendingSaves.delete(name);
      const latestValue = cache.get(name) ?? value;
      wrapInvoke("save_user_settings", { data: latestValue }).catch((err) => {
        logError("tauriStorage.save", err);
        setTimeout(() => {
          wrapInvoke("save_user_settings", { data: cache.get(name) ?? latestValue }).catch((err2) => {
            logError("tauriStorage.saveRetry", err2);
            window.dispatchEvent(new CustomEvent("storage-save-error", {
              detail: { error: getErrorMessage(err2) },
            }));
          });
        }, 1000);
      });
    }, SAVE_DEBOUNCE_MS));
  },

  removeItem(name: string): void {
    if (!isTauri) {
      localStorage.removeItem(name);
      return;
    }
    cache.delete(name);
    // Do NOT write empty object to disk — just clear the cache.
    // The next save will write the correct state.
    logWarn("tauriStorage", `removeItem called for: ${name}`);
  },
};

/** Flush any pending settings saves immediately. Call before app close. */
export function flushPendingSaves(): Promise<void> {
  if (!isTauri) return Promise.resolve();
  // Cancel all pending debounced saves and fire them immediately
  const promises: Promise<void>[] = [];
  for (const [name, timer] of pendingSaves) {
    clearTimeout(timer);
    pendingSaves.delete(name);
    const latestValue = cache.get(name);
    if (latestValue) {
      promises.push(
        invoke("save_user_settings", { data: latestValue })
          .then(() => {})
          .catch((err) => logError("tauriStorage.flush", err))
      );
    }
  }
  // Also flush note timers from settingsStore (injected via registerNoteFlush)
  if (_noteFlushFn) {
    promises.push(_noteFlushFn());
  }
  return Promise.all(promises).then(() => {});
}

// Allow settingsStore to register its note-flush function to avoid circular imports
let _noteFlushFn: (() => Promise<void>) | null = null;
export function registerNoteFlush(fn: () => Promise<void>): void {
  _noteFlushFn = fn;
}
