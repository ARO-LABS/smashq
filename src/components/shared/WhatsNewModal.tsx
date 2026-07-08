import { open } from "@tauri-apps/plugin-shell";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { ICONS, ICON_SIZE } from "../../utils/icons";
import type { WhatsNewEntry, WhatsNewIconKey } from "../../whatsNew";

const CHANGELOG_URL =
  "https://github.com/ARO-LABS/smashq/blob/master/CHANGELOG.md";
const ISSUES_URL = "https://github.com/ARO-LABS/smashq/issues";

/**
 * Kuratiertes Icon-Set fuer Whats-New-Highlights, gemappt auf die bestehende
 * ICONS-Registry. `WhatsNewIconKey` ist eine geschlossene Union — ein neuer
 * Schluessel ist eine bewusste Erweiterung HIER, kein freies Feld im Content.
 */
const HIGHLIGHT_ICONS: Record<WhatsNewIconKey, typeof ICONS.action.retry> = {
  restore: ICONS.action.retry,
  edit: ICONS.action.edit,
  stability: ICONS.toast.ready,
  panels: ICONS.action.panelOpen,
  design: ICONS.theme.dark,
  update: ICONS.update.available,
  terminal: ICONS.action.terminal,
};

const WarnIcon = ICONS.toast.error;
const ExternalIcon = ICONS.action.externalLink;
const GithubIcon = ICONS.git.github;

export interface WhatsNewModalProps {
  /** Kuratierter Eintrag der laufenden Version; null rendert nichts. */
  entry: WhatsNewEntry | null;
  onClose: () => void;
}

/**
 * Einmaliges "Was ist neu"-Modal nach einem Update (Template-Haelfte der
 * Template/Content-Trennung — der Inhalt lebt in `src/whatsNew.ts`).
 * Gating/Anzeige-Logik: `useWhatsNew`, Mount: `App.tsx`.
 */
export function WhatsNewModal({ entry, onClose }: WhatsNewModalProps) {
  return (
    <Modal
      open={entry !== null}
      onClose={onClose}
      size="lg"
      title={
        entry !== null && (
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-xs font-semibold uppercase tracking-widest text-neutral-200">
              Was ist neu
            </span>
            <span className="font-mono text-[11px] text-accent bg-accent/10 rounded-sm px-2 py-0.5">
              v{entry.version}
            </span>
            <span className="font-mono text-[11px] text-neutral-500">
              {entry.date}
            </span>
          </div>
        )
      }
    >
      {entry !== null && (
        <>
          <div className="flex flex-col gap-4 px-4 py-4 overflow-y-auto max-h-[60vh]">
            <p className="text-sm text-neutral-400">{entry.intro}</p>

            <div className="flex flex-col gap-3.5">
              {entry.highlights.map((h) => {
                const Icon = HIGHLIGHT_ICONS[h.icon];
                return (
                  <div key={h.title} className="grid grid-cols-[30px_1fr] gap-3 items-start">
                    <span className="w-[30px] h-[30px] grid place-items-center rounded-md bg-accent/10 text-accent">
                      <Icon className={ICON_SIZE.nav} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-neutral-200">
                        {h.title}
                      </h4>
                      <p className="text-[13px] text-neutral-400">{h.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-md border border-neutral-700 border-l-2 border-l-warning bg-warning/5 px-3.5 py-3">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-warning mb-2">
                <WarnIcon className={ICON_SIZE.inline} aria-hidden="true" />
                Worauf achten
              </span>
              <ul className="list-disc pl-4 flex flex-col gap-1.5">
                {entry.watchouts.map((w) => (
                  <li key={w} className="text-[13px] text-neutral-200">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex items-center gap-4 px-4 py-3 border-t border-neutral-700 shrink-0">
            <button
              type="button"
              onClick={() => void open(CHANGELOG_URL)}
              className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-accent transition-colors duration-150"
            >
              <ExternalIcon className={ICON_SIZE.inline} aria-hidden="true" />
              Vollständiges Changelog
            </button>
            <button
              type="button"
              onClick={() => void open(ISSUES_URL)}
              className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-accent transition-colors duration-150"
              title="Issues und Pull Requests willkommen"
            >
              <GithubIcon className={ICON_SIZE.inline} aria-hidden="true" />
              Feedback geben
            </button>
            <Button
              variant="primary"
              size="md"
              onClick={onClose}
              className="ml-auto"
            >
              Verstanden
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
