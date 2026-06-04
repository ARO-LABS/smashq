import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FavoritesList } from "./FavoritesList";
import { useSettingsStore } from "../../store/settingsStore";
import type { FavoriteFolder } from "../../store/settingsStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

// Stub the DnD hook so DndContext receives valid sensor descriptors.
// useSensors() returns an empty array — DndContext handles [] gracefully.
vi.mock("./hooks/useSidebarDnd", () => ({
  useSidebarDnd: () => ({ sensors: [], handleDragEnd: vi.fn() }),
}));

function makeFavorite(overrides: Partial<FavoriteFolder> = {}): FavoriteFolder {
  return {
    id: "fav-1",
    path: "C:/Projects/test",
    label: "Test Project",
    shell: "powershell",
    addedAt: Date.now(),
    lastUsedAt: Date.now(),
    groupId: null,
    sortIndex: 0,
    ...overrides,
  };
}

describe("FavoritesList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ favorites: [], favoriteGroups: [] });
  });

  it("renders empty state text when no favorites and no groups", () => {
    render(<FavoritesList onQuickStart={vi.fn()} />);
    expect(screen.getByText("Ordner hinzufügen für Schnellstart")).toBeTruthy();
  });

  it("no longer renders the FAVORITEN / UNGRUPPIERT section headers", () => {
    render(<FavoritesList onQuickStart={vi.fn()} />);
    expect(screen.queryByText("Favoriten")).toBeNull();
    expect(screen.queryByText("UNGRUPPIERT")).toBeNull();
  });

  it("renders favorite cards when favorites exist", () => {
    useSettingsStore.setState({
      favorites: [
        makeFavorite({ id: "f1", label: "Project A", sortIndex: 0 }),
        makeFavorite({ id: "f2", label: "Project B", sortIndex: 1 }),
      ],
    });

    render(<FavoritesList onQuickStart={vi.fn()} />);
    expect(screen.getByText("Project A")).toBeTruthy();
    expect(screen.getByText("Project B")).toBeTruthy();
  });

  it("renders favorites in sortIndex order (not lastUsedAt)", () => {
    useSettingsStore.setState({
      favorites: [
        makeFavorite({ id: "f1", label: "First", sortIndex: 0, lastUsedAt: 100 }),
        makeFavorite({ id: "f2", label: "Second", sortIndex: 1, lastUsedAt: 200 }),
      ],
    });

    const { container } = render(<FavoritesList onQuickStart={vi.fn()} />);
    // First should appear before Second in DOM order (sortIndex wins, not lastUsedAt)
    const labels = container.querySelectorAll(".font-medium");
    const texts = Array.from(labels).map((el) => el.textContent);
    expect(texts.indexOf("First")).toBeLessThan(texts.indexOf("Second"));
  });

  it("does not show empty state when favorites exist", () => {
    useSettingsStore.setState({
      favorites: [makeFavorite()],
    });

    render(<FavoritesList onQuickStart={vi.fn()} />);
    expect(screen.queryByText("Ordner hinzufügen für Schnellstart")).toBeNull();
  });

  it("does not show empty state when groups exist", () => {
    useSettingsStore.setState({
      favoriteGroups: [{ id: "g1", label: "Work", sortIndex: 0 }],
    });

    render(<FavoritesList onQuickStart={vi.fn()} />);
    expect(screen.queryByText("Ordner hinzufügen für Schnellstart")).toBeNull();
  });
});

