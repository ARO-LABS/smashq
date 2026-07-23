import { useCallback, useEffect, useState } from "react";
import { wrapInvoke } from "../../../utils/perfLogger";
import { logError } from "../../../utils/errorLogger";
import { ICONS, ICON_SIZE } from "../../../utils/icons";
import { Button } from "../../ui/Button";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { useSettingsStore } from "../../../store/settingsStore";
import { SettingsPanelHeader } from "../shared/SettingsPanelHeader";
import { SettingsSection } from "../shared/SettingsSection";
import { ToolRow, type ToolStatus } from "../system/ToolRow";
import { GhAuthSection, type GhAuthStatus } from "../system/GhAuthSection";
import { DebugLoggingSection } from "../DebugLoggingPanel";

const RefreshIcon = ICONS.action.refresh;
const LoadingIcon = ICONS.action.loading;

/** Mirrors the Rust `PrerequisiteStatus`. */
interface PrerequisiteStatus {
  claude: ToolStatus;
  git: ToolStatus;
  gh: ToolStatus;
  shell: ToolStatus;
  shellName: string;
}

export function SystemPanel() {
  const [status, setStatus] = useState<PrerequisiteStatus | null>(null);
  const [auth, setAuth] = useState<GhAuthStatus | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(false);

  // Updates-Toggle für den automatischen Update-Check (Issue #21).
  // Gated NUR den automatischen Check in useAutoUpdate — der manuelle Check
  // über das v-Badge in der Session-Leiste funktioniert unabhängig davon.
  const autoUpdateEnabled = useSettingsStore((s) => s.autoUpdateEnabled ?? true);
  const setAutoUpdateEnabled = useSettingsStore((s) => s.setAutoUpdateEnabled);

  const check = useCallback(async () => {
    // Outside Tauri (browser dev / jsdom without mockIPC) there is no backend.
    if (!("__TAURI_INTERNALS__" in window)) return;
    setLoading(true);
    // Auth preflight in parallel: failure (e.g. gh missing) must not block the
    // prerequisite rows — it degrades to the "nicht prüfbar" hint instead.
    const authProbe = wrapInvoke<GhAuthStatus>("check_gh_auth_status")
      .then((result) => setAuth(result ?? null))
      .catch((err) => {
        setAuth(null);
        logError("SystemPanel.checkGhAuthStatus", err);
      })
      .finally(() => setAuthChecked(true));
    try {
      const result = await wrapInvoke<PrerequisiteStatus>("check_prerequisites");
      setStatus(result ?? null);
    } catch (err) {
      logError("SystemPanel.checkPrerequisites", err);
    } finally {
      await authProbe;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <SettingsPanelHeader
        title="System"
        description={
          <>
            Voraussetzungen für neue Sessions. Fehlt{" "}
            <span className="text-neutral-300">claude</span>, lässt sich keine Session starten.
          </>
        }
      />

      <SettingsSection
        title="Voraussetzungen"
        headerAction={
          <Button variant="secondary" size="sm" onClick={check} disabled={loading}>
            {loading ? (
              <LoadingIcon className={`${ICON_SIZE.card} animate-spin`} aria-hidden="true" />
            ) : (
              <RefreshIcon className={ICON_SIZE.card} aria-hidden="true" />
            )}
            <span>Erneut prüfen</span>
          </Button>
        }
      >
        {status ? (
          <div className="flex flex-col gap-3">
            <ToolRow tool="claude" label="Claude CLI" status={status.claude} />
            <ToolRow tool="git" label="Git" status={status.git} />
            <ToolRow tool="gh" label="GitHub CLI (gh)" status={status.gh} />
            <ToolRow tool="shell" label={`Shell (${status.shellName})`} status={status.shell} />
          </div>
        ) : (
          <p className="text-xs text-neutral-500">
            {loading ? "Prüfe Voraussetzungen…" : "Keine Daten — außerhalb der App nicht verfügbar."}
          </p>
        )}
      </SettingsSection>

      <SettingsSection title="GitHub-Konto">
        <GhAuthSection auth={auth} checked={authChecked} />
      </SettingsSection>

      <SettingsSection title="Updates">
        <ToggleSwitch
          label="Automatisch nach Updates suchen"
          checked={autoUpdateEnabled}
          onChange={(v) => setAutoUpdateEnabled(v)}
        />
        <p className="text-xs text-neutral-500">
          Die manuelle Suche über das Versions-Badge in der Session-Leiste bleibt
          jederzeit möglich.
        </p>
      </SettingsSection>

      <DebugLoggingSection />
    </div>
  );
}
