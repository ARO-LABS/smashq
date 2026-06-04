import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./AppShell";
import { useUIStore } from "../../store/uiStore";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../sessions/SessionManagerView", () => ({
  SessionManagerView: () => <div data-testid="session-manager" />,
}));

// ── Tests ─────────────────────────────────────────────────────────────

describe("AppShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ toasts: [] });
  });

  it("renders the SessionManagerView as the single main view", () => {
    render(<AppShell />);
    expect(screen.getByTestId("session-manager")).toBeTruthy();
  });

  it("has flex layout with full screen dimensions", () => {
    const { container } = render(<AppShell />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("flex");
    expect(root.className).toContain("h-screen");
    expect(root.className).toContain("w-screen");
  });

  // Regression guard: ToastContainer must be mounted at App level so that
  // addToast() calls from anywhere in the tree become visible. Previously
  // the container existed but was never mounted → updater/settings toasts
  // silently dropped. This test must never be skipped or deleted — only extended.
  it("mounts ToastContainer so addToast renders a visible toast", async () => {
    render(<AppShell />);
    useUIStore.getState().addToast({
      type: "info",
      title: "Update v9.9.9 verfügbar",
      duration: 0,
    });
    expect(await screen.findByText("Update v9.9.9 verfügbar")).toBeTruthy();
  });
});
