import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() =>
    Promise.resolve({
      sessionId: "session-routed",
      snapshotCommit: "abc",
      snapshotAt: "2026-05-12T14:02:00Z",
      computedAt: "2026-05-12T14:05:00Z",
      computeMs: 1,
      files: [],
      truncated: false,
    }),
  ),
}));

// CodeMirror DOM-measuring is brittle in jsdom — stub out the merge view
// for routing tests, same approach as DiffWindowView.test.
vi.mock("./components/diff/DiffMergeView", () => ({
  DiffMergeView: () => <div data-testid="diff-merge-stub" />,
}));

import DiffWindowApp from "./DiffWindowApp";

/**
 * Tests the URL-routing-pivot contract: DiffWindowApp must mount the
 * DiffWindowView with the sessionId pulled from the query string. This mirrors
 * the branch in `main.tsx` that flips between the main app, log viewer, and
 * diff window based on `?view=...` — keeping the test at the wrapper level
 * isolates the routing concern without booting the full App shell.
 */
describe("DiffWindowApp (?view=diff routing)", () => {
  it("renders DiffWindowView with the passed sessionId and triggers get_session_diff", async () => {
    render(<DiffWindowApp sessionId="session-routed" />);
    await waitFor(() => {
      expect(screen.getByText(/Session-Diff/i)).toBeTruthy();
    });
    // Empty-files state confirms the view actually rendered with our mocked diff.
    expect(screen.getByText(/Keine Aenderungen seit Session-Start/i)).toBeTruthy();
  });

  it("renders missing-id error when sessionId is null", async () => {
    render(<DiffWindowApp sessionId={null} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Session-ID");
  });
});
