/**
 * Performance Logging Service (dev-only)
 *
 * Measures IPC invoke latency, event throughput, store updates, and render times.
 * Ring buffer of 500 entries. Zero overhead when disabled (production).
 * Capture is controlled exclusively by the Settings toggle via setPerfEnabled()
 * (wired in wireRuntimeGates). Manual dev override: window.__perf.enable().
 */

import { invoke } from "@tauri-apps/api/core";

export type PerfCategory =
  | "ipc-invoke"
  | "ipc-event"
  | "store-update"
  | "render"
  | "custom";

export interface PerfEntry {
  timestamp: number; // performance.now()
  category: PerfCategory;
  label: string;
  durationMs: number; // -1 for throughput-only entries
  meta?: Record<string, unknown>;
}

export interface PerfSummary {
  label: string;
  category: PerfCategory;
  count: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  ratePerSec: number;
}

declare global {
  interface Window {
    __perf?: {
      dump: typeof dumpPerf;
      clear: typeof clearPerf;
      summaries: typeof getPerfSummaries;
      entries: PerfEntry[];
      enable: () => void;
      disable: () => void;
    };
  }
}

const MAX_ENTRIES = 500;
const entries: PerfEntry[] = [];
let enabled = false;
type PerfSubscriber = (entry: PerfEntry) => void;
let subscriber: PerfSubscriber | null = null;

export function initPerf(): void {
  // Capture is controlled exclusively by setPerfEnabled() (wired from the
  // Settings toggle). DEV/localStorage no longer auto-enable — that was a
  // second source of truth that broke "disable actually skips work".
  // Manual dev override remains via window.__perf.enable().
  window.__perf = {
    dump: dumpPerf,
    clear: clearPerf,
    summaries: getPerfSummaries,
    entries,
    enable: () => { enabled = true; },
    disable: () => { enabled = false; },
  };
}

/**
 * External toggle, e.g. driven by user-facing Settings. Hot-path checks read a
 * plain boolean so a function-call gate would be measurably more expensive.
 */
export function setPerfEnabled(value: boolean): void {
  enabled = value;
}

export function recordPerf(
  category: PerfCategory,
  label: string,
  durationMs: number,
  meta?: Record<string, unknown>,
): void {
  if (!enabled) return;
  const entry: PerfEntry = {
    timestamp: performance.now(),
    category,
    label,
    durationMs,
    meta,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.shift();
  }
  subscriber?.(entry);
}

export async function wrapInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!enabled) return invoke<T>(command, args);
  const start = performance.now();
  try {
    return await invoke<T>(command, args);
  } finally {
    recordPerf("ipc-invoke", command, performance.now() - start);
  }
}

export function createEventTracker(eventName: string): () => void {
  let count = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let lastCallTime = 0;

  function tick() {
    if (count === 0) return;
    const now = performance.now();
    const elapsed = (now - lastCallTime) / 1000;
    const rate = elapsed > 0 ? count / elapsed : count;
    recordPerf("ipc-event", eventName, -1, { rate, count });

    // Clean up if no calls for 5 seconds
    if (now - lastCallTime > 5000 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
      count = 0;
    }
  }

  return () => {
    if (!enabled) return;
    count++;
    lastCallTime = performance.now();
    if (intervalId === null) {
      intervalId = setInterval(tick, 1000);
    }
  };
}

export function markRender(componentName: string): { done: () => void } {
  if (!enabled) return { done: () => {} };
  const start = performance.now();
  return {
    done: () => recordPerf("render", componentName, performance.now() - start),
  };
}

export function getPerfSummaries(category?: PerfCategory): PerfSummary[] {
  const filtered = category ? entries.filter((e) => e.category === category) : entries;
  const groups = new Map<string, PerfEntry[]>();

  for (const entry of filtered) {
    const key = `${entry.category}::${entry.label}`;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  const summaries: PerfSummary[] = [];
  for (const group of groups.values()) {
    const durations = group
      .filter((e) => e.durationMs >= 0)
      .map((e) => e.durationMs)
      .sort((a, b) => a - b);

    const count = group.length;
    const totalMs = durations.reduce((s, d) => s + d, 0);
    const avgMs = durations.length > 0 ? totalMs / durations.length : 0;
    const minMs = durations.length > 0 ? durations[0] : 0;
    const maxMs = durations.length > 0 ? durations[durations.length - 1] : 0;
    const p95Idx = Math.max(0, Math.ceil(durations.length * 0.95) - 1);
    const p95Ms = durations.length > 0 ? durations[p95Idx] : 0;

    const first = group[0];
    const last = group[group.length - 1];
    const windowMs = last.timestamp - first.timestamp;
    const ratePerSec = windowMs > 0 ? (count / windowMs) * 1000 : count;

    summaries.push({
      label: first.label,
      category: first.category,
      count,
      totalMs,
      avgMs,
      minMs,
      maxMs,
      p95Ms,
      ratePerSec,
    });
  }
  return summaries;
}

export function subscribeToPerfEntries(cb: PerfSubscriber): () => void {
  subscriber = cb;
  return () => {
    if (subscriber === cb) subscriber = null;
  };
}

export function dumpPerf(): void {
  const summaries = getPerfSummaries();
  if (summaries.length === 0) {
    console.log("No perf data recorded."); // eslint-disable-line no-console
    return;
  }
  console.table(summaries); // eslint-disable-line no-console
}

export function clearPerf(): void {
  entries.length = 0;
}
