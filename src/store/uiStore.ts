import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";

/**
 * Safe localStorage wrapper — falls back to a no-op in environments
 * where localStorage is unavailable (e.g. Tauri WebView, test environments).
 */
function makeLocalStorage(): StateStorage {
  try {
    const test = "__zustand_test__";
    localStorage.setItem(test, "1");
    localStorage.removeItem(test);
    return localStorage;
  } catch {
    // Fallback: in-memory store (tests, restricted environments)
    const map = new Map<string, string>();
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => { map.set(key, value); },
      removeItem: (key) => { map.delete(key); },
    };
  }
}

/**
 * Coerce an unknown persisted value into a clean Record<string, boolean>.
 * Drops every non-boolean entry; non-object inputs collapse to {}. Shared
 * between the store default, `migrate` (schema bump) and `onRehydrateStorage`
 * (same-version corruption recovery) so a tampered blob can never spread
 * non-boolean junk onto state.
 */
export function sanitizeBoolRecord(raw: unknown): Record<string, boolean> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const clean: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "boolean") clean[key] = value;
  }
  return clean;
}

const CONFIG_PANEL_WIDTH_MIN = 250;
const CONFIG_PANEL_WIDTH_MAX = 800;
const CONFIG_PANEL_WIDTH_DEFAULT = 400;

/** Clamp the config-panel width into its valid range; non-finite → default. */
export function sanitizeConfigPanelWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return CONFIG_PANEL_WIDTH_DEFAULT;
  }
  return Math.max(CONFIG_PANEL_WIDTH_MIN, Math.min(CONFIG_PANEL_WIDTH_MAX, value));
}

export type ConfigSubTab =
  | "claude-md"
  | "skills"
  | "hooks"
  | "settings"
  | "agents"
  | "github"
  | "worktrees"
  | "kanban"
  | "history"
  | `pin:${string}`;

/** Type guard: true when the active tab is a user-pinned document */
export function isPinTab(tab: ConfigSubTab): tab is `pin:${string}` {
  return tab.startsWith("pin:");
}

/** Extract the pin id from a `pin:${id}` tab value */
export function getPinIdFromTab(tab: ConfigSubTab): string | null {
  return isPinTab(tab) ? tab.slice(4) : null;
}

export type ToastType = "achievement" | "error" | "info" | "success";

export interface ToastAction {
  /** Button label shown inside the toast — keep short, max ~15 chars. */
  label: string;
  /** Fired on click. Toast auto-dismisses after the action runs. */
  onClick: () => void;
}

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  /** Optional inline action button (e.g. "Speichern", "Rückgängig"). */
  action?: ToastAction;
  /** 0–100 download/operation progress. When set, the toast renders a bar. */
  progress?: number;
}

export interface DetailPanel {
  isOpen: boolean;
  type: string | null;
  targetId: string | null;
}

interface UIState {
  configSubTab: ConfigSubTab;
  setConfigSubTab: (tab: ConfigSubTab) => void;

  configPanelOpen: boolean;
  toggleConfigPanel: () => void;
  setConfigPanelOpen: (open: boolean) => void;

  configPanelWidth: number;
  setConfigPanelWidth: (width: number) => void;

  /** True when an inline editor has unsaved changes — triggers confirm on tab switch. */
  hasDirtyEditor: boolean;
  setHasDirtyEditor: (dirty: boolean) => void;

  previewFolder: string | null;
  openPreview: (folder: string) => void;
  closePreview: () => void;

  detailPanel: DetailPanel;
  openDetailPanel: (type: string, targetId: string) => void;
  closeDetailPanel: () => void;

  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => string;
  updateToast: (id: string, partial: Partial<Omit<Toast, "id">>) => void;
  removeToast: (id: string) => void;

  /** Persistent expand/collapse state for LibraryView ScopePanels. Key: scope id. */
  libraryScopeOpen: Record<string, boolean>;
  setLibraryScopeOpen: (scope: string, open: boolean) => void;

