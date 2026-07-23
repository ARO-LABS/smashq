/**
 * Test helpers for installing IPC-level Tauri stubs in integration tests.
 *
 * NOT a module mock — uses Tauri's official `mockIPC` from
 * `@tauri-apps/api/mocks`. Frontend production code (hooks, stores,
 * components) calls `invoke()` and `listen()` exactly as in production;
 * this helper intercepts the runtime boundary only.
 *
 * Use together with `setup.integration.ts`. Pair `installRealIPC()` with
 * `clearTauriIPC()` in `afterEach` to reset between tests.
 *
 * Plan reference: reports/2026-05-08-session-loading-real-tests-PLAN.md (Wave 2)
 */

import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { ClaudeSessionSummary } from "../components/sessions/sessionHistoryHelpers";

// ---------------------------------------------------------------------------
// IPC handler installation
// ---------------------------------------------------------------------------

/**
 * Per-command handler signature. Receives the args object the frontend
 * passed to `invoke()`; returns the value (or rejects to simulate an error).
 */
export type IPCHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

/**
 * Map of Tauri command name → handler. Tests provide only the commands they
 * need; unhandled commands throw to surface gaps loudly during test runs.
 */
export type IPCHandlerMap = Record<string, IPCHandler>;

/**
 * Install IPC handlers. Frontend `invoke()` calls route to the matching
 * handler; unhandled commands throw a descriptive error so missing handler
 * coverage is never silent.
 *
 * Tests must call `clearTauriIPC()` in `afterEach` to reset.
 */
export function installRealIPC(handlers: IPCHandlerMap): void {
  mockIPC(async (cmd, args) => {
    const handler = handlers[cmd];
    if (!handler) {
      throw new Error(
        `mockTauriIPC: unhandled invoke("${cmd}", ...). ` +
          `Add it to your handlers map or accept the failure as a test signal.`,
      );
    }
    return await handler((args ?? {}) as Record<string, unknown>);
  });
}

/**
 * Tear down IPC + event mocks. Idempotent; safe to call from a global
 * `afterEach` hook even in test files that never imported
 * `@tauri-apps/api/event` (and therefore never initialized the bus).
 */
export function clearTauriIPC(): void {
  clearMocks();
  const bus = getEventBus();
  if (bus) bus.bus.clear();
}

// ---------------------------------------------------------------------------
// Common Tauri-command handler builders
// ---------------------------------------------------------------------------

/**
 * Handler builder for `create_session` with call recording.
 *
 * Returns `{ handler, calls, reset }`:
 *   - `handler`: pass to `installRealIPC({ create_session: handler })`
 *   - `calls`: ordered list of args each invocation received — assert in tests
 *   - `reset()`: clear the recorded calls without re-installing the handler
 *
 * The handler echoes the args back as the production Rust command's response
 * shape: `{ id, title, folder, shell }`. Pass `responseOverride` to swap in
 * a fixed response (e.g. to simulate Rust returning a different id) or to
 * have the handler reject.
 */
export function buildCreateSessionHandler(opts?: {
  responseOverride?: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}): {
  handler: IPCHandler;
  calls: Array<Record<string, unknown>>;
  reset: () => void;
} {
  const calls: Array<Record<string, unknown>> = [];
  const handler: IPCHandler = async (args) => {
    calls.push({ ...args });
    if (opts?.responseOverride) return await opts.responseOverride(args);
    return {
      id: typeof args.id === "string" ? args.id : `mock-${calls.length}`,
      title: typeof args.title === "string" ? args.title : "untitled",
      folder: typeof args.folder === "string" ? args.folder : "",
      // Spiegelt resolve_shell_pref im Rust-Backend: "auto" wird zur
      // konkreten Plattform-Shell aufgeloest (Test-Referenz = Windows).
      shell:
        typeof args.shell === "string" && args.shell !== "auto" ? args.shell : "powershell",
    };
  };
  const reset = () => {
    calls.length = 0;
  };
  return { handler, calls, reset };
}

/**
 * No-op handler for `set_file_logging_enabled`. Hooks calling this command
 * during integration tests don't need a real Rust toggle — the global
 * flag lives in Rust and is irrelevant in jsdom.
 */
export function buildSetFileLoggingEnabledHandler(): IPCHandler {
  return async () => undefined;
}

/**
 * Handler for the dialog plugin's `open` command. The plugin-dialog wrapper
 * `open()` from `@tauri-apps/plugin-dialog` calls `invoke("plugin:dialog|open", ...)`
 * under the hood, so mockIPC catches it here.
 *
 * @param result What the dialog "returns": a string path (single file/dir),
 *               an array (multi-select), or null (user cancelled).
 */
export function buildDialogOpenHandler(
  result: string | string[] | null,
): IPCHandler {
  return async () => result;
}

