import { useCallback, useEffect, useState } from "react";
import { wrapInvoke } from "../../../utils/perfLogger";
import { logError } from "../../../utils/errorLogger";
import { ICONS, ICON_SIZE } from "../../../utils/icons";
import { claudeInstallHint } from "../../../utils/adpError";
import { isMacOS, isWindows } from "../../../utils/platform";
import { Button } from "../../ui/Button";

const CheckIcon = ICONS.toast.success; // CheckCircle2
const CrossIcon = ICONS.git.checkFailed; // XCircle
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

export function SystemPanel() {
  const [status, setStatus] = useState<PrerequisiteStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const check = useCallback(async () => {
    // Outside Tauri (browser dev / jsdom without mockIPC) there is no backend.
    if (!("__TAURI_INTERNALS__" in window)) return;
    setLoading(true);
    try {
      const result = await wrapInvoke<PrerequisiteStatus>("check_prerequisites");
      setStatus(result ?? null);
    } catch (err) {
      logError("SystemPanel.checkPrerequisites", err);
    } finally {
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
    </div>
  );
}
