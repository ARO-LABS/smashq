import type { AppPreferencesSettings, ThemeSettings } from "../store/settingsStore";

/**
 * Cross-window preferences propagation.
 *
 * Tauri emits broadcast to ALL webviews including the sender — so every
 * payload carries `sourceWindow` and the listener early-returns on echo.
 * The receiver applies the partial via raw `setState` (NOT `setPreferences`)
 * to avoid retriggering the broadcast and looping forever.
 */

const EVENT_NAME = "preferences-changed";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Payload sent over the broadcast channel: a preferences partial, a theme
 * partial (so detached windows re-theme live), or a favorites-related signal.
 */
export type BroadcastPartial =
  | Partial<AppPreferencesSettings>
  | { favoritesUpdate: true }
  | { theme: Partial<ThemeSettings> };

export interface PreferencesChangedPayload {
  partial: BroadcastPartial;
  sourceWindow: string;
}

let cachedWindowLabel: string | null = null;

async function getWindowLabel(): Promise<string> {
  if (cachedWindowLabel !== null) return cachedWindowLabel;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  cachedWindowLabel = getCurrentWindow().label;
  return cachedWindowLabel;
}

/**
 * Emit a preferences change to all windows (including self — receivers
 * filter themselves out via `sourceWindow`). No-op outside Tauri.
 * Errors are deliberately swallowed: a failed broadcast must not break
 * the local-window state update that just succeeded.
 */
export async function broadcastPreferencesChange(
  partial: BroadcastPartial,
): Promise<void> {
  if (!isTauri) return;
  try {
    const [{ emit }, sourceWindow] = await Promise.all([
      import("@tauri-apps/api/event"),
      getWindowLabel(),
    ]);
    await emit(EVENT_NAME, { partial, sourceWindow } satisfies PreferencesChangedPayload);
  } catch {
    // Swallowed — local state already updated. errorLogger may also be off.
  }
}

/**
 * Subscribe to cross-window preferences changes. Returns an async unsubscribe
 * promise. Use `await listenForPreferencesChanges(applyFn).then(unsub => ...)`
 * or attach the resulting promise to a useEffect cleanup chain.
 */
export async function listenForPreferencesChanges(
  apply: (partial: BroadcastPartial) => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const myLabel = await getWindowLabel();
  return listen<PreferencesChangedPayload>(EVENT_NAME, (event) => {
    if (!event.payload || event.payload.sourceWindow === myLabel) return;
    apply(event.payload.partial);
  });
}
