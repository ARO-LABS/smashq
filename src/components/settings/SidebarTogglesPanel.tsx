import { useSettingsStore } from "../../store/settingsStore";

export function SidebarTogglesPanel() {
  const showProtokolleTab = useSettingsStore((s) => s.preferences.showProtokolleTab);
  const setPreferences = useSettingsStore((s) => s.setPreferences);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-neutral-200">Sidebar</h3>
        <p className="text-xs text-neutral-500">
          Tabs in der linken Navigation an- oder ausblenden.
        </p>
      </header>

      <section className="rounded-md shadow-hairline p-4 flex flex-col gap-3 bg-surface-base">
        <label className="flex items-start gap-2 cursor-pointer text-sm text-neutral-200">
          <input
            type="checkbox"
            checked={showProtokolleTab}
            onChange={(e) => setPreferences({ showProtokolleTab: e.target.checked })}
            className="mt-0.5 accent-accent"
          />
          <span>
            <span className="block">Protokolle-Tab anzeigen</span>
            <span className="block text-xs text-neutral-500">
              Zeigt die Live-Log-Ansicht in der Seitennavigation. Standardmäßig versteckt, wenn Logging aus ist.
            </span>
          </span>
        </label>
      </section>
    </div>
  );
}
