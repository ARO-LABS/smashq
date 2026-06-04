import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSettingsStore, type SettingsState } from "../../store/settingsStore";
import { logError } from "../../utils/errorLogger";
import { ICONS, ICON_SIZE } from "../../utils/icons";
import { Button } from "../ui/Button";

const FolderOpenIcon = ICONS.action.folderOpen;

const SHELL_OPTIONS: { value: SettingsState["defaultShell"]; label: string }[] = [
  { value: "auto", label: "Auto (Plattform-Default)" },
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "CMD" },
  { value: "bash", label: "Bash" },
  { value: "zsh", label: "Zsh" },
];

export function NewSessionDefaultsPanel() {
  const defaultShell = useSettingsStore((s) => s.defaultShell);
  const defaultProjectPath = useSettingsStore((s) => s.defaultProjectPath);
  const setDefaultShell = useSettingsStore((s) => s.setDefaultShell);
  const setDefaultProjectPath = useSettingsStore((s) => s.setDefaultProjectPath);
  const [picking, setPicking] = useState(false);

  async function handlePickFolder() {
    setPicking(true);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Standard-Projektordner wählen",
      });
      if (selected && typeof selected === "string") {
        setDefaultProjectPath(selected);
      }
    } catch (err) {
      logError("NewSessionDefaultsPanel.pickFolder", err);
    } finally {
      setPicking(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-neutral-200">Neue Session</h3>
        <p className="text-xs text-neutral-500">
          Diese Werte starten beim Klick auf <span className="text-neutral-300">+ Neue Session</span> sofort eine Sitzung.
        </p>
      </header>

      <section className="rounded-md shadow-hairline p-4 flex flex-col gap-4 bg-surface-base">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="default-shell" className="text-xs font-medium text-neutral-300">
            Standard-Shell
          </label>
          <select
            id="default-shell"
            value={defaultShell}
            onChange={(e) => setDefaultShell(e.target.value as SettingsState["defaultShell"])}
            className="w-full rounded-md bg-surface-raised shadow-hairline text-neutral-200 text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent focus:ring-inset transition-shadow duration-150"
          >
            {SHELL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-neutral-300">Standard-Projektordner</label>
          <div className="flex items-center gap-2">
            <div
              className="flex-1 min-w-0 rounded-md bg-surface-raised shadow-hairline text-neutral-300 text-xs px-3 py-2 truncate font-mono"
              title={defaultProjectPath || "Kein Ordner gesetzt"}
            >
              {defaultProjectPath || (
                <span className="text-neutral-500 italic">Kein Ordner gesetzt</span>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={handlePickFolder} disabled={picking}>
              <FolderOpenIcon className={ICON_SIZE.card} />
              <span>Wählen</span>
            </Button>
            {defaultProjectPath && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDefaultProjectPath("")}
                title="Default zurücksetzen"
              >
                Leeren
              </Button>
            )}
          </div>
          {!defaultProjectPath && (
            <p className="text-xs text-neutral-500">
              Ohne Default öffnet der Button beim ersten Klick einen Ordner-Picker.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
