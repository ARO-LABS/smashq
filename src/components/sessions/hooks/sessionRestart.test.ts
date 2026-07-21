import { describe, it, expect, beforeEach, vi } from "vitest";
import { restartSession } from "./sessionRestart";
import { useSessionStore } from "../../../store/sessionStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUIStore } from "../../../store/uiStore";
import { invoke } from "@tauri-apps/api/core";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

// ── Helpers ───────────────────────────────────────────────────────────

/** Args-Shape des `create_session`-Calls, wie restartSession ihn absetzt. */
interface CreateArgs {
  id: string;
  folder: string;
  title: string;
  shell: string;
  permissionMode: string;
  resumeSessionId?: string;
}

function seedSession(overrides: Partial<Parameters<ReturnType<typeof useSessionStore.getState>["addSession"]>[0]> = {}) {
  useSessionStore.getState().addSession({
    id: "sess-old",
    title: "Mein Projekt",
    folder: "C:/Projects/demo",
    shell: "gitbash",
    permissionMode: "plan",
    ...overrides,
  });
}

/** Default happy-path backend: close ok, create echoes the request. */
function mockBackendOk() {
  mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "create_session") {
      const a = args as CreateArgs;
      return { id: a.id, title: a.title, folder: a.folder, shell: a.shell };
    }
    return undefined;
  });
}

