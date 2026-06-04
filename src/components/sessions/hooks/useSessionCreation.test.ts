import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionCreation } from "./useSessionCreation";

// ── Mocks ─────────────────────────────────────────────────────────────

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockAddSession = vi.fn();
vi.mock("../../../store/sessionStore", () => ({
  useSessionStore: {
    getState: () => ({
      sessions: [],
      addSession: mockAddSession,
    }),
  },
  // Deterministic stub so tests can assert on a known displayId value.
  generateUniqueDisplayId: vi.fn(() => "TEST"),
}));

const mockUpdateFavoriteLastUsed = vi.fn();
const mockSetDefaultProjectPath = vi.fn();
// Mutable settings snapshot — tests tweak these before invoking the hook.
const settingsSnapshot: { defaultProjectPath: string | null; defaultShell: string } = {
  defaultProjectPath: null,
  defaultShell: "auto",
};
vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      updateFavoriteLastUsed: mockUpdateFavoriteLastUsed,
      setDefaultProjectPath: mockSetDefaultProjectPath,
      defaultProjectPath: settingsSnapshot.defaultProjectPath,
      defaultShell: settingsSnapshot.defaultShell,
    }),
  },
}));

const mockClosePreview = vi.fn();
const mockAddToast = vi.fn();
vi.mock("../../../store/uiStore", () => ({
  useUIStore: {
    getState: () => ({
      closePreview: mockClosePreview,
      addToast: mockAddToast,
    }),
  },
}));

const mockOpen = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mockOpen(...args),
}));

vi.mock("../../../utils/perfLogger", () => ({
  wrapInvoke: (cmd: string, args: Record<string, unknown>) =>
    mockInvoke(cmd, args),
}));

vi.mock("../../../utils/errorLogger", () => ({
  logError: vi.fn(),
}));

// ── Tests ─────────────────────────────────────────────────────────────

