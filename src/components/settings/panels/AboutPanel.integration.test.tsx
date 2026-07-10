/**
 * Layer-B integration test for AboutPanel.
 *
 * Real IPC via mockIPC (never vi.mock on core). The panel reads the app version
 * (plugin:app|version), the platform (get_os_info) and opens external URLs
 * (plugin:shell|open). Build constants come from vitest.config.integration.ts's
 * `define` (__GIT_HASH__="test", __BUILD_DATE__="2026-01-01T00:00").
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { AboutPanel } from "./AboutPanel";
import { installRealIPC, clearTauriIPC } from "../../../test/mockTauriIPC";

afterEach(() => {
  clearTauriIPC();
  vi.restoreAllMocks();
});

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

const baseHandlers = {
  "plugin:app|version": async () => "9.9.9",
  get_os_info: async () => ({ os: "macOS", arch: "arm64" }),
};

describe("AboutPanel — Layer-B", () => {
  it("renders version, commit, build date and platform", async () => {
    installRealIPC({ ...baseHandlers });

    render(<AboutPanel />);

    await waitFor(() => expect(screen.getByText("9.9.9")).toBeTruthy());
    expect(screen.getByText("test")).toBeTruthy(); // __GIT_HASH__
    expect(screen.getByText("2026-01-01 00:00")).toBeTruthy(); // __BUILD_DATE__ (T→space)
    await waitFor(() => expect(screen.getByText("macOS · arm64")).toBeTruthy());
  });

  it("copies a diagnostics block to the clipboard", async () => {
    const writeText = stubClipboard();
    installRealIPC({ ...baseHandlers });

    render(<AboutPanel />);
    await waitFor(() => expect(screen.getByText("macOS · arm64")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Diagnose kopieren/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("Smashq v9.9.9");
    expect(copied).toContain("Commit: test");
    expect(copied).toContain("Plattform: macOS · arm64");
  });

  it("opens the issues URL when 'Problem melden' is clicked", async () => {
    const openCalls: string[] = [];
    installRealIPC({
      ...baseHandlers,
      "plugin:shell|open": async (args) => {
        openCalls.push(String(args.path));
        return null;
      },
    });

    render(<AboutPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Problem melden/i }));

    await waitFor(() =>
      expect(openCalls).toContain("https://github.com/ARO-LABS/smashq/issues"),
    );
  });

  it("opens the commit URL when the commit hash is clicked", async () => {
    const openCalls: string[] = [];
    installRealIPC({
      ...baseHandlers,
      "plugin:shell|open": async (args) => {
        openCalls.push(String(args.path));
        return null;
      },
    });

    render(<AboutPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "test" }));

    await waitFor(() =>
      expect(openCalls).toContain("https://github.com/ARO-LABS/smashq/commit/test"),
    );
  });

  it("falls back to 'unbekannt' when get_os_info fails", async () => {
    installRealIPC({
      "plugin:app|version": async () => "9.9.9",
      get_os_info: async () => {
        throw new Error("no backend");
      },
    });

    render(<AboutPanel />);
    await waitFor(() => expect(screen.getByText("9.9.9")).toBeTruthy());
    expect(screen.getByText("unbekannt")).toBeTruthy();
  });
});
