import { mockIPC } from "@tauri-apps/api/mocks";
import { useSessionStore, type ClaudeSession } from "../../store/sessionStore";
import { useSettingsStore } from "../../store/settingsStore";

const NOW = 1_700_000_000_000;

function fakeSession(over: Partial<ClaudeSession>): ClaudeSession {
  return {
    id: "ds-1",
    title: "smashq",
    folder: "C:/Projects/smashq",
    shell: "powershell",
    status: "running",
    createdAt: NOW,
    finishedAt: null,
    exitCode: null,
    lastOutputAt: NOW,
    lastOutputSnippet: "VITE ready in 312 ms",
    ...over,
  };
}

export function seedDesignDocState(): void {
  useSettingsStore.setState({
    theme: { ...useSettingsStore.getState().theme, mode: "dark" },
  });

  useSessionStore.setState({
    sessions: [
      fakeSession({ id: "ds-1", title: "smashq", status: "running" }),
      fakeSession({
        id: "ds-2",
        title: "agentic-dashboard",
        status: "waiting",
        claudeSessionId: "ds-claude-2",
      }),
      fakeSession({
        id: "ds-3",
        title: "release-build",
        status: "done",
        finishedAt: NOW,
        exitCode: 0,
        claudeSessionId: "ds-claude-3",
      }),
    ],
  });

  useSettingsStore.setState({
    favorites: [
      {
        id: "fav-1",
        path: "C:/fe",
        label: "Frontend",
        shell: "powershell",
        addedAt: NOW,
        lastUsedAt: NOW,
        groupId: "grp-1",
        sortIndex: 0,
      },
      {
        id: "fav-2",
        path: "C:/be",
        label: "Backend API",
        shell: "powershell",
        addedAt: NOW,
        lastUsedAt: NOW,
        groupId: "grp-1",
        sortIndex: 1000,
      },
    ],
    favoriteGroups: [{ id: "grp-1", label: "FAVORITEN", sortIndex: 0 }],
  });

  mockIPC((cmd) => {
    switch (cmd) {
      case "get_git_info":
        return { branch: "main", ahead: 0, behind: 0, hasChanges: false };
      case "open_folder_in_explorer":
      case "open_terminal_in_folder":
        return null;
      default:
        // eslint-disable-next-line no-console
        console.warn(`[designdoc] unmocked IPC: ${cmd}`);
        return null;
    }
  });
}
