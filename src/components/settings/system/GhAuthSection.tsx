import { ICONS, ICON_SIZE } from "../../../utils/icons";
import { GH_FIX_COMMANDS } from "../../../utils/adpError";
import { CopyableCommand } from "../../shared/CopyableCommand";
import { OpenInTerminalButton } from "../../shared/OpenInTerminalButton";

const CheckIcon = ICONS.toast.success; // CheckCircle2
const CrossIcon = ICONS.git.checkFailed; // XCircle
const WarnIcon = ICONS.toast.error; // AlertTriangle

/** Mirrors the Rust `GhAuthStatus` (`github/auth.rs`, camelCase serde). */
export interface GhAuthStatus {
  loggedIn: boolean;
  host?: string | null;
  account?: string | null;
  scopes: string[];
  hasProjectScope: boolean;
}

/** GitHub auth/scope preflight section (Issue #38, Follow-up zu #10).
 *  Renders login state + token scopes; a missing `read:project` scope gets
 *  the copyable fix command plus the "Im Terminal öffnen" launcher — the
 *  same remedies the Kanban error card offers, but visible BEFORE the board
 *  fails to load. */
export function GhAuthSection({ auth, checked }: { auth: GhAuthStatus | null; checked: boolean }) {
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
