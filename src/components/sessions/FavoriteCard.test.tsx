import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FavoriteCard } from "./FavoriteCard";
import { useUIStore } from "../../store/uiStore";
import { useSessionStore } from "../../store/sessionStore";
import { useSettingsStore } from "../../store/settingsStore";
import { invoke } from "@tauri-apps/api/core";
import type { FavoriteFolder } from "../../store/settingsStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const mockInvoke = vi.mocked(invoke);

function makeFavorite(overrides: Partial<FavoriteFolder> = {}): FavoriteFolder {
  return {
    id: "fav-1",
    path: "C:/Projects/my-project",
    label: "My Project",
    shell: "powershell",
    addedAt: Date.now(),
    lastUsedAt: Date.now(),
    groupId: null,
    sortIndex: 0,
    ...overrides,
  };
}

function renderCard(overrides: Partial<FavoriteFolder> = {}) {
  return render(
    <FavoriteCard favorite={makeFavorite(overrides)} onStart={vi.fn()} onRemove={vi.fn()} />,
  );
}

describe("FavoriteCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ previewFolder: null });
    useSessionStore.setState({ sessions: [] });
  });

  it("renders a project color dot and the label", () => {
    renderCard({ label: "zovel", path: "C:/Projects/zovel" });
    expect(screen.getByText("zovel")).toBeInTheDocument();
    expect(screen.getByTestId("fav-dot")).toBeInTheDocument();
  });

  it("hides the action buttons until the row is hovered", () => {
    renderCard({ label: "zovel", path: "C:/Projects/zovel" });
    const folderBtn = screen.getByRole("button", { name: "Ordner im Explorer öffnen" });
    expect(folderBtn.closest("[data-actions]")).toHaveClass("hidden");
  });

  it("renders favorite label + exposes full path via title for hover tooltip", () => {
    const { container } = render(
      <FavoriteCard favorite={makeFavorite()} onStart={vi.fn()} onRemove={vi.fn()} />,
    );

    expect(screen.getByText("My Project")).toBeTruthy();
    expect(container.querySelector('[title="C:/Projects/my-project"]')).not.toBeNull();
  });

  it("calls onStart when play button is clicked", () => {
    const onStart = vi.fn();
    render(
      <FavoriteCard favorite={makeFavorite()} onStart={onStart} onRemove={vi.fn()} />,
    );

    fireEvent.click(screen.getByLabelText("Session starten"));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("calls onRemove when remove button is clicked", () => {
    const onRemove = vi.fn();
    render(
      <FavoriteCard favorite={makeFavorite()} onStart={vi.fn()} onRemove={onRemove} />,
    );

    fireEvent.click(screen.getByLabelText("Favorit entfernen"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("invokes open_folder_in_explorer on folder button click", () => {
    const fav = makeFavorite({ path: "/test/path" });
    render(
      <FavoriteCard favorite={fav} onStart={vi.fn()} onRemove={vi.fn()} />,
    );

    fireEvent.click(screen.getByLabelText("Ordner im Explorer öffnen"));
    expect(mockInvoke).toHaveBeenCalledWith("open_folder_in_explorer", { path: "/test/path" });
  });

  it("invokes open_terminal_in_folder on terminal button click", () => {
    const fav = makeFavorite({ path: "/test/path" });
    render(
      <FavoriteCard favorite={fav} onStart={vi.fn()} onRemove={vi.fn()} />,
    );

    fireEvent.click(screen.getByLabelText("Terminal im Ordner öffnen"));
    expect(mockInvoke).toHaveBeenCalledWith("open_terminal_in_folder", { path: "/test/path" });
  });

  it("opens preview in uiStore when card is clicked", () => {
    const fav = makeFavorite({ path: "/preview/folder" });
    render(
      <FavoriteCard favorite={fav} onStart={vi.fn()} onRemove={vi.fn()} />,
    );

    // Click the card body (not an action button)
    fireEvent.click(screen.getByText("My Project"));
    // openPreview sets previewFolder in uiStore (propagation from label click to card)
    // The card onClick calls openPreview(favorite.path)
    expect(useUIStore.getState().previewFolder).toBe("/preview/folder");
  });

  it("dot pulses when the folder has a live (running) session", () => {
    useSessionStore.getState().addSession({ id: "s1", title: "s", folder: "C:/Projects/zovel", shell: "powershell" });
    // addSession sets status 'starting' → live
    renderCard({ label: "zovel", path: "C:/Projects/zovel" });
    expect(screen.getByTestId("fav-dot").className).toContain("animate-pulse");
  });

  it("dot does NOT pulse when the folder's sessions are all finished", () => {
    useSessionStore.getState().addSession({ id: "s2", title: "s", folder: "C:/Projects/zovel", shell: "powershell" });
    useSessionStore.getState().updateStatus("s2", "done");
    renderCard({ label: "zovel", path: "C:/Projects/zovel" });
    expect(screen.getByTestId("fav-dot").className).not.toContain("animate-pulse");
  });

  describe("accent context menu (per-project color)", () => {
    beforeEach(() => {
      useSettingsStore.setState({ folderAccents: {} });
    });

    it("opens the accent menu on right-click", () => {
      renderCard({ label: "zovel", path: "C:/Projects/zovel" });
      fireEvent.contextMenu(screen.getByText("zovel"));
      expect(screen.getByRole("menu", { name: "Akzentfarbe wählen" })).toBeInTheDocument();
    });

    it("suppresses the native menu via preventDefault", () => {
      renderCard({ label: "zovel", path: "C:/Projects/zovel" });
      const evt = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      const spy = vi.spyOn(evt, "preventDefault");
      screen.getByText("zovel").dispatchEvent(evt);
      expect(spy).toHaveBeenCalled();
    });

    it("writes a per-folder accent override keyed by the favorite path", () => {
      renderCard({ label: "zovel", path: "C:/Projects/zovel" });
      fireEvent.contextMenu(screen.getByText("zovel"));
      fireEvent.click(screen.getByRole("button", { name: "rose" }));
      expect(useSettingsStore.getState().folderAccents["C:/Projects/zovel"]).toBe("rose");
    });
  });
});
