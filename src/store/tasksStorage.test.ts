import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { tasksStorage } from "./tasksStorage";

// In jsdom there is no __TAURI_INTERNALS__, so the adapter takes the
// localStorage-fallback branch. That is the branch we assert here.

describe("tasksStorage (localStorage fallback)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a value through setItem/getItem", () => {
    tasksStorage.setItem("smashq-tasks", '{"state":{"tasks":[]},"version":1}');
    expect(tasksStorage.getItem("smashq-tasks")).toBe(
      '{"state":{"tasks":[]},"version":1}',
    );
  });

  it("returns null for an unknown key", () => {
    expect(tasksStorage.getItem("does-not-exist")).toBeNull();
  });

  it("removeItem clears the stored value", () => {
    tasksStorage.setItem("smashq-tasks", "x");
    tasksStorage.removeItem("smashq-tasks");
    expect(tasksStorage.getItem("smashq-tasks")).toBeNull();
  });
});

// In the Tauri branch the adapter debounces a `save_tasks` invoke. We drive
// that branch by installing __TAURI_INTERNALS__ before a fresh dynamic import
// (isTauri is read at module load), intercept invoke via mockIPC (NOT a core
// module mock), and use fake timers to flush the debounce deterministically.
describe("tasksStorage (Tauri branch — suppressPersist)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    clearMocks();
    vi.useRealTimers();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("skips the debounced save_tasks invoke while suppressPersist is active but still updates the cache (getItem reflects the new value)", async () => {
    const saveCalls: unknown[] = [];
    // mockIPC installs __TAURI_INTERNALS__ on window; import AFTER so the
    // adapter's load-time `isTauri` check sees the Tauri branch.
    mockIPC((cmd, args) => {
      if (cmd === "save_tasks") saveCalls.push(args);
      return undefined;
    });
    const mod = await import("./tasksStorage");

    mod.setSuppressTasksPersist(true);
    mod.tasksStorage.setItem(
      "smashq-tasks",
      '{"state":{"tasks":[{"id":"a"}]},"version":1}',
    );
    // Flush past the 300ms debounce window.
    await vi.advanceTimersByTimeAsync(500);

    expect(saveCalls).toHaveLength(0);
    // Cache stays consistent so getItem still reflects the applied value.
    expect(mod.tasksStorage.getItem("smashq-tasks")).toBe(
      '{"state":{"tasks":[{"id":"a"}]},"version":1}',
    );
  });

  it("resumes scheduling save_tasks after suppressPersist is set back to false", async () => {
    const saveCalls: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "save_tasks") saveCalls.push(args);
      return undefined;
    });
    // Import AFTER mockIPC so the load-time isTauri check takes the Tauri branch.
    const mod = await import("./tasksStorage");

    mod.setSuppressTasksPersist(true);
    mod.tasksStorage.setItem("smashq-tasks", '{"suppressed":true}');
    await vi.advanceTimersByTimeAsync(500);
    expect(saveCalls).toHaveLength(0);

    mod.setSuppressTasksPersist(false);
    mod.tasksStorage.setItem("smashq-tasks", '{"suppressed":false}');
    await vi.advanceTimersByTimeAsync(500);

    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0]).toEqual({ data: '{"suppressed":false}' });
  });
});
