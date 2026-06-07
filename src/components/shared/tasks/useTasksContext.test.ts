import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useTasksContext } from "./useTasksContext";
import { useSessionStore } from "../../../store/sessionStore";
import { useSettingsStore, normalizeProjectKey } from "../../../store/settingsStore";
import { useTasksStore } from "../../../store/tasksStore";

// ── helpers ───────────────────────────────────────────────────────────────────

const NON_FAVORITE_FOLDER = "C:/Projects/not-a-favorite";

function seedActiveSession(folder: string): void {
  const sessionId = "test-session-1";
  useSessionStore.setState({
    sessions: [
      {
        id: sessionId,
        title: "Test Session",
        folder,
        shell: "powershell",
        status: "running",
        createdAt: Date.now(),
        finishedAt: null,
        exitCode: null,
        lastOutputAt: Date.now(),
        lastOutputSnippet: "",
      },
    ],
    activeSessionId: sessionId,
    layoutMode: "single",
    gridSessionIds: [],
    focusedGridSessionId: null,
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("useTasksContext – availableProjects", () => {
  beforeEach(() => {
    useTasksStore.setState({ tasks: [] });
    useSettingsStore.setState({ favorites: [] });
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      layoutMode: "single",
      gridSessionIds: [],
      focusedGridSessionId: null,
    });
  });

  it("includes the active session's project even if it is not a favorite and has no tasks", () => {
    seedActiveSession(NON_FAVORITE_FOLDER);

    const { result } = renderHook(() => useTasksContext(true));

    const key = normalizeProjectKey(NON_FAVORITE_FOLDER);
    expect(result.current.availableProjects.some((p) => p.key === key)).toBe(true);
  });

  it("still includes favorites and global sentinel when active session is absent", () => {
    // No active session — only the Global sentinel should be present.
    const { result } = renderHook(() => useTasksContext(true));

    expect(result.current.availableProjects).toHaveLength(1);
    expect(result.current.availableProjects[0].key).toBeNull();
  });

  it("does not duplicate the active session's project if it is already a favorite", () => {
    const favoriteFolder = "C:/Projects/my-fav";
    useSettingsStore.setState({
      favorites: [
        {
          id: "fav-1",
          path: favoriteFolder,
          label: "My Fav",
          shell: "powershell",
          addedAt: 0,
          lastUsedAt: 0,
          groupId: null,
          sortIndex: 1000,
        },
      ],
    });
    seedActiveSession(favoriteFolder);

    const { result } = renderHook(() => useTasksContext(true));

    const key = normalizeProjectKey(favoriteFolder);
    const matches = result.current.availableProjects.filter((p) => p.key === key);
    // Must appear exactly once — no duplication.
    expect(matches).toHaveLength(1);
  });
});
