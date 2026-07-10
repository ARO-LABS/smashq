/**
 * Layer-B integration test for SystemPanel (Issue #10).
 *
 * Real IPC via Tauri's official `mockIPC` (never `vi.mock` on core). The panel
 * invokes `check_prerequisites` on mount; the handler returns a canned
 * PrerequisiteStatus and the panel must render found/missing rows + the
 * platform fix command when a tool is absent.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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
