import { describe, it, expect } from "vitest";
import { dedupRestorableSessions } from "./sessionRestoreSync";
import type { ClaudeSession } from "./sessionStore";

function makeSession(overrides: Partial<ClaudeSession>): ClaudeSession {
  return {
    id: "s-default",
    title: "Test",
    folder: "C:/projects/x",
    shell: "powershell",
    status: "running",
    createdAt: 0,
    finishedAt: null,
    exitCode: null,
    lastOutputAt: 0,
    lastOutputSnippet: "",
    ...overrides,
  };
}

describe("dedupRestorableSessions", () => {
  it("returns empty array for empty input", () => {
    expect(dedupRestorableSessions([])).toEqual([]);
  });

  it("preserves all sessions when claudeSessionIds are unique", () => {
    const result = dedupRestorableSessions([
      makeSession({ id: "s1", title: "m2", claudeSessionId: "uuid-1" }),
      makeSession({ id: "s2", title: "m2", claudeSessionId: "uuid-2" }),
      makeSession({ id: "s3", title: "m2", claudeSessionId: "uuid-3" }),
    ]);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.claudeSessionId)).toEqual(["uuid-1", "uuid-2", "uuid-3"]);
  });

  it("collapses cards that share the same claudeSessionId — first card wins", () => {
    // The exact bug-state: 3 frontend cards latched onto the same backend
    // session via the discovery race. Only one should be persisted.
    const result = dedupRestorableSessions([
      makeSession({ id: "s1", title: "m2", folder: "C:/proj/m2", claudeSessionId: "uuid-shared" }),
      makeSession({ id: "s2", title: "m2", folder: "C:/proj/m2", claudeSessionId: "uuid-shared" }),
      makeSession({ id: "s3", title: "m2", folder: "C:/proj/m2", claudeSessionId: "uuid-shared" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].claudeSessionId).toBe("uuid-shared");
    expect(result[0].folder).toBe("C:/proj/m2");
  });

  it("keeps the first occurrence and drops later duplicates", () => {
    const result = dedupRestorableSessions([
      makeSession({ id: "s1", title: "first", claudeSessionId: "uuid-A" }),
      makeSession({ id: "s2", title: "second", claudeSessionId: "uuid-B" }),
      makeSession({ id: "s3", title: "duplicate-of-first", claudeSessionId: "uuid-A" }),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("first");
    expect(result[1].title).toBe("second");
  });

  it("never deduplicates sessions without a claudeSessionId — even if folder matches", () => {
    // Two fresh sessions in the same folder before discovery has run are
    // legitimately distinct. The restore-side claim set assigns distinct
    // UUIDs on the next start.
    const result = dedupRestorableSessions([
      makeSession({ id: "s1", title: "m2", folder: "C:/proj/m2", claudeSessionId: undefined }),
      makeSession({ id: "s2", title: "m2", folder: "C:/proj/m2", claudeSessionId: undefined }),
    ]);

    expect(result).toHaveLength(2);
  });

  it("mixes deduped (with id) and preserved (without id) entries correctly", () => {
    const result = dedupRestorableSessions([
      makeSession({ id: "s1", title: "discovered", claudeSessionId: "uuid-X" }),
      makeSession({ id: "s2", title: "fresh-1", claudeSessionId: undefined }),
      makeSession({ id: "s3", title: "discovered-dup", claudeSessionId: "uuid-X" }),
      makeSession({ id: "s4", title: "fresh-2", claudeSessionId: undefined }),
    ]);

    // s3 dropped (duplicate of s1); s2 and s4 both kept.
    expect(result.map((r) => r.title)).toEqual(["discovered", "fresh-1", "fresh-2"]);
  });

  it("strips frontend-only fields (id, status, lastOutput*) from persisted shape", () => {
    const result = dedupRestorableSessions([
      makeSession({
        id: "s-frontend-only",
        title: "m2",
        folder: "C:/proj/m2",
        shell: "powershell",
        claudeSessionId: "uuid-1",
        status: "running",
        lastOutputAt: 12345,
        lastOutputSnippet: "secret content",
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(Object.keys(result[0]).sort()).toEqual(
      ["claudeSessionId", "folder", "shell", "title"].sort(),
    );
  });
});
