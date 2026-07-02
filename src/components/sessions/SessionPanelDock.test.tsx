import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SessionPanelDock } from "./SessionPanelDock";
import { useUIStore } from "../../store/uiStore";
import { useSettingsStore } from "../../store/settingsStore";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

// Mutable auto-update mock state so individual tests can drive status/version.
const autoUpdate = vi.hoisted(() => ({
  status: "idle" as string,
  progress: 0,
  error: null as string | null,
  newVersion: null as string | null,
  lastChecked: null as Date | null,
  checkForUpdate: vi.fn(),
  downloadAndInstall: vi.fn(),
  confirmRelaunch: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("../../hooks/useAutoUpdate", () => ({
  useAutoUpdate: () => autoUpdate,
}));

vi.mock("../shared/NotesPanel", () => ({
  NotesPanel: ({ variant }: { variant?: string }) => (
    <button data-testid="notes-panel" data-variant={variant}>Notizen</button>
  ),
}));

const PREFS_DEFAULT = {
  frontendLogging: false,
  backendFileLogging: false,
  performanceProfiler: false,
  scrollbackLines: 25_000,
};

describe("SessionPanelDock", () => {
  const onNewSession = vi.fn();
  const onAddFavorite = vi.fn();

  function renderDock() {
    return render(
      <SessionPanelDock onNewSession={onNewSession} onAddFavorite={onAddFavorite} />,
    );
  }

  beforeEach(() => {
    // preferences are persisted — reset to deterministic defaults each test.
    useSettingsStore.setState({ preferences: { ...PREFS_DEFAULT } });
    useUIStore.setState({ toasts: [] });
    vi.clearAllMocks();
    autoUpdate.status = "idle";
    autoUpdate.progress = 0;
    autoUpdate.newVersion = null;
    autoUpdate.lastChecked = null;
    // Production code chains `.catch()` on these — they must return promises.
    autoUpdate.checkForUpdate.mockResolvedValue(undefined);
    autoUpdate.downloadAndInstall.mockResolvedValue(undefined);
    autoUpdate.confirmRelaunch.mockResolvedValue(undefined);
  });

  // ── Launchers ──────────────────────────────────────────────────────────

  it("renders the detached-window launchers with German labels", () => {
    renderDock();
    expect(screen.getByLabelText("Kanban")).toBeTruthy();
    expect(screen.getByLabelText("Bibliothek")).toBeTruthy();
    expect(screen.getByLabelText("Editor")).toBeTruthy();
    expect(screen.getByLabelText("Einstellungen")).toBeTruthy();
    // The Sessions switcher is gone — the main window is always Sessions.
    expect(screen.queryByLabelText("Sitzungen")).toBeNull();
    // Protokolle is hidden by default — opt-in via Einstellungen.
    expect(screen.queryByLabelText("Protokolle")).toBeNull();
  });

  it("shows the Protokolle launcher when frontendLogging is on", () => {
    useSettingsStore.setState({ preferences: { ...PREFS_DEFAULT, frontendLogging: true } });
    renderDock();
    expect(screen.getByLabelText("Protokolle")).toBeTruthy();
  });

  it("shows the Protokolle launcher when backendFileLogging is on", () => {
    useSettingsStore.setState({ preferences: { ...PREFS_DEFAULT, backendFileLogging: true } });
    renderDock();
    expect(screen.getByLabelText("Protokolle")).toBeTruthy();
  });

  it("opens a detached window when a launcher is clicked", () => {
    invokeMock.mockResolvedValue(undefined);
    renderDock();
    fireEvent.click(screen.getByLabelText("Einstellungen"));
    expect(invokeMock).toHaveBeenCalledWith("open_detached_window", {
      view: "settings",
      title: "Einstellungen",
    });
  });

  it("opens the editor in a detached window with the correct view+title", () => {
    invokeMock.mockResolvedValue(undefined);
    renderDock();
    fireEvent.click(screen.getByLabelText("Editor"));
    expect(invokeMock).toHaveBeenCalledWith("open_detached_window", {
      view: "editor",
      title: "Editor",
    });
  });

  // ── Session actions (props) ────────────────────────────────────────────

  it("calls onNewSession when the new-session button is clicked", () => {
    renderDock();
    fireEvent.click(screen.getByLabelText("Neue Session starten"));
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });

  it("calls onAddFavorite when the add-favorite button is clicked", () => {
    renderDock();
    fireEvent.click(screen.getByLabelText("Ordner als Favorit hinzufügen"));
    expect(onAddFavorite).toHaveBeenCalledTimes(1);
  });

  // ── Theme + Notes ──────────────────────────────────────────────────────

  it("renders the notes panel in dock variant", () => {
    renderDock();
    expect(screen.getByTestId("notes-panel").dataset.variant).toBe("dock");
  });

  it("toggles theme from dark to light via the theme button", () => {
    useSettingsStore.setState((s) => ({ theme: { ...s.theme, mode: "dark" } }));
    renderDock();
    fireEvent.click(screen.getByLabelText("Light Mode aktivieren"));
    expect(useSettingsStore.getState().theme.mode).toBe("light");
  });

  it("toggles theme from light to dark via the theme button", () => {
    useSettingsStore.setState((s) => ({ theme: { ...s.theme, mode: "light" } }));
    renderDock();
    fireEvent.click(screen.getByLabelText("Dark Mode aktivieren"));
    expect(useSettingsStore.getState().theme.mode).toBe("dark");
  });

  // ── Updater (protected path — migrated 1:1 from SideNav) ────────────────

  // Version-Pill ueber den Accessible Name greifen — das fruehere title-
  // Attribut ist durch die Tooltip-Komponente ersetzt (Hover-Test unten).
  const versionPill = () => screen.getByRole("button", { name: /v\d+\.\d+\.\d+/ });

  it("renders the version badge", () => {
    renderDock();
    expect(versionPill()).toBeTruthy();
  });

  it("zeigt beim Hover den Version-Tooltip mit Update-Wortlaut", async () => {
    autoUpdate.status = "available";
    autoUpdate.newVersion = "2.0.0";
    renderDock();
    fireEvent.mouseEnter(versionPill().parentElement!);
    await waitFor(() => {
      expect(screen.getByRole("tooltip").textContent).toMatch(
        /Update v2\.0\.0 verfügbar — Klick: Installieren/,
      );
    });
  });

  it("triggers an update-check and shows a search toast on version click (idle)", () => {
    renderDock();
    fireEvent.click(versionPill());
    expect(autoUpdate.checkForUpdate).toHaveBeenCalledTimes(1);
    const titles = useUIStore.getState().toasts.map((t) => t.title);
    expect(titles).toContain("Suche nach Updates...");
  });

  it("shows an install toast and status dot when an update is available", async () => {
    autoUpdate.status = "available";
    autoUpdate.newVersion = "9.9.9";
    renderDock();
    await waitFor(() => {
      const titles = useUIStore.getState().toasts.map((t) => t.title);
      expect(titles).toContain("Update v9.9.9 verfügbar");
    });
    expect(screen.getByLabelText("Update verfügbar")).toBeTruthy();
  });

  it("shows a restart toast and ready dot when an update is ready", async () => {
    autoUpdate.status = "ready";
    renderDock();
    await waitFor(() => {
      const titles = useUIStore.getState().toasts.map((t) => t.title);
      expect(titles).toContain("Update bereit");
    });
    expect(screen.getByLabelText("Update installationsbereit")).toBeTruthy();
  });

  it("re-shows the install toast on version click when update already available", () => {
    autoUpdate.status = "available";
    autoUpdate.newVersion = "2.0.0";
    renderDock();
    // Clear the auto-fired transition toast, then click to re-show it.
    act(() => useUIStore.setState({ toasts: [] }));
    fireEvent.click(versionPill());
    const titles = useUIStore.getState().toasts.map((t) => t.title);
    expect(titles).toContain("Update v2.0.0 verfügbar");
    expect(autoUpdate.checkForUpdate).not.toHaveBeenCalled();
  });

  it("does NOT re-check on version click while a download is in flight", () => {
    autoUpdate.status = "downloading";
    autoUpdate.progress = 30;
    autoUpdate.newVersion = "3.0.0";
    renderDock();
    // Clear the auto-fired progress toast, then click the version pill.
    act(() => useUIStore.setState({ toasts: [] }));
    fireEvent.click(versionPill());
    // No stray concurrent re-check while the download runs.
    expect(autoUpdate.checkForUpdate).not.toHaveBeenCalled();
    const titles = useUIStore.getState().toasts.map((t) => t.title);
    expect(titles).toContain("Update wird geladen");
    expect(titles).not.toContain("Suche nach Updates...");
  });

  it("shows an error toast when the update-check fails", async () => {
    autoUpdate.status = "error";
    renderDock();
    await waitFor(() => {
      const titles = useUIStore.getState().toasts.map((t) => t.title);
      expect(titles).toContain("Update-Check fehlgeschlagen");
    });
  });

  it("shows a live progress toast during download, then swaps to the restart toast", async () => {
    autoUpdate.status = "downloading";
    autoUpdate.progress = 0;
    autoUpdate.newVersion = "1.6.36";
    const { rerender } = renderDock();

    // Progress toast appears with a progress field (the bar) at 0.
    await waitFor(() => {
      const dl = useUIStore.getState().toasts.find((t) => t.title === "Update wird geladen");
      expect(dl).toBeTruthy();
      expect(dl!.progress).toBe(0);
    });

    // Progress updates IN PLACE (same toast, not a new one).
    autoUpdate.progress = 60;
    rerender(<SessionPanelDock onNewSession={onNewSession} onAddFavorite={onAddFavorite} />);
    await waitFor(() => {
      const dls = useUIStore.getState().toasts.filter((t) => t.title === "Update wird geladen");
      expect(dls).toHaveLength(1);
      expect(dls[0].progress).toBe(60);
    });

    // Ready → progress toast removed, restart toast shown.
    autoUpdate.status = "ready";
    rerender(<SessionPanelDock onNewSession={onNewSession} onAddFavorite={onAddFavorite} />);
    await waitFor(() => {
      const titles = useUIStore.getState().toasts.map((t) => t.title);
      expect(titles).not.toContain("Update wird geladen");
      expect(titles).toContain("Update bereit");
    });
  });

  it("still shows the restart toast if the progress toast was dismissed mid-download", async () => {
    autoUpdate.status = "downloading";
    autoUpdate.progress = 10;
    autoUpdate.newVersion = "1.6.36";
    const { rerender } = renderDock();
    await waitFor(() =>
      expect(
        useUIStore.getState().toasts.find((t) => t.title === "Update wird geladen"),
      ).toBeTruthy(),
    );

    // User dismisses the progress toast mid-download.
    act(() => useUIStore.setState({ toasts: [] }));

    // Download finishes → ready. removeToast on the now-gone id is a no-op,
    // and the restart toast still appears.
    autoUpdate.status = "ready";
    rerender(<SessionPanelDock onNewSession={onNewSession} onAddFavorite={onAddFavorite} />);
    await waitFor(() => {
      expect(useUIStore.getState().toasts.map((t) => t.title)).toContain("Update bereit");
    });
  });
});
