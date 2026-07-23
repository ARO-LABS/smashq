import { useSettingsStore, type AppPreferencesSettings } from "../../store/settingsStore";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { SettingsSection } from "./shared/SettingsSection";

type LoggingFlag = keyof Pick<
  AppPreferencesSettings,
  "frontendLogging" | "backendFileLogging" | "performanceProfiler"
>;

const SUB_TOGGLES: { key: LoggingFlag; label: string; help: string }[] = [
  {
    key: "frontendLogging",
    label: "Frontend-Errors",
    help: "1000-Eintrag-Ringbuffer für die Protokolle-Ansicht. Toasts bleiben unabhängig.",
  },
  {
    key: "backendFileLogging",
    label: "Log-Datei (NDJSON)",
    help: "Schreibt app-log.ndjson (Frontend + Backend) im AppData-Ordner für spätere Analyse. Größter Disk-/IO-Hebel.",
  },
  {
    key: "performanceProfiler",
    label: "Performance-Profiler",
    help: "IPC-Latenz, Render-Zeiten, Event-Throughput. Standard nur in Dev-Builds.",
  },
];

/**
 * Sektion "Debug-Logging" — seit der Tab-Konsolidierung (Issue #52) Teil des
 * System-Tabs (panels/SystemPanel).
 */
export function DebugLoggingSection() {
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
    <SettingsSection title="Debug-Logging">
      <p className="text-xs text-neutral-500">
        Standardmäßig aus, um RAM und Disk im Daily-Use zu sparen. Beim aktiven Debuggen einschalten.
      </p>

      <fieldset className="space-y-2">
        <legend className="sr-only">Master-Schalter</legend>
        <label className="flex items-start gap-2 cursor-pointer text-sm text-neutral-200">
          <input
            type="radio"
            name="logging-master"
            checked={!anyEnabled}
            onChange={() => handleMasterChange(false)}
            className="mt-0.5 accent-accent focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
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
            className="mt-0.5 accent-accent focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          />
          <span>
            <span className="block">Aktiviert</span>
            <span className="block text-xs text-neutral-500">
              Sub-Optionen unten freischalten.
            </span>
          </span>
        </label>
      </fieldset>

      {/* Container dimmt bewusst NICHT selbst: die disabled-ToggleSwitches dimmen
          ihre Zeile (inkl. Description) bereits auf opacity-40 — eine zusätzliche
          Container-Opacity würde multiplikativ stapeln (0.4 × 0.4 ≈ 0.16). */}
      <div
        className={`pl-6 space-y-3 border-l-2 ${
          anyEnabled ? "border-accent" : "border-neutral-700 pointer-events-none"
        }`}
        aria-disabled={!anyEnabled}
      >
        {SUB_TOGGLES.map((toggle) => (
          <ToggleSwitch
            key={toggle.key}
            label={toggle.label}
            description={toggle.help}
            checked={preferences[toggle.key]}
            disabled={!anyEnabled}
            onChange={(value) => setPreferences({ [toggle.key]: value })}
          />
        ))}
      </div>
    </SettingsSection>
  );
}
