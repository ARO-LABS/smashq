import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { initTauriStorage } from "./store/tauriStorage";
import { initTasksStorage } from "./store/tasksStorage";
import "./index.css";

const LogWindowApp = lazy(() => import("./LogWindowApp"));
const DetachedViewApp = lazy(() => import("./DetachedViewApp"));
const DiffWindowApp = lazy(() => import("./DiffWindowApp"));

const DETACHED_VIEWS = new Set(["kanban", "library", "editor", "settings", "tasks"]);

Promise.all([initTauriStorage(), initTasksStorage()]).then(async () => {
  if (import.meta.env.DEV || localStorage.getItem("agenticexplorer-perf") === "1") {
    const { initPerf } = await import("./utils/perfLogger");
    initPerf();
  }

  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");

  if (view === "logs") {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <Suspense fallback={<div className="flex items-center justify-center h-screen">Lade Logs...</div>}>
          <LogWindowApp />
        </Suspense>
      </React.StrictMode>
    );
  } else if (view === "diff") {
    // Per-Session-Diff-Window. SessionId aus der URL ziehen — kein Store-Bootstrap
    // im Diff-Window, damit das zweite JS-Context nicht unnoetig den Haupt-State
    // hydratisiert.
    const sessionId = params.get("sessionId");
    const { ErrorBoundary } = await import("./components/shared/ErrorBoundary");
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <ErrorBoundary>
          <Suspense fallback={<div className="flex items-center justify-center h-screen">Lade Diff...</div>}>
            <DiffWindowApp sessionId={sessionId} />
          </Suspense>
        </ErrorBoundary>
      </React.StrictMode>
    );
  } else if (view && DETACHED_VIEWS.has(view)) {
    const { ErrorBoundary } = await import("./components/shared/ErrorBoundary");
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <ErrorBoundary>
          <Suspense fallback={<div className="flex items-center justify-center h-screen">Lade...</div>}>
            <DetachedViewApp view={view} />
          </Suspense>
        </ErrorBoundary>
      </React.StrictMode>
    );
  } else {
    const [{ default: App }, { ErrorBoundary }] = await Promise.all([
      import("./App"),
      import("./components/shared/ErrorBoundary"),
    ]);
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>
    );
  }
});
