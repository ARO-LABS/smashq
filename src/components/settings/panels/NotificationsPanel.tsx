import { useSettingsStore } from "../../../store/settingsStore";

export function NotificationsPanel() {
  const notifications = useSettingsStore((s) => s.notifications);
  const sound = useSettingsStore((s) => s.sound);
  const setNotifications = useSettingsStore((s) => s.setNotifications);
  const setSound = useSettingsStore((s) => s.setSound);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-neutral-200">Benachrichtigungen</h3>
        <p className="text-xs text-neutral-500">
          Welche Events Toasts auslösen — und ob Sound dabei abgespielt wird.
        </p>
      </header>

      <section className="rounded-md shadow-hairline p-4 flex flex-col gap-3 bg-surface-base">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wide">Events</h4>
        <Toggle
          label="Benachrichtigungen aktiviert"
          checked={notifications.enabled}
          onChange={(v) => setNotifications({ enabled: v })}
        />
        <Toggle
          label="Pipeline abgeschlossen"
          checked={notifications.pipelineComplete}
          disabled={!notifications.enabled}
          onChange={(v) => setNotifications({ pipelineComplete: v })}
        />
        <Toggle
          label="Pipeline-Fehler"
          checked={notifications.pipelineError}
          disabled={!notifications.enabled}
          onChange={(v) => setNotifications({ pipelineError: v })}
        />
        <Toggle
          label="QA-Gate Ergebnis"
          checked={notifications.qaGateResult}
          disabled={!notifications.enabled}
          onChange={(v) => setNotifications({ qaGateResult: v })}
        />
        <Toggle
          label="Kosten-Warnung"
          checked={notifications.costAlert}
          disabled={!notifications.enabled}
          onChange={(v) => setNotifications({ costAlert: v })}
        />
      </section>

      <section className="rounded-md shadow-hairline p-4 flex flex-col gap-3 bg-surface-base">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wide">Sound</h4>
        <Toggle
          label="Sound aktiviert"
          checked={sound.enabled}
          onChange={(v) => setSound({ enabled: v })}
        />
        <label className={`flex flex-col gap-1 text-sm ${sound.enabled ? "" : "opacity-40"}`}>
          <span className="text-neutral-300">Lautstärke ({Math.round(sound.volume * 100)} %)</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sound.volume}
            disabled={!sound.enabled}
            onChange={(e) => setSound({ volume: Number(e.target.value) })}
            className="w-full accent-accent"
          />
        </label>
      </section>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-sm ${
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-neutral-200">{label}</span>
    </label>
  );
}
