import { Suspense, lazy, useEffect } from "react";
import { useSettingsStore } from "./store/settingsStore";
import { wireRuntimeGates } from "./utils/wireRuntimeGates";

const LogViewer = lazy(() => import("./components/logs/LogViewer").then(m => ({ default: m.LogViewer })));

export default function LogWindowApp() {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    // Each window mounts its own React root; perf/logging gates are
    // module-local and must be re-wired per-window. No backend sync
    // here — only the main window owns the Rust-side toggle.
    const unsubscribeGates = wireRuntimeGates();

    return () => {
      unsubscribeGates();
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme.mode === "dark");
  }, [theme.mode]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-surface-base text-neutral-200">
      <Suspense fallback={<div className="flex items-center justify-center h-full text-sm text-neutral-500">Lade Logs...</div>}>
        <LogViewer />
      </Suspense>
    </div>
  );
}
