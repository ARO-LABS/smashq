/**
 * Layer-B integration test for SystemPanel (Issue #10).
 *
 * Real IPC via Tauri's official `mockIPC` (never `vi.mock` on core). The panel
 * invokes `check_prerequisites` on mount; the handler returns a canned
 * PrerequisiteStatus and the panel must render found/missing rows + the
 * platform fix command when a tool is absent.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SystemPanel } from "./SystemPanel";
import { claudeInstallHint } from "../../../utils/adpError";
import { installRealIPC, clearTauriIPC, type IPCHandler } from "../../../test/mockTauriIPC";

afterEach(() => {
  clearTauriIPC();
});

describe("SystemPanel — Layer-B", () => {
  it("renders resolved paths when every prerequisite is found", async () => {
    const handler: IPCHandler = async () => ({
      claude: { found: true, path: "/usr/local/bin/claude" },
      git: { found: true, path: "/usr/bin/git" },
      gh: { found: true, path: "/usr/bin/gh" },
      shell: { found: true, path: "/bin/zsh" },
      shellName: "zsh",
    });
    installRealIPC({ check_prerequisites: handler });

    render(<SystemPanel />);

    await waitFor(() => {
      expect(screen.getByText("/usr/local/bin/claude")).toBeTruthy();
    });
    expect(screen.getByText("/usr/bin/git")).toBeTruthy();
    expect(screen.getByText("/usr/bin/gh")).toBeTruthy();
    // Shell row carries the resolved shell name as its label. Match the label
    // exactly — a loose /zsh/ also hits the "/bin/zsh" path span (two matches).
    expect(screen.getByText("Shell (zsh)")).toBeTruthy();
  });

  it("shows the claude install command when claude is missing", async () => {
    const handler: IPCHandler = async () => ({
      claude: { found: false },
      git: { found: true, path: "/usr/bin/git" },
      gh: { found: true, path: "/usr/bin/gh" },
      shell: { found: true, path: "/bin/zsh" },
      shellName: "zsh",
    });
    installRealIPC({ check_prerequisites: handler });

    render(<SystemPanel />);

    await waitFor(() => {
      expect(
        screen.getByText(/npm install -g @anthropic-ai\/claude-code/i),
      ).toBeTruthy();
    });
  });

  // ── gh-Auth/Scope-Preflight (Issue #38) ─────────────────────────────

  /** All prerequisites found — the auth section is what varies per test. */
  const allFoundPrerequisites: IPCHandler = async () => ({
    claude: { found: true, path: "/usr/local/bin/claude" },
    git: { found: true, path: "/usr/bin/git" },
    gh: { found: true, path: "/usr/bin/gh" },
    shell: { found: true, path: "/bin/zsh" },
    shellName: "zsh",
  });

  it("shows account + scopes WITHOUT a fix command when read:project is granted (happy path)", async () => {
    installRealIPC({
      check_prerequisites: allFoundPrerequisites,
      check_gh_auth_status: async () => ({
        loggedIn: true,
        host: "github.com",
        account: "hossoOG",
        scopes: ["gist", "read:org", "read:project", "repo"],
        hasProjectScope: true,
      }),
    });

    render(<SystemPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Angemeldet als hossoOG/)).toBeTruthy();
    });
    expect(screen.getByText(/read:project/)).toBeTruthy();
    // Discriminating: with the scope granted there must be NO remedy UI.
    expect(screen.queryByText(/gh auth refresh/)).toBeNull();
    expect(screen.queryByText("Im Terminal öffnen")).toBeNull();
  });

  it("warns with copyable command + terminal launcher when read:project is missing (edge)", async () => {
    installRealIPC({
      check_prerequisites: allFoundPrerequisites,
      check_gh_auth_status: async () => ({
        loggedIn: true,
        host: "github.com",
        account: "hossoOG",
        scopes: ["gist", "read:org", "repo", "workflow"],
        hasProjectScope: false,
      }),
    });

    render(<SystemPanel />);

    await waitFor(() => {
      expect(
        screen.getByText("gh auth refresh -s read:project,project"),
      ).toBeTruthy();
    });
    expect(screen.getByText("Im Terminal öffnen")).toBeTruthy();
    expect(screen.getByLabelText("Befehl kopieren")).toBeTruthy();
  });

  it("clicking the terminal launcher invokes open_system_terminal with the scope-refresh id", async () => {
    const openCalls: Array<Record<string, unknown>> = [];
    installRealIPC({
      check_prerequisites: allFoundPrerequisites,
      check_gh_auth_status: async () => ({
        loggedIn: true,
        host: "github.com",
        account: "hossoOG",
        scopes: ["repo"],
        hasProjectScope: false,
      }),
      open_system_terminal: async (args) => {
        openCalls.push({ ...args });
        return undefined;
      },
    });

    render(<SystemPanel />);

    await waitFor(() => {
      expect(screen.getByText("Im Terminal öffnen")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Im Terminal öffnen"));

    await waitFor(() => {
      expect(openCalls).toEqual([{ commandId: "gh_refresh_project_scope" }]);
    });
  });

  it("offers gh auth login when not logged in", async () => {
    installRealIPC({
      check_prerequisites: allFoundPrerequisites,
      check_gh_auth_status: async () => ({
        loggedIn: false,
        scopes: [],
        hasProjectScope: false,
      }),
    });

    render(<SystemPanel />);

    await waitFor(() => {
      expect(screen.getByText("Nicht bei GitHub angemeldet")).toBeTruthy();
    });
    expect(screen.getByText("gh auth login")).toBeTruthy();
    expect(screen.getByText("Im Terminal öffnen")).toBeTruthy();
    // No scope warning while logged out — login comes first.
    expect(screen.queryByText(/gh auth refresh/)).toBeNull();
  });

  it("degrades to a hint when the auth check fails and keeps the prerequisite rows (edge)", async () => {
    installRealIPC({
      check_prerequisites: allFoundPrerequisites,
      check_gh_auth_status: async () => {
        throw {
          code: "SERVICE_REQUEST_FAILED",
          message: "gh CLI not found",
          details: "gh_missing",
          retryable: false,
        };
      },
    });

    render(<SystemPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Anmeldestatus nicht prüfbar/)).toBeTruthy();
    });
    // Prerequisite section must survive the failed auth probe.
    expect(screen.getByText("/usr/local/bin/claude")).toBeTruthy();
  });

  // macOS branch of `claudeInstallHint()` has no coverage otherwise: jsdom's UA
  // is never Mac. Stub the UA so the hint takes the macOS path, then restore.
  it("appends the .zprofile hint on macOS", () => {
    const uaSpy = vi
      .spyOn(window.navigator, "userAgent", "get")
      .mockReturnValue(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      );
    try {
      expect(claudeInstallHint()).toContain(".zprofile");
    } finally {
      uaSpy.mockRestore();
    }
  });
});
