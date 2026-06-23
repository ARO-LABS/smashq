import { useState, useCallback, type FormEvent } from "react";
import { ICONS, ICON_SIZE } from "../../utils/icons";

interface OpenMdPathInputProps {
  /** Called with the trimmed, non-empty path when the user submits. */
  onOpen: (path: string) => void;
  /** "panel" = compact row in the session sidebar; "empty" = editor empty-state. */
  variant?: "panel" | "empty";
}

/**
 * Presentational path-input: paste a `.md` path, submit, get it opened. Holds
 * only its own draft text — the open action is the parent's via `onOpen`, so the
 * same component serves both the main window (→ open_md_in_editor) and the editor
 * empty-state (→ store.openFileByPath).
 */
export function OpenMdPathInput({ onOpen, variant = "panel" }: OpenMdPathInputProps): JSX.Element {
  const [path, setPath] = useState("");
  const OpenIcon = ICONS.action.chevronRight;

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = path.trim();
      if (!trimmed) return;
      onOpen(trimmed);
      setPath("");
    },
    [path, onOpen],
  );

  const wrap = variant === "panel" ? "px-2 py-1.5" : "w-full max-w-md mt-2";

  return (
    <form onSubmit={handleSubmit} className={`flex items-center gap-1.5 ${wrap}`}>
      <input
        type="text"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="Pfad zur .md-Datei einfügen"
        aria-label="Pfad zur Markdown-Datei"
        className="flex-1 min-w-0 rounded-md bg-surface-raised px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-500 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      />
      <button
        type="submit"
        aria-label="Markdown-Datei öffnen"
        title="Öffnen"
        className="flex items-center justify-center w-7 h-7 rounded-md text-neutral-400 hover:text-accent hover:bg-accent-a05 transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      >
        <OpenIcon className={ICON_SIZE.inline} aria-hidden="true" />
      </button>
    </form>
  );
}
