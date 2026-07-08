import { useSettingsStore } from "../../../store/settingsStore";

export function ThemePanel() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-neutral-200">Darstellung</h3>
        <p className="text-xs text-neutral-500">
          Theme-Modus und Animation. Dark Mode ist Standard und auf den Concept-B-Look hin getuned.
        </p>
      </header>

      <section className="rounded-md shadow-hairline p-4 flex flex-col gap-3 bg-surface-base">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wide">Modus</h4>
        <div className="flex gap-2">
          <ModeButton mode="light" current={theme.mode} onSelect={(m) => setTheme({ mode: m })} />
          <ModeButton mode="dark" current={theme.mode} onSelect={(m) => setTheme({ mode: m })} />
        </div>
        <p className="text-xs text-neutral-500">
          Light Mode ist verfügbar, aber sekundär — Concept-B-Token sind primär für Dark optimiert.
        </p>
      </section>

      <section className="rounded-md shadow-hairline p-4 flex flex-col gap-3 bg-surface-base">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wide">Bewegung</h4>
        <label className="flex items-start gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            checked={theme.reducedMotion}
            onChange={(e) => setTheme({ reducedMotion: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            <span className="text-neutral-200">Reduzierte Bewegung</span>
            <span className="block text-xs text-neutral-500 mt-0.5">
              Deaktiviert Animationen für bessere Lesbarkeit. Folgt sonst dem System-Setting.
            </span>
          </span>
        </label>
      </section>

      <section className="rounded-md shadow-hairline p-4 flex flex-col gap-3 bg-surface-base">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wide">Terminal</h4>
        <label className="flex items-start gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            checked={theme.syncTerminalTheme ?? false}
            onChange={(e) => setTheme({ syncTerminalTheme: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            <span className="text-neutral-200">Terminal-Farben an App-Theme koppeln</span>
            <span className="block text-xs text-neutral-500 mt-0.5">
              Koppelt Hintergrund und Vordergrund des Terminals an den Hell/Dunkel-Modus.
              Standardmäßig aus — sonst überschreibt der Moduswechsel die Farben laufender
              Programme. Wirkt auf neu gestartete Sessions.
            </span>
          </span>
        </label>
      </section>
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
      className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
        isActive
          ? "bg-accent-a15 text-accent ring-1 ring-accent"
          : "bg-surface-raised text-neutral-300 hover:bg-hover-overlay"
      }`}
    >
      {mode === "light" ? "Hell" : "Dunkel"}
    </button>
  );
}
