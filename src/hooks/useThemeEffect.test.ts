import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useThemeEffect } from "./useThemeEffect";
import { useSettingsStore } from "../store/settingsStore";

// ── Mock Tauri (settingsStore depends on it) ──────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

beforeEach(() => {
  // Reset document classes
  document.documentElement.classList.remove("dark", "theme-transition");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────

describe("useThemeEffect", () => {
  it("adds 'dark' class when theme mode is dark", () => {
    useSettingsStore.setState({
      theme: { mode: "dark", accentColor: "#00FF88", reducedMotion: false, animationSpeed: 1 },
    });

    renderHook(() => useThemeEffect());

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("theme-transition")).toBe(true);

    // After 250ms, transition class is removed
    vi.advanceTimersByTime(250);
    expect(document.documentElement.classList.contains("theme-transition")).toBe(false);
  });

  it("removes 'dark' class when theme mode is light", () => {
    // Pre-set dark
    document.documentElement.classList.add("dark");

    useSettingsStore.setState({
      theme: { mode: "light", accentColor: "#00FF88", reducedMotion: false, animationSpeed: 1 },
    });

    renderHook(() => useThemeEffect());

    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
