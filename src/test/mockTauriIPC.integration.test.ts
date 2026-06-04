/**
 * Wave-2 smoke test — proves the integration test infrastructure works
 * end-to-end: real Node-fs fixtures, real Tauri-API surface, real event
 * bus driver. NO production-code mocks; every `invoke()` and `listen()`
 * call goes through the same path Wave-3+ tests will use.
 *
 * Plan reference: reports/2026-05-08-session-loading-real-tests-PLAN.md (Wave 2)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildScanClaudeSessionsHandler,
  clearTauriIPC,
  emitTauriEvent,
  installRealIPC,
} from "./mockTauriIPC";

describe("mockTauriIPC — Wave 2 integration smoke", () => {
  let projectsRoot: string;

  beforeEach(() => {
    projectsRoot = mkdtempSync(join(tmpdir(), "claude-projects-test-"));
  });

  afterEach(() => {
    clearTauriIPC();
    rmSync(projectsRoot, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------
  // invoke() routing
  // ---------------------------------------------------------------------

  describe("invoke routing", () => {
    it("routes invoke() to a matching handler", async () => {
      installRealIPC({
        custom_cmd: async (args) => ({ echoed: args.x }),
      });
      const result = await invoke<{ echoed: number }>("custom_cmd", { x: 42 });
      expect(result.echoed).toBe(42);
    });

    it("throws on unhandled command — surfaces gaps loudly", async () => {
      installRealIPC({});
      // Tight regex that matches the actual error prefix in mockTauriIPC.ts.
      // Loose /unhandled/ would pass on any error containing the word.
      await expect(invoke("never_registered", {})).rejects.toThrow(
        /mockTauriIPC: unhandled invoke/,
      );
    });

    it("handler errors propagate as rejected promises", async () => {
      installRealIPC({
        failing_cmd: async () => {
          throw new Error("simulated backend failure");
        },
      });
      await expect(invoke("failing_cmd", {})).rejects.toThrow(/simulated backend failure/);
    });
  });

  // ---------------------------------------------------------------------
  // buildScanClaudeSessionsHandler — real fs, mirrors Rust scanner
  // ---------------------------------------------------------------------

  describe("buildScanClaudeSessionsHandler — real fs against tempdir", () => {
    it("returns empty array when project dir does not exist", async () => {
      installRealIPC({
        scan_claude_sessions: buildScanClaudeSessionsHandler(projectsRoot),
      });
      const result = await invoke<unknown[]>("scan_claude_sessions", {
        folder: "C:\\NonExistent",
      });
      expect(result).toEqual([]);
    });

    it("parses one JSONL session and returns summary matching Rust shape", async () => {
      const projectDir = join(projectsRoot, "C--test-app");
      mkdirSync(projectDir);
      writeFileSync(
        join(projectDir, "12345678-1234-4234-8234-123456789012.jsonl"),
        '{"type":"user","timestamp":"2026-05-08T10:00:00Z","message":{"content":"hi"},"isSidechain":false,"isMeta":false}',
      );

      installRealIPC({
        scan_claude_sessions: buildScanClaudeSessionsHandler(projectsRoot),
      });
      const result = await invoke<
        Array<{ session_id: string; title: string; user_turns: number; started_at: string }>
      >("scan_claude_sessions", { folder: "C:\\test\\app" });

      expect(result).toHaveLength(1);
      expect(result[0].session_id).toBe("12345678-1234-4234-8234-123456789012");
      expect(result[0].title).toBe("hi");
      expect(result[0].user_turns).toBe(1);
      expect(result[0].started_at).toBe("2026-05-08T10:00:00Z");
    });

    it("returns sessions DESC-sorted by started_at (adversarial: filename-sort != timestamp-sort)", async () => {
      // Adversarial fixture: UUIDs are lex-ASCENDING (aaa…/bbb…/ccc…) but
      // timestamps are lex-DESCENDING (300/200/100 ms). A regression that
      // sorts by filename instead of started_at would order [aaa, bbb, ccc]
      // → started_at [300, 200, 100] (ALSO descending by coincidence!).
      // To break that ambiguity, we INVERT the timestamps: aaa gets the
      // OLDEST timestamp, ccc gets the NEWEST. Filename-sort produces
      // [aaa, bbb, ccc] = [oldest, mid, newest] which is ASC by timestamp.
      // Timestamp-DESC produces [ccc, bbb, aaa]. The two orderings are now
      // distinct, so the test catches a filename-sort regression.
      const projectDir = join(projectsRoot, "C--test-m2");
      mkdirSync(projectDir);
      const fixtures: Array<[string, string]> = [
        ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "2026-05-08T10:00:00.100Z"], // oldest
        ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "2026-05-08T10:00:00.200Z"], // middle
        ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "2026-05-08T10:00:00.300Z"], // newest
      ];
      for (const [uuid, ts] of fixtures) {
        writeFileSync(
          join(projectDir, `${uuid}.jsonl`),
          `{"type":"user","timestamp":"${ts}","message":{"content":"x"},"isSidechain":false,"isMeta":false}`,
        );
      }

      installRealIPC({
        scan_claude_sessions: buildScanClaudeSessionsHandler(projectsRoot),
      });
      const result = await invoke<Array<{ session_id: string; started_at: string }>>(
        "scan_claude_sessions",
        { folder: "C:\\test\\m2" },
      );

      expect(result).toHaveLength(3);
      // Newest timestamp → highest UUID (ccc), NOT the lowest UUID.
      // If a regression sorts by filename, [0] would be "aaa…", failing here.
      expect(result[0].session_id).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
      expect(result[0].started_at).toBe("2026-05-08T10:00:00.300Z");
      expect(result[2].session_id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      expect(result[2].started_at).toBe("2026-05-08T10:00:00.100Z");
      const uuids = new Set(result.map((s) => s.session_id));
      expect(uuids.size).toBe(3);
    });

    it("title truncation matches Rust chars().take(120) for multi-byte content", async () => {
      // Locks the JS↔Rust title-truncation contract. Rust uses
      // `chars().take(120)` (Unicode scalar values). The JS handler must
      // use Array.from(...).slice(0, 120) (code points), NOT slice(0, 120)
      // (UTF-16 units). With emoji content, slice(0, 120) cuts mid-
      // surrogate-pair and produces broken titles.
      const projectDir = join(projectsRoot, "C--test-truncate");
      mkdirSync(projectDir);
      // 200 emoji = 200 code points = 400 UTF-16 units. Truncate to 120
      // code points, which is 240 UTF-16 units. The test passes only if
      // the JS handler iterates code points correctly.
      const longTitle = "😀".repeat(200);
      writeFileSync(
        join(projectDir, "11111111-1111-4111-8111-111111111111.jsonl"),
        JSON.stringify({
          type: "user",
          timestamp: "2026-05-08T10:00:00Z",
          message: { content: longTitle },
          isSidechain: false,
          isMeta: false,
        }),
      );

      installRealIPC({
        scan_claude_sessions: buildScanClaudeSessionsHandler(projectsRoot),
      });
      const result = await invoke<Array<{ title: string }>>("scan_claude_sessions", {
        folder: "C:\\test\\truncate",
      });

      expect(result).toHaveLength(1);
      // Rust contract: chars().take(120) → 120 emoji glyphs.
      const titleCodePoints = Array.from(result[0].title).length;
      expect(titleCodePoints).toBe(120);
      // And the title must NOT contain a lone surrogate (slice-bug signature).
      // Each code point of an emoji is 2 UTF-16 units, but Array.from re-pairs them.
      expect(result[0].title.length).toBe(240); // 120 code points × 2 UTF-16 units each
    });

    it("filters non-UUID-named JSONL files (matches Rust is_uuid_like)", async () => {
      const projectDir = join(projectsRoot, "C--test-filter");
      mkdirSync(projectDir);
      writeFileSync(
        join(projectDir, "11111111-1111-4111-8111-111111111111.jsonl"),
        '{"type":"user","timestamp":"2026-05-08T10:00:00Z","message":{"content":"real"},"isSidechain":false,"isMeta":false}',
      );
      writeFileSync(
        join(projectDir, "notes.jsonl"),
        '{"type":"user","timestamp":"2026-05-08T11:00:00Z","message":{"content":"notes"},"isSidechain":false,"isMeta":false}',
      );
      writeFileSync(join(projectDir, "1234.jsonl"), "{}");

      installRealIPC({
        scan_claude_sessions: buildScanClaudeSessionsHandler(projectsRoot),
      });
      const result = await invoke<Array<{ session_id: string }>>("scan_claude_sessions", {
        folder: "C:\\test\\filter",
      });

      expect(result).toHaveLength(1);
      expect(result[0].session_id).toBe("11111111-1111-4111-8111-111111111111");
    });
  });

  // ---------------------------------------------------------------------
  // Event-bus driver
  // ---------------------------------------------------------------------

  describe("event bus driver", () => {
    it("listen + emitTauriEvent: payload reaches listener", async () => {
      const received: Array<{ id: string; status: string }> = [];
      const unlisten = await listen<{ id: string; status: string }>(
        "session-status",
        (event) => received.push(event.payload),
      );

      await emitTauriEvent("session-status", { id: "s1", status: "running" });

      expect(received).toEqual([{ id: "s1", status: "running" }]);
      unlisten();
    });

    it("multiple listeners for same event all fire", async () => {
      const a: unknown[] = [];
      const b: unknown[] = [];
      const unA = await listen("ping", (e) => a.push(e.payload));
      const unB = await listen("ping", (e) => b.push(e.payload));

      await emitTauriEvent("ping", { value: 42 });

      expect(a).toEqual([{ value: 42 }]);
      expect(b).toEqual([{ value: 42 }]);
      unA();
      unB();
    });

    it("listeners on different events are isolated", async () => {
      const aReceived: unknown[] = [];
      const bReceived: unknown[] = [];
      await listen("event-a", (e) => aReceived.push(e.payload));
      await listen("event-b", (e) => bReceived.push(e.payload));

      await emitTauriEvent("event-a", "for-a");
      await emitTauriEvent("event-b", "for-b");

      expect(aReceived).toEqual(["for-a"]);
      expect(bReceived).toEqual(["for-b"]);
    });

    it("unlisten removes the listener — emit after unlisten produces no callback", async () => {
      const received: unknown[] = [];
      const unlisten = await listen("once-only", (e) => received.push(e.payload));
      unlisten();
      await emitTauriEvent("once-only", "should-not-arrive");
      expect(received).toEqual([]);
    });

    it("clearTauriIPC drops all listeners (cross-test isolation)", async () => {
      const received: unknown[] = [];
      await listen("survives-clear", (e) => received.push(e.payload));

      clearTauriIPC();

      await emitTauriEvent("survives-clear", "should-not-arrive");
      expect(received).toEqual([]);
    });
  });
});
