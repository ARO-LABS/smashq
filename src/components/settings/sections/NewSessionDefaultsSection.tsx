import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSettingsStore, type SettingsState, type PermissionMode } from "../../../store/settingsStore";
import { logError } from "../../../utils/errorLogger";
import { wrapInvoke } from "../../../utils/perfLogger";
import { ICONS, ICON_SIZE } from "../../../utils/icons";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { SettingsSection } from "../shared/SettingsSection";

const FolderOpenIcon = ICONS.action.folderOpen;

type ShellValue = SettingsState["defaultShell"];

interface ShellOption {
  value: ShellValue;
  label: string;
}

const AUTO_OPTION: ShellOption = { value: "auto", label: "Auto (Plattform-Default)" };

/**
 * Statischer Fallback, solange `detect_shells` nicht geantwortet hat oder die
 * App ausserhalb von Tauri laeuft (Browser-Dev, jsdom-Tests).
 */
const FALLBACK_SHELL_OPTIONS: ShellOption[] = [
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "CMD" },
  { value: "bash", label: "Bash" },
  { value: "zsh", label: "Zsh" },
];

const PERMISSION_MODE_OPTIONS: { value: PermissionMode; label: string; hint: string }[] = [
  { value: "default", label: "Standard (Nachfragen)", hint: "Claude fragt vor jeder Aktion nach." },
  { value: "auto", label: "Auto", hint: "Erlaubt Aktionen automatisch, außer bei Konflikten." },
  { value: "plan", label: "Plan", hint: "Startet im Planungsmodus ohne Änderungen." },
  { value: "bypass", label: "Bypass / YOLO", hint: "Überspringt alle Nachfragen (bisheriges Verhalten)." },
];

function isKnownShellValue(id: string): id is Exclude<ShellValue, "auto"> {
  return FALLBACK_SHELL_OPTIONS.some((o) => o.value === id);
}

/** Laedt die auf diesem Geraet real installierten Shells vom Rust-Backend. */
function useDetectedShells(): ShellOption[] | null {
  const [detected, setDetected] = useState<ShellOption[] | null>(null);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    wrapInvoke<Array<{ id?: string; label?: string }>>("detect_shells")
      .then((shells) => {
        if (cancelled || !Array.isArray(shells)) return;
        setDetected(
          shells
            .filter((s): s is { id: string; label?: string } => isKnownShellValue(s?.id ?? ""))
            .map((s) => ({ value: s.id as ShellValue, label: s.label ?? s.id })),
        );
      })
      .catch((err) => logError("NewSessionDefaultsSection.detectShells", err));
    return () => {
      cancelled = true;
    };
  }, []);

  return detected;
}

/**
 * Sektion "Neue Session" — seit der Tab-Konsolidierung (Issue #52) Teil des
 * Sessions-Tabs (panels/SessionsPanel).
 */
export function NewSessionDefaultsSection() {
  const defaultShell = useSettingsStore((s) => s.defaultShell);
  const defaultProjectPath = useSettingsStore((s) => s.defaultProjectPath);
  const setDefaultShell = useSettingsStore((s) => s.setDefaultShell);
  const setDefaultProjectPath = useSettingsStore((s) => s.setDefaultProjectPath);
  const defaultPermissionMode = useSettingsStore((s) => s.defaultPermissionMode);
  const setDefaultPermissionMode = useSettingsStore((s) => s.setDefaultPermissionMode);
  const activeModeHint =
    PERMISSION_MODE_OPTIONS.find((o) => o.value === defaultPermissionMode)?.hint ?? "";
  const [picking, setPicking] = useState(false);
  const detectedShells = useDetectedShells();

  const shellOptions = [AUTO_OPTION, ...(detectedShells ?? FALLBACK_SHELL_OPTIONS)];
  // Gespeicherte, aber nicht (mehr) installierte Shell sichtbar halten —
  // sonst zeigt das <select> stumm einen leeren Wert an.
  if (!shellOptions.some((o) => o.value === defaultShell)) {
    const label =
      FALLBACK_SHELL_OPTIONS.find((o) => o.value === defaultShell)?.label ?? defaultShell;
    shellOptions.push({ value: defaultShell, label: `${label} (nicht gefunden)` });
  }

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
      logError("NewSessionDefaultsSection.pickFolder", err);
    } finally {
      setPicking(false);
    }
  }

  return (
    <SettingsSection title="Neue Session">
      <p className="text-xs text-neutral-500">
        Diese Werte starten beim Klick auf <span className="text-neutral-300">+ Neue Session</span> sofort eine Sitzung.
      </p>

      <div className="flex flex-col gap-1.5">
        <Select
          label="Standard-Shell"
          value={defaultShell}
          options={shellOptions}
          onChange={(v) => setDefaultShell(v as SettingsState["defaultShell"])}
        />
        {detectedShells !== null && (
          <p className="text-xs text-neutral-500">
            Angezeigt werden nur Shells, die auf diesem Gerät gefunden wurden.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Select
          label="Permission-Modus"
          value={defaultPermissionMode}
          options={PERMISSION_MODE_OPTIONS}
          onChange={(v) => setDefaultPermissionMode(v as PermissionMode)}
        />
        <p className="text-xs text-neutral-500">{activeModeHint}</p>
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
    </SettingsSection>
  );
}
