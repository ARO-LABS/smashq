import { useSettingsStore } from "../../../store/settingsStore";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { SettingsPanelHeader } from "../shared/SettingsPanelHeader";
import { SettingsSection } from "../shared/SettingsSection";

export function ThemePanel() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <SettingsPanelHeader
        title="Darstellung"
        description="Theme-Modus und Animation. Dark Mode ist Standard und auf den Concept-B-Look hin getuned."
      />

      <SettingsSection title="Modus">
        <div className="flex gap-2">
          <ModeButton mode="light" current={theme.mode} onSelect={(m) => setTheme({ mode: m })} />
          <ModeButton mode="dark" current={theme.mode} onSelect={(m) => setTheme({ mode: m })} />
        </div>
        <p className="text-xs text-neutral-500">
          Light Mode ist verfügbar, aber sekundär — Concept-B-Token sind primär für Dark optimiert.
        </p>
      </SettingsSection>

      <SettingsSection title="Bewegung">
        <ToggleSwitch
          label="Reduzierte Bewegung"
          description="Deaktiviert Animationen für bessere Lesbarkeit. Folgt sonst dem System-Setting."
          checked={theme.reducedMotion}
          onChange={(v) => setTheme({ reducedMotion: v })}
        />
      </SettingsSection>

      <SettingsSection title="Terminal">
        <ToggleSwitch
          label="Terminal-Farben an App-Theme koppeln"
          description="Koppelt Hintergrund und Vordergrund des Terminals an den Hell/Dunkel-Modus. Standardmäßig aus — sonst überschreibt der Moduswechsel die Farben laufender Programme. Wirkt auf neu gestartete Sessions."
          checked={theme.syncTerminalTheme ?? false}
          onChange={(v) => setTheme({ syncTerminalTheme: v })}
        />
      </SettingsSection>
    </div>
  );
}

function ModeButton({
  mode,
  current,
  onSelect,
}: {
  mode: "light" | "dark";
  current: string;
  onSelect: (m: "light" | "dark") => void;
}) {
  const isActive = current === mode;
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      className={`px-3 py-1.5 rounded-md text-sm transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${
        isActive
          ? "bg-accent-a15 text-accent ring-1 ring-accent"
          : "bg-surface-raised text-neutral-300 hover:bg-hover-overlay"
      }`}
    >
      {mode === "light" ? "Hell" : "Dunkel"}
    </button>
  );
}
