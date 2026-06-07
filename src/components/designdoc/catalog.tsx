import type { ReactNode } from "react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Input } from "../ui/Input";
import { StatusBadge } from "../shared/StatusBadge";
import { StatusPill } from "../shared/StatusPill";
import { SessionCard } from "../sessions/SessionCard";
import { TerminalToolbar } from "../sessions/TerminalToolbar";
import { ICONS, ICON_SIZE } from "../../utils/icons";
import { useSessionStore, type SessionStatus } from "../../store/sessionStore";
import { Foundations } from "./Foundations";

// ============================================================================
// Types
// ============================================================================

export interface CatalogEntry {
  id: string;
  label: string;
  state?: string;
  interactive?: boolean;
  render: () => ReactNode;
}

export interface CatalogSection {
  id: string;
  title: string;
  entries: CatalogEntry[];
}

// ============================================================================
// Helpers
// ============================================================================

/** noop matching SessionCard's (sessionId: string) => void signature */
const noop = (_id: string): void => {};

function sessionByStatus(status: SessionStatus) {
  const sessions = useSessionStore.getState().sessions;
  return sessions.find((s) => s.status === status) ?? sessions[0];
}

// ============================================================================
// Icon component references (nested ICONS structure)
// ============================================================================

const SearchIcon = ICONS.action.search;
const FolderIcon = ICONS.action.folderOpen;
const CloseIcon = ICONS.action.close;

// ============================================================================
// Catalog
// ============================================================================

export const catalog: CatalogSection[] = [
  {
    id: "foundations",
    title: "Foundations",
    entries: [
      {
        id: "tokens",
        label: "Tokens",
        render: () => <Foundations />,
      },
    ],
  },
  {
    id: "primitives",
    title: "Primitives",
    entries: [
      {
        id: "button-variants",
        label: "Buttons",
        interactive: true,
        render: () => (
          <>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
          </>
        ),
      },
      {
        id: "icon-buttons",
        label: "Icon-Buttons",
        interactive: true,
        render: () => (
          <>
            <IconButton
              icon={<SearchIcon className={ICON_SIZE.nav} />}
              label="Suchen"
            />
            <IconButton
              icon={<FolderIcon className={ICON_SIZE.nav} />}
              label="Ordner"
            />
            <IconButton
              icon={<CloseIcon className={ICON_SIZE.nav} />}
              label="Schließen"
            />
          </>
        ),
      },
      {
        id: "inputs",
        label: "Inputs",
        interactive: true,
        render: () => (
          <>
            <Input label="Projektname" placeholder="Name eingeben" />
            <Input label="Pfad" error="Pfad darf nicht leer sein" />
          </>
        ),
      },
      {
        id: "status-badges",
        label: "Status-Badges",
        render: () => (
          <>
            <StatusBadge status="running" label="Läuft" pulse />
            <StatusBadge status="idle" label="Idle" />
            <StatusBadge status="done" label="Fertig" />
            <StatusBadge status="error" label="Fehler" />
            <StatusBadge status="waiting" label="Wartet" />
          </>
        ),
      },
      {
        id: "status-pills",
        label: "Pills",
        render: () => (
          <>
            <StatusPill tone="success" label="Success" />
            <StatusPill tone="error" label="Error" />
            <StatusPill tone="warning" label="Warning" />
            <StatusPill tone="info" label="Info" />
            <StatusPill tone="accent" label="Accent" />
          </>
        ),
      },
    ],
  },
  {
    id: "sessions",
    title: "Sessions",
    entries: [
      {
        id: "session-card-running",
        label: "Session Card — running",
        state: "running",
        interactive: true,
        render: () => (
          <div style={{ width: 280 }}>
            <SessionCard
              session={sessionByStatus("running")}
              isActive={false}
              onClick={noop}
              onClose={noop}
            />
          </div>
        ),
      },
      {
        id: "session-card-active",
        label: "Session Card — active",
        state: "active",
        interactive: true,
        render: () => (
          <div style={{ width: 280 }}>
            <SessionCard
              session={sessionByStatus("running")}
              isActive
              onClick={noop}
              onClose={noop}
            />
          </div>
        ),
      },
      {
        id: "session-card-done",
        label: "Session Card — done",
        state: "done",
        render: () => (
          <div style={{ width: 280 }}>
            <SessionCard
              session={sessionByStatus("done")}
              isActive={false}
              onClick={noop}
              onClose={noop}
            />
          </div>
        ),
      },
      {
        id: "terminal-toolbar",
        label: "Control-Bar",
        interactive: true,
        render: () => (
          <div style={{ position: "relative", height: 40, width: 300 }}>
            <TerminalToolbar
              layoutMode="single"
              onLayoutChange={noop as unknown as (mode: "single" | "grid") => void}
              folder="C:/Projects/smashq"
              sessionId="ds-1"
            />
          </div>
        ),
      },
    ],
  },
];
