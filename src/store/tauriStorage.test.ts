import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @tauri-apps/api/core — must be before importing the module under test
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock the error logger to avoid noise and verify logging calls
vi.mock("../utils/errorLogger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// tauriStorage checks `"__TAURI_INTERNALS__" in window` at module load.
// Without it, tauriStorage falls back to localStorage — which we can test directly.
// We test the non-Tauri (localStorage) path since jsdom doesn't have __TAURI_INTERNALS__.

import {
  tauriStorage,
  getLoadedFavorites,
  getLoadedNotes,
  registerNoteFlush,
  initTauriStorage,
  flushPendingSaves,
  parseFavoritesFile,
} from "./tauriStorage";

// ---------------------------------------------------------------------------
// tauriStorage (localStorage fallback path)
// ---------------------------------------------------------------------------

describe("tauriStorage (localStorage fallback)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("getItem", () => {
    it("returns null when key does not exist", () => {
      expect(tauriStorage.getItem("nonexistent")).toBeNull();
    });

    it("returns the stored value", () => {
      localStorage.setItem("my-key", '{"data":1}');
      expect(tauriStorage.getItem("my-key")).toBe('{"data":1}');
    });

    it("falls back to old persist key for agenticexplorer-settings", () => {
      // Migration: if new key has no data, try old key
      localStorage.setItem("agentic-dashboard-settings", '{"old":true}');
      expect(tauriStorage.getItem("agenticexplorer-settings")).toBe('{"old":true}');
    });

    it("prefers new key over old key for agenticexplorer-settings", () => {
      localStorage.setItem("agenticexplorer-settings", '{"new":true}');
      localStorage.setItem("agentic-dashboard-settings", '{"old":true}');
      expect(tauriStorage.getItem("agenticexplorer-settings")).toBe('{"new":true}');
    });

    it("returns null for agenticexplorer-settings when neither key exists", () => {
      expect(tauriStorage.getItem("agenticexplorer-settings")).toBeNull();
    });

    it("does NOT apply old-key fallback for unrelated missing keys", () => {
      localStorage.setItem("agentic-dashboard-settings", '{"old":true}');
      // migration fallback is scoped to agenticexplorer-settings only
      expect(tauriStorage.getItem("some-other-key")).toBeNull();
    });

    it("returns an empty-string value verbatim (not coerced to null)", () => {
      localStorage.setItem("empty-key", "");
      expect(tauriStorage.getItem("empty-key")).toBe("");
    });
  });

  describe("setItem", () => {
    it("stores value in localStorage", () => {
      tauriStorage.setItem("test-key", '{"val":"hello"}');
      expect(localStorage.getItem("test-key")).toBe('{"val":"hello"}');
    });

    it("overwrites existing value", () => {
      tauriStorage.setItem("test-key", "first");
      tauriStorage.setItem("test-key", "second");
      expect(localStorage.getItem("test-key")).toBe("second");
    });

    it("round-trips a serialized JSON payload through get/set", () => {
      const payload = JSON.stringify({ theme: "dark", count: 3, nested: { a: [1, 2] } });
      tauriStorage.setItem("agenticexplorer-settings", payload);
      // getItem is synchronous in this adapter; cast away the Promise union.
      const read = tauriStorage.getItem("agenticexplorer-settings") as string | null;
      expect(read).toBe(payload);
      expect(JSON.parse(read!)).toEqual({ theme: "dark", count: 3, nested: { a: [1, 2] } });
    });

    it("stores an empty string without throwing", () => {
      tauriStorage.setItem("empty-set", "");
      expect(localStorage.getItem("empty-set")).toBe("");
    });

    it("preserves unicode and special characters", () => {
      const value = JSON.stringify({ note: "Grün/Größe — \"Zitat\" \n\t" });
      tauriStorage.setItem("uni-key", value);
      expect(localStorage.getItem("uni-key")).toBe(value);
    });
  });

  describe("removeItem", () => {
    it("removes the key from localStorage", () => {
      localStorage.setItem("test-key", "value");
      tauriStorage.removeItem("test-key");
      expect(localStorage.getItem("test-key")).toBeNull();
    });

    it("does not throw when removing non-existent key", () => {
      expect(() => tauriStorage.removeItem("missing")).not.toThrow();
    });

    it("leaves other keys intact when removing one", () => {
      localStorage.setItem("keep", "stays");
      localStorage.setItem("drop", "goes");
      tauriStorage.removeItem("drop");
      expect(localStorage.getItem("keep")).toBe("stays");
      expect(localStorage.getItem("drop")).toBeNull();
    });

    it("getItem returns null after removeItem", () => {
      tauriStorage.setItem("rt-key", "value");
      tauriStorage.removeItem("rt-key");
      expect(tauriStorage.getItem("rt-key")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// getLoadedFavorites / getLoadedNotes (before init)
// ---------------------------------------------------------------------------

describe("getLoadedFavorites", () => {
  it("returns null before initTauriStorage is called", () => {
    // In test environment (non-Tauri), these are never populated
    expect(getLoadedFavorites()).toBeNull();
  });
});

describe("getLoadedNotes", () => {
  it("returns null before initTauriStorage is called", () => {
    expect(getLoadedNotes()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// registerNoteFlush
// ---------------------------------------------------------------------------

describe("registerNoteFlush", () => {
  it("accepts a flush function without throwing", () => {
    const flushFn = vi.fn(() => Promise.resolve());
    expect(() => registerNoteFlush(flushFn)).not.toThrow();
  });

  it("can be re-registered, replacing the previous function", () => {
    const first = vi.fn(() => Promise.resolve());
    const second = vi.fn(() => Promise.resolve());
    registerNoteFlush(first);
    expect(() => registerNoteFlush(second)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// initTauriStorage (non-Tauri fallback path)
// ---------------------------------------------------------------------------

describe("initTauriStorage", () => {
  it("resolves immediately without invoking Tauri commands outside Tauri", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();

    await expect(initTauriStorage()).resolves.toBeUndefined();
    // Non-Tauri env → no backend commands fired
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("is idempotent — repeated calls all resolve", async () => {
    await expect(initTauriStorage()).resolves.toBeUndefined();
    await expect(initTauriStorage()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// flushPendingSaves (non-Tauri fallback path)
// ---------------------------------------------------------------------------

describe("flushPendingSaves", () => {
  it("resolves without error outside Tauri", async () => {
    await expect(flushPendingSaves()).resolves.toBeUndefined();
  });

  it("does not invoke save commands outside Tauri", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();
    tauriStorage.setItem("agenticexplorer-settings", '{"x":1}');

    await flushPendingSaves();

    // localStorage path → no debounced disk saves queued
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// parseFavoritesFile
// ---------------------------------------------------------------------------

describe("parseFavoritesFile", () => {
  it("returns empty for empty input", () => {
    expect(parseFavoritesFile("")).toEqual({ groups: [], items: [] });
    expect(parseFavoritesFile("   ")).toEqual({ groups: [], items: [] });
  });

  it("wraps v1 flat array as items, empty groups", () => {
    const v1 = JSON.stringify([
      { id: "f1", path: "/f1", label: "F1", shell: "powershell",
        addedAt: 1, lastUsedAt: 1 },
    ]);
    const out = parseFavoritesFile(v1);
    expect(out.groups).toEqual([]);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].id).toBe("f1");
  });

  it("parses v2 object with groups + items", () => {
    const v2 = JSON.stringify({
      version: 2,
      groups: [{ id: "grp-1", label: "A", sortIndex: 0 }],
      items: [
        { id: "f1", path: "/f1", label: "F1", shell: "powershell",
          addedAt: 1, lastUsedAt: 1, groupId: "grp-1", sortIndex: 0 },
      ],
    });
    const out = parseFavoritesFile(v2);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].label).toBe("A");
    expect(out.items).toHaveLength(1);
    expect(out.items[0].groupId).toBe("grp-1");
  });

  it("returns empty on malformed JSON", () => {
    expect(parseFavoritesFile("{{{not json")).toEqual({ groups: [], items: [] });
  });

  it("returns empty on unrecognized shape", () => {
    expect(parseFavoritesFile('{"foo": "bar"}')).toEqual({ groups: [], items: [] });
  });

  it("v2 with missing groups field defaults to empty groups", () => {
    const v2 = JSON.stringify({
      version: 2,
      items: [{ id: "f1", path: "/f1", label: "F1", shell: "powershell",
                addedAt: 1, lastUsedAt: 1, groupId: null, sortIndex: 0 }],
    });
    const out = parseFavoritesFile(v2);
    expect(out.groups).toEqual([]);
    expect(out.items).toHaveLength(1);
  });
});
