import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { useLogViewerStore } from "./store/logViewerStore";
import { useSettingsStore } from "./store/settingsStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve([])),
}));

vi.mock("./utils/errorLogger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  wireLoggingGate: vi.fn(),
  wirePersistenceGate: vi.fn(),
  flushFrontendLogs: vi.fn(() => Promise.resolve()),
}));

vi.mock("./utils/perfLogger", () => ({
  setPerfEnabled: vi.fn(),
  wrapInvoke: vi.fn(<T,>(_cmd: string, _args?: unknown) => Promise.resolve(undefined as T)),
}));

beforeEach(() => {
  useLogViewerStore.setState({
    entries: [],
    severityFilter: new Set(["error", "warn", "info"]),
    sourceFilter: new Set(["frontend", "backend"]),
    searchText: "",
    liveTail: true,
  });
  useSettingsStore.setState({
    preferences: {
      frontendLogging: true,
      backendFileLogging: false,
      performanceProfiler: false,
      scrollbackLines: 25_000,
    },
  });
});

describe("LogWindowApp", () => {
  it("renders without crash", async () => {
    // Dynamic import after mocks are set up
    const { default: LogWindowApp } = await import("./LogWindowApp");
    render(<LogWindowApp />);
    // Should show loading or the log viewer
    expect(document.querySelector(".h-screen")).toBeInTheDocument();
  });
});
