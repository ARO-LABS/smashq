import { useState } from "react";
import { wrapInvoke } from "../../utils/perfLogger";
import { logError } from "../../utils/errorLogger";
import { ICONS, ICON_SIZE } from "../../utils/icons";
import type { TerminalFixCommandId } from "../../utils/adpError";

const TerminalIcon = ICONS.action.terminal;

/** Öffnet das System-Terminal mit einem allowlisted gh-Fix-Befehl.
 *
 *  Sicherheitsmodell (Issue #38): es wird NIE ein Befehlsstring an das
 *  Backend geschickt — nur der geschlossene Diskriminator
 *  `TerminalFixCommandId`. Das Rust-Backend mappt ihn auf feste
 *  `&'static str`-Literale (Allowlist in `github/auth.rs`); unbekannte Werte
 *  werden dort strukturiert abgelehnt. `gh auth`-Befehle sind interaktiv
 *  (OAuth-Device-Flow, TTY-Pflicht), deshalb ein echtes Terminal statt eines
 *  Headless-Aufrufs. */
export function OpenInTerminalButton({
  commandId,
}: {
  commandId: TerminalFixCommandId;
}) {
  const [opening, setOpening] = useState(false);

  const handleClick = async () => {
    setOpening(true);
    try {
      await wrapInvoke("open_system_terminal", { commandId });
    } catch (err) {
      logError("OpenInTerminalButton.open", err);
    } finally {
      setOpening(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={opening}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-surface-raised text-neutral-300 shadow-hairline hover:shadow-lift hover:bg-hover-overlay hover:text-neutral-100 transition-shadow duration-200 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <TerminalIcon className={`${ICON_SIZE.card} shrink-0`} aria-hidden="true" />
      <span>Im Terminal öffnen</span>
    </button>
  );
}
