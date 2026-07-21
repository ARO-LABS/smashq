import { useCallback, useEffect, useState } from "react";
import { wrapInvoke } from "../../../utils/perfLogger";
import { logError } from "../../../utils/errorLogger";
import { ICONS, ICON_SIZE } from "../../../utils/icons";
import { claudeInstallHint, GH_FIX_COMMANDS } from "../../../utils/adpError";
import { isMacOS, isWindows } from "../../../utils/platform";
import { Button } from "../../ui/Button";
import { CopyableCommand } from "../../shared/CopyableCommand";
import { OpenInTerminalButton } from "../../shared/OpenInTerminalButton";
import { useSettingsStore } from "../../../store/settingsStore";

const CheckIcon = ICONS.toast.success; // CheckCircle2
const CrossIcon = ICONS.git.checkFailed; // XCircle
const WarnIcon = ICONS.toast.error; // AlertTriangle
const RefreshIcon = ICONS.action.refresh;
const LoadingIcon = ICONS.action.loading;

/** Mirrors the Rust `ToolStatus` (camelCase, `path` optional/skipped). */
interface ToolStatus {
  found: boolean;
  path?: string;
}

/** Mirrors the Rust `PrerequisiteStatus`. */
interface PrerequisiteStatus {
  claude: ToolStatus;
  git: ToolStatus;
  gh: ToolStatus;
  shell: ToolStatus;
  shellName: string;
}

/** Mirrors the Rust `GhAuthStatus` (`github/auth.rs`, camelCase serde). */
interface GhAuthStatus {
  loggedIn: boolean;
  host?: string | null;
  account?: string | null;
  scopes: string[];
  hasProjectScope: boolean;
}

type ToolKey = "claude" | "git" | "gh" | "shell";

/** Platform-specific fix command shown when a tool is missing. */
function fixHint(tool: ToolKey): string {
  switch (tool) {
    case "claude":
      return claudeInstallHint();
    case "git":
      if (isWindows()) return "Git von https://git-scm.com installieren.";
      if (isMacOS()) return "Installieren mit: xcode-select --install";
      return "Über den Paketmanager installieren, z. B. apt install git.";
    case "gh":
      return "GitHub CLI von https://cli.github.com installieren.";
    case "shell":
      return "Keine unterstützte Shell auf PATH gefunden.";
  }
}

function ToolRow({
  tool,
  label,
  status,
}: {
  tool: ToolKey;
  label: string;
  status: ToolStatus;
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      {status.found ? (
        <CheckIcon className={`${ICON_SIZE.nav} text-success shrink-0 mt-0.5`} aria-hidden="true" />
      ) : (
        <CrossIcon className={`${ICON_SIZE.nav} text-error shrink-0 mt-0.5`} aria-hidden="true" />
      )}
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-neutral-200">{label}</span>
        {status.found ? (
          <span className="text-xs text-neutral-500 font-mono truncate" title={status.path ?? ""}>
            {status.path ?? "gefunden"}
          </span>
        ) : (
          <span className="text-xs text-neutral-400 font-mono">{fixHint(tool)}</span>
        )}
      </div>
    </div>
  );
}

/** GitHub auth/scope preflight section (Issue #38, Follow-up zu #10).
 *  Renders login state + token scopes; a missing `read:project` scope gets
 *  the copyable fix command plus the "Im Terminal öffnen" launcher — the
 *  same remedies the Kanban error card offers, but visible BEFORE the board
 *  fails to load. */