function createCalls(): CreateArgs[] {
  return mockedInvoke.mock.calls
    .filter(([cmd]) => cmd === "create_session")
    .map(([, args]) => args as unknown as CreateArgs);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("restartSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      layoutMode: "single",
      gridSessionIds: [],
      focusedGridSessionId: null,
    });
    useUIStore.setState({ toasts: [] });
    useSettingsStore.setState({ defaultPermissionMode: "default" });
  });

  it("happy path: closes the old session and starts a FRESH one with same folder/shell/permissionMode (no resume)", async () => {
    seedSession();
    mockBackendOk();

    await restartSession("sess-old");

    // Old PTY was closed via the existing close path.
    expect(mockedInvoke).toHaveBeenCalledWith("close_session", { id: "sess-old" });

    // Exactly one fresh create with the SAME settings…
    const creates = createCalls();
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({
      folder: "C:/Projects/demo",
      title: "Mein Projekt",
      shell: "gitbash",
      permissionMode: "plan",
    });
    // …and explicitly WITHOUT resume: restart means "start clean", the
    // maintainer decision for #13 — resume is a separate existing flow.
    expect(creates[0].resumeSessionId).toBeUndefined();
    // A fresh session id — restarting must not recycle the dead PTY's id.
    expect(creates[0].id).not.toBe("sess-old");

    // Store: old gone, exactly one new session in "starting" state.
    const sessions = useSessionStore.getState().sessions;
    expect(sessions.find((s) => s.id === "sess-old")).toBeUndefined();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      folder: "C:/Projects/demo",
      shell: "gitbash",
      permissionMode: "plan",
      status: "starting",
    });
    expect(sessions[0].claudeSessionId).toBeUndefined();
  });

  it("legacy session without stored permissionMode falls back to the current settings default", async () => {
    seedSession({ id: "sess-legacy", permissionMode: undefined });
    useSettingsStore.setState({ defaultPermissionMode: "auto" });
    mockBackendOk();

    await restartSession("sess-legacy");

    const creates = createCalls();
    expect(creates).toHaveLength(1);
    expect(creates[0].permissionMode).toBe("auto");
  });

  it("edge case: restarting an already-ended session proceeds even when close_session rejects", async () => {
    seedSession({ id: "sess-dead" });
    // Simulate a session whose PTY already exited (status error).
    useSessionStore.getState().setExitCode("sess-dead", 1);
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "close_session") {
        throw new Error("session not found");
      }
      const a = args as CreateArgs;
      return { id: a.id, title: a.title, folder: a.folder, shell: a.shell };
    });

    await restartSession("sess-dead");

    // Restart still went through: fresh session exists, old one is gone.
    const sessions = useSessionStore.getState().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).not.toBe("sess-dead");
    expect(sessions[0].status).toBe("starting");
    // The failed close is non-fatal by design — no error toast for it.
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });

  it("edge case: double-click while restart is in flight spawns only ONE fresh session", async () => {
    seedSession({ id: "sess-double" });
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "close_session") {
        await closeGate; // hold the first restart mid-flight
        return undefined;
      }
      const a = args as CreateArgs;
      return { id: a.id, title: a.title, folder: a.folder, shell: a.shell };
    });

    const first = restartSession("sess-double");
    const second = restartSession("sess-double"); // double-click
    releaseClose();
    await Promise.all([first, second]);

    // Without the in-flight guard this would be 2 — two fresh sessions for one card.
    expect(createCalls()).toHaveLength(1);
    expect(useSessionStore.getState().sessions).toHaveLength(1);
  });

  it("create failure: old session is gone, error surfaces as toast, no ghost session added", async () => {
    seedSession({ id: "sess-fail" });
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "create_session") {
        throw new Error("spawn failed");
      }
      return undefined;
    });

    await restartSession("sess-fail");

    expect(useSessionStore.getState().sessions).toHaveLength(0);
    const toasts = useUIStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe("error");
  });

  it("unknown session id: no IPC calls at all", async () => {
    await restartSession("does-not-exist");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  // ── Grid-Erhalt (Review-Finding PR #44) ─────────────────────────────

  it("grid session: fresh session re-enters gridSessionIds, layout and foreign focus survive", async () => {
    seedSession({ id: "sess-grid" });
    seedSession({ id: "sess-other", folder: "C:/Projects/other" });
    useSessionStore.setState({
      layoutMode: "grid",
      gridSessionIds: ["sess-grid", "sess-other"],
      // Fokus liegt auf der ANDEREN Zelle — der Restart darf ihn nicht klauen.
      focusedGridSessionId: "sess-other",
    });
    mockBackendOk();

    await restartSession("sess-grid");

    const state = useSessionStore.getState();
    const fresh = state.sessions.find((s) => s.id !== "sess-other");
    expect(fresh).toBeDefined();
    // Ohne Re-Add wäre die frische Session nur noch als Single sichtbar,
    // obwohl der User sie im Grid neu gestartet hat.
    expect(state.layoutMode).toBe("grid");
    expect(state.gridSessionIds).toContain(fresh!.id);
    expect(state.gridSessionIds).toContain("sess-other");
    expect(state.gridSessionIds).not.toContain("sess-grid");
    expect(state.focusedGridSessionId).toBe("sess-other");
  });

  it("last grid session: layoutMode flips back to grid with the fresh session as sole member", async () => {
    seedSession({ id: "sess-solo" });
    useSessionStore.setState({
      layoutMode: "grid",
      gridSessionIds: ["sess-solo"],
      focusedGridSessionId: "sess-solo",
    });
    mockBackendOk();

    await restartSession("sess-solo");

    const state = useSessionStore.getState();
    expect(state.sessions).toHaveLength(1);
    // removeSession flippt bei leerem Grid auf "single" — der Restart muss
    // Grid-Modus UND Mitgliedschaft wiederherstellen.
    expect(state.layoutMode).toBe("grid");
    expect(state.gridSessionIds).toEqual([state.sessions[0].id]);
  });

  it("single-mode session: restart does not put the fresh session into the grid", async () => {
    seedSession({ id: "sess-single" });
    mockBackendOk();

    await restartSession("sess-single");

    const state = useSessionStore.getState();
    expect(state.layoutMode).toBe("single");
    expect(state.gridSessionIds).toEqual([]);
  });

  // ── Close-Interleave-TOCTOU (Review-Finding PR #44) ─────────────────

  it("close interleave: session removed from the store during close_session aborts the restart (no create)", async () => {
    seedSession({ id: "sess-race" });
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "close_session") {
        // User schließt die Session währenddessen per X (SessionList.handleClose
        // lief) — der Restart darf danach KEINE frische Session mehr erzeugen.
        useSessionStore.getState().removeSession("sess-race");
        return undefined;
      }
      const a = args as CreateArgs;
      return { id: a.id, title: a.title, folder: a.folder, shell: a.shell };
    });

    await restartSession("sess-race");

    expect(createCalls()).toHaveLength(0);
    expect(useSessionStore.getState().sessions).toHaveLength(0);
  });

  // ── closePreview-Parität (Review-Finding PR #44) ────────────────────

  it("closes an open favorites preview after a successful restart (parity with useSessionCreation)", async () => {
    seedSession({ id: "sess-preview" });
    useUIStore.setState({ previewFolder: "C:/Projects/demo" });
    mockBackendOk();

    await restartSession("sess-preview");

    expect(useUIStore.getState().previewFolder).toBeNull();
  });
});
