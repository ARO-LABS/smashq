import type { DiffFileStatus } from "./types";

/**
 * Mapping von Status zu Anzeige-Char + Semantik-Klasse.
 * Single-Buchstaben passen zum klassischen Git-Diff-Output (M/A/D/R/?).
 */
export interface DiffStatusVisual {
  char: string;
  label: string;
  /** Tailwind-Token fuer die Status-Faerbung in der File-Liste. */
  className: string;
}

export function diffStatusVisual(status: DiffFileStatus): DiffStatusVisual {
  switch (status) {
    case "modified":
      return { char: "M", label: "Geaendert", className: "text-warning" };
    case "added":
      return { char: "A", label: "Hinzugefuegt", className: "text-success" };
    case "deleted":
      return { char: "D", label: "Geloescht", className: "text-error" };
    case "renamed":
      return { char: "R", label: "Umbenannt", className: "text-info" };
    case "untracked":
      return { char: "?", label: "Untracked", className: "text-neutral-400" };
  }
}
