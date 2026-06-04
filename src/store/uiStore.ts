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

  configPanelWidth: 400,
  setConfigPanelWidth: (width) => set({ configPanelWidth: Math.max(250, Math.min(800, width)) }),

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
    }
  )
);
