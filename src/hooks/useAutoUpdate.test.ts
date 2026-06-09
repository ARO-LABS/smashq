import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoUpdate } from "./useAutoUpdate";

// ── Mocks ─────────────────────────────────────────────────────────────

const mockCheck = vi.fn();
const mockRelaunch = vi.fn();
const mockGetVersion = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => mockCheck(...args),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args: unknown[]) => mockRelaunch(...args),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: (...args: unknown[]) => mockGetVersion(...args),
}));

// Ensure isTauri is false in test env (no __TAURI_INTERNALS__)
// so auto-check timers don't fire. We test manual calls instead.

beforeEach(() => {
  vi.clearAllMocks();
  mockGetVersion.mockResolvedValue("1.0.0");
});

// ── Tests ─────────────────────────────────────────────────────────────

describe("useAutoUpdate", () => {
  it("starts with idle status", () => {
    const { result } = renderHook(() => useAutoUpdate());

    expect(result.current.status).toBe("idle");
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBeNull();
    expect(result.current.newVersion).toBeNull();
    expect(result.current.lastChecked).toBeNull();
  });

  it("exposes checkForUpdate, downloadAndInstall, confirmRelaunch, dismiss", () => {
    const { result } = renderHook(() => useAutoUpdate());

    expect(typeof result.current.checkForUpdate).toBe("function");
    expect(typeof result.current.downloadAndInstall).toBe("function");
    expect(typeof result.current.confirmRelaunch).toBe("function");
    expect(typeof result.current.dismiss).toBe("function");
  });

  it("dismiss resets status to idle", async () => {
    const { result } = renderHook(() => useAutoUpdate());

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.status).toBe("idle");
  });

  it("downloadAndInstall does nothing when no update available", async () => {
    const { result } = renderHook(() => useAutoUpdate());

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    // No update set → still idle
    expect(result.current.status).toBe("idle");
  });

  it("confirmRelaunch does nothing outside Tauri", async () => {
    const { result } = renderHook(() => useAutoUpdate());

    await act(async () => {
      await result.current.confirmRelaunch();
    });

    // relaunch not called — isTauri is false
    expect(mockRelaunch).not.toHaveBeenCalled();
  });

  it("checkForUpdate is a no-op outside Tauri (check() not invoked)", async () => {
    const { result } = renderHook(() => useAutoUpdate());

    await act(async () => {
      await result.current.checkForUpdate();
    });

    // isTauri false → checkFnRef early-returns before calling check()
    expect(mockCheck).not.toHaveBeenCalled();
    expect(mockGetVersion).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("checkForUpdate does not transition status when outside Tauri", async () => {
    const { result } = renderHook(() => useAutoUpdate());

    await act(async () => {
      await result.current.checkForUpdate();
    });

    // never reaches "checking" — early return keeps idle
    expect(result.current.status).toBe("idle");
    expect(result.current.lastChecked).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("checkForUpdate resolves without throwing", async () => {
    const { result } = renderHook(() => useAutoUpdate());

    await expect(
      act(async () => {
        await result.current.checkForUpdate();
      })
    ).resolves.toBeUndefined();
  });

  it("dismiss leaves progress and error untouched", async () => {
    const { result } = renderHook(() => useAutoUpdate());

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("dismiss is idempotent across repeated calls", async () => {
    const { result } = renderHook(() => useAutoUpdate());

    act(() => {
      result.current.dismiss();
      result.current.dismiss();
      result.current.dismiss();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.newVersion).toBeNull();
  });

  it("downloadAndInstall keeps progress at 0 when no update is set", async () => {
    const { result } = renderHook(() => useAutoUpdate());

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    // early return before any safeSetState — progress never touched
    expect(result.current.progress).toBe(0);
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
  });

  it("downloadAndInstall resolves without throwing when no update", async () => {
    const { result } = renderHook(() => useAutoUpdate());

    await expect(
      act(async () => {
        await result.current.downloadAndInstall();
      })
    ).resolves.toBeUndefined();
  });

  it("confirmRelaunch never calls update.install outside Tauri", async () => {
    const { result } = renderHook(() => useAutoUpdate());

    await act(async () => {
      await result.current.confirmRelaunch();
    });

    // isTauri false → early return, neither install nor relaunch run
    expect(mockRelaunch).not.toHaveBeenCalled();
  });

  it("confirmRelaunch transitions to error when relaunch fails (in Tauri)", async () => {
    // isTauri is a module-level const ("__TAURI_INTERNALS__" in window), so we
    // must set the global and re-import the module so it re-evaluates to true.
    // The vi.mock factories route through the persistent mockRelaunch/mockCheck
    // refs, so they still intercept after resetModules.
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.resetModules();
    mockCheck.mockResolvedValue(null);
    mockRelaunch.mockRejectedValueOnce(new Error("relaunch blew up"));
    try {
      const { useAutoUpdate: freshUseAutoUpdate } = await import("./useAutoUpdate");
      const { result } = renderHook(() => freshUseAutoUpdate());

      await act(async () => {
        await result.current.confirmRelaunch();
      });

      expect(result.current.status).toBe("error");
      expect(result.current.error).toBe("relaunch blew up");
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
      vi.resetModules();
    }
  });

  it("keeps stable callback identities across re-renders", () => {
    const { result, rerender } = renderHook(() => useAutoUpdate());

    const first = {
      checkForUpdate: result.current.checkForUpdate,
      confirmRelaunch: result.current.confirmRelaunch,
    };

    rerender();

    // checkForUpdate has empty deps → stable identity
    expect(result.current.checkForUpdate).toBe(first.checkForUpdate);
    // confirmRelaunch depends on `update` which never changes here → stable
    expect(result.current.confirmRelaunch).toBe(first.confirmRelaunch);
  });

  it("does not start auto-check timers outside Tauri", () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useAutoUpdate());
      // effect early-returns before scheduling timers
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(mockCheck).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("unmounts cleanly without errors", () => {
    const { unmount } = renderHook(() => useAutoUpdate());
    expect(() => unmount()).not.toThrow();
  });

  it("returns a state object with all UpdateState keys", () => {
    const { result } = renderHook(() => useAutoUpdate());

    expect(result.current).toMatchObject({
      status: "idle",
      progress: 0,
      error: null,
      newVersion: null,
      lastChecked: null,
    });
  });
});
