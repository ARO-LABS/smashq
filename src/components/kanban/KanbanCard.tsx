import { useState, useRef, useCallback } from "react";
import { ExternalLink } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { logWarn } from "../../utils/errorLogger";
import { labelStyle } from "./kanbanUtils";

export interface KanbanLabel {
  name: string;
  color: string;
}

export interface KanbanIssue {
  /** Projects v2 item ID — used for move_project_item */
  itemId: string;
  number: number;
  title: string;
  state: string;
  labels: KanbanLabel[];
  assignee: string;
  url: string;
  /** `"owner/name"` — present when the issue belongs to a different repo (global board). */
  repository?: string | null;
}

interface KanbanCardProps {
  issue: KanbanIssue;
  onClick?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

const DRAG_THRESHOLD_PX = 5;

async function openUrl(url: string) {
  try {
    await open(url);
  } catch {
    logWarn("KanbanCard", `shell.open failed for: ${url}`);
  }
}

export function KanbanCard({ issue, onClick, onDragStart, onDragEnd }: KanbanCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = false;
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startPosRef.current || isDraggingRef.current) return;
      const dx = Math.abs(e.clientX - startPosRef.current.x);
      const dy = Math.abs(e.clientY - startPosRef.current.y);
      if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) {
        isDraggingRef.current = true;
        setIsDragging(true);
        onDragStart?.();
      }
    },
    [onDragStart],
  );

  const handlePointerUp = useCallback(() => {
    const wasDragging = isDraggingRef.current;
    isDraggingRef.current = false;
    startPosRef.current = null;
    setIsDragging(false);
    if (wasDragging) onDragEnd?.();
  }, [onDragEnd]);

  return (
    <div
      className={`group bg-surface-base rounded-md shadow-hairline p-3 hover:shadow-lift hover:bg-hover-overlay transition-shadow duration-200 select-none ${
        isDragging ? "opacity-50 cursor-grabbing pointer-events-none" : "cursor-grab"
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={() => {
        if (isDraggingRef.current) return;
        onClick?.();
      }}
    >
      {/* Header: number + external link */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-mono text-neutral-500">#{issue.number}</span>
        {issue.url && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void openUrl(issue.url);
            }}
            className="p-0.5 text-neutral-600 hover:text-neutral-300 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Im Browser öffnen"
          >
            <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Title */}
      <div className="text-xs text-neutral-200 leading-snug mb-2 line-clamp-2">
        {issue.title}
      </div>

      {/* Labels + Assignee */}
      <div className="flex flex-wrap items-center gap-1">
        {issue.labels.map((label) => (
          <span
            key={label.name}
            className="text-[10px] px-1.5 py-0.5 rounded-sm border font-medium"
            style={labelStyle(label.color)}
          >
            {label.name}
          </span>
        ))}
        {issue.assignee && (
          <span className="text-[10px] text-neutral-500 ml-auto">
            {issue.assignee}
          </span>
        )}
      </div>

      {/* Repo badge — only shown in global board when item is cross-repo */}
      {issue.repository && (
        <div className="mt-1.5 text-[10px] text-neutral-600 truncate">
          {issue.repository}
        </div>
      )}
    </div>
  );
}
