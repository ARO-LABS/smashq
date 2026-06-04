import { useEffect } from "react";
import { useSettingsStore } from "./store/settingsStore";
import { wireRuntimeGates } from "./utils/wireRuntimeGates";
import { DiffWindowView } from "./views/DiffWindowView";

interface DiffWindowAppProps {
  sessionId: string | null;
}

/**
 * Per-Window-Wrapper fuer das Session-Diff-Fenster.
 *
 * Mirrors `LogWindowApp`: re-wired Perf-/Logging-Gates pro Window (jeder
 * React-Root hat seinen eigenen Module-Scope) und toggelt das Dark-Theme
 * anhand der globalen Settings.
 */
export default function DiffWindowApp({ sessionId }: DiffWindowAppProps) {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
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
      <DiffWindowView sessionId={sessionId} />
    </div>
  );
}
