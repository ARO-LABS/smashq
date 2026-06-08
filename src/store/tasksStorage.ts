import { invoke } from "@tauri-apps/api/core";
import type { StateStorage } from "zustand/middleware";
import { getErrorMessage } from "../utils/adpError";
import { logError, logWarn } from "../utils/errorLogger";
import { wrapInvoke } from "../utils/perfLogger";

/**
 * Zustand storage adapter persisting the tasks store to
 * Documents/Smashq/tasks.json via Tauri commands (survives reinstalls).
 *
 * Mirrors tauriStorage with ONE deliberate difference: there is NO
 * main-window write-guard. The global Tasks view is a detached OS window
 * (view=tasks) and must be able to persist its own edits. This is safe
 * because tasks.json is a dedicated file (cannot clobber settings.json)
 * and every write is an intentional task mutation — no incidental-write
 * race like the M-01 case that motivated tauriStorage's guard.
 *
 * Falls back to localStorage outside Tauri (browser dev).
 */

const STORAGE_KEY = "smashq-tasks";
const SAVE_DEBOUNCE_MS = 300;

const isTauri = "__TAURI_INTERNALS__" in window;
const cache = new Map<string, string>();
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();

let initialized = false;
let initPromise: Promise<void> | null = null;

/**
 * When true, setItem updates the in-memory cache but does NOT schedule a
 * debounced save_tasks invoke. Set synchronously around the setState that
 * applies a cross-window broadcast (see applyRemoteTasks): the originating
 * window already persisted tasks.json, so the receiver re-writing it is a
 * redundant concurrent write + double backup churn (Bug #4). zustand persist
 * calls storage.setItem synchronously within setState, so a synchronous flag
 * fully covers that write.
 */
let suppressPersist = false;

/** Toggle the persist-suppression flag. See `suppressPersist` doc above. */
export function setSuppressTasksPersist(active: boolean): void {
  suppressPersist = active;
}

/** Eagerly load tasks.json into the in-memory cache. Call before hydration. */
export function initTasksStorage(): Promise<void> {
  if (!isTauri) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = invoke<string>("load_tasks")
    .then((data) => {
      if (data) cache.set(STORAGE_KEY, data);
    })
    .catch((err: unknown) => {
      logWarn(
        "tasksStorage",
        `Failed to load tasks from disk: ${getErrorMessage(err)}`,
      );
    })
    .finally(() => {
      initialized = true;
    });
  return initPromise;
}

export const tasksStorage: StateStorage = {
  getItem(name: string): string | null {
    if (!isTauri) return localStorage.getItem(name);
    if (!initialized) {
      logWarn(
        "tasksStorage",
        `getItem called before init completed for: ${name}`,
      );
    }
    return cache.get(name) ?? null;
  },

  setItem(name: string, value: string): void {
    if (!isTauri) {
      localStorage.setItem(name, value);
      return;
    }
    cache.set(name, value);
    // Applying a remote broadcast: keep the cache consistent (so getItem
    // reflects the new value) but skip the disk write — the source window
    // already persisted it.
    if (suppressPersist) return;
    const existing = pendingSaves.get(name);
    if (existing) clearTimeout(existing);
    pendingSaves.set(
      name,
      setTimeout(() => {
        pendingSaves.delete(name);
        const latest = cache.get(name) ?? value;
        wrapInvoke("save_tasks", { data: latest }).catch((err) => {
          logError("tasksStorage.save", err);
        });
      }, SAVE_DEBOUNCE_MS),
    );
  },

  removeItem(name: string): void {
    if (!isTauri) {
      localStorage.removeItem(name);
      return;
    }
    cache.delete(name);
  },
};

/** Flush any pending tasks save immediately. Call before app close. */
export function flushPendingTaskSaves(): Promise<void> {
  if (!isTauri) return Promise.resolve();
  const promises: Promise<void>[] = [];
  for (const [name, timer] of pendingSaves) {
    clearTimeout(timer);
    pendingSaves.delete(name);
    const latest = cache.get(name);
    if (latest) {
      promises.push(
        invoke("save_tasks", { data: latest })
          .then(() => {})
          .catch((err) => logError("tasksStorage.flush", err)),
      );
    }
  }
  return Promise.all(promises).then(() => {});
}
