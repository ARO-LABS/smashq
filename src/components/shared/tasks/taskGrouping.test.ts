import { describe, it, expect, vi, afterEach } from "vitest";
import {
  filterTasks,
  groupByProject,
  groupByDeadline,
  nextTaskId,
  type ProjectOption,
} from "./taskGrouping";
import type { TaskItem } from "../../../store/tasksStore";

// ── Test factory ──────────────────────────────────────────────────────

let _idCounter = 0;

const SLOT_MS = 30 * 60_000;

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  const id = `task-${++_idCounter}`;
  const startsAt = overrides.startsAt ?? Date.now();
  return {
    id,
    projectKey: null,
    title: "Aufgabe",
    status: "open",
    startsAt,
    endsAt: overrides.endsAt ?? startsAt + SLOT_MS,
    subtasks: [],
    source: "manual",
    sortIndex: _idCounter * 1000,
    createdAt: 0,
    completedAt: null,
    ...overrides,
  };
}

// ── filterTasks ───────────────────────────────────────────────────────

describe("filterTasks", () => {
  describe("happy path — status filter", () => {
    it("filter='all' returns all tasks regardless of status", () => {
      const tasks = [
        makeTask({ status: "open" }),
        makeTask({ status: "active" }),
        makeTask({ status: "done" }),
      ];
      expect(filterTasks(tasks, "all", "")).toHaveLength(3);
    });

    it("filter='open' keeps open and active, drops done", () => {
      const tasks = [
        makeTask({ status: "open" }),
        makeTask({ status: "active" }),
        makeTask({ status: "done" }),
      ];
      const result = filterTasks(tasks, "open", "");
      expect(result).toHaveLength(2);
      expect(result.every((t) => t.status !== "done")).toBe(true);
    });

    it("filter='done' keeps only done tasks", () => {
      const tasks = [
        makeTask({ status: "open" }),
        makeTask({ status: "done", title: "Erledigt" }),
      ];
      const result = filterTasks(tasks, "done", "");
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Erledigt");
    });
  });

  describe("happy path — text query", () => {
    it("query matches title case-insensitively", () => {
      const tasks = [
        makeTask({ title: "Deploy Skript schreiben" }),
        makeTask({ title: "Meeting vorbereiten" }),
      ];
      const result = filterTasks(tasks, "all", "deploy");
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Deploy Skript schreiben");
    });

    it("query matches note when present", () => {
      const tasks = [
        makeTask({ title: "Aufgabe", note: "wichtig: prod-server" }),
        makeTask({ title: "Andere Aufgabe" }),
      ];
      const result = filterTasks(tasks, "all", "prod-server");
      expect(result).toHaveLength(1);
    });

    it("combined filter and query: only open tasks matching title", () => {
      const tasks = [
        makeTask({ title: "Build prüfen", status: "open" }),
        makeTask({ title: "Build prüfen", status: "done" }),
        makeTask({ title: "Deploy starten", status: "open" }),
      ];
      const result = filterTasks(tasks, "open", "Build");
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("open");
      expect(result[0].title).toBe("Build prüfen");
    });
  });

  describe("edge cases — filterTasks", () => {
    it("empty query matches everything", () => {
      const tasks = [makeTask(), makeTask(), makeTask()];
      expect(filterTasks(tasks, "all", "")).toHaveLength(3);
    });

    it("whitespace-only query is treated as empty (matches all)", () => {
      const tasks = [makeTask({ title: "x" }), makeTask({ title: "y" })];
      expect(filterTasks(tasks, "all", "   ")).toHaveLength(2);
    });

    it("returns empty array when no tasks match", () => {
      const tasks = [makeTask({ title: "Deploy" })];
      expect(filterTasks(tasks, "all", "xyz-not-present")).toHaveLength(0);
    });

    it("returns empty array for empty input", () => {
      expect(filterTasks([], "all", "anything")).toHaveLength(0);
    });

    it("tasks without note field are not excluded by query against note", () => {
      const task = makeTask({ title: "Aufgabe ohne Notiz" });
      // note is undefined; query touches only title
      const result = filterTasks([task], "all", "Aufgabe");
      expect(result).toHaveLength(1);
    });

    it("preserves input order", () => {
      const tasks = [
        makeTask({ title: "Z-Aufgabe" }),
        makeTask({ title: "A-Aufgabe" }),
        makeTask({ title: "M-Aufgabe" }),
      ];
      const result = filterTasks(tasks, "all", "Aufgabe");
      expect(result.map((t) => t.title)).toEqual([
        "Z-Aufgabe",
        "A-Aufgabe",
        "M-Aufgabe",
      ]);
    });
  });
});

