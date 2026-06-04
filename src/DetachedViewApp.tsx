import { Suspense, lazy, useEffect } from "react";
import { useSettingsStore } from "./store/settingsStore";
import { wireRuntimeGates } from "./utils/wireRuntimeGates";

const KanbanDashboardView = lazy(() =>
  import("./components/kanban/KanbanDashboardView").then((m) => ({ default: m.KanbanDashboardView }))
);
const LibraryView = lazy(() =>
  import("./components/library/LibraryView").then((m) => ({ default: m.LibraryView }))
);
const MarkdownEditorView = lazy(() =>
  import("./components/editor/MarkdownEditorView").then((m) => ({ default: m.MarkdownEditorView }))
);
const PreferencesView = lazy(() =>
  import("./components/settings/PreferencesView").then((m) => ({ default: m.PreferencesView }))
);

function NeonSpinner() {
  return (
    <div className="flex items-center justify-center h-full w-full">
      <div className="w-8 h-8 border-2 border-accent-a30 border-t-accent rounded-full animate-spin" />
    </div>
  );
}

export default function DetachedViewApp({ view }: { view: string }) {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    // Each window mounts its own React root; perf/logging gates are
    // module-local and must be re-wired per-window. No backend sync
    // here — only the main window owns the Rust-side toggle.
    return wireRuntimeGates();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme.mode === "dark");
  }, [theme.mode]);

  const renderView = () => {
    switch (view) {
      case "kanban":
        return <KanbanDashboardView />;
      case "library":
        return <LibraryView />;
      case "editor":
        return <MarkdownEditorView />;
      case "settings":
        return <PreferencesView />;
      default:
        return <div className="flex items-center justify-center h-full text-neutral-500">Unbekannte Ansicht: {view}</div>;
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-surface-base text-neutral-200">
      <Suspense fallback={<NeonSpinner />}>
        {renderView()}
      </Suspense>
    </div>
  );
}
