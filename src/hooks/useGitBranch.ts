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
    let onVisible: (() => void) | null = null;

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
      // While the document is hidden, do not re-arm the 30s poll. Instead wait
      // for the tab to become visible, then fetch immediately and resume the
      // loop — this avoids background timer churn and up-to-30s-stale data on
      // return.
      if (!isDocumentVisible()) {
        if (typeof document === "undefined" || onVisible) return;
        onVisible = () => {
          if (cancelled || document.visibilityState === "hidden") return;
          document.removeEventListener("visibilitychange", onVisible!);
          onVisible = null;
          void fetchBranch().then(scheduleNext);
        };
        document.addEventListener("visibilitychange", onVisible);
        return;
      }
      timer = setTimeout(() => {
        void fetchBranch().then(scheduleNext);
      }, POLL_INTERVAL_MS);
    }

    void fetchBranch().then(scheduleNext);

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      if (onVisible && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
        onVisible = null;
      }
    };
  }, [folder]);

  return branch;
}