describe("useSessionCreation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsSnapshot.defaultProjectPath = null;
    settingsSnapshot.defaultShell = "auto";
  });

  describe("handleResumeSession", () => {
    it("creates a session via Tauri and adds it to the store", async () => {
      mockInvoke.mockResolvedValue({
        id: "session-resume-1",
        title: "Resume Session",
        folder: "C:/Projects/test",
        shell: "powershell",
      });

      const { result } = renderHook(() => useSessionCreation());

      await act(async () => {
        await result.current.handleResumeSession("old-session-id", "C:/Projects/test");
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        "create_session",
        expect.objectContaining({
          folder: "C:/Projects/test",
          title: "Resume Session",
          shell: "powershell",
          resumeSessionId: "old-session-id",
        }),
      );

      expect(mockAddSession).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "session-resume-1",
          title: "Resume Session",
          folder: "C:/Projects/test",
          shell: "powershell",
          claudeSessionId: "old-session-id",
        }),
      );
    });

    it("uses fallback values if invoke returns partial data", async () => {
      mockInvoke.mockResolvedValue({});

      const { result } = renderHook(() => useSessionCreation());

      await act(async () => {
        await result.current.handleResumeSession("old-id", "C:/test");
      });

      expect(mockAddSession).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Resume Session",
          folder: "C:/test",
          shell: "powershell",
          claudeSessionId: "old-id",
        }),
      );
    });

    it("handles invoke errors gracefully", async () => {
      mockInvoke.mockRejectedValue(new Error("connection failed"));
      const { logError } = await import("../../../utils/errorLogger");

      const { result } = renderHook(() => useSessionCreation());

      await act(async () => {
        await result.current.handleResumeSession("old-id", "C:/test");
      });

      expect(logError).toHaveBeenCalledWith(
        "useSessionCreation.resumeSession",
        expect.any(Error),
      );
    });
  });

  describe("handleQuickStart", () => {
    const favorite = {
      id: "fav-1",
      label: "My Project",
      path: "C:/Projects/my-project",
      shell: "powershell" as const,
      lastUsedAt: 0,
      addedAt: Date.now(),
      pinnedDocs: [],
      groupId: null,
      sortIndex: 0,
    };

    it("creates a session and updates favorite last-used", async () => {
      mockInvoke.mockResolvedValue({
        id: "session-quick-1",
        title: "My Project",
        folder: "C:/Projects/my-project",
        shell: "powershell",
      });

      const { result } = renderHook(() => useSessionCreation());

      await act(async () => {
        await result.current.handleQuickStart(favorite);
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        "create_session",
        expect.objectContaining({
          folder: "C:/Projects/my-project",
          title: "My Project",
          shell: "powershell",
        }),
      );

      expect(mockAddSession).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "session-quick-1",
          title: "My Project",
        }),
      );

      expect(mockUpdateFavoriteLastUsed).toHaveBeenCalledWith("fav-1");
      expect(mockClosePreview).toHaveBeenCalled();
    });

    it("handles invoke errors gracefully", async () => {
      mockInvoke.mockRejectedValue(new Error("spawn failed"));
      const { logError } = await import("../../../utils/errorLogger");

      const { result } = renderHook(() => useSessionCreation());

      await act(async () => {
        await result.current.handleQuickStart(favorite);
      });

      expect(logError).toHaveBeenCalledWith(
        "useSessionCreation.quickStart",
        expect.any(Error),
      );
      expect(mockAddSession).not.toHaveBeenCalled();
    });

    it("does not update favorite last-used or close preview on failure", async () => {
      mockInvoke.mockRejectedValue(new Error("spawn failed"));

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleQuickStart(favorite);
      });

      // Error path returns before the post-create side effects.
      expect(mockUpdateFavoriteLastUsed).not.toHaveBeenCalled();
      expect(mockClosePreview).not.toHaveBeenCalled();
    });

    it("uses the favorite's own shell rather than a default", async () => {
      mockInvoke.mockResolvedValue({});
      const cmdFavorite = { ...favorite, shell: "cmd" as const };

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleQuickStart(cmdFavorite);
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        "create_session",
        expect.objectContaining({ shell: "cmd" }),
      );
      expect(mockAddSession).toHaveBeenCalledWith(
        expect.objectContaining({ shell: "cmd" }),
      );
    });

    it("forwards git snapshot fields from the backend result", async () => {
      mockInvoke.mockResolvedValue({
        id: "session-git-1",
        title: "My Project",
        folder: "C:/Projects/my-project",
        shell: "powershell",
        isGitRepo: true,
        snapshotCommit: "abc1234",
      });

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleQuickStart(favorite);
      });

      expect(mockAddSession).toHaveBeenCalledWith(
        expect.objectContaining({ isGitRepo: true, snapshotCommit: "abc1234" }),
      );
    });
  });

  describe("handleResumeSession — extra branches", () => {
    it("uses a custom resume title when provided", async () => {
      mockInvoke.mockResolvedValue({});

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleResumeSession("old-id", "C:/test", "Mein Titel");
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        "create_session",
        expect.objectContaining({ title: "Mein Titel" }),
      );
      expect(mockAddSession).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Mein Titel" }),
      );
    });

    it("does not add a session to the store when invoke fails", async () => {
      mockInvoke.mockRejectedValue(new Error("connection failed"));

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleResumeSession("old-id", "C:/test");
      });

      expect(mockAddSession).not.toHaveBeenCalled();
    });

    it("falls back to the generated id when result has no id", async () => {
      mockInvoke.mockResolvedValue({ title: "Resume Session", folder: "C:/test", shell: "powershell" });

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleResumeSession("old-id", "C:/test");
      });

      expect(mockAddSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: expect.stringMatching(/^session-/) }),
      );
    });
  });

  describe("handleNewSessionFromDefaults", () => {
    it("starts a session directly when a default project path is set", async () => {
      settingsSnapshot.defaultProjectPath = "C:/Projects/default-proj";
      settingsSnapshot.defaultShell = "powershell";
      mockInvoke.mockResolvedValue({});

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleNewSessionFromDefaults();
      });

      // No folder picker — default path used straight away.
      expect(mockOpen).not.toHaveBeenCalled();
      expect(mockInvoke).toHaveBeenCalledWith(
        "create_session",
        expect.objectContaining({
          folder: "C:/Projects/default-proj",
          title: "default-proj",
          shell: "powershell",
        }),
      );
      expect(mockClosePreview).toHaveBeenCalled();
      // No "Default speichern?" toast when the path was already configured.
      expect(mockAddToast).not.toHaveBeenCalled();
    });

    it("derives the title from the last path segment, handling backslashes", async () => {
      settingsSnapshot.defaultProjectPath = "C:\\Users\\me\\agentic-dashboard";
      mockInvoke.mockResolvedValue({});

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleNewSessionFromDefaults();
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        "create_session",
        expect.objectContaining({ title: "agentic-dashboard" }),
      );
    });

    it("maps the 'auto' shell preference to powershell", async () => {
      settingsSnapshot.defaultProjectPath = "C:/proj/a";
      settingsSnapshot.defaultShell = "auto";
      mockInvoke.mockResolvedValue({});

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleNewSessionFromDefaults();
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        "create_session",
        expect.objectContaining({ shell: "powershell" }),
      );
    });

    it("maps the 'bash' shell preference to gitbash", async () => {
      settingsSnapshot.defaultProjectPath = "C:/proj/b";
      settingsSnapshot.defaultShell = "bash";
      mockInvoke.mockResolvedValue({});

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleNewSessionFromDefaults();
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        "create_session",
        expect.objectContaining({ shell: "gitbash" }),
      );
    });

    it("opens a folder picker and nudges to save the default when no path is set", async () => {
      settingsSnapshot.defaultProjectPath = null;
      mockOpen.mockResolvedValue("C:/Projects/picked-folder");
      mockInvoke.mockResolvedValue({});

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleNewSessionFromDefaults();
      });

      expect(mockOpen).toHaveBeenCalledWith(
        expect.objectContaining({ directory: true, multiple: false }),
      );
      expect(mockInvoke).toHaveBeenCalledWith(
        "create_session",
        expect.objectContaining({ folder: "C:/Projects/picked-folder" }),
      );
      // Picked-folder path → nudge toast with a "Speichern" action.
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "info",
          title: "Default speichern?",
          action: expect.objectContaining({ label: "Speichern" }),
        }),
      );
    });

    it("toast action persists the picked folder as the default", async () => {
      settingsSnapshot.defaultProjectPath = null;
      mockOpen.mockResolvedValue("C:/Projects/save-me");
      mockInvoke.mockResolvedValue({});

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleNewSessionFromDefaults();
      });

      const toastArg = mockAddToast.mock.calls[0][0] as {
        action: { onClick: () => void };
      };
      toastArg.action.onClick();
      expect(mockSetDefaultProjectPath).toHaveBeenCalledWith("C:/Projects/save-me");
    });

    it("aborts silently when the folder picker is cancelled", async () => {
      settingsSnapshot.defaultProjectPath = null;
      mockOpen.mockResolvedValue(null);

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleNewSessionFromDefaults();
      });

      // No path → never reaches create_session.
      expect(mockInvoke).not.toHaveBeenCalled();
      expect(mockAddSession).not.toHaveBeenCalled();
    });

    it("aborts when the folder picker returns a non-string (multiple selection)", async () => {
      settingsSnapshot.defaultProjectPath = null;
      mockOpen.mockResolvedValue(["C:/a", "C:/b"]);

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleNewSessionFromDefaults();
      });

      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("logs and aborts when the folder picker itself throws", async () => {
      settingsSnapshot.defaultProjectPath = null;
      mockOpen.mockRejectedValue(new Error("dialog crashed"));
      const { logError } = await import("../../../utils/errorLogger");

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleNewSessionFromDefaults();
      });

      expect(logError).toHaveBeenCalledWith(
        "useSessionCreation.newSession.pickFolder",
        expect.any(Error),
      );
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("toasts an error and skips the save-nudge when create_session fails", async () => {
      settingsSnapshot.defaultProjectPath = null;
      mockOpen.mockResolvedValue("C:/Projects/doomed");
      mockInvoke.mockRejectedValue(new Error("create boom"));
      const { logError } = await import("../../../utils/errorLogger");

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleNewSessionFromDefaults();
      });

      expect(logError).toHaveBeenCalledWith(
        "useSessionCreation.newSession.create",
        expect.any(Error),
      );
      expect(mockAddSession).not.toHaveBeenCalled();
      // Exactly one toast — the error toast — and NOT the save-nudge.
      expect(mockAddToast).toHaveBeenCalledTimes(1);
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          title: "Session-Start fehlgeschlagen",
          message: "create boom",
        }),
      );
    });

    it("stringifies a non-Error rejection in the error toast", async () => {
      settingsSnapshot.defaultProjectPath = "C:/proj/c";
      mockInvoke.mockRejectedValue("plain string failure");

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleNewSessionFromDefaults();
      });

      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          message: "plain string failure",
        }),
      );
    });
  });
});
