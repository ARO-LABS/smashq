import { memo } from "react";
import type { DiffFile } from "./types";
import { diffStatusVisual } from "./diffStatus";

interface DiffFileListProps {
  files: DiffFile[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/**
 * Linke Spalte des Diff-Windows: Datei-Liste mit Status-Indikator.
 * Active-Selected nach Design-System: 2px linke Akzent-Border + Akzent-Tint.
 */
function DiffFileListInner({ files, selectedIndex, onSelect }: DiffFileListProps) {
  return (
    <div className="flex flex-col h-full overflow-y-auto bg-surface-raised">
      <div className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-neutral-300 border-b border-neutral-700">
        Dateien ({files.length})
      </div>
      {files.length === 0 ? (
        <div className="px-4 py-3 text-xs text-neutral-400">
          Keine Aenderungen seit Session-Start.
        </div>
      ) : (
        <ul className="flex-1">
          {files.map((file, index) => {
            const visual = diffStatusVisual(file.status);
            const isSelected = index === selectedIndex;
            return (
              <li key={`${file.path}-${index}`}>
                <button
                  type="button"
                  onClick={() => onSelect(index)}
                  className={`
                    group flex w-full items-center gap-2 px-3 py-2 text-left text-xs
                    border-l-2 transition-colors duration-150
                    ${
                      isSelected
                        ? "border-l-accent bg-accent-a10 text-neutral-100"
                        : "border-l-transparent text-neutral-300 hover:bg-hover-overlay"
                    }
                  `}
                  aria-current={isSelected ? "true" : undefined}
                  title={`${visual.label}: ${file.path}`}
                >
                  <span
                    className={`w-3 shrink-0 font-mono font-bold ${visual.className}`}
                    aria-hidden="true"
                  >
                    {visual.char}
                  </span>
                  <span className="truncate flex-1">{file.path}</span>
                  {(file.additions > 0 || file.deletions > 0) && (
                    <span className="shrink-0 font-mono text-[10px] text-neutral-400">
                      <span className="text-success">+{file.additions}</span>
                      <span className="px-0.5">/</span>
                      <span className="text-error">-{file.deletions}</span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const DiffFileList = memo(DiffFileListInner);
