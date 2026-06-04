import { User, Calendar, Tag, Milestone } from "lucide-react";
import { labelStyle } from "./kanbanUtils";
import type { KanbanLabel } from "./KanbanCard";

interface IssueSidebarProps {
  state: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string;
  assignees: string[];
  labels: KanbanLabel[];
  milestone: string | null;
  formatDate: (iso: string) => string;
}

export function IssueSidebar({
  author,
  createdAt,
  updatedAt,
  closedAt,
  assignees,
  labels,
  milestone,
  formatDate,
}: IssueSidebarProps) {
  return (
    <div className="space-y-4 text-xs">

      {/* Author */}
      {author && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-neutral-400 uppercase tracking-wide">Autor</p>
          <div className="flex items-center gap-1.5 text-neutral-300">
            <User className="w-3 h-3 text-neutral-500 shrink-0" />
            <span>{author}</span>
          </div>
        </div>
      )}

      {/* Dates */}
      <div className="space-y-1">
        <p className="text-[10px] font-medium text-neutral-400 uppercase tracking-wide">Datum</p>
        {createdAt && (
          <div className="flex items-center gap-1.5 text-neutral-400">
            <Calendar className="w-3 h-3 text-neutral-500 shrink-0" />
            <span>Erstellt: {formatDate(createdAt)}</span>
          </div>
        )}
        {updatedAt && updatedAt !== createdAt && (
          <div className="flex items-center gap-1.5 text-neutral-400">
            <Calendar className="w-3 h-3 text-neutral-500 shrink-0" />
            <span>Geändert: {formatDate(updatedAt)}</span>
          </div>
        )}
        {closedAt && (
          <div className="flex items-center gap-1.5 text-neutral-400">
            <Calendar className="w-3 h-3 text-neutral-500 shrink-0" />
            <span>Geschlossen: {formatDate(closedAt)}</span>
          </div>
        )}
      </div>

      {/* Assignees */}
      <div className="space-y-1">
        <p className="text-[10px] font-medium text-neutral-400 uppercase tracking-wide">Zugewiesen</p>
        {assignees.length === 0 ? (
          <p className="text-neutral-500 italic">Niemand zugewiesen</p>
        ) : (
          <div className="flex flex-col gap-1">
            {assignees.map((a) => (
              <div key={a} className="flex items-center gap-1.5 text-neutral-300">
                <User className="w-3 h-3 text-neutral-500 shrink-0" />
                <span>{a}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Labels */}
      {labels.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-neutral-400 uppercase tracking-wide">Labels</p>
          <div className="flex flex-col gap-1">
            {labels.map((label) => (
              <span
                key={label.name}
                className="self-start text-[10px] px-1.5 py-0.5 rounded-sm border font-medium"
                style={labelStyle(label.color)}
              >
                <Tag className="w-2.5 h-2.5 inline mr-1 opacity-70" />
                {label.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Milestone */}
      {milestone && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-neutral-400 uppercase tracking-wide">Milestone</p>
          <div className="flex items-center gap-1.5 text-neutral-300">
            <Milestone className="w-3 h-3 text-neutral-500 shrink-0" />
            <span>{milestone}</span>
          </div>
        </div>
      )}
    </div>
  );
}
