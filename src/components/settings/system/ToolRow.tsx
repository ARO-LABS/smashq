import { ICONS, ICON_SIZE } from "../../../utils/icons";
import { claudeInstallHint } from "../../../utils/adpError";
import { isMacOS, isWindows } from "../../../utils/platform";

const CheckIcon = ICONS.toast.success; // CheckCircle2
const CrossIcon = ICONS.git.checkFailed; // XCircle

/** Mirrors the Rust `ToolStatus` (camelCase, `path` optional/skipped). */
export interface ToolStatus {
  found: boolean;
  path?: string;
}

export type ToolKey = "claude" | "git" | "gh" | "shell";

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

export function ToolRow({
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
