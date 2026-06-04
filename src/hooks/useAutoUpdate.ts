import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { useState, useEffect, useRef, useCallback } from "react";

const isTauri = "__TAURI_INTERNALS__" in window;

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "upToDate"
  | "error";

export interface UpdateState {
  status: UpdateStatus;
  progress: number;
  error: string | null;
  newVersion: string | null;
  lastChecked: Date | null;
}

export interface UseAutoUpdateReturn extends UpdateState {
  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  confirmRelaunch: () => Promise<void>;
  dismiss: () => void;
}

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const INITIAL_DELAY_MS = 15 * 1000;

export function useAutoUpdate(): UseAutoUpdateReturn {
  const [state, setState] = useState<UpdateState>({
    status: "idle",
    progress: 0,
    error: null,
    newVersion: null,
    lastChecked: null,
  });
  const [update, setUpdate] = useState<Update | null>(null);

  const isMountedRef = useRef(true);
  const isCheckingRef = useRef(false);
  const dismissedVersionRef = useRef<string | null>(null);
  const checkFnRef = useRef<() => Promise<void>>();

  const safeSetState = useCallback(
    (updater: (prev: UpdateState) => UpdateState) => {
      if (isMountedRef.current) setState(updater);
    },
    []
  );

  checkFnRef.current = async () => {
    if (!isTauri || isCheckingRef.current) return;
    isCheckingRef.current = true;
    safeSetState((s) => ({ ...s, status: "checking", error: null }));

    try {
      const [result, currentVersion] = await Promise.all([
        check(),
        getVersion(),
      ]);

      if (result && result.version !== currentVersion) {
        if (dismissedVersionRef.current === result.version) {
          safeSetState((s) => ({
            ...s,
            status: "idle",
            lastChecked: new Date(),
          }));
        } else {
          setUpdate(result);
          safeSetState((s) => ({
            ...s,
            status: "available",
            newVersion: result.version,
            lastChecked: new Date(),
          }));
        }
      } else {
        safeSetState((s) => ({
          ...s,
          status: "upToDate",
          lastChecked: new Date(),
        }));
        // Auto-reset to idle — no toast needed, lastChecked is persisted
        setTimeout(() => {
          if (isMountedRef.current) {
            setState((s) => s.status === "upToDate" ? { ...s, status: "idle" } : s);
          }
        }, 800);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isBenign =
        /network|fetch|404|not found|could not determine|dns|timeout|econnrefused/i.test(
          msg
        );
      if (isBenign) {
        safeSetState((s) => ({ ...s, status: "idle" }));
      } else {
        safeSetState((s) => ({ ...s, status: "error", error: msg }));
      }
    } finally {
      isCheckingRef.current = false;
    }
  };

  const checkForUpdate = useCallback(async () => {
    await checkFnRef.current?.();
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!update) return;
    safeSetState((s) => ({ ...s, status: "downloading", progress: 0 }));
    try {
      let totalBytes = 0;
      let downloadedBytes = 0;
      // Download only — do NOT install yet. Install happens on explicit user confirmation.
      await update.download((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalBytes = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          const pct =
            totalBytes > 0
              ? Math.round((downloadedBytes / totalBytes) * 100)
              : 0;
          safeSetState((s) => ({ ...s, progress: pct }));
        } else if (event.event === "Finished") {
          safeSetState((s) => ({ ...s, status: "ready", progress: 100 }));
        }
      });
      // Mark as ready — user must click "Jetzt neu starten" to install + relaunch
      safeSetState((s) => ({ ...s, status: "ready", progress: 100 }));
    } catch (err) {
      safeSetState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [update, safeSetState]);

  const confirmRelaunch = useCallback(async () => {
    if (!isTauri) return;
    // Install the previously downloaded update, then relaunch
    if (update) {
      await update.install();
    }
    await relaunch();
  }, [update]);

  const dismiss = useCallback(() => {
    if (state.newVersion) {
      dismissedVersionRef.current = state.newVersion;
    }
    safeSetState((s) => ({ ...s, status: "idle" }));
    setUpdate(null);
  }, [state.newVersion, safeSetState]);

  useEffect(() => {
    isMountedRef.current = true;
    if (!isTauri) return;

    const initialTimeout = setTimeout(() => {
      checkFnRef.current?.();
    }, INITIAL_DELAY_MS);

    const interval = setInterval(() => {
      checkFnRef.current?.();
    }, CHECK_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, []);

  return {
    ...state,
    checkForUpdate,
    downloadAndInstall,
    confirmRelaunch,
    dismiss,
  };
}
