// Shared master-detail shell for the config-panel list viewers (SkillsViewer,
// AgentsViewer). Both render the same two-column layout: a left list column
// (title + reload, optional filter row, search, scrollable cards) and a right
// detail pane with a placeholder. Viewer-specific concerns — the data loader,
// the filter model, the card body and the detail content — stay in each
// viewer and are passed in as props/children.

import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

interface MasterDetailViewerProps {
  /** Left-column heading, e.g. "Agents". */
  title: string;
  /** Item count shown next to the title. */
  count: number;
  onReload: () => void;
  /** Optional filter row rendered above the search input. */
  filterBar?: ReactNode;
  search: string;
  onSearchChange: (value: string) => void;
  /** True when items exist but none match the current filter/search. */
  filteredEmpty: boolean;
  /** Message for the empty-filtered-list state, e.g. "Keine Agents gefunden". */
  filteredEmptyText: string;
  /** The rendered list-item cards (caller-specific). */
  cards: ReactNode;
  /** Detail-pane content, or null when nothing is selected. */
  detail: ReactNode;
  /** Placeholder shown in the detail pane when `detail` is null. */
  detailPlaceholder: string;
}

/** Two-column list/detail shell — see module comment for the split of concerns. */
export function MasterDetailViewer({
  title,
  count,
  onReload,
  filterBar,
  search,
  onSearchChange,
  filteredEmpty,
  filteredEmptyText,
  cards,
  detail,
  detailPlaceholder,
}: MasterDetailViewerProps) {
  return (
    <div className="flex h-full">
      {/* Left column — item list */}
      <div className="w-64 min-w-[256px] border-r border-neutral-700 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-700 shrink-0">
          <span className="text-xs text-neutral-400 font-medium uppercase tracking-widest">
            {title} ({count})
          </span>
          <button
            onClick={onReload}
            className="p-1 text-neutral-500 hover:text-neutral-300 transition-colors"
            title="Neu laden"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Filter (optional) + search */}
        <div
          className={`px-3 py-2 border-b border-neutral-700 shrink-0${
            filterBar ? " space-y-2" : ""
          }`}
        >
          {filterBar}
          <input
            type="text"
            placeholder="Suchen..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-surface-base border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
          />
        </div>

        {/* Cards */}
        <div className="flex-1 overflow-auto">
          {filteredEmpty ? (
            <div className="px-3 py-4 text-xs text-neutral-500 text-center">
              {filteredEmptyText}
            </div>
          ) : (
            cards
          )}
        </div>
      </div>

      {/* Right column — detail */}
      <div className="flex-1 overflow-auto p-4">
        {detail ?? (
          <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
            {detailPlaceholder}
          </div>
        )}
      </div>
    </div>
  );
}

/** Uppercase section heading used inside detail panes. */
export function DetailSectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-2">
      {children}
    </h3>
  );
}

/** "Inhalt" section: a monospace <pre> block of the item body. */
export function DetailBody({ body }: { body: string }) {
  return (
    <div>
      <DetailSectionHeading>Inhalt</DetailSectionHeading>
      <pre className="text-sm text-neutral-200 whitespace-pre-wrap font-mono leading-relaxed bg-surface-raised rounded p-3">
        {body}
      </pre>
    </div>
  );
}
