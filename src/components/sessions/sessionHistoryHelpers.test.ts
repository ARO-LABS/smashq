import { describe, it, expect } from "vitest";
import {
  groupSessionsByTime,
  matchesHistoryQuery,
  buildRunningClaudeIds,
  type HistorySessionLike,
} from "./sessionHistoryHelpers";

const mk = (id: string, startedAt: string, branch = ""): HistorySessionLike => ({
  session_id: id,
  title: `t-${id}`,
  started_at: startedAt,
  git_branch: branch,
});

describe("groupSessionsByTime", () => {
  const now = new Date("2026-07-23T12:00:00Z");

  it("buckets sessions into Heute / Diese Woche / Aelter and keeps order within groups", () => {
    const groups = groupSessionsByTime(
      [
        mk("a", "2026-07-23T09:00:00Z"),
        mk("a2", "2026-07-23T10:00:00Z"),
        mk("b", "2026-07-20T09:00:00Z"),
        mk("c", "2026-06-01T09:00:00Z"),
      ],
      now
    );
    expect(groups.map((g) => g.key)).toEqual(["today", "week", "older"]);
    expect(groups[0].label).toBe("Heute");
    expect(groups[1].label).toBe("Diese Woche");
    expect(groups[2].label).toBe("Älter");
    expect(groups[0].sessions.map((s) => s.session_id)).toEqual(["a", "a2"]);
  });

  it("returns an empty array for no sessions", () => {
    expect(groupSessionsByTime([], now)).toEqual([]);
  });

  it("omits empty groups", () => {
    const groups = groupSessionsByTime([mk("a", "2026-07-23T01:00:00Z")], now);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("today");
  });

  it("treats unparsable started_at as older (edge case)", () => {
    const groups = groupSessionsByTime([mk("x", "")], now);
    expect(groups[0].key).toBe("older");
  });
});

describe("matchesHistoryQuery", () => {
  it("matches case-insensitive on effective title and branch", () => {
    const s = mk("a", "2026-07-23T09:00:00Z", "fix/restart");
    expect(matchesHistoryQuery(s, "Mein Titel", "titel")).toBe(true);
    expect(matchesHistoryQuery(s, "Mein Titel", "RESTART")).toBe(true);
    expect(matchesHistoryQuery(s, "Mein Titel", "kanban")).toBe(false);
  });

  it("empty/whitespace query matches everything", () => {
    expect(matchesHistoryQuery(mk("a", ""), "x", "   ")).toBe(true);
  });
});

describe("buildRunningClaudeIds", () => {
  it("collects claudeSessionIds of live sessions only", () => {
    const ids = buildRunningClaudeIds([
      { claudeSessionId: "u1", status: "running" },
      { claudeSessionId: "u2", status: "done" },
      { claudeSessionId: undefined, status: "waiting" },
      { claudeSessionId: "u3", status: "starting" },
    ]);
    expect(ids.has("u1")).toBe(true);
    expect(ids.has("u3")).toBe(true);
    expect(ids.has("u2")).toBe(false);
    expect(ids.size).toBe(2);
  });
});