  /** Persistent expand/collapse state for LibraryView Sections. Key: section key. */
  librarySectionOpen: Record<string, boolean>;
  setLibrarySectionOpen: (key: string, open: boolean) => void;

  /** Ephemeral collapse state for favorite groups. Key: groupId. NOT persisted. */
  favoriteGroupsCollapsed: Record<string, boolean>;
  toggleFavoriteGroupCollapsed: (groupId: string) => void;
}

let toastCounter = 0;

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
  configSubTab: "claude-md",
  setConfigSubTab: (tab) => set({ configSubTab: tab }),

  configPanelOpen: false,
  toggleConfigPanel: () => set((state) => ({ configPanelOpen: !state.configPanelOpen })),
  setConfigPanelOpen: (open) => set({ configPanelOpen: open }),

  configPanelWidth: CONFIG_PANEL_WIDTH_DEFAULT,
  setConfigPanelWidth: (width) => set({ configPanelWidth: sanitizeConfigPanelWidth(width) }),

  hasDirtyEditor: false,
  setHasDirtyEditor: (dirty) => set({ hasDirtyEditor: dirty }),

  previewFolder: null,
  openPreview: (folder) => set({ previewFolder: folder }),
  closePreview: () => set({ previewFolder: null }),

  detailPanel: { isOpen: false, type: null, targetId: null },
  openDetailPanel: (type, targetId) =>
    set({ detailPanel: { isOpen: true, type, targetId } }),
  closeDetailPanel: () =>
    set({ detailPanel: { isOpen: false, type: null, targetId: null } }),

  toasts: [],
  addToast: (toast) => {
    const id = `toast-${++toastCounter}`;
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }].slice(-10),
    }));
    return id;
  },
  updateToast: (id, partial) =>
    set((state) => ({
      toasts: state.toasts.map((t) => (t.id === id ? { ...t, ...partial } : t)),
    })),
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  libraryScopeOpen: {},
  setLibraryScopeOpen: (scope, open) =>
    set((state) => ({
      libraryScopeOpen: { ...state.libraryScopeOpen, [scope]: open },
    })),

  librarySectionOpen: {},
  setLibrarySectionOpen: (key, open) =>
    set((state) => ({
      librarySectionOpen: { ...state.librarySectionOpen, [key]: open },
    })),

  favoriteGroupsCollapsed: {},
  toggleFavoriteGroupCollapsed: (groupId) =>
    set((state) => ({
      favoriteGroupsCollapsed: {
        ...state.favoriteGroupsCollapsed,
        [groupId]: !state.favoriteGroupsCollapsed[groupId],
      },
    })),
    }),
    {
      name: "agenticexplorer-ui",
      storage: createJSONStorage(makeLocalStorage),
      partialize: (state) => ({
        libraryScopeOpen: state.libraryScopeOpen,
        librarySectionOpen: state.librarySectionOpen,
      }),
      version: 1,
      // Schema-bump path: coerce both persisted records to clean bool-maps so a
      // pre-version blob (or a tampered one) cannot inject non-boolean values.
      migrate: (persisted: unknown): Partial<UIState> => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        return {
          libraryScopeOpen: sanitizeBoolRecord(p.libraryScopeOpen),
          librarySectionOpen: sanitizeBoolRecord(p.librarySectionOpen),
        };
      },
      // Same-version corruption recovery: migrate only fires on a version change,
      // so re-run the coercion here to heal a corrupt blob carrying the current
      // version (mirrors settingsStore's migrate + onRehydrateStorage split).
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const scope = sanitizeBoolRecord(state.libraryScopeOpen);
        const section = sanitizeBoolRecord(state.librarySectionOpen);
        if (
          JSON.stringify(scope) !== JSON.stringify(state.libraryScopeOpen) ||
          JSON.stringify(section) !== JSON.stringify(state.librarySectionOpen)
        ) {
          useUIStore.setState({
            libraryScopeOpen: scope,
            librarySectionOpen: section,
          });
        }
      },
    }
  )
);
