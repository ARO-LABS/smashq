import { describe, it, expect, beforeEach } from "vitest";
import { sanitizeTask, sanitizeTasks, useTasksStore } from "./tasksStore";

describe("sanitizeTask", () => {
  const valid = {
    id: "task-1",
    projectKey: "c:/p",
    title: "Do thing",
    status: "open",
    deadline: 1000,
    deadlineHasTime: true,
    note: "n",
    subtasks: [{ id: "s1", title: "step", done: false }],
    source: "manual",
    sortIndex: 1000,
    createdAt: 50,
    completedAt: null,
    archivedAt: null,
  };

  it("passes a fully-valid task through unchanged", () => {
    expect(sanitizeTask(valid)).toEqual(valid);
  });

  it("rejects a non-object", () => {
    expect(sanitizeTask(null)).toBeNull();
    expect(sanitizeTask(42)).toBeNull();
  });

  it("rejects an entry without a string id", () => {
    expect(sanitizeTask({ ...valid, id: 123 })).toBeNull();
  });

  it("coerces an unknown status to 'open'", () => {
    expect(sanitizeTask({ ...valid, status: "bogus" })?.status).toBe("open");
  });

  it("coerces a NaN sortIndex to 0", () => {
    expect(sanitizeTask({ ...valid, sortIndex: NaN })?.sortIndex).toBe(0);
  });

  it("coerces an invalid deadline to null", () => {
    expect(sanitizeTask({ ...valid, deadline: "soon" })?.deadline).toBeNull();
  });

  it("drops malformed subtasks", () => {
    const out = sanitizeTask({
      ...valid,
      subtasks: [{ id: "ok", title: "t", done: true }, { id: 5 }, "nope"],
    });
    expect(out?.subtasks).toEqual([{ id: "ok", title: "t", done: true }]);
  });

  it("defaults source to 'manual' for unknown values", () => {
    expect(sanitizeTask({ ...valid, source: "alien" })?.source).toBe("manual");
  });
});

describe("sanitizeTasks", () => {
  it("returns [] for a non-array", () => {
    expect(sanitizeTasks("nope")).toEqual([]);
  });

  it("filters out invalid entries and keeps valid ones", () => {
    const out = sanitizeTasks([
      { id: "a", title: "x", status: "done" },
      null,
      { title: "no id" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
  });
});

function resetTasks() {
  useTasksStore.setState({ tasks: [] });
}

describe("useTasksStore.addTask", () => {
  beforeEach(resetTasks);

  it("adds a task with sane defaults and returns its id", () => {
    const id = useTasksStore.getState().addTask({ title: "First", projectKey: "c:/p" });
    const tasks = useTasksStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    const t = tasks[0];
    expect(t.id).toBe(id);
    expect(t.id).toMatch(/^task-/);
    expect(t.title).toBe("First");
    expect(t.projectKey).toBe("c:/p");
    expect(t.status).toBe("open");
    expect(t.source).toBe("manual");
    expect(t.deadline).toBeNull();
    expect(t.subtasks).toEqual([]);
    expect(t.archivedAt).toBeNull();
    expect(t.sortIndex).toBe(1000);
  });

  it("trims the title", () => {
    useTasksStore.getState().addTask({ title: "  spaced  " });
    expect(useTasksStore.getState().tasks[0].title).toBe("spaced");
  });

  it("assigns increasing sortIndex in 1000-step gaps", () => {
    useTasksStore.getState().addTask({ title: "a" });
    useTasksStore.getState().addTask({ title: "b" });
    const [a, b] = useTasksStore.getState().tasks;
    expect(a.sortIndex).toBe(1000);
    expect(b.sortIndex).toBe(2000);
  });

  it("defaults projectKey to null when omitted (global task)", () => {
    useTasksStore.getState().addTask({ title: "global" });
    expect(useTasksStore.getState().tasks[0].projectKey).toBeNull();
  });
});

describe("useTasksStore mutations", () => {
  beforeEach(resetTasks);

  it("updateTask merges allowed fields", () => {
    const id = useTasksStore.getState().addTask({ title: "x" });
    useTasksStore.getState().updateTask(id, { title: "y", deadline: 99, note: "hi" });
    const t = useTasksStore.getState().tasks[0];
    expect(t.title).toBe("y");
    expect(t.deadline).toBe(99);
    expect(t.note).toBe("hi");
  });

  it("updateTask is a no-op for an unknown id", () => {
    const id = useTasksStore.getState().addTask({ title: "x" });
    useTasksStore.getState().updateTask("nope", { title: "changed" });
    expect(useTasksStore.getState().tasks[0].title).toBe("x");
    expect(useTasksStore.getState().tasks[0].id).toBe(id);
  });

  it("completeTask sets status done + completedAt", () => {
    const id = useTasksStore.getState().addTask({ title: "x" });
    useTasksStore.getState().completeTask(id);
    const t = useTasksStore.getState().tasks[0];
    expect(t.status).toBe("done");
    expect(typeof t.completedAt).toBe("number");
  });

  it("reopenTask clears completedAt and sets status open", () => {
    const id = useTasksStore.getState().addTask({ title: "x" });
    useTasksStore.getState().completeTask(id);
    useTasksStore.getState().reopenTask(id);
    const t = useTasksStore.getState().tasks[0];
    expect(t.status).toBe("open");
    expect(t.completedAt).toBeNull();
  });

  it("archiveTask sets archivedAt (soft delete, entry stays)", () => {
    const id = useTasksStore.getState().addTask({ title: "x" });
    useTasksStore.getState().archiveTask(id);
    const t = useTasksStore.getState().tasks[0];
    expect(typeof t.archivedAt).toBe("number");
    expect(useTasksStore.getState().tasks).toHaveLength(1);
  });

  it("reorderTask sets the sortIndex directly", () => {
    const id = useTasksStore.getState().addTask({ title: "x" });
    useTasksStore.getState().reorderTask(id, 5500);
    expect(useTasksStore.getState().tasks[0].sortIndex).toBe(5500);
  });

  it("reorderTask ignores a non-finite index", () => {
    const id = useTasksStore.getState().addTask({ title: "x" });
    useTasksStore.getState().reorderTask(id, Number.NaN);
    expect(useTasksStore.getState().tasks[0].sortIndex).toBe(1000);
  });
});