describe("FavoritesList with groups + DnD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ favorites: [], favoriteGroups: [] });
  });

  it("renders ungrouped favorites without an 'UNGRUPPIERT' header when no groups exist", () => {
    useSettingsStore.setState({
      favorites: [
        { id: "f1", path: "/f1", label: "F1", shell: "powershell",
          addedAt: 1, lastUsedAt: 1, groupId: null, sortIndex: 0 },
      ],
    });
    render(<FavoritesList onQuickStart={() => {}} />);
    expect(screen.queryByText("UNGRUPPIERT")).toBeNull();
    expect(screen.getByText("F1")).toBeInTheDocument();
  });

  it("renders ungrouped + grouped favorites without any UNGRUPPIERT header", () => {
    useSettingsStore.setState({
      favoriteGroups: [{ id: "g1", label: "Arbeit", sortIndex: 0 }],
      favorites: [
        { id: "f1", path: "/f1", label: "F1", shell: "powershell",
          addedAt: 1, lastUsedAt: 1, groupId: "g1", sortIndex: 0 },
        { id: "f2", path: "/f2", label: "F2", shell: "powershell",
          addedAt: 2, lastUsedAt: 2, groupId: null, sortIndex: 0 },
      ],
    });
    render(<FavoritesList onQuickStart={() => {}} />);
    expect(screen.queryByText("UNGRUPPIERT")).toBeNull();
    expect(screen.getByText("F1")).toBeInTheDocument();
    expect(screen.getByText("F2")).toBeInTheDocument();
  });

  it("creates a new group via the inline input", () => {
    render(<FavoritesList onQuickStart={() => {}} />);
    fireEvent.click(screen.getByLabelText("Neue Gruppe erstellen"));
    const input = screen.getByPlaceholderText("Gruppen-Name…");
    fireEvent.change(input, { target: { value: "Fun" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useSettingsStore.getState().favoriteGroups[0].label).toBe("Fun");
  });

  it("clears the inline input and hides it on Escape", () => {
    render(<FavoritesList onQuickStart={() => {}} />);
    fireEvent.click(screen.getByLabelText("Neue Gruppe erstellen"));
    const input = screen.getByPlaceholderText("Gruppen-Name…");
    fireEvent.change(input, { target: { value: "Draft" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Gruppen-Name…")).toBeNull();
    expect(useSettingsStore.getState().favoriteGroups).toHaveLength(0);
  });

  it("opens cascade modal when group delete is requested", () => {
    useSettingsStore.setState({
      favoriteGroups: [{ id: "g1", label: "Arbeit", sortIndex: 0 }],
      favorites: [{ id: "f1", path: "/f1", label: "F1", shell: "powershell",
                     addedAt: 1, lastUsedAt: 1, groupId: "g1", sortIndex: 0 }],
    });
    render(<FavoritesList onQuickStart={() => {}} />);
    fireEvent.click(screen.getByLabelText("Gruppe löschen"));
    expect(screen.getByText(/Favoriten behalten/)).toBeInTheDocument();
    expect(screen.getByText(/alle Favoriten löschen/i)).toBeInTheDocument();
  });

  it("cascade=unassign moves favorites to ungrouped", () => {
    useSettingsStore.setState({
      favoriteGroups: [{ id: "g1", label: "Arbeit", sortIndex: 0 }],
      favorites: [{ id: "f1", path: "/f1", label: "F1", shell: "powershell",
                     addedAt: 1, lastUsedAt: 1, groupId: "g1", sortIndex: 0 }],
    });
    render(<FavoritesList onQuickStart={() => {}} />);
    fireEvent.click(screen.getByLabelText("Gruppe löschen"));
    fireEvent.click(screen.getByText(/Favoriten behalten/));
    const st = useSettingsStore.getState();
    expect(st.favoriteGroups).toHaveLength(0);
    expect(st.favorites[0].groupId).toBe(null);
  });

  it("cascade=delete removes group and its favorites", () => {
    useSettingsStore.setState({
      favoriteGroups: [{ id: "g1", label: "Arbeit", sortIndex: 0 }],
      favorites: [{ id: "f1", path: "/f1", label: "F1", shell: "powershell",
                     addedAt: 1, lastUsedAt: 1, groupId: "g1", sortIndex: 0 }],
    });
    render(<FavoritesList onQuickStart={() => {}} />);
    fireEvent.click(screen.getByLabelText("Gruppe löschen"));
    fireEvent.click(screen.getByText(/alle Favoriten löschen/i));
    const st = useSettingsStore.getState();
    expect(st.favoriteGroups).toHaveLength(0);
    expect(st.favorites).toHaveLength(0);
  });
});
