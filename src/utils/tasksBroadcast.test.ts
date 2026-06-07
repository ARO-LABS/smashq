import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TaskItem } from "../store/tasksStore";

// Mocks must be set up before module-level imports of the test target
// because tasksBroadcast does dynamic imports of @tauri-apps/api.

const emitMock = vi.fn((_event: string, _payload: unknown) => Promise.resolve());
let listenCallback: ((event: { payload: unknown }) => void) | null = null;

vi.mock("@tauri-apps/api/event", () => ({
  emit: (event: string, payload: unknown) => emitMock(event, payload),
  listen: vi.fn((_eventName: string, cb: (event: { payload: unknown }) => void) => {
    listenCallback = cb;
    return Promise.resolve(() => {});
  }),
}));

const getCurrentWindowMock = vi.fn(() => ({ label: "main" }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => getCurrentWindowMock(),
}));

function makeTasks(ids: string[]): TaskItem[] {
  return ids.map((id, i) => ({
    id,
    projectKey: null,
    title: id,
    status: "open" as const,
    startsAt: 1000 + i,
    endsAt: 2000 + i,
    subtasks: [],
    source: "manual" as const,
    sortIndex: (i + 1) * 1000,
    createdAt: 0,
    completedAt: null,
  }));
}

beforeEach(() => {
  emitMock.mockClear();
  listenCallback = null;
  getCurrentWindowMock.mockReturnValue({ label: "main" });
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {},
    configurable: true,
  });
  vi.resetModules();
});

describe("tasksBroadcast", () => {
  it("broadcastTasksChange emits 'tasks-changed' with tasks + sourceWindow label", async () => {
    const { broadcastTasksChange } = await import("./tasksBroadcast");
    const tasks = makeTasks(["a", "b"]);
    await broadcastTasksChange(tasks);
    expect(emitMock).toHaveBeenCalledWith("tasks-changed", {
      tasks,
      sourceWindow: "main",
    });
  });

  it("broadcast carries the current window label as sourceWindow", async () => {
    getCurrentWindowMock.mockReturnValue({ label: "tasks" });
    const { broadcastTasksChange } = await import("./tasksBroadcast");
    await broadcastTasksChange(makeTasks(["x"]));
    expect(emitMock.mock.calls[0][1]).toMatchObject({ sourceWindow: "tasks" });
  });

  it("listenForTasksChanges filters echoes from its own window", async () => {
    getCurrentWindowMock.mockReturnValue({ label: "main" });
    const { listenForTasksChanges } = await import("./tasksBroadcast");
    const apply = vi.fn();
    await listenForTasksChanges(apply);

    listenCallback?.({ payload: { tasks: makeTasks(["a"]), sourceWindow: "main" } });

    expect(apply).not.toHaveBeenCalled();
  });

  it("listenForTasksChanges applies tasks from other windows", async () => {
    getCurrentWindowMock.mockReturnValue({ label: "main" });
    const { listenForTasksChanges } = await import("./tasksBroadcast");
    const apply = vi.fn();
    await listenForTasksChanges(apply);

    const tasks = makeTasks(["a", "b"]);
    listenCallback?.({ payload: { tasks, sourceWindow: "tasks" } });

    expect(apply).toHaveBeenCalledWith(tasks);
  });

  it("ignores malformed and null payloads", async () => {
    const { listenForTasksChanges } = await import("./tasksBroadcast");
    const apply = vi.fn();
    await listenForTasksChanges(apply);
    listenCallback?.({ payload: undefined });
    listenCallback?.({ payload: null });
    expect(apply).not.toHaveBeenCalled();
  });

  it("swallows emit errors without throwing", async () => {
    emitMock.mockImplementationOnce(() => Promise.reject(new Error("emit boom")));
    const { broadcastTasksChange } = await import("./tasksBroadcast");
    await expect(broadcastTasksChange(makeTasks(["a"]))).resolves.toBeUndefined();
  });

  it("listenForTasksChanges returns an unsubscribe function", async () => {
    const { listenForTasksChanges } = await import("./tasksBroadcast");
    const unsub = await listenForTasksChanges(vi.fn());
    expect(typeof unsub).toBe("function");
  });
});

describe("tasksBroadcast — non-Tauri environment", () => {
  beforeEach(() => {
    emitMock.mockClear();
    listenCallback = null;
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
  });

  it("broadcastTasksChange is a no-op outside Tauri", async () => {
    const { broadcastTasksChange } = await import("./tasksBroadcast");
    await broadcastTasksChange(makeTasks(["a"]));
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("listenForTasksChanges registers no listener outside Tauri", async () => {
    const { listenForTasksChanges } = await import("./tasksBroadcast");
    const unsub = await listenForTasksChanges(vi.fn());
    expect(typeof unsub).toBe("function");
    expect(listenCallback).toBeNull();
  });
});
