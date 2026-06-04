import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import App from "./App";
import { useThemeEffect } from "./hooks/useThemeEffect";
import { useSessionRestore } from "./hooks/useSessionRestore";
import { initSessionRestoreSync } from "./store/sessionRestoreSync";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  }),
}));

vi.mock("./components/layout/AppShell", () => ({
  AppShell: () => <div data-testid="app-shell" />,
}));

vi.mock("./utils/globalErrorHandler", () => ({
  installGlobalErrorHandlers: vi.fn(),
}));

vi.mock("./hooks/useThemeEffect", () => ({
  useThemeEffect: vi.fn(),
}));

vi.mock("./store/tauriStorage", () => ({
  flushPendingSaves: vi.fn(() => Promise.resolve()),
  tauriStorage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
  getLoadedFavorites: vi.fn(() => []),
  getLoadedNotes: vi.fn(() => null),
  registerNoteFlush: vi.fn(),
}));

vi.mock("./hooks/useSessionRestore", () => ({
  useSessionRestore: vi.fn(),
}));

vi.mock("./store/sessionRestoreSync", () => ({
  initSessionRestoreSync: vi.fn(() => vi.fn()),
}));

// ── Tests ─────────────────────────────────────────────────────────────

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders AppShell component", () => {
    const { getByTestId } = render(<App />);
    expect(getByTestId("app-shell")).toBeTruthy();
  });

  it("calls useThemeEffect on mount", () => {
    render(<App />);
    expect(useThemeEffect).toHaveBeenCalled();
  });

  it("calls useSessionRestore on mount", () => {
    render(<App />);
    expect(useSessionRestore).toHaveBeenCalled();
  });

  it("initializes session restore sync on mount", () => {
    render(<App />);
    expect(initSessionRestoreSync).toHaveBeenCalled();
  });
});
