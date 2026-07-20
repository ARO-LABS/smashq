/**
 * Unit tests for OpenInTerminalButton (Issue #38).
 *
 * Security contract under test: the component sends ONLY the closed
 * discriminator (`commandId`) over IPC — never a command string. The Rust
 * backend maps the id onto fixed literals (allowlist in `github/auth.rs`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OpenInTerminalButton } from "./OpenInTerminalButton";
import { invoke } from "@tauri-apps/api/core";
import { logError } from "../../utils/errorLogger";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../utils/errorLogger", () => ({
  logError: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

describe("OpenInTerminalButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invokes open_system_terminal with exactly the given discriminator (happy path)", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    render(<OpenInTerminalButton commandId="gh_login" />);

    fireEvent.click(screen.getByText("Im Terminal öffnen"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("open_system_terminal", {
        commandId: "gh_login",
      });
    });
    // Discriminating anchor: no free-form command string may cross the
    // IPC boundary — only the allowlist id.
    const [, args] = mockInvoke.mock.calls[0];
    expect(Object.keys(args as Record<string, unknown>)).toEqual(["commandId"]);
  });

  it("logs a rejected invoke and re-enables the button (edge: backend failure)", async () => {
    mockInvoke.mockRejectedValueOnce({
      code: "COMMAND_EXECUTION_FAILED",
      message: "Failed to open terminal",
      retryable: false,
    });
    render(<OpenInTerminalButton commandId="gh_refresh_project_scope" />);

    const button = screen.getByText("Im Terminal öffnen").closest("button");
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLButtonElement);

    await waitFor(() => {
      expect(logError).toHaveBeenCalledWith(
        "OpenInTerminalButton.open",
        expect.anything()
      );
    });
    // The failure path must not leave the button stuck in disabled state —
    // the user needs to retry after fixing the environment.
    await waitFor(() => {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