// ---------------------------------------------------------------------------
// Canonical recipe (read this if you're a Wave-3+ test author)
// ---------------------------------------------------------------------------
//
// 1. Filename must end in `.integration.test.ts` so the integration vitest
//    config picks it up and the regular config skips it.
//
// 2. ALWAYS use real Zustand stores. Reset between tests with
//    `resetAllStores()` from `../../test/storeReset` (no mocks!).
//
// 3. ALWAYS go through `installRealIPC` for invoke routing. Never
//    `vi.mock("@tauri-apps/api/core")`. Use the handler builders above
//    where they fit; write your own when you need different behavior.
//
// 4. Use `emitTauriEvent(name, payload)` to drive listeners synchronously.
//    Cleanup is automatic via the global `afterEach(clearTauriIPC)` in
//    `setup.integration.ts` — no need to repeat in your file.
//
// 5. Real-fs fixtures: `mkdtempSync(join(tmpdir(), "name-"))` + `rmSync` in
//    afterEach. Pass the tempdir path to `buildScanClaudeSessionsHandler`.
//
// Minimal example:
//
//   import { describe, it, expect, beforeEach } from "vitest";
//   import { resetAllStores } from "../../test/storeReset";
//   import { installRealIPC, buildCreateSessionHandler } from "../../test/mockTauriIPC";
//   import { useSessionStore } from "../../store/sessionStore";
//
//   describe("my real test", () => {
//     beforeEach(() => { resetAllStores(); });
//
//     it("creates a session", async () => {
//       const { handler, calls } = buildCreateSessionHandler();
//       installRealIPC({ create_session: handler });
//       // ... drive your hook/component, assert on real store state + calls
//     });
//   });
//

// ---------------------------------------------------------------------------
// Event-bus driver
// ---------------------------------------------------------------------------

interface ExposedBus {
  bus: Set<{
    eventName: string;
    handler: (event: { payload: unknown; event: string; id: number }) => void;
    id: number;
  }>;
  nextId: () => number;
}

function getEventBus(): ExposedBus | null {
  return (
    (globalThis as unknown as { __TAURI_TEST_EVENT_BUS__?: ExposedBus })
      .__TAURI_TEST_EVENT_BUS__ ?? null
  );
}

function getEventBusOrThrow(): ExposedBus {
  const bus = getEventBus();
  if (!bus) {
    throw new Error(
      "mockTauriIPC: event bus not available. Make sure setup.integration.ts ran first " +
        "AND your test file imported `@tauri-apps/api/event` (the bus initializes lazily " +
        "via the vi.mock factory when the module is first imported).",
    );
  }
  return bus;
}

/**
 * Synchronously trigger all listeners for the given event. If a handler
 * throws, the rejection propagates to the test. Payload shape matches
 * real Tauri `Event<T>` ({ event, id, payload }) — no `windowLabel`,
 * intentionally, to keep parity with production.
 *
 * @param eventName Tauri event name (e.g. "session-status", "session-output")
 * @param payload The payload object frontend handlers receive as `event.payload`
 */
export async function emitTauriEvent(eventName: string, payload: unknown): Promise<void> {
  const { bus } = getEventBusOrThrow();
  const matching = Array.from(bus).filter((l) => l.eventName === eventName);
  for (const listener of matching) {
    listener.handler({ payload, event: eventName, id: listener.id });
  }
}

// ---------------------------------------------------------------------------
// Real-fs handler builders for common Tauri commands
// ---------------------------------------------------------------------------

/**
 * Mirror Rust's `folder_to_project_dir_name`: non-alphanumeric chars
 * (except '-') become '-'. Used by the scan_claude_sessions handler.
 *
 * NOTE: This is a JS reimplementation of the Rust slug logic. Drift risk
 * is mitigated by the Layer-A integration tests (src-tauri/tests/) which
 * cover the same fixture shapes against the real Rust code.
 */
function folderToProjectDirName(folder: string): string {
  return folder
    .split("")
    .map((c) => (/[A-Za-z0-9-]/.test(c) ? c : "-"))
    .join("");
}

/**
 * Test if a string is UUID-shaped (mirrors Rust's `is_uuid_like`).
 */
function isUuidLike(s: string): boolean {
  return s.length === 36 && /^[0-9a-fA-F-]+$/.test(s) && (s.match(/-/g)?.length ?? 0) === 4;
}

/**
 * Build a `scan_claude_sessions` handler that reads from a real tempdir
 * mimicking `~/.claude/projects/`. Closely mirrors the Rust scanner so
 * tests against this handler produce the same shape as Layer A integration
 * tests against the real Rust code.
 *
 * Caveat: this is a JS reimplementation, not the actual Rust code. Any
 * scenario tested against this handler should also have a matching Layer A
 * test as a contract anchor — see `src-tauri/tests/session_discovery.rs`.
 */
