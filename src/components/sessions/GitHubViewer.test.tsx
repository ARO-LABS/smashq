import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { open } from "@tauri-apps/plugin-shell";
import { GitHubViewer } from "./GitHubViewer";

// Mock @tauri-apps/api/core
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock @tauri-apps/plugin-shell
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

const openMock = vi.mocked(open);

beforeEach(() => {
  vi.clearAllMocks();
});

// Unique folder per test — module-level cache (60s TTL) would otherwise leak
// state across tests that reuse the same folder string.
let folderSeq = 0;
function uniqueFolder(): string {
  folderSeq += 1;
  return `/test/ghv-${folderSeq}-${Date.now()}`;
}

// Standard invoke mock builder for git + gh commands.
function mockGit(opts: {
  gitInfo?: unknown;
  gitReject?: string;
  prs?: unknown[];
  issues?: unknown[];
  ghReject?: string;
}) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_git_info") {
      return opts.gitReject
        ? Promise.reject(new Error(opts.gitReject))
        : Promise.resolve(opts.gitInfo ?? { branch: "main", last_commit: null, remote_url: "" });
    }
    if (cmd === "get_github_prs") {
      return opts.ghReject
        ? Promise.reject(new Error(opts.ghReject))
        : Promise.resolve(opts.prs ?? []);
    }
    if (cmd === "get_github_issues") {
      return opts.ghReject
        ? Promise.reject(new Error(opts.ghReject))
        : Promise.resolve(opts.issues ?? []);
    }
    return Promise.reject(new Error("unknown"));
  });
}

