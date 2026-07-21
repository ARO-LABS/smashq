import { useEffect, useRef, useState } from "react";
import { ICONS } from "../../utils/icons";

const CopyIcon = ICONS.action.copy;
const CheckIcon = ICONS.toast.success;

/** Copyable fix command for classified errors. `gh auth` commands are
 *  interactive (OAuth device flow), so the app cannot run them itself —
 *  the best it can offer is a one-click copy for the user's own terminal.
 *  Copy feedback follows the AboutPanel contract: optimistic check icon,
 *  silent failure.
 *
 *  Extracted from KanbanBoard.tsx (PR #39) so the Settings System panel can
 *  reuse the exact same snippet UI (Issue #38). */
export function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);
  // Timer cleanup: an unmount before the 2s reset elapses must cancel the
  // pending timeout, otherwise it fires setCopied on an unmounted component.
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // leave UI unchanged
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-md bg-surface-raised shadow-hairline px-3 py-1.5 max-w-full">
      <code className="text-xs font-mono text-neutral-300 truncate" title={command}>
        {command}
      </code>
      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label="Befehl kopieren"
        title="Befehl kopieren"
        className="shrink-0 text-neutral-500 hover:text-neutral-200 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm"
      >
        {copied ? (
          <CheckIcon className="w-3.5 h-3.5 text-success" aria-hidden="true" />
        ) : (
          <CopyIcon className="w-3.5 h-3.5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