function GhAuthSection({ auth, checked }: { auth: GhAuthStatus | null; checked: boolean }) {
  if (!checked) {
    return <p className="text-xs text-neutral-500">Prüfe Anmeldestatus…</p>;
  }
  if (!auth) {
    return (
      <p className="text-xs text-neutral-500">
        Anmeldestatus nicht prüfbar — GitHub CLI installieren und erneut prüfen.
      </p>
    );
  }
  if (!auth.loggedIn) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-3 text-sm">
          <CrossIcon
            className={`${ICON_SIZE.nav} text-error shrink-0 mt-0.5`}
            aria-hidden="true"
          />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-neutral-200">Nicht bei GitHub angemeldet</span>
            <span className="text-xs text-neutral-400">
              Den Befehl in einem Terminal ausführen, um das Kanban-Board zu nutzen.
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-7">
          <CopyableCommand command={GH_FIX_COMMANDS.gh_login} />
          <OpenInTerminalButton commandId="gh_login" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3 text-sm">
        <CheckIcon
          className={`${ICON_SIZE.nav} text-success shrink-0 mt-0.5`}
          aria-hidden="true"
        />
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-neutral-200">
            Angemeldet als {auth.account ?? "unbekannt"}
            {auth.host ? ` (${auth.host})` : ""}
          </span>
          <span className="text-xs text-neutral-500 font-mono truncate" title={auth.scopes.join(", ")}>
            Scopes: {auth.scopes.length > 0 ? auth.scopes.join(", ") : "unbekannt"}
          </span>
        </div>
      </div>
      {!auth.hasProjectScope ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-3 text-sm">
            <WarnIcon
              className={`${ICON_SIZE.nav} text-warning shrink-0 mt-0.5`}
              aria-hidden="true"
            />
            <span className="text-xs text-neutral-400">
              Scope <span className="font-mono text-neutral-300">read:project</span> fehlt —
              das Kanban-Board kann ohne ihn nicht laden. Den Befehl in einem
              Terminal ausführen und danach erneut prüfen.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-7">
            <CopyableCommand command={GH_FIX_COMMANDS.gh_refresh_project_scope} />
            <OpenInTerminalButton commandId="gh_refresh_project_scope" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SystemPanel() {
  const [status, setStatus] = useState<PrerequisiteStatus | null>(null);
  const [auth, setAuth] = useState<GhAuthStatus | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(false);

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
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-neutral-200">System</h3>
        <p className="text-xs text-neutral-500">
          Voraussetzungen für neue Sessions. Fehlt <span className="text-neutral-300">claude</span>,
          lässt sich keine Session starten.
        </p>
      </header>

      <section className="rounded-md shadow-hairline p-4 flex flex-col gap-4 bg-surface-base">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wide">
            Voraussetzungen
          </h4>
          <Button variant="secondary" size="sm" onClick={check} disabled={loading}>
            {loading ? (
              <LoadingIcon className={`${ICON_SIZE.card} animate-spin`} aria-hidden="true" />
            ) : (
              <RefreshIcon className={ICON_SIZE.card} aria-hidden="true" />
            )}
            <span>Erneut prüfen</span>
          </Button>
        </div>

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
      </section>

      <section className="rounded-md shadow-hairline p-4 flex flex-col gap-4 bg-surface-base">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wide">
          GitHub-Konto
        </h4>
        <GhAuthSection auth={auth} checked={authChecked} />
      </section>

      <UpdatesSection />
    </div>
  );
}

/**
 * Updates-Sektion: Toggle für den automatischen Update-Check (Issue #21).
 * Gated NUR den automatischen Check in useAutoUpdate — der manuelle Check
 * über das v-Badge in der Session-Leiste funktioniert unabhängig davon.
 */
function UpdatesSection() {
  const autoUpdateEnabled = useSettingsStore((s) => s.autoUpdateEnabled ?? true);
  const setAutoUpdateEnabled = useSettingsStore((s) => s.setAutoUpdateEnabled);

  return (
    <section className="rounded-md shadow-hairline p-4 flex flex-col gap-4 bg-surface-base">
      <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wide">
        Updates
      </h4>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={autoUpdateEnabled}
          onChange={(e) => setAutoUpdateEnabled(e.target.checked)}
        />
        <span className="text-neutral-200">Automatisch nach Updates suchen</span>
      </label>
      <p className="text-xs text-neutral-500">
        Die manuelle Suche über das Versions-Badge in der Session-Leiste bleibt
        jederzeit möglich.
      </p>
    </section>
  );
}