describe("GitHubViewer", () => {
  it("shows loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<GitHubViewer folder="/test/project" />);
    expect(screen.getByText("Lade Git/GitHub-Daten...")).toBeInTheDocument();
  });

  it("renders git info, PRs, and issues", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_git_info") {
        return Promise.resolve({
          branch: "feature/test",
          last_commit: {
            hash: "abc1234",
            message: "fix: something",
            date: "2026-04-01",
          },
          remote_url: "https://github.com/user/repo.git",
        });
      }
      if (cmd === "get_github_prs") {
        return Promise.resolve([
          {
            number: 42,
            title: "Add feature X",
            author: "dev1",
            status: "APPROVED",
            url: "https://github.com/user/repo/pull/42",
          },
        ]);
      }
      if (cmd === "get_github_issues") {
        return Promise.resolve([
          {
            number: 10,
            title: "Bug in login",
            labels: ["bug", "high-priority"],
            assignee: "dev2",
            url: "https://github.com/user/repo/issues/10",
          },
        ]);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<GitHubViewer folder="/test/fresh-project" />);

    await waitFor(() => {
      expect(screen.getByText("feature/test")).toBeInTheDocument();
    });

    // Git info
    expect(screen.getByText("abc1234")).toBeInTheDocument();
    expect(screen.getByText("fix: something")).toBeInTheDocument();

    // PR
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("Add feature X")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();

    // Issue
    expect(screen.getByText("#10")).toBeInTheDocument();
    expect(screen.getByText("Bug in login")).toBeInTheDocument();
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByText("high-priority")).toBeInTheDocument();
  });

  it("shows empty state when git fails", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_git_info") {
        return Promise.reject(new Error("not a git repository"));
      }
      if (cmd === "get_github_prs") return Promise.resolve([]);
      if (cmd === "get_github_issues") return Promise.resolve([]);
      return Promise.reject(new Error("unknown"));
    });

    render(<GitHubViewer folder="/test/no-git-project" />);

    await waitFor(() => {
      expect(screen.getByText("Kein Git-Repository")).toBeInTheDocument();
    });
  });

  it("shows gh CLI error when github commands fail", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_git_info") {
        return Promise.resolve({
          branch: "main",
          last_commit: null,
          remote_url: "",
        });
      }
      if (cmd === "get_github_prs" || cmd === "get_github_issues") {
        return Promise.reject(new Error("gh not found"));
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<GitHubViewer folder="/test/no-gh-project" />);

    await waitFor(() => {
      expect(screen.getByText("main")).toBeInTheDocument();
    });

    // The error contains "not found" which triggers the special gh CLI message
    expect(
      screen.getByText("gh CLI nicht gefunden — installiere von https://cli.github.com"),
    ).toBeInTheDocument();
  });

  it("shows no PRs/issues when lists are empty", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_git_info") {
        return Promise.resolve({
          branch: "main",
          last_commit: null,
          remote_url: "",
        });
      }
      if (cmd === "get_github_prs") return Promise.resolve([]);
      if (cmd === "get_github_issues") return Promise.resolve([]);
      return Promise.reject(new Error("unknown"));
    });

    render(<GitHubViewer folder="/test/empty-gh-project" />);

    await waitFor(() => {
      expect(screen.getByText("Keine offenen PRs")).toBeInTheDocument();
    });
    expect(screen.getByText("Keine offenen Issues")).toBeInTheDocument();
  });

  it("renders refresh button", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_git_info") {
        return Promise.resolve({ branch: "main", last_commit: null, remote_url: "" });
      }
      if (cmd === "get_github_prs") return Promise.resolve([]);
      if (cmd === "get_github_issues") return Promise.resolve([]);
      return Promise.reject(new Error("unknown"));
    });

    render(<GitHubViewer folder="/test/refresh-project" />);

    await waitFor(() => {
      expect(screen.getByText("GitHub")).toBeInTheDocument();
    });

    const refreshBtn = screen.getByTitle("Neu laden");
    expect(refreshBtn).toBeInTheDocument();

    // Click refresh triggers reload — await the resulting state updates so they
    // settle inside act() rather than leaking past the test.
    fireEvent.click(refreshBtn);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_git_info", {
        folder: "/test/refresh-project",
      });
    });
  });

  it("maps PR statuses to German-style labels (Changes, Review, Pending)", async () => {
    mockGit({
      gitInfo: { branch: "main", last_commit: null, remote_url: "" },
      prs: [
        { number: 1, title: "PR one", author: "a", status: "CHANGES_REQUESTED", url: "" },
        { number: 2, title: "PR two", author: "b", status: "REVIEW_REQUIRED", url: "" },
        { number: 3, title: "PR three", author: "c", status: "OPEN", url: "" },
      ],
    });
    render(<GitHubViewer folder={uniqueFolder()} />);
    await waitFor(() => expect(screen.getByText("PR one")).toBeInTheDocument());
    expect(screen.getByText("Changes")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("shows the PR and issue counts in the section headers", async () => {
    mockGit({
      gitInfo: { branch: "main", last_commit: null, remote_url: "" },
      prs: [
        { number: 1, title: "PR one", author: "a", status: "APPROVED", url: "" },
        { number: 2, title: "PR two", author: "b", status: "APPROVED", url: "" },
      ],
      issues: [{ number: 9, title: "Issue nine", labels: [], assignee: "", url: "" }],
    });
    render(<GitHubViewer folder={uniqueFolder()} />);
    await waitFor(() => expect(screen.getByText("PR one")).toBeInTheDocument());
    expect(screen.getByText("Pull Requests (2)")).toBeInTheDocument();
    expect(screen.getByText("Issues (1)")).toBeInTheDocument();
  });

  it("opens the PR url in the browser when the external-link button is clicked", async () => {
    openMock.mockResolvedValue(undefined);
    mockGit({
      gitInfo: { branch: "main", last_commit: null, remote_url: "" },
      prs: [
        {
          number: 7,
          title: "Clickable PR",
          author: "dev",
          status: "APPROVED",
          url: "https://github.com/u/r/pull/7",
        },
      ],
    });
    render(<GitHubViewer folder={uniqueFolder()} />);
    await waitFor(() => expect(screen.getByText("Clickable PR")).toBeInTheDocument());
    fireEvent.click(screen.getByTitle("Im Browser öffnen"));
    expect(openMock).toHaveBeenCalledWith("https://github.com/u/r/pull/7");
  });

  it("opens the issue url in the browser when its external-link button is clicked", async () => {
    openMock.mockResolvedValue(undefined);
    mockGit({
      gitInfo: { branch: "main", last_commit: null, remote_url: "" },
      issues: [
        {
          number: 22,
          title: "Clickable issue",
          labels: [],
          assignee: "",
          url: "https://github.com/u/r/issues/22",
        },
      ],
    });
    render(<GitHubViewer folder={uniqueFolder()} />);
    await waitFor(() => expect(screen.getByText("Clickable issue")).toBeInTheDocument());
    fireEvent.click(screen.getByTitle("Im Browser öffnen"));
    expect(openMock).toHaveBeenCalledWith("https://github.com/u/r/issues/22");
  });

  it("converts an ssh remote_url to https and opens it when clicked", async () => {
    openMock.mockResolvedValue(undefined);
    mockGit({
      gitInfo: {
        branch: "main",
        last_commit: null,
        remote_url: "git@github.com:user/repo.git",
      },
    });
    render(<GitHubViewer folder={uniqueFolder()} />);
    await waitFor(() =>
      expect(screen.getByText("git@github.com:user/repo.git")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("git@github.com:user/repo.git"));
    expect(openMock).toHaveBeenCalledWith("https://github.com/user/repo");
  });

  it("renders the assignee when present and omits it when empty", async () => {
    const folderWith = uniqueFolder();
    mockGit({
      gitInfo: { branch: "main", last_commit: null, remote_url: "" },
      issues: [
        { number: 5, title: "Has owner", labels: ["docs"], assignee: "octocat", url: "" },
      ],
    });
    const { unmount } = render(<GitHubViewer folder={folderWith} />);
    await waitFor(() => expect(screen.getByText("Has owner")).toBeInTheDocument());
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("octocat")).toBeInTheDocument();
    unmount();

    mockGit({
      gitInfo: { branch: "main", last_commit: null, remote_url: "" },
      issues: [{ number: 6, title: "No owner", labels: [], assignee: "", url: "" }],
    });
    render(<GitHubViewer folder={uniqueFolder()} />);
    await waitFor(() => expect(screen.getByText("No owner")).toBeInTheDocument());
    expect(screen.queryByText("octocat")).toBeNull();
  });

  it("renders a raw gh error verbatim when it does not mention 'not found'", async () => {
    mockGit({
      gitInfo: { branch: "main", last_commit: null, remote_url: "" },
      ghReject: "rate limit exceeded",
    });
    render(<GitHubViewer folder={uniqueFolder()} />);
    await waitFor(() =>
      expect(screen.getByText(/rate limit exceeded/)).toBeInTheDocument(),
    );
    // With a gh error, PR/issue sections are suppressed.
    expect(screen.queryByText(/Pull Requests/)).toBeNull();
    expect(screen.queryByText(/^Issues/)).toBeNull();
  });

  it("renders the no-git empty state with the folder path shown", async () => {
    const folder = uniqueFolder();
    mockGit({ gitReject: "not a git repository" });
    render(<GitHubViewer folder={folder} />);
    await waitFor(() =>
      expect(screen.getByText("Kein Git-Repository")).toBeInTheDocument(),
    );
    expect(screen.getByText(folder)).toBeInTheDocument();
  });

  it("serves cached data on remount without re-invoking the backend", async () => {
    const folder = uniqueFolder();
    mockGit({
      gitInfo: { branch: "cached-branch", last_commit: null, remote_url: "" },
    });
    const { unmount } = render(<GitHubViewer folder={folder} />);
    await waitFor(() => expect(screen.getByText("cached-branch")).toBeInTheDocument());
    const callsAfterFirst = mockInvoke.mock.calls.length;
    unmount();

    render(<GitHubViewer folder={folder} />);
    await waitFor(() => expect(screen.getByText("cached-branch")).toBeInTheDocument());
    // Cache hit — no additional backend calls.
    expect(mockInvoke.mock.calls.length).toBe(callsAfterFirst);
  });
});
