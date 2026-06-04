import { useSettingsStore, type AppPreferencesSettings } from "../../store/settingsStore";

type LoggingFlag = keyof Pick<
  AppPreferencesSettings,
  "frontendLogging" | "backendFileLogging" | "performanceProfiler"
>;

const SUB_TOGGLES: { key: LoggingFlag; label: string; help: string }[] = [
  {
    key: "frontendLogging",
    label: "Frontend-Errors",
    help: "100-Eintrag-Ringbuffer für die Protokolle-Ansicht. Toasts bleiben unabhängig.",
  },
  {
    key: "backendFileLogging",
    label: "Backend-Log-Files",
    help: "Schreibt smashq.log im AppData-Ordner. Größter Disk- und IO-Hebel.",
  },
  {
    key: "performanceProfiler",
    label: "Performance-Profiler",
    help: "IPC-Latenz, Render-Zeiten, Event-Throughput. Standard nur in Dev-Builds.",
  },
];

export function DebugLoggingPanel() {
  const preferences = useSettingsStore((s) => s.preferences);
  const setPreferences = useSettingsStore((s) => s.setPreferences);

  const anyEnabled =
    preferences.frontendLogging ||
    preferences.backendFileLogging ||
    preferences.performanceProfiler;

  function handleMasterChange(enable: boolean) {
    if (enable) {
      // Soft "wake up" — turn on the most useful default (frontend) so the
      // user sees something happen. They can fine-tune sub-checkboxes after.
      setPreferences({
        frontendLogging: true,
        backendFileLogging: false,
        performanceProfiler: false,
      });
    } else {
      setPreferences({
        frontendLogging: false,
        backendFileLogging: false,
        performanceProfiler: false,
      });
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-neutral-200">Debug-Logging</h3>
        <p className="text-xs text-neutral-500">
          Standardmäßig aus, um RAM und Disk im Daily-Use zu sparen.
          Beim aktiven Debuggen einschalten.
        </p>
      </header>

      <section className="rounded-md shadow-hairline p-4 flex flex-col gap-4 bg-surface-base">
        <fieldset className="space-y-2">
          <legend className="sr-only">Master-Schalter</legend>
          <label className="flex items-start gap-2 cursor-pointer text-sm text-neutral-200">
            <input
              type="radio"
              name="logging-master"
              checked={!anyEnabled}
              onChange={() => handleMasterChange(false)}
              className="mt-0.5 accent-accent"
            />
            <span>
              <span className="block">Komplett aus (empfohlen)</span>
              <span className="block text-xs text-neutral-500">
                Kein Buffer, keine Datei, kein Profiler.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer text-sm text-neutral-200">
            <input
              type="radio"
              name="logging-master"
              checked={anyEnabled}
              onChange={() => handleMasterChange(true)}
              className="mt-0.5 accent-accent"
            />
            <span>
              <span className="block">Aktiviert</span>
              <span className="block text-xs text-neutral-500">
                Sub-Optionen unten freischalten.
              </span>
            </span>
          </label>
        </fieldset>

        <div
          className={`pl-6 space-y-3 border-l-2 transition-opacity duration-200 ${
            anyEnabled
              ? "border-accent opacity-100"
              : "border-neutral-700 opacity-40 pointer-events-none"
          }`}
          aria-disabled={!anyEnabled}
        >
          {SUB_TOGGLES.map((toggle) => (
            <label
              key={toggle.key}
              className="flex items-start gap-2 cursor-pointer text-sm text-neutral-200"
            >
              <input
                type="checkbox"
                checked={preferences[toggle.key]}
                disabled={!anyEnabled}
                onChange={(e) => setPreferences({ [toggle.key]: e.target.checked })}
                className="mt-0.5 accent-accent disabled:cursor-not-allowed"
              />
              <span>
                <span className="block">{toggle.label}</span>
                <span className="block text-xs text-neutral-500">{toggle.help}</span>
              </span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
