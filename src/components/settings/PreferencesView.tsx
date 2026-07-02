import { Suspense, useEffect, useState } from "react";
import { useSettingsStore } from "../../store/settingsStore";
import { ICONS, ICON_SIZE } from "../../utils/icons";
import { SETTINGS_CATEGORIES } from "./categories";
import { CategoryNav } from "./CategoryNav";

const SettingsIcon = ICONS.nav.settings;
const CheckIcon = ICONS.tasks.check;

type SaveStatus = "idle" | "saving" | "saved";

/**
 * Beobachtet Settings-Mutationen und meldet sie als kurzlebigen Status.
 * Settings speichern automatisch (Zustand-persist, 300 ms debounced) — der
 * eigentliche Disk-Write laeuft im Main-Window, daher ist dieser Status
 * bewusst optimistisch: "saved" nach Ablauf des Debounce-Fensters. Echte
 * Schreibfehler landen ueber den Retry-Pfad des Storage-Adapters im Log
 * und als storage-save-error-Event im Main-Window.
 */
function useSaveStatus(): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    let savedTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useSettingsStore.subscribe(() => {
      setStatus("saving");
      clearTimeout(savedTimer);
      clearTimeout(idleTimer);
      savedTimer = setTimeout(() => {
        setStatus("saved");
        idleTimer = setTimeout(() => setStatus("idle"), 2000);
      }, 500);
    });
    return () => {
      unsubscribe();
      clearTimeout(savedTimer);
      clearTimeout(idleTimer);
    };
  }, []);

  return status;
}

/** Dezentes Inline-Feedback im Header: "Speichern…" → "✓ Gespeichert". */
function SaveStatusIndicator() {
  const status = useSaveStatus();

  return (
    <span aria-live="polite" className="ml-auto flex items-center gap-1 text-xs">
      {status === "saving" && <span className="text-neutral-500">Speichern…</span>}
      {status === "saved" && (
        <>
          <CheckIcon className={`${ICON_SIZE.card} text-success`} aria-hidden="true" />
          <span className="text-neutral-400">Gespeichert</span>
        </>
      )}
    </span>
  );
}

/**
 * Concept B (Phase 6): Settings as a categorized full-page view.
 *
 * The previous flat panel-stack (NewSessionDefaults / TerminalScrollback /
 * DebugLogging / SidebarToggles all rendered top-to-bottom) is replaced by a
 * left-rail CategoryNav + lazy-loaded panel on the right. New panels for
 * Theme + Notifications closed prior UX gaps (those settings had no UI before).
 *
 * Runs as its own detached window (opened from the SessionPanelDock via
 * open_detached_window("settings")), NOT a modal — so no fixed-inset /
 * backdrop / close-button. Closing the window is the dismissal.
 */
export function PreferencesView() {
  const [activeId, setActiveId] = useState<string>(SETTINGS_CATEGORIES[0].id);
  const active = SETTINGS_CATEGORIES.find((c) => c.id === activeId) ?? SETTINGS_CATEGORIES[0];
  const ActivePanel = active.Panel;

  return (
    <div className="flex flex-col h-full bg-surface-base overflow-hidden">
      <header className="px-4 py-3 border-b border-neutral-800 flex items-center gap-2 shrink-0">
        <SettingsIcon className={`${ICON_SIZE.nav} text-neutral-400`} aria-hidden="true" />
        <h2 className="text-sm font-semibold text-neutral-200">Einstellungen</h2>
        <SaveStatusIndicator />
      </header>

      <div className="flex-1 min-h-0 flex">
        <CategoryNav activeId={activeId} onSelect={setActiveId} />
        <div className="flex-1 min-w-0 overflow-y-auto">
          <Suspense
            fallback={<div className="p-6 text-sm text-neutral-500">Lade Panel…</div>}
          >
            <ActivePanel />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
