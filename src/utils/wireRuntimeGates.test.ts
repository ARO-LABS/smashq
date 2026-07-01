/**
 * Regression test for the close-flush race: two independent `onCloseRequested`
 * listeners on the main window (App.tsx's settings/notes/tasks flush and
 * wireRuntimeGates.ts's frontend-log flush) each decided independently when
 * to let Tauri destroy() the window. Since frontend logging is off by default,
 * its flush resolves near-instantly and won the race, destroying the window
 * (and the IPC channel) before the slower notes/settings flush completed.
 *
 * Fix: consolidate into ONE listener per window that awaits every flush via
 * `Promise.all` before letting Tauri's built-in "await handler, then destroy()"
 * logic proceed. This test proves the combined handler does not settle until
 * BOTH the internal log flush and an injected `additionalCloseFlush` resolve.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { flushFrontendLogsMock, onCloseRequestedSpy } = vi.hoisted(() => ({
  flushFrontendLogsMock: vi.fn(() => Promise.resolve()),
  onCloseRequestedSpy: vi.fn(),
}));
let capturedHandler: (() => Promise<void>) | undefined;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: (cb: () => Promise<void>) => {
      onCloseRequestedSpy(cb);
      capturedHandler = cb;
      return Promise.resolve(() => {});
    },
  }),
}));

vi.mock("./errorLogger", () => ({
  wireLoggingGate: vi.fn(),
  wirePersistenceGate: vi.fn(),
  flushFrontendLogs: flushFrontendLogsMock,
  logError: vi.fn(),
}));

vi.mock("./perfLogger", () => ({
  setPerfEnabled: vi.fn(),
}));

vi.mock("./preferencesBroadcast", () => ({
  listenForPreferencesChanges: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("./tasksBroadcast", () => ({
  broadcastTasksChange: vi.fn(() => Promise.resolve()),
  listenForTasksChanges: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("../store/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      preferences: { frontendLogging: false, backendFileLogging: false, performanceProfiler: false },
      theme: {},
    }),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.mock("../store/tasksStore", () => ({
  useTasksStore: {
    getState: () => ({ tasks: [] }),
    subscribe: vi.fn(() => vi.fn()),
  },
  sanitizeTasks: (tasks: unknown) => tasks,
}));

vi.mock("../store/tasksStorage", () => ({
  setSuppressTasksPersist: vi.fn(),
}));

import { wireRuntimeGates } from "./wireRuntimeGates";

// wireRuntimeGates registers the close listener behind a dynamic
// `import("@tauri-apps/api/window")`, which resolves on a real event-loop
// tick in jsdom, not just queued microtasks. Poll instead of guessing a tick
// count (see the same flakiness documented in App.integration.test.tsx).
async function waitForCloseListener(): Promise<void> {
  await vi.waitFor(() => {
    if (!capturedHandler) throw new Error("onCloseRequested not registered yet");
  });
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("wireRuntimeGates — consolidated close-flush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = undefined;
  });

  it("registers exactly one onCloseRequested listener and awaits both the log flush AND an injected additionalCloseFlush before settling", async () => {
    let resolveAdditional: () => void = () => {};
    const additionalCloseFlush = vi.fn(
      () => new Promise<void>((resolve) => { resolveAdditional = resolve; }),
    );

    const cleanup = wireRuntimeGates({ additionalCloseFlush });
    await waitForCloseListener();

    expect(onCloseRequestedSpy).toHaveBeenCalledTimes(1);
    expect(capturedHandler).toBeDefined();

    let settled = false;
    const handlerPromise = capturedHandler!().then(() => {
      settled = true;
    });

    // flushFrontendLogs (mocked) already resolved, but additionalCloseFlush is
    // still pending. The combined handler must NOT settle yet — this is the
    // exact race that let the log-flush listener destroy() the window before
    // the notes/settings flush finished in production.
    await flushMicrotasks();
    expect(settled).toBe(false);

    resolveAdditional();
    await handlerPromise;

    expect(settled).toBe(true);
    expect(additionalCloseFlush).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("resolves cleanly with no additionalCloseFlush (detached windows have nothing extra to flush)", async () => {
    const cleanup = wireRuntimeGates();
    await waitForCloseListener();

    expect(capturedHandler).toBeDefined();
    await expect(capturedHandler!()).resolves.toBeUndefined();

    cleanup();
  });
});
