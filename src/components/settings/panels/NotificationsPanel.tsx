import { useSettingsStore } from "../../../store/settingsStore";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { SettingsPanelHeader } from "../shared/SettingsPanelHeader";
import { SettingsSection } from "../shared/SettingsSection";

export function NotificationsPanel() {
  const notifications = useSettingsStore((s) => s.notifications);
  const sound = useSettingsStore((s) => s.sound);
  const setNotifications = useSettingsStore((s) => s.setNotifications);
  const setSound = useSettingsStore((s) => s.setSound);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <SettingsPanelHeader
        title="Benachrichtigungen"
        description="Welche Events Toasts auslösen — und ob Sound dabei abgespielt wird."
      />

      <SettingsSection title="Events">
        <ToggleSwitch
          label="Benachrichtigungen aktiviert"
          checked={notifications.enabled}
          onChange={(v) => setNotifications({ enabled: v })}
        />
        <ToggleSwitch
          label="Pipeline abgeschlossen"
          checked={notifications.pipelineComplete}
          disabled={!notifications.enabled}
          onChange={(v) => setNotifications({ pipelineComplete: v })}
        />
        <ToggleSwitch
          label="Pipeline-Fehler"
          checked={notifications.pipelineError}
          disabled={!notifications.enabled}
          onChange={(v) => setNotifications({ pipelineError: v })}
        />
        <ToggleSwitch
          label="QA-Gate Ergebnis"
          checked={notifications.qaGateResult}
          disabled={!notifications.enabled}
          onChange={(v) => setNotifications({ qaGateResult: v })}
        />
        <ToggleSwitch
          label="Kosten-Warnung"
          checked={notifications.costAlert}
          disabled={!notifications.enabled}
          onChange={(v) => setNotifications({ costAlert: v })}
        />
      </SettingsSection>

      <SettingsSection title="Sound">
        <ToggleSwitch
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
            className="w-full accent-accent focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          />
        </label>
      </SettingsSection>
    </div>
  );
}
