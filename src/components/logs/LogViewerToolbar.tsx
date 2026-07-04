import { ICONS, ICON_SIZE } from "../../utils/icons";
import type { LogSeverity, LogSource } from "../../store/logViewerStore";

const SearchIcon = ICONS.action.search;
const ArrowDownToLineIcon = ICONS.action.scrollToBottom;
const RefreshIcon = ICONS.action.refresh;
const TrashIcon = ICONS.action.trash;

const SEVERITY_OPTIONS: { key: LogSeverity; label: string; color: string }[] = [
  { key: "error", label: "Error", color: "bg-red-400/20 text-red-400 border-red-400/40" },
  { key: "warn", label: "Warn", color: "bg-yellow-400/20 text-yellow-400 border-yellow-400/40" },
  { key: "info", label: "Info", color: "bg-blue-400/20 text-blue-400 border-blue-400/40" },
  { key: "debug", label: "Debug", color: "bg-teal-400/20 text-teal-400 border-teal-400/40" },
  { key: "trace", label: "Trace", color: "bg-neutral-400/20 text-neutral-400 border-neutral-400/40" },
];

const SOURCE_OPTIONS: { key: LogSource; label: string; color: string }[] = [
  { key: "frontend", label: "Frontend", color: "bg-purple-400/20 text-purple-400 border-purple-400/40" },
  { key: "backend", label: "Backend", color: "bg-emerald-400/20 text-emerald-400 border-emerald-400/40" },
];

export interface LogViewerToolbarProps {
  severityFilter: Set<LogSeverity>;
  sourceFilter: Set<LogSource>;
  searchText: string;
  liveTail: boolean;
  sortOrder: "desc" | "asc";
  scope: "session" | "all";
  onToggleSeverity: (key: LogSeverity) => void;
  onToggleSource: (key: LogSource) => void;
  onSearchChange: (text: string) => void;
  onToggleLiveTail: () => void;
  onSetSortOrder: (order: "desc" | "asc") => void;
  onSetScope: (scope: "session" | "all") => void;
  onRefresh: () => void;
  onClear: () => void;
}

export function LogViewerToolbar({
  severityFilter,
  sourceFilter,
  searchText,
  liveTail,
  sortOrder,
  scope,
  onToggleSeverity,
  onToggleSource,
  onSearchChange,
  onToggleLiveTail,
  onSetSortOrder,
  onSetScope,
  onRefresh,
  onClear,
}: LogViewerToolbarProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-neutral-700 bg-surface-base flex-wrap">
      {/* Severity filters */}
      <div className="flex gap-1">
        {SEVERITY_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => onToggleSeverity(opt.key)}
            className={`px-2 py-0.5 text-[11px] font-medium rounded border transition-all ${
              severityFilter.has(opt.key)
                ? opt.color
                : "bg-transparent text-neutral-500 border-neutral-700 opacity-50"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-neutral-700" />

      {/* Source filters */}
      <div className="flex gap-1">
        {SOURCE_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => onToggleSource(opt.key)}
            className={`px-2 py-0.5 text-[11px] font-medium rounded border transition-all ${
              sourceFilter.has(opt.key)
                ? opt.color
                : "bg-transparent text-neutral-500 border-neutral-700 opacity-50"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-neutral-700" />

      {/* Search */}
      <div className="relative flex-1 min-w-[140px] max-w-[300px]">
        <SearchIcon className={`absolute left-2 top-1/2 -translate-y-1/2 ${ICON_SIZE.card} text-neutral-500`} />
        <input
          type="text"
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Suchen..."
          className="w-full pl-7 pr-2 py-1 text-xs bg-surface-base border border-neutral-700 rounded text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-accent"
        />
      </div>

      <div className="flex-1" />

      {/* Action buttons */}
      <div className="flex gap-1">
        <button
          onClick={() => onSetScope(scope === "session" ? "all" : "session")}
          className={`px-2 py-1 text-[11px] rounded transition-all ${
            scope === "all" ? "bg-accent-a10 text-accent" : "text-neutral-400 hover:text-neutral-200"
          }`}
          title="Verlauf umschalten"
        >
          {scope === "session" ? "Session" : "Verlauf"}
        </button>

        <button
          onClick={() => onSetSortOrder(sortOrder === "desc" ? "asc" : "desc")}
          className="px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-200 rounded transition-all"
          title="Sortierung umschalten"
        >
          {sortOrder === "desc" ? "Neueste" : "Älteste"}
        </button>

        <button
          onClick={onToggleLiveTail}
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-all ${
            liveTail ? "bg-accent-a10 text-accent" : "text-neutral-400 hover:text-neutral-200"
          }`}
          title="Live-Tail"
        >
          <ArrowDownToLineIcon className={ICON_SIZE.card} />
          Live
        </button>

        <button
          onClick={onRefresh}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-200 rounded transition-all"
          title="Backend-Logs aktualisieren"
        >
          <RefreshIcon className={ICON_SIZE.card} />
        </button>

        <button
          onClick={onClear}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-neutral-400 hover:text-red-400 rounded transition-all"
          title="Logs leeren"
        >
          <TrashIcon className={ICON_SIZE.card} />
        </button>
      </div>
    </div>
  );
}