// ── nextTaskId ────────────────────────────────────────────────────────

describe("nextTaskId", () => {
  it("returns the id of the first element when list is non-empty", () => {
    const tasks = [
      makeTask({ id: "first", sortIndex: 1000 }),
      makeTask({ id: "second", sortIndex: 2000 }),
    ];
    expect(nextTaskId(tasks)).toBe("first");
  });

  it("returns undefined for an empty list", () => {
    expect(nextTaskId([])).toBeUndefined();
  });
});

// ── groupByProject ────────────────────────────────────────────────────

describe("groupByProject", () => {
  const projects: ProjectOption[] = [
    { key: "c:/proj/alpha", label: "Alpha" },
    { key: "c:/proj/beta", label: "Beta" },
    { key: null, label: "Global" },
  ];

  describe("happy path", () => {
    it("groups tasks into their matching project buckets", () => {
      const tasks = [
        makeTask({ projectKey: "c:/proj/alpha" }),
        makeTask({ projectKey: "c:/proj/alpha" }),
        makeTask({ projectKey: "c:/proj/beta" }),
        makeTask({ projectKey: null }),
      ];
      const groups = groupByProject(tasks, projects);
      expect(groups).toHaveLength(3);

      const alpha = groups.find((g) => g.key === "c:/proj/alpha")!;
      expect(alpha.label).toBe("Alpha");
      expect(alpha.tasks).toHaveLength(2);

      const beta = groups.find((g) => g.key === "c:/proj/beta")!;
      expect(beta.tasks).toHaveLength(1);

      const global = groups.find((g) => g.key === null)!;
      expect(global.label).toBe("Global");
      expect(global.tasks).toHaveLength(1);
    });

    it("nextId = lowest sortIndex open task within the group", () => {
      // Tasks in reverse sortIndex order to verify it picks the lowest, not first
      const high = makeTask({ projectKey: "c:/proj/alpha", sortIndex: 2000, status: "open" });
      const low = makeTask({ projectKey: "c:/proj/alpha", sortIndex: 1000, status: "open" });
      // Pass high before low to ensure sorting happens inside groupByProject
      const groups = groupByProject([high, low], projects);
      const alpha = groups.find((g) => g.key === "c:/proj/alpha")!;
      expect(alpha.nextId).toBe(low.id);
    });

    it("nextId is undefined when all tasks in the group are done", () => {
      const tasks = [
        makeTask({ projectKey: "c:/proj/alpha", status: "done" }),
        makeTask({ projectKey: "c:/proj/alpha", status: "done" }),
      ];
      const groups = groupByProject(tasks, projects);
      const alpha = groups.find((g) => g.key === "c:/proj/alpha")!;
      expect(alpha.nextId).toBeUndefined();
    });

    it("nextId skips done tasks and picks the lowest-sortIndex open one", () => {
      const done = makeTask({ projectKey: "c:/proj/alpha", sortIndex: 500, status: "done" });
      const open = makeTask({ projectKey: "c:/proj/alpha", sortIndex: 1500, status: "open" });
      const groups = groupByProject([done, open], projects);
      const alpha = groups.find((g) => g.key === "c:/proj/alpha")!;
      expect(alpha.nextId).toBe(open.id);
    });

    it("output order mirrors projects array order", () => {
      const tasks = [
        makeTask({ projectKey: null }),
        makeTask({ projectKey: "c:/proj/beta" }),
        makeTask({ projectKey: "c:/proj/alpha" }),
      ];
      const groups = groupByProject(tasks, projects);
      expect(groups.map((g) => g.key)).toEqual([
        "c:/proj/alpha",
        "c:/proj/beta",
        null,
      ]);
    });
  });

  describe("edge cases — groupByProject", () => {
    it("drops tasks whose projectKey is not in the projects list", () => {
      const tasks = [makeTask({ projectKey: "c:/unknown" })];
      const groups = groupByProject(tasks, projects);
      expect(groups).toHaveLength(0);
    });

    it("omits empty groups (no tasks for that project)", () => {
      const tasks = [makeTask({ projectKey: "c:/proj/alpha" })];
      const groups = groupByProject(tasks, projects);
      // Only alpha should appear; beta and global have no tasks
      expect(groups).toHaveLength(1);
      expect(groups[0].key).toBe("c:/proj/alpha");
    });

    it("returns empty array when tasks is empty", () => {
      expect(groupByProject([], projects)).toHaveLength(0);
    });

    it("returns empty array when projects is empty", () => {
      const tasks = [makeTask({ projectKey: "c:/proj/alpha" })];
      expect(groupByProject(tasks, [])).toHaveLength(0);
    });

    it("global tasks (key=null) are correctly placed in the null bucket", () => {
      const global = makeTask({ projectKey: null });
      const groups = groupByProject([global], [{ key: null, label: "Global" }]);
      expect(groups).toHaveLength(1);
      expect(groups[0].key).toBeNull();
      expect(groups[0].tasks[0].id).toBe(global.id);
    });
  });
});

