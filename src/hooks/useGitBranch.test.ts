import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useGitBranch } from "./useGitBranch";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useGitBranch", () => {
  it("returns null and skips invoke when folder is undefined", () => {
    const { result } = renderHook(() => useGitBranch(undefined));
    expect(result.current).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("returns the branch name reported by the backend", async () => {
    mockInvoke.mockResolvedValue({ branch: "main" });
    const { result } = renderHook(() => useGitBranch("/repo"));
    await waitFor(() => expect(result.current).toBe("main"));
  });

  it("passes the folder argument to get_git_info", async () => {
    mockInvoke.mockResolvedValue({ branch: "develop" });
    renderHook(() => useGitBranch("/repo/x"));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("get_git_info", {
        folder: "/repo/x",
      }),
    );
  });

  it("returns null when HEAD is detached", async () => {
    mockInvoke.mockResolvedValue({ branch: "HEAD" });
    const { result } = renderHook(() => useGitBranch("/repo"));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("returns null when the backend reports no branch", async () => {
    mockInvoke.mockResolvedValue({ branch: undefined });
    const { result } = renderHook(() => useGitBranch("/repo"));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("trims surrounding whitespace from the branch name", async () => {
    mockInvoke.mockResolvedValue({ branch: "  feature/x  " });
    const { result } = renderHook(() => useGitBranch("/repo"));
    await waitFor(() => expect(result.current).toBe("feature/x"));
  });

  it("returns null when the backend invocation rejects", async () => {
    mockInvoke.mockRejectedValue(new Error("not a git repo"));
    const { result } = renderHook(() => useGitBranch("/repo"));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("pauses the poll loop while the document is hidden and resumes on visibilitychange (edge)", async () => {
    vi.useFakeTimers();
    try {
      mockInvoke.mockResolvedValue({ branch: "main" });
      const visState = vi.spyOn(document, "visibilityState", "get");
      visState.mockReturnValue("visible");
      const addSpy = vi.spyOn(document, "addEventListener");

      renderHook(() => useGitBranch("/repo"));
      // Initial fetch resolves, then scheduleNext arms the 30s timer.
      await vi.advanceTimersByTimeAsync(0);
      const callsAfterInitial = mockInvoke.mock.calls.length;
      expect(callsAfterInitial).toBeGreaterThan(0);

      // Tab goes hidden. The next scheduled tick fires fetch-then-schedule;
      // scheduleNext now sees hidden → parks on a visibilitychange listener
      // instead of re-arming a timer.
      visState.mockReturnValue("hidden");
      await vi.advanceTimersByTimeAsync(30_000);
      const callsWhileHidden = mockInvoke.mock.calls.length;

      // No further timer ticks happen while hidden — advancing time is a no-op.
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mockInvoke.mock.calls.length).toBe(callsWhileHidden);
      expect(
        addSpy.mock.calls.some((c) => c[0] === "visibilitychange"),
      ).toBe(true);

      // Becoming visible again triggers an immediate fetch.
      visState.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(mockInvoke.mock.calls.length).toBeGreaterThan(callsWhileHidden);

      visState.mockRestore();
      addSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets the branch to null when folder changes to undefined", async () => {
    mockInvoke.mockResolvedValue({ branch: "main" });
    const { result, rerender } = renderHook(
      ({ folder }) => useGitBranch(folder),
      { initialProps: { folder: "/repo" as string | undefined } },
    );
    await waitFor(() => expect(result.current).toBe("main"));
    rerender({ folder: undefined });
    expect(result.current).toBeNull();
  });
});
