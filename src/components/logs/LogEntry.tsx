import { memo, useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import {
  formatTime,
  type GroupedLogEntry,
  type LogSeverity,
} from "../../store/logViewerStore";

const severityColors: Record<LogSeverity, string> = {
  error: "text-error bg-error/10",
  warn: "text-warning bg-warning/10",
  info: "text-info bg-info/10",
  debug: "text-neutral-400 bg-neutral-400/10",
  trace: "text-neutral-400 bg-neutral-400/10",
};

const sourceColors: Record<string, string> = {
  frontend: "text-cat-violet bg-cat-violet/10",
  backend: "text-cat-emerald bg-cat-emerald/10",
};

/** Row-height estimate for virtualization (px). Actual height is measured
 *  dynamically (measureElement) so expanded stacks / wrapped messages grow. */
export const LOG_ROW_HEIGHT = 32;

interface LogEntryRowProps {
  entry: GroupedLogEntry;
}

export const LogEntryRow = memo(function LogEntryRow({
  entry,
}: LogEntryRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasStack = !!entry.stack;

  return (
    <div className="group border-b border-neutral-800 hover:bg-hover-overlay font-mono text-xs">
      <div
        className={`flex items-start gap-2 px-3 py-1.5 ${hasStack ? "cursor-pointer" : ""}`}
        style={{ minHeight: LOG_ROW_HEIGHT }}
        onClick={hasStack ? () => setExpanded(!expanded) : undefined}
      >
        {/* Expand icon for stack traces */}
        <span className="w-3 shrink-0">
          {hasStack &&
            (expanded ? (
              <ChevronDown className="w-3 h-3 text-neutral-500" />
            ) : (
              <ChevronRight className="w-3 h-3 text-neutral-500" />
            ))}
        </span>

        {/* Timestamp */}
        <span className="text-neutral-500 shrink-0 tabular-nums">
          {formatTime(entry.timestamp)}
        </span>

        {/* Severity badge */}
        <span
          className={`shrink-0 px-1.5 rounded text-[10px] font-semibold uppercase ${severityColors[entry.severity] ?? ""}`}
        >
          {entry.severity}
        </span>

        {/* Source badge */}
        <span
          className={`shrink-0 px-1.5 rounded text-[10px] ${sourceColors[entry.source] ?? ""}`}
        >
          {entry.source}
        </span>

        {/* Group count badge */}
        {entry.count > 1 && (
          <span className="shrink-0 px-1.5 rounded text-[10px] font-semibold bg-neutral-600/40 text-neutral-300">
            &times;{entry.count}
          </span>
        )}

        {/* Module */}
        {entry.module && (
          <span className="text-neutral-500 shrink-0 truncate max-w-[200px]">
            {entry.module}
          </span>
        )}

        {/* Message */}
        <span className="text-neutral-200 break-words min-w-0 flex-1">{entry.message}</span>
      </div>

      {/* Expanded stack trace */}
      {expanded && entry.stack && (
        <pre className="px-3 pb-2 pl-8 text-[10px] text-neutral-500 whitespace-pre-wrap break-all">
          {entry.stack}
        </pre>
      )}
    </div>
  );
});
