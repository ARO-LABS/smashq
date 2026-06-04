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
