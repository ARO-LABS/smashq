import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useWhatsNew } from "./useWhatsNew";
import { useSettingsStore } from "../store/settingsStore";

// ── Mocks ─────────────────────────────────────────────────────────────

const mockGetVersion = vi.fn();
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: (...args: unknown[]) => mockGetVersion(...args),
}));

vi.mock("../utils/errorLogger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// "1.0.23" HAS a curated entry in whatsNew.ts; "9.9.9" has none.
// Tests run against the REAL content module so the gating logic and the
// content contract are exercised together.

describe("useWhatsNew", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ lastSeenVersion: null });
  });

  it("new version WITH entry: returns the entry and stamps lastSeenVersion", async () => {
    useSettingsStore.setState({ lastSeenVersion: "1.0.21" });
    mockGetVersion.mockResolvedValue("1.0.23");

    const { result } = renderHook(() => useWhatsNew());

    await waitFor(() => {
      expect(result.current.entry?.version).toBe("1.0.23");
    });
    // Stamped on SHOW, not on dismiss — survives a crash before "Verstanden".
    expect(useSettingsStore.getState().lastSeenVersion).toBe("1.0.23");
  });

  it("already seen version: no entry", async () => {
    useSettingsStore.setState({ lastSeenVersion: "1.0.23" });
    mockGetVersion.mockResolvedValue("1.0.23");

    const { result } = renderHook(() => useWhatsNew());

    await waitFor(() => {
      expect(mockGetVersion).toHaveBeenCalled();
    });
    expect(result.current.entry).toBeNull();
  });

  it("fresh install (lastSeenVersion null): no modal, only the stamp", async () => {
    mockGetVersion.mockResolvedValue("1.0.23");

    const { result } = renderHook(() => useWhatsNew());

    await waitFor(() => {
      expect(useSettingsStore.getState().lastSeenVersion).toBe("1.0.23");
    });
    expect(result.current.entry).toBeNull();
  });

  it("upgrade sentinel '0.0.0' (seeded by migrate for pre-v12 users): modal shows", async () => {
    // Regression guard for the v1.0.23 rollout bug: existing users upgrading
    // from a pre-whats-new version had lastSeenVersion === null and were
    // misread as fresh installs — nobody saw the modal. migrate now seeds
    // "0.0.0" for them, which must take the normal show-and-stamp path.
    useSettingsStore.setState({ lastSeenVersion: "0.0.0" });
    mockGetVersion.mockResolvedValue("1.0.23");

    const { result } = renderHook(() => useWhatsNew());

    await waitFor(() => {
      expect(result.current.entry?.version).toBe("1.0.23");
    });
    expect(useSettingsStore.getState().lastSeenVersion).toBe("1.0.23");
  });

  it("new version WITHOUT entry: silent skip, stamp still written", async () => {
    useSettingsStore.setState({ lastSeenVersion: "1.0.21" });
    mockGetVersion.mockResolvedValue("9.9.9");

    const { result } = renderHook(() => useWhatsNew());

    await waitFor(() => {
      expect(useSettingsStore.getState().lastSeenVersion).toBe("9.9.9");
    });
    expect(result.current.entry).toBeNull();
  });

  it("dismiss clears the entry", async () => {
    useSettingsStore.setState({ lastSeenVersion: "1.0.21" });
    mockGetVersion.mockResolvedValue("1.0.23");

    const { result } = renderHook(() => useWhatsNew());
    await waitFor(() => {
      expect(result.current.entry).not.toBeNull();
    });

    act(() => result.current.dismiss());
    expect(result.current.entry).toBeNull();
  });
});
