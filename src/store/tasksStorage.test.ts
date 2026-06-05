import { describe, it, expect, beforeEach } from "vitest";
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
