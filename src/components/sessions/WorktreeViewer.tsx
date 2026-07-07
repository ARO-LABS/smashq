import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ICONS } from "../../utils/icons";
import { getErrorMessage } from "../../utils/adpError";

const RefreshCw = ICONS.action.refresh;
const GitBranch = ICONS.git.branch;

interface WorktreeViewerProps {
  folder: string;
}

interface WorktreeInfo {
  path: string;
  branch: string | null;
  is_main: boolean;
}

// Simple in-memory cache to avoid re-fetching on tab switches
interface CacheEntry {
  worktrees: WorktreeInfo[];
  timestamp: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 60_000; // 1 minute

export function WorktreeViewer({ folder }: WorktreeViewerProps) {
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  // Generation counter — bumped at every load start (including cache hits) so a
  // slow in-flight scan_worktrees for a superseded folder cannot overwrite the
  // current folder's worktrees (the component stays mounted across folder changes).
  const loadGenRef = useRef(0);

  const load = useCallback(async (forceRefresh = false) => {
    const gen = ++loadGenRef.current;

    if (!forceRefresh) {
      const cached = cache.get(folder);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        setWorktrees(cached.worktrees);
        setError("");
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    setError("");

    try {
      const result = await invoke<WorktreeInfo[]>("scan_worktrees", { folder });
      cache.set(folder, { worktrees: result, timestamp: Date.now() });
      if (!mountedRef.current || gen !== loadGenRef.current) return;
      setWorktrees(result);
    } catch (err) {
      if (!mountedRef.current || gen !== loadGenRef.current) return;
      setError(getErrorMessage(err));
    } finally {
      if (mountedRef.current && gen === loadGenRef.current) setLoading(false);
    }
  }, [folder]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
        Laden...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-neutral-500">
        <GitBranch className="w-10 h-10 text-neutral-600" />
        <span className="text-sm text-error">{error}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700 shrink-0">
        <div className="flex items-center gap-1.5">
          <GitBranch className="w-3.5 h-3.5 text-neutral-400" />
          <span className="text-xs text-neutral-400 font-medium uppercase tracking-widest">
            Worktrees ({worktrees.length})
          </span>
        </div>
        <button
          onClick={() => load(true)}
          className="p-1 text-neutral-500 hover:text-neutral-300 transition-colors"
          title="Neu laden"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {worktrees.length === 0 ? (
          <div className="text-xs text-neutral-600">Keine Worktrees gefunden</div>
        ) : (
          <div className="space-y-1.5">
            {worktrees.map((wt) => (
              <div
                key={wt.path}
                className="flex items-center gap-2 bg-surface-base border border-neutral-700 rounded-sm px-3 py-2 hover:border-neutral-500 hover:bg-hover-overlay transition-colors"
              >
                <GitBranch className="w-4 h-4 text-accent shrink-0" />
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-xs text-neutral-200 font-medium">
                    {wt.branch ?? "detached"}
                  </span>
                  <span className="text-[11px] text-neutral-500 truncate">
                    {wt.path}
                  </span>
                </div>
                {wt.is_main && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-accent-a10 text-accent rounded-sm shrink-0">
                    Haupt
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
