/**
 * Unit tests for CopyableCommand (extracted shared snippet UI, Issue #38).
 *
 * The reset timer (check icon -> copy icon after 2s) must not outlive the
 * component: an unmount before the 2s elapse would otherwise fire setState
 * on an unmounted component (PR-#47-Review, Backlog-Item (a) Timer-Cleanup).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CopyableCommand } from "./CopyableCommand";

describe("CopyableCommand", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("copies the command, shows the check icon and reverts after 2s (happy path)", async () => {
    const { container } = render(<CopyableCommand command="gh auth login" />);

    fireEvent.click(screen.getByRole("button", { name: "Befehl kopieren" }));
    // Flush the clipboard promise microtask so setCopied(true) lands.
    await act(async () => {});

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("gh auth login");
    expect(container.querySelector(".text-success")).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(container.querySelector(".text-success")).toBeNull();
  });

  it("clears the pending reset timer on unmount (edge: no orphaned setState)", async () => {
    const setSpy = vi.spyOn(window, "setTimeout");
    const { unmount } = render(<CopyableCommand command="gh auth login" />);

    fireEvent.click(screen.getByRole("button", { name: "Befehl kopieren" }));
    await act(async () => {});

    const timerId = setSpy.mock.results.at(-1)?.value as number;
    expect(timerId).toBeDefined();

    const clearSpy = vi.spyOn(window, "clearTimeout");
    unmount();
    // The cleanup must cancel exactly the pending reset timer.
    expect(clearSpy).toHaveBeenCalledWith(timerId);
  });
});
