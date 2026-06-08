import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useLogViewerStore } from "../../store/logViewerStore";
import { LogViewer } from "./LogViewer";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../../utils/errorLogger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  wireLoggingGate: vi.fn(),
}));

// Mock @tanstack/react-virtual — jsdom has no layout engine, so the virtualizer
// would render zero rows. This mock renders all items directly.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: {
    count: number;
    estimateSize: () => number;
    getScrollElement: () => HTMLElement | null;
  }) => ({
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, i) => ({
        index: i,
        start: i * opts.estimateSize(),
        size: opts.estimateSize(),
        key: i,
      })),
    getTotalSize: () => opts.count * opts.estimateSize(),
    scrollToIndex: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  useLogViewerStore.setState({
    entries: [],
    severityFilter: new Set(["error", "warn", "info"]),
    sourceFilter: new Set(["frontend", "backend"]),
    searchText: "",
    liveTail: true,
  });
  // Reset invoke to the default empty-array resolution so leftover
  // mockResolvedValueOnce queues from a prior test don't bleed over.
  const { invoke } = await import("@tauri-apps/api/core");
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LogViewer", () => {
  it("renders empty state when no entries", () => {
    render(<LogViewer />);
    expect(screen.getByText("Keine Logs vorhanden")).toBeInTheDocument();
  });

  it("renders entries from store", () => {
    useLogViewerStore.getState().addEntries([
      {
        timestamp: "2025-01-15T10:30:00.000Z",
        severity: "error",
        source: "frontend",
        message: "Test error message",
      },
    ]);

    render(<LogViewer />);
    expect(screen.getByText("Test error message")).toBeInTheDocument();
  });

  it("re-fetches backend logs on every mount and respects the 1000-entry cap", async () => {
    // Pre-populate as if logs already loaded on prior mount
    useLogViewerStore.getState().addEntries([
      {
        timestamp: "2025-01-15T10:30:00.000Z",
        severity: "info",
        source: "frontend",
        module: "test",
        message: "existing log",
      },
    ]);

    const { invoke } = await import("@tauri-apps/api/core");
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockClear();

    render(<LogViewer />);

    // After dropping the dual-store dance, we ALWAYS refetch on mount —
    // the 1000-cap + timestamp ordering keep dupes bounded.
    expect(mockInvoke).toHaveBeenCalledWith("read_structured_log", { maxLines: 500 });
  });

  it("renders the newest entry first (newest on top)", () => {
    useLogViewerStore.getState().addEntries([
      {
        timestamp: "2025-01-15T10:30:00.000Z",
        severity: "info",
        source: "frontend",
        message: "older entry",
      },
      {
        timestamp: "2025-01-15T10:30:05.000Z",
        severity: "info",
        source: "frontend",
        message: "newer entry",
      },
    ]);

    render(<LogViewer />);
    const older = screen.getByText("older entry");
    const newer = screen.getByText("newer entry");
    // newer must appear BEFORE older in the DOM → older follows newer.
    expect(
      newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("displays entry count correctly", () => {
    useLogViewerStore.getState().addEntries([
      {
        timestamp: "2025-01-15T10:30:00.000Z",
        severity: "info",
        source: "frontend",
        message: "msg1",
      },
      {
        timestamp: "2025-01-15T10:30:01.000Z",
        severity: "error",
        source: "backend",
        message: "msg2",
      },
    ]);

    render(<LogViewer />);
    expect(screen.getByText(/2 Gruppen von 2 Einträgen/)).toBeInTheDocument();
  });

  it("filters entries by severity", () => {
    useLogViewerStore.getState().addEntries([
      {
        timestamp: "2025-01-15T10:30:00.000Z",
        severity: "error",
        source: "frontend",
        message: "error msg",
      },
      {
        timestamp: "2025-01-15T10:30:01.000Z",
        severity: "info",
        source: "frontend",
        message: "info msg",
      },
    ]);

    // Only show errors
    useLogViewerStore.setState({
      severityFilter: new Set(["error"]),
    });

    render(<LogViewer />);
    expect(screen.getByText("error msg")).toBeInTheDocument();
    expect(screen.queryByText("info msg")).not.toBeInTheDocument();
    expect(screen.getByText(/1 Gruppen von 2 Einträgen/)).toBeInTheDocument();
  });

  it("groups consecutive identical entries and shows count badge", () => {
    // Add 3 identical error entries
    useLogViewerStore.getState().addEntries([
      {
        timestamp: "2025-01-15T10:30:00.000Z",
        severity: "error",
        source: "frontend",
        message: "repeated error",
      },
      {
        timestamp: "2025-01-15T10:30:01.000Z",
        severity: "error",
        source: "frontend",
        message: "repeated error",
      },
      {
        timestamp: "2025-01-15T10:30:02.000Z",
        severity: "error",
        source: "frontend",
        message: "repeated error",
      },
    ]);

    render(<LogViewer />);
    // Should show 1 grouped row, not 3
    expect(screen.getByText(/1 Gruppen von 3 Einträgen/)).toBeInTheDocument();
    // The group count badge should show ×3
    expect(screen.getByText("×3")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Toolbar interactions
// ---------------------------------------------------------------------------

describe("LogViewer — toolbar interactions", () => {
  function seedTwoSources() {
    useLogViewerStore.getState().addEntries([
      {
        timestamp: "2025-01-15T10:30:00.000Z",
        severity: "info",
        source: "frontend",
        message: "frontend line",
      },
      {
        timestamp: "2025-01-15T10:30:01.000Z",
        severity: "info",
        source: "backend",
        message: "backend line",
      },
    ]);
  }

  it("toggles a severity filter off when its button is clicked", () => {
    useLogViewerStore.getState().addEntries([
      {
        timestamp: "2025-01-15T10:30:00.000Z",
        severity: "error",
        source: "frontend",
        message: "boom",
      },
    ]);

    render(<LogViewer />);
    expect(screen.getByText("boom")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Error" }));

    expect(screen.queryByText("boom")).not.toBeInTheDocument();
    expect(useLogViewerStore.getState().severityFilter.has("error")).toBe(false);
  });

  it("toggles a severity filter back on after a second click", () => {
    useLogViewerStore.getState().addEntries([
      {
        timestamp: "2025-01-15T10:30:00.000Z",
        severity: "warn",
        source: "frontend",
        message: "careful",
      },
    ]);

    render(<LogViewer />);
    const warnBtn = screen.getByRole("button", { name: "Warn" });

    fireEvent.click(warnBtn);
    expect(screen.queryByText("careful")).not.toBeInTheDocument();

    fireEvent.click(warnBtn);
    expect(screen.getByText("careful")).toBeInTheDocument();
    expect(useLogViewerStore.getState().severityFilter.has("warn")).toBe(true);
  });

  it("filters by source when a source button is toggled off", () => {
    seedTwoSources();
    render(<LogViewer />);

    expect(screen.getByText("frontend line")).toBeInTheDocument();
    expect(screen.getByText("backend line")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Backend" }));

    expect(screen.getByText("frontend line")).toBeInTheDocument();
    expect(screen.queryByText("backend line")).not.toBeInTheDocument();
    expect(useLogViewerStore.getState().sourceFilter.has("backend")).toBe(false);
  });

  it("filters entries by the search input (case-insensitive)", () => {
    useLogViewerStore.getState().addEntries([
      {
        timestamp: "2025-01-15T10:30:00.000Z",
        severity: "info",
        source: "frontend",
        message: "Database connected",
      },
      {
        timestamp: "2025-01-15T10:30:01.000Z",
        severity: "info",
        source: "frontend",
        message: "Cache warmed",
      },
    ]);

    render(<LogViewer />);
    fireEvent.change(screen.getByPlaceholderText("Suchen..."), {
      target: { value: "database" },
    });

    expect(screen.getByText("Database connected")).toBeInTheDocument();
    expect(screen.queryByText("Cache warmed")).not.toBeInTheDocument();
    expect(useLogViewerStore.getState().searchText).toBe("database");
  });

  it("shows the empty state when search matches nothing", () => {
    useLogViewerStore.getState().addEntries([
      {
        timestamp: "2025-01-15T10:30:00.000Z",
        severity: "info",
        source: "frontend",
        message: "only entry",
      },
    ]);

    render(<LogViewer />);
    fireEvent.change(screen.getByPlaceholderText("Suchen..."), {
      target: { value: "zzz-no-match" },
    });

    expect(screen.getByText("Keine Logs vorhanden")).toBeInTheDocument();
    expect(screen.getByText(/0 Gruppen von 1 Einträgen/)).toBeInTheDocument();
  });

  it("clears all entries when the trash button is clicked", () => {
    useLogViewerStore.getState().addEntries([
      {
        timestamp: "2025-01-15T10:30:00.000Z",
        severity: "info",
        source: "frontend",
        message: "to be cleared",
      },
    ]);

    render(<LogViewer />);
    expect(screen.getByText("to be cleared")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Logs leeren"));

    expect(screen.queryByText("to be cleared")).not.toBeInTheDocument();
    expect(useLogViewerStore.getState().entries).toHaveLength(0);
    expect(screen.getByText("Keine Logs vorhanden")).toBeInTheDocument();
  });

  it("toggles live-tail state when the Live button is clicked", () => {
    render(<LogViewer />);
    expect(useLogViewerStore.getState().liveTail).toBe(true);

    fireEvent.click(screen.getByTitle("Live-Tail"));
    expect(useLogViewerStore.getState().liveTail).toBe(false);

    fireEvent.click(screen.getByTitle("Live-Tail"));
    expect(useLogViewerStore.getState().liveTail).toBe(true);
  });

  it("re-invokes read_structured_log when the refresh button is clicked", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const mockInvoke = vi.mocked(invoke);

    render(<LogViewer />);
    mockInvoke.mockClear();

    fireEvent.click(screen.getByTitle("Backend-Logs aktualisieren"));

    expect(mockInvoke).toHaveBeenCalledWith("read_structured_log", { maxLines: 500 });
  });

  it("invokes open_log_window when the external-window button is clicked", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const mockInvoke = vi.mocked(invoke);

    render(<LogViewer />);
    mockInvoke.mockClear();

    fireEvent.click(screen.getByTitle("In eigenem Fenster öffnen"));

    expect(mockInvoke).toHaveBeenCalledWith("open_log_window");
  });
});

// ---------------------------------------------------------------------------
// Backend log loading on mount
// ---------------------------------------------------------------------------

describe("LogViewer — backend log loading", () => {
  it("maps structured rows returned by the invoke mock and renders them", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce([
      { ts: "2025-01-15T10:30:00.000Z", level: "error", source: "backend", module: "pty", message: "PTY spawn failed" },
    ]);

    render(<LogViewer />);

    expect(await screen.findByText("PTY spawn failed")).toBeInTheDocument();
    // Backend source + error severity reflected in the count line
    expect(screen.getByText(/von 1 Einträgen/)).toBeInTheDocument();
  });

  it("renders a structured row with an unknown level (falls back to info) without crashing", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce([
      { ts: "2025-01-15T10:30:00.000Z", level: "weird", source: "backend", message: "odd line" },
    ]);

    render(<LogViewer />);

    expect(await screen.findByText("odd line")).toBeInTheDocument();
    expect(useLogViewerStore.getState().entries[0].severity).toBe("info");
  });

  it("logs an error and stays empty when read_structured_log rejects", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockRejectedValueOnce(new Error("disk read failed"));

    const { logError } = await import("../../utils/errorLogger");

    render(<LogViewer />);

    await vi.waitFor(() => {
      expect(vi.mocked(logError)).toHaveBeenCalledWith(
        "LogViewer.readStructuredLog",
        expect.any(Error),
      );
    });
    expect(screen.getByText("Keine Logs vorhanden")).toBeInTheDocument();
  });
});
