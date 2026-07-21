import { useState } from "react";
import { wrapInvoke } from "../../utils/perfLogger";
import { logError } from "../../utils/errorLogger";
import { ICONS, ICON_SIZE } from "../../utils/icons";
import { Button } from "../ui/Button";
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
      // Bewusst stiller Fehlerpfad (nur Log, kein Toast): alle Render-Orte
      // (Settings-System-Panel, Kanban-Fehlerkarte/-Picker) leben im
      // Sekundärfenster (`DetachedViewApp`), das keinen ToastContainer
      // mountet — ein addToast wäre dort unsichtbar. Sichtbarer Fallback ist
      // die CopyableCommand-Box direkt daneben: der Befehl lässt sich immer
      // manuell kopieren und ausführen.
      logError("OpenInTerminalButton.open", err);
    } finally {
      setOpening(false);
    }
  };

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => void handleClick()}
      loading={opening}
      icon={<TerminalIcon className={ICON_SIZE.card} aria-hidden="true" />}
    >
      <span>Im Terminal öffnen</span>
    </Button>
  );
}