// ── groupByDeadline ───────────────────────────────────────────────────

describe("groupByDeadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Pin clock to a fixed point so deadline arithmetic is deterministic.
  // We use a Tuesday noon so "today" / "this week" boundaries are clear.
  // 2024-03-05T12:00:00.000Z = 1709640000000
  const NOW = 1_709_640_000_000;

  const ONE_HOUR = 3_600_000;
  const ONE_DAY = 86_400_000;

  function pinClock(): void {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  }

  it("overdue: startsAt strictly before now → 'overdue' bucket", () => {
    pinClock();
    const tasks = [makeTask({ startsAt: NOW - ONE_HOUR })];
    const groups = groupByDeadline(tasks);
    expect(groups).toHaveLength(1);
    expect(groups[0].bucket).toBe("overdue");
    expect(groups[0].label).toBe("Überfällig");
  });

  it("today: startsAt on the same calendar day but after now → 'today' bucket", () => {
    pinClock();
    // Later today (same calendar day)
    const tasks = [makeTask({ startsAt: NOW + ONE_HOUR })];
    const groups = groupByDeadline(tasks);
    expect(groups[0].bucket).toBe("today");
    expect(groups[0].label).toBe("Heute");
  });

  it("week: startsAt 2 days from now → 'week' bucket", () => {
    pinClock();
    const tasks = [makeTask({ startsAt: NOW + 2 * ONE_DAY })];
    const groups = groupByDeadline(tasks);
    expect(groups[0].bucket).toBe("week");
    expect(groups[0].label).toBe("Diese Woche");
  });

  it("later: startsAt >7 days from now → 'later' bucket", () => {
    pinClock();
    const tasks = [makeTask({ startsAt: NOW + 8 * ONE_DAY })];
    const groups = groupByDeadline(tasks);
    expect(groups[0].bucket).toBe("later");
    expect(groups[0].label).toBe("Später");
  });

  it("empty input yields empty output", () => {
    pinClock();
    expect(groupByDeadline([])).toHaveLength(0);
  });

  it("empty buckets are omitted", () => {
    pinClock();
    // Only overdue tasks → only 'overdue' group in output
    const tasks = [
      makeTask({ startsAt: NOW - ONE_HOUR }),
      makeTask({ startsAt: NOW - 2 * ONE_HOUR }),
    ];
    const groups = groupByDeadline(tasks);
    expect(groups).toHaveLength(1);
    expect(groups[0].bucket).toBe("overdue");
  });

  it("output respects bucket order: overdue → today → week → later", () => {
    pinClock();
    const tasks = [
      makeTask({ startsAt: NOW + 8 * ONE_DAY }),
      makeTask({ startsAt: NOW + 2 * ONE_DAY }),
      makeTask({ startsAt: NOW + ONE_HOUR }),
      makeTask({ startsAt: NOW - ONE_HOUR }),
    ];
    const groups = groupByDeadline(tasks);
    expect(groups.map((g) => g.bucket)).toEqual([
      "overdue",
      "today",
      "week",
      "later",
    ]);
  });

  it("task order within each bucket mirrors the input order", () => {
    pinClock();
    const a = makeTask({ startsAt: NOW - ONE_HOUR, title: "A" });
    const b = makeTask({ startsAt: NOW - 2 * ONE_HOUR, title: "B" });
    const tasks = [a, b];
    const groups = groupByDeadline(tasks);
    expect(groups[0].tasks.map((t) => t.title)).toEqual(["A", "B"]);
  });
});