export function buildScanClaudeSessionsHandler(projectsRoot: string): IPCHandler {
  return async (args) => {
    const folder = args.folder;
    if (typeof folder !== "string") {
      throw new Error("scan_claude_sessions: folder must be a string");
    }
    const slug = folderToProjectDirName(folder).toLowerCase();

    let projectDirName: string | undefined;
    try {
      const entries = await fs.readdir(projectsRoot);
      projectDirName = entries.find((d) => d.toLowerCase() === slug);
    } catch {
      return [];
    }
    if (!projectDirName) return [];

    const projectDir = join(projectsRoot, projectDirName);
    let entries;
    try {
      entries = await fs.readdir(projectDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const summaries: Array<Record<string, unknown>> = [];
    const seenIds = new Set<string>();

    for (const entry of entries) {
      let sessionId: string | undefined;
      let jsonlPath: string | undefined;

      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const id = entry.name.slice(0, -".jsonl".length);
        if (isUuidLike(id) && !seenIds.has(id)) {
          sessionId = id;
          jsonlPath = join(projectDir, entry.name);
        }
      } else if (entry.isDirectory() && isUuidLike(entry.name) && !seenIds.has(entry.name)) {
        const inner = join(projectDir, entry.name, `${entry.name}.jsonl`);
        try {
          const stat = await fs.stat(inner);
          if (stat.isFile()) {
            sessionId = entry.name;
            jsonlPath = inner;
          }
        } catch {
          continue;
        }
      }
      if (!sessionId || !jsonlPath) continue;

      const summary = await parseJsonlFile(jsonlPath, sessionId);
      if (summary) {
        summaries.push(summary);
        seenIds.add(sessionId);
      }
    }

    // Pin locale to "en" for deterministic sort across Node versions/OS.
    // ISO-8601 timestamps sort lex-correctly under "en" collation, which
    // matches Rust's byte-lexicographic sort on the same input.
    summaries.sort((a, b) =>
      String(b.started_at).localeCompare(String(a.started_at), "en"),
    );
    return summaries;
  };
}

/**
 * Test-only alias for the frontend summary type, which itself mirrors Rust's
 * `ClaudeSessionSummary` struct (src-tauri/src/session/file_reader/session_history.rs:17-28).
 * Alias statt Shape-Kopie: eine Drift zwischen Test-Typ und Produktions-Typ
 * ist damit strukturell unmöglich. Use this in tests to type the result of
 * `invoke<TestClaudeSessionSummary[]>("scan_claude_sessions", ...)`.
 *
 * KNOWN LIMITATION: this JS handler hard-codes `subagent_count: 0`. The
 * real Rust scanner counts `subagents/*.meta.json` files. Tests that need
 * to assert subagent_count must use Layer A (src-tauri/tests/) instead.
 */
export type TestClaudeSessionSummary = ClaudeSessionSummary;

async function parseJsonlFile(
  path: string,
  sessionId: string,
): Promise<Record<string, unknown> | null> {
  let content: string;
  try {
    content = await fs.readFile(path, "utf-8");
  } catch {
    return null;
  }
  if (!content) return null;

  const lines = content.split("\n").filter(Boolean);
  if (lines.length === 0) return null;

  let title = "";
  let started_at = "";
  let ended_at = "";
  let model = "";
  let user_turns = 0;
  let total_messages = 0;
  let git_branch = "";
  let cwd = "";

  for (const line of lines) {
    let val: Record<string, unknown>;
    try {
      val = JSON.parse(line);
    } catch {
      continue;
    }
    total_messages++;

    if (typeof val.timestamp === "string") {
      if (!started_at) started_at = val.timestamp;
      ended_at = val.timestamp;
    }
    if (!git_branch && typeof val.gitBranch === "string") git_branch = val.gitBranch;
    if (!cwd && typeof val.cwd === "string") cwd = val.cwd;

    const msgType = typeof val.type === "string" ? val.type : "";
    const isSidechain = val.isSidechain === true;
    const isMeta = val.isMeta === true;

    if (msgType === "user" && !isSidechain && !isMeta) {
      const message = val.message as { content?: unknown } | undefined;
      const msgContent = message?.content;
      if (typeof msgContent === "string") {
        user_turns++;
        if (!title) {
          // CRITICAL: Rust uses `chars().take(120)` (Unicode scalar values).
          // JS `slice(0, 120)` cuts UTF-16 code units which mid-surrogate
          // for emoji etc. produces broken-rune titles. Use Array.from to
          // iterate code points, matching Rust's behavior 1:1.
          title = Array.from(msgContent).slice(0, 120).join("").replace(/\n/g, " ").trim();
        }
      } else if (Array.isArray(msgContent)) {
        const isToolResult = msgContent.some(
          (item) => (item as { type?: string }).type === "tool_result",
        );
        if (!isToolResult) user_turns++;
      }
    }

    if (msgType === "assistant" && !model) {
      const message = val.message as { model?: unknown } | undefined;
      if (typeof message?.model === "string") model = message.model;
    }
  }

  if (user_turns === 0 && !title) return null;
  if (!title) title = "(Kein Prompt)";

  return {
    session_id: sessionId,
    title,
    started_at,
    ended_at,
    model,
    user_turns,
    total_messages,
    subagent_count: 0,
    git_branch,
    cwd,
  };
}
