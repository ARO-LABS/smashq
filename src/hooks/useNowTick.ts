import { useSyncExternalStore } from "react";

/** Shared module-level timer — one setInterval for all subscribers. */
let now = Date.now();
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function startTimer() {
  if (intervalId !== null) return;
  intervalId = setInterval(() => {
    now = Date.now();
    listeners.forEach((cb) => cb());
  }, 1000);
}

function stopTimer() {
  if (intervalId === null) return;
  clearInterval(intervalId);
  intervalId = null;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  if (listeners.size === 1) startTimer();
  return () => {
    listeners.delete(callback);
    if (listeners.size === 0) stopTimer();
  };
}

function getSnapshot(): number {
  return now;
}

/**
 * Shared per-second timer hook.
 * All components using this hook share a single setInterval(1000).
 * Returns Date.now() updated once per second.
 */
export function useNowTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
