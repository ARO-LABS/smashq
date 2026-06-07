import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocks must be set up before module-level imports of the test target
// because preferencesBroadcast does dynamic imports of @tauri-apps/api.

const emitMock = vi.fn((_event: string, _payload: unknown) => Promise.resolve());
let listenCallback: ((event: { payload: unknown }) => void) | null = null;

vi.mock("@tauri-apps/api/event", () => ({
  emit: (event: string, payload: unknown) => emitMock(event, payload),
  listen: vi.fn((_eventName: string, cb: (event: { payload: unknown }) => void) => {
    listenCallback = cb;
    return Promise.resolve(() => {});
  }),
}));

const getCurrentWindowMock = vi.fn(() => ({ label: "main" }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => getCurrentWindowMock(),
}));

// Force the helper to take the Tauri branch (it checks
// "__TAURI_INTERNALS__" in window).
beforeEach(() => {
  emitMock.mockClear();
  listenCallback = null;
  getCurrentWindowMock.mockReturnValue({ label: "main" });
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {},
    configurable: true,
  });
  vi.resetModules();
});

describe("preferencesBroadcast", () => {
  it("broadcastPreferencesChange emits with sourceWindow label", async () => {
    const { broadcastPreferencesChange } = await import("./preferencesBroadcast");
    await broadcastPreferencesChange({ frontendLogging: true });
    expect(emitMock).toHaveBeenCalledWith("preferences-changed", {
      partial: { frontendLogging: true },
      sourceWindow: "main",
    });
  });

  it("listenForPreferencesChanges filters echoes from its own window", async () => {
    getCurrentWindowMock.mockReturnValue({ label: "main" });
    const { listenForPreferencesChanges } = await import("./preferencesBroadcast");
    const apply = vi.fn();
    await listenForPreferencesChanges(apply);

    // Echo from same window — must be ignored.
    listenCallback?.({
      payload: { partial: { frontendLogging: true }, sourceWindow: "main" },
    });

    expect(apply).not.toHaveBeenCalled();
  });

  it("listenForPreferencesChanges applies partials from other windows", async () => {
    getCurrentWindowMock.mockReturnValue({ label: "main" });
    const { listenForPreferencesChanges } = await import("./preferencesBroadcast");
    const apply = vi.fn();
    await listenForPreferencesChanges(apply);

    // Event from "log-viewer" — different window, must be applied.
    listenCallback?.({
      payload: { partial: { performanceProfiler: true }, sourceWindow: "log-viewer" },
    });

    expect(apply).toHaveBeenCalledWith({ performanceProfiler: true });
  });

  it("applies a theme partial from another window", async () => {
    getCurrentWindowMock.mockReturnValue({ label: "main" });
    const { listenForPreferencesChanges } = await import("./preferencesBroadcast");
    const apply = vi.fn();
    await listenForPreferencesChanges(apply);

    // Light/dark toggled in a detached window — the main window must apply it.
    listenCallback?.({
      payload: { partial: { theme: { mode: "light" } }, sourceWindow: "detached-library" },
    });

    expect(apply).toHaveBeenCalledWith({ theme: { mode: "light" } });
  });

  it("ignores malformed payloads", async () => {
    const { listenForPreferencesChanges } = await import("./preferencesBroadcast");
    const apply = vi.fn();
    await listenForPreferencesChanges(apply);

    listenCallback?.({ payload: undefined });

    expect(apply).not.toHaveBeenCalled();
  });

  it("ignores null payloads", async () => {
    const { listenForPreferencesChanges } = await import("./preferencesBroadcast");
    const apply = vi.fn();
    await listenForPreferencesChanges(apply);
    listenCallback?.({ payload: null });
    expect(apply).not.toHaveBeenCalled();
  });

  it("emits the canonical 'preferences-changed' event name", async () => {
    const { broadcastPreferencesChange } = await import("./preferencesBroadcast");
    await broadcastPreferencesChange({ frontendLogging: false });
    expect(emitMock.mock.calls[0][0]).toBe("preferences-changed");
  });

  it("broadcast carries the current window label as sourceWindow", async () => {
    getCurrentWindowMock.mockReturnValue({ label: "log-viewer" });
    const { broadcastPreferencesChange } = await import("./preferencesBroadcast");
    await broadcastPreferencesChange({ performanceProfiler: true });
    expect(emitMock).toHaveBeenCalledWith("preferences-changed", {
      partial: { performanceProfiler: true },
      sourceWindow: "log-viewer",
    });
  });

  it("broadcast forwards the exact partial object", async () => {
    const { broadcastPreferencesChange } = await import("./preferencesBroadcast");
    await broadcastPreferencesChange({ frontendLogging: true, performanceProfiler: false });
    expect(emitMock.mock.calls[0][1]).toMatchObject({
      partial: { frontendLogging: true, performanceProfiler: false },
    });
  });

  it("emits with the same sourceWindow across multiple broadcasts", async () => {
    getCurrentWindowMock.mockReturnValue({ label: "win-A" });
    const { broadcastPreferencesChange } = await import("./preferencesBroadcast");
    await broadcastPreferencesChange({ frontendLogging: true });
    await broadcastPreferencesChange({ frontendLogging: false });
    expect(emitMock).toHaveBeenCalledTimes(2);
    expect(emitMock.mock.calls[0][1]).toMatchObject({ sourceWindow: "win-A" });
    expect(emitMock.mock.calls[1][1]).toMatchObject({ sourceWindow: "win-A" });
  });

  it("swallows emit errors without throwing", async () => {
    emitMock.mockImplementationOnce(() => Promise.reject(new Error("emit boom")));
    const { broadcastPreferencesChange } = await import("./preferencesBroadcast");
    await expect(
      broadcastPreferencesChange({ frontendLogging: true }),
    ).resolves.toBeUndefined();
  });

  it("listenForPreferencesChanges returns an unsubscribe function", async () => {
    const { listenForPreferencesChanges } = await import("./preferencesBroadcast");
    const unsub = await listenForPreferencesChanges(vi.fn());
    expect(typeof unsub).toBe("function");
  });

  it("applies partials when sourceWindow differs only by label", async () => {
    getCurrentWindowMock.mockReturnValue({ label: "main" });
    const { listenForPreferencesChanges } = await import("./preferencesBroadcast");
    const apply = vi.fn();
    await listenForPreferencesChanges(apply);
    listenCallback?.({
      payload: { partial: { frontendLogging: false }, sourceWindow: "other" },
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ frontendLogging: false });
  });

  it("does not apply repeatedly for echoed events", async () => {
    getCurrentWindowMock.mockReturnValue({ label: "main" });
    const { listenForPreferencesChanges } = await import("./preferencesBroadcast");
    const apply = vi.fn();
    await listenForPreferencesChanges(apply);
    listenCallback?.({ payload: { partial: {}, sourceWindow: "main" } });
    listenCallback?.({ payload: { partial: {}, sourceWindow: "main" } });
    expect(apply).not.toHaveBeenCalled();
  });

  it("broadcasts a favoritesUpdate signal that subscribers receive", async () => {
    const { broadcastPreferencesChange } = await import("./preferencesBroadcast");
    await broadcastPreferencesChange({ favoritesUpdate: true });
    expect(emitMock).toHaveBeenCalledWith("preferences-changed", {
      partial: { favoritesUpdate: true },
      sourceWindow: "main",
    });
  });
});

describe("preferencesBroadcast — non-Tauri environment", () => {
  beforeEach(() => {
    emitMock.mockClear();
    listenCallback = null;
    // Remove the Tauri marker so isTauri evaluates false.
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
  });

  it("broadcastPreferencesChange is a no-op outside Tauri", async () => {
    const { broadcastPreferencesChange } = await import("./preferencesBroadcast");
    await broadcastPreferencesChange({ frontendLogging: true });
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("listenForPreferencesChanges returns a no-op unsubscribe outside Tauri", async () => {
    const { listenForPreferencesChanges } = await import("./preferencesBroadcast");
    const apply = vi.fn();
    const unsub = await listenForPreferencesChanges(apply);
    expect(typeof unsub).toBe("function");
    expect(() => unsub()).not.toThrow();
    expect(listenCallback).toBeNull();
  });

  it("does not register a listener outside Tauri", async () => {
    const { listenForPreferencesChanges } = await import("./preferencesBroadcast");
    await listenForPreferencesChanges(vi.fn());
    expect(listenCallback).toBeNull();
  });
});
