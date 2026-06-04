import type { Page } from "@playwright/test";

/**
 * Installs a Tauri v2 IPC mock in the browser context BEFORE any app code runs.
 *
 * The Tauri v2 API reads `window.__TAURI_INTERNALS__.invoke(cmd, args, options)`
 * and the event plugin reads
 * `window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId)`.
 * We stub both plus `transformCallback`, so the dashboard can run in a plain
 * browser tab during Playwright tests.
 *
 * Responses are intentionally minimal empty-states so components fall back
 * to their default UI (no sessions, no favorites, no projects, ...).
 */
export async function installTauriMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type InvokeHandler = (
      cmd: string,
      args?: Record<string, unknown>,
    ) => unknown;

    // Commands that return arrays. Listed explicitly plus heuristic prefix.
    const ARRAY_COMMANDS = new Set<string>([
      "list_sessions",
      "list_favorites",
      "list_projects",
      "list_projects_v2",
      "list_skills",
      "list_agents",
      "list_worktrees",
      "list_recent_folders",
      "list_session_history",
      "list_logs",
      "list_user_claude_dir",
      "list_project_claude_dir",
      "get_git_info",
      "get_clipboard_text",
    ]);

    // Commands returning empty string for file-read operations.
    const EMPTY_STRING_COMMANDS = new Set<string>([
      "read_user_claude_file",
      "read_project_claude_file",
    ]);

    const handleInvoke: InvokeHandler = (cmd) => {
      // Tauri plugin events: `plugin:event|listen` returns a numeric eventId,
      // `plugin:event|unlisten` / emit / etc. are no-ops.
      if (cmd === "plugin:event|listen") {
        return nextListenerId++;
      }
      if (cmd.startsWith("plugin:event|")) {
        return null;
      }
      if (cmd.startsWith("plugin:")) {
        return null;
      }

      switch (cmd) {
        case "get_app_version":
          return "1.6.24";
        case "get_user_settings":
          return null;
        case "save_user_settings":
          return null;
        default:
          if (ARRAY_COMMANDS.has(cmd)) return [];
          if (EMPTY_STRING_COMMANDS.has(cmd)) return "";
          // Heuristic: commands named list_* → []
          if (cmd.startsWith("list_")) return [];
          return null;
      }
    };

    // ── Callback registry (minimal) ───────────────────────────────────
    let nextCallbackId = 1;
    let nextListenerId = 1;
    const callbacks = new Map<number, (payload: unknown) => void>();

    const transformCallback = (
      callback?: (payload: unknown) => void,
      once = false,
    ): number => {
      const id = nextCallbackId++;
      callbacks.set(id, (payload) => {
        if (once) callbacks.delete(id);
        try {
          callback?.(payload);
        } catch {
          // swallow
        }
      });
      return id;
    };

    const unregisterCallback = (id: number): void => {
      callbacks.delete(id);
    };

    const runCallback = (id: number, payload: unknown): void => {
      callbacks.get(id)?.(payload);
    };

    // ── Attach to window ──────────────────────────────────────────────
    const w = window as unknown as Record<string, unknown>;
    const existing =
      (w.__TAURI_INTERNALS__ as Record<string, unknown> | undefined) ?? {};

    w.__TAURI_INTERNALS__ = {
      ...existing,
      invoke: async (cmd: string, args?: Record<string, unknown>) =>
        Promise.resolve(handleInvoke(cmd, args)),
      transformCallback,
      unregisterCallback,
      runCallback,
      callbacks,
      convertFileSrc: (filePath: string, protocol = "asset") =>
        `https://${protocol}.localhost/${encodeURIComponent(filePath)}`,
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main", windowLabel: "main" },
      },
      plugins: {},
    };

    // Event plugin internals — the @tauri-apps/api/event module calls this
    // directly from _unlisten() (not through invoke()), so it MUST exist.
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event: string, _eventId: number) => {
        // no-op — we never actually fire events in tests.
      },
    };

    // Marker so tests can verify the mock was installed.
    (w as Record<string, unknown>).__TAURI_MOCK_INSTALLED__ = true;
  });
}
