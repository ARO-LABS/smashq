import { SessionManagerView } from "../sessions/SessionManagerView";
import { ToastContainer } from "../shared/ToastContainer";

/**
 * App root. The main window is ALWAYS the Sessions view — Kanban, Bibliothek,
 * Editor and Einstellungen open as detached windows from the SessionPanelDock,
 * so there is no in-window tab switching here anymore.
 *
 * <ToastContainer /> MUST stay mounted at this level (protected updater path):
 * every addToast() call — updater, settings-save errors, Kanban — renders here.
 * The AppShell regression test guards this mount; do not remove it.
 */
export function AppShell() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-base">
      <main className="flex-1 min-w-0 h-full overflow-hidden">
        <SessionManagerView />
      </main>
      <ToastContainer />
    </div>
  );
}
