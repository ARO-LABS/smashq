import { describe, it, expect } from "vitest";
import { getStatusStyle, STATUS_STYLES, PULSE_STATUSES } from "./statusConfig";

describe("getStatusStyle", () => {
  it("returns active style for 'active'", () => {
    expect(getStatusStyle("active")).toBe(STATUS_STYLES.active);
  });

  it("returns error style for 'error'", () => {
    expect(getStatusStyle("error")).toBe(STATUS_STYLES.error);
  });

  it("returns done style for 'done'", () => {
    expect(getStatusStyle("done")).toBe(STATUS_STYLES.done);
  });

  it("returns idle style for unknown status", () => {
    expect(getStatusStyle("nonexistent")).toBe(STATUS_STYLES.idle);
  });

  it("returns idle style for empty string", () => {
    expect(getStatusStyle("")).toBe(STATUS_STYLES.idle);
  });

  it("returns idle style for 'idle' itself", () => {
    expect(getStatusStyle("idle")).toBe(STATUS_STYLES.idle);
  });

  it("returns running style for 'running'", () => {
    expect(getStatusStyle("running")).toBe(STATUS_STYLES.running);
  });

  it("returns pass style for 'pass'", () => {
    expect(getStatusStyle("pass")).toBe(STATUS_STYLES.pass);
  });

  it("returns fail style for 'fail'", () => {
    expect(getStatusStyle("fail")).toBe(STATUS_STYLES.fail);
  });

  it("returns blocked style for 'blocked'", () => {
    expect(getStatusStyle("blocked")).toBe(STATUS_STYLES.blocked);
  });

  it("returns waiting style for 'waiting'", () => {
    expect(getStatusStyle("waiting")).toBe(STATUS_STYLES.waiting);
  });

  it("returns pending style for 'pending'", () => {
    expect(getStatusStyle("pending")).toBe(STATUS_STYLES.pending);
  });

  it("returns skipped style for 'skipped'", () => {
    expect(getStatusStyle("skipped")).toBe(STATUS_STYLES.skipped);
  });

  it("returns planning style for 'planning'", () => {
    expect(getStatusStyle("planning")).toBe(STATUS_STYLES.planning);
  });

  it("returns generated_manifest style for 'generated_manifest'", () => {
    expect(getStatusStyle("generated_manifest")).toBe(
      STATUS_STYLES.generated_manifest,
    );
  });

  it("returns waiting_for_input style for 'waiting_for_input'", () => {
    expect(getStatusStyle("waiting_for_input")).toBe(
      STATUS_STYLES.waiting_for_input,
    );
  });

  it("is case-sensitive — uppercase keys fall back to idle", () => {
    expect(getStatusStyle("ACTIVE")).toBe(STATUS_STYLES.idle);
  });

  it("returns idle for status names not in the map", () => {
    expect(getStatusStyle("unknown-state")).toBe(STATUS_STYLES.idle);
    expect(getStatusStyle("123")).toBe(STATUS_STYLES.idle);
  });
});

describe("STATUS_STYLES map", () => {
  const ALL_KEYS = [
    "idle", "active", "running", "done", "pass", "error", "fail",
    "blocked", "waiting", "pending", "skipped", "planning",
    "generated_manifest", "waiting_for_input",
  ];

  it("exposes exactly the canonical status keys", () => {
    expect(Object.keys(STATUS_STYLES).sort()).toEqual([...ALL_KEYS].sort());
  });

  it("every entry has text/border/bg/dot fields", () => {
    for (const style of Object.values(STATUS_STYLES)) {
      expect(style).toHaveProperty("text");
      expect(style).toHaveProperty("border");
      expect(style).toHaveProperty("bg");
      expect(style).toHaveProperty("dot");
    }
  });

  it("active and running share identical accent styling", () => {
    expect(STATUS_STYLES.active).toEqual(STATUS_STYLES.running);
  });

  it("done and pass share identical success styling", () => {
    expect(STATUS_STYLES.done).toEqual(STATUS_STYLES.pass);
  });

  it("error and fail share identical error styling", () => {
    expect(STATUS_STYLES.error).toEqual(STATUS_STYLES.fail);
  });

  it("blocked and waiting share identical warning styling", () => {
    expect(STATUS_STYLES.blocked).toEqual(STATUS_STYLES.waiting);
  });

  it("idle and pending share identical neutral styling", () => {
    expect(STATUS_STYLES.idle).toEqual(STATUS_STYLES.pending);
  });

  it("planning uses accent tokens", () => {
    expect(STATUS_STYLES.planning.text).toBe("text-accent");
    expect(STATUS_STYLES.planning.dot).toBe("bg-accent");
  });

  it("skipped uses a distinct dimmer neutral than idle", () => {
    expect(STATUS_STYLES.skipped.text).toBe("text-neutral-400");
    expect(STATUS_STYLES.skipped.text).not.toBe(STATUS_STYLES.idle.text);
  });

  it("error border uses border-error token", () => {
    expect(STATUS_STYLES.error.border).toBe("border-error");
  });
});

describe("PULSE_STATUSES set", () => {
  it("contains exactly active, running, planning", () => {
    expect([...PULSE_STATUSES].sort()).toEqual(
      ["active", "planning", "running"],
    );
  });

  it("includes the in-progress statuses", () => {
    expect(PULSE_STATUSES.has("active")).toBe(true);
    expect(PULSE_STATUSES.has("running")).toBe(true);
    expect(PULSE_STATUSES.has("planning")).toBe(true);
  });

  it("excludes terminal and idle statuses", () => {
    for (const s of ["idle", "done", "error", "pass", "fail", "skipped", "pending"]) {
      expect(PULSE_STATUSES.has(s)).toBe(false);
    }
  });

  it("excludes unknown statuses", () => {
    expect(PULSE_STATUSES.has("nonexistent")).toBe(false);
  });
});
