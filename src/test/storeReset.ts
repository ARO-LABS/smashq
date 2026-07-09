/**
 * Store-reset helpers for Wave-3+ Layer-B integration tests.
 *
 * Integration tests use REAL Zustand stores (no `vi.mock`). Cross-test
 * state leaks WILL break suites unless every test starts from a clean
 * snapshot. This helper resets the data fields of the stores tests
 * commonly touch, while preserving bound action functions (because we
 * use `setState(partial, false)` — merge mode).
 *
 * Usage:
 *   import { resetAllStores } from "../test/storeReset";  // path varies
 *   beforeEach(() => { resetAllStores(); });
 *
 * When a test mutates a NEW data field this helper doesn't reset, add it
 * here. The hardcoded approach is intentional — it forces test authors
 * to think about which fields their tests assume.
 *
 * Plan reference: reports/2026-05-08-session-loading-real-tests-PLAN.md (Wave 2/3)
 */

import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import { useUIStore } from "../store/uiStore";

/**
 * Reset all integration-test-relevant stores AND clear localStorage so
 * the persist middleware starts from a clean slate on next mutation.
 */
export function resetAllStores(): void {
  // Clear localStorage first so subsequent setState writes propagate to a
  // clean store via persist middleware. Tests that write to localStorage
  // directly (B3.5 migration) should call this then re-seed.
  localStorage.clear();

  // sessionStore — ephemeral (no persist), but explicit reset for clarity
  useSessionStore.setState(
    {
      sessions: [],
      activeSessionId: null,
      gridSessionIds: [],
      focusedGridSessionId: null,
      layoutMode: "single",
    },
    false,
  );

  // settingsStore — persisted via zustand/persist; reset key data fields.
  // The persist middleware re-saves to (now-empty) localStorage on next
  // mutation, keeping disk + memory in sync.
  useSettingsStore.setState(
    {
      sessionRestore: {
        enabled: true,
        sessions: [],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
      defaultProjectPath: "",
      defaultShell: "auto",
      defaultPermissionMode: "default",
      sessionTitleOverrides: {},
      favorites: [],
      globalNotes: "",
      projectNotes: {},
      pinnedDocs: {},
      preferences: {
        frontendLogging: false,
        backendFileLogging: false,
        performanceProfiler: false,
        scrollbackLines: 25_000,
      },
    },
    false,
  );

  // uiStore — ephemeral
  useUIStore.setState(
    {
      toasts: [],
      configPanelCollapsed: true,
      configSubTab: "claude-md",
      configPanelWidth: 400,
      leftNavWidth: 240,
      leftNavCollapsed: false,
      hasDirtyEditor: false,
      previewFolder: null,
      detailPanel: { isOpen: false, type: null, targetId: null },
      libraryScopeOpen: {},
      librarySectionOpen: {},
    },
    false,
  );
}
