import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GitInfo } from "../types/git";

const POLL_INTERVAL_MS = 30_000;

function isDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/**
 * Polls the current git branch of `folder` every 30 s.
 * Returns null when folder is undefined, not a git repo, or HEAD is detached.
 */
export function useGitBranch(folder: string | undefined): string | null {
  const [branch, setBranch] = useState<string | null>(null);

  useEffect(() => {
    if (!folder) {
      setBranch(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function fetchBranch(): Promise<void> {
      try {
        const info = await invoke<GitInfo>("get_git_info", { folder });
        if (!cancelled) {
          const raw = info.branch?.trim();
          setBranch(raw && raw !== "HEAD" ? raw : null);
        }
      } catch {
        if (!cancelled) setBranch(null);
      }
    }

    function scheduleNext(): void {
      if (cancelled) return;
      timer = setTimeout(async () => {
        if (!cancelled && isDocumentVisible()) await fetchBranch();
        scheduleNext();
      }, POLL_INTERVAL_MS);
    }

    void fetchBranch().then(scheduleNext);

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [folder]);

  return branch;
}
