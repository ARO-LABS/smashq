/**
 * Layer-B integration tests for useSessionCreation.handleNewSessionFromDefaults.
 *
 * Covers the four code paths of the "Ein-Klick: Neue Session" flow that
 * previously had ZERO test coverage — every path was regression-roulette:
 *
 *   1. defaultProjectPath set        → spawn immediately, no folder picker.
 *   2. defaultProjectPath empty + picker returns a path
 *                                    → spawn AND nudge user via save-default toast.
 *   3. defaultProjectPath empty + picker cancelled (returns null)
 *                                    → no session, no toast.
 *   4. create_session rejects        → error toast, no session added.
 *   5. shell preference pass-through → Preference (inkl. "auto") geht roh ans
 *      Backend; die Aufloesung ist seit macOS-Support Rust-Sache.
 *
 * Real Zustand stores; no mocks of production code. IPC is intercepted via
 * Tauri's official `mockIPC` helper (see `src/test/mockTauriIPC.ts`).
 *
 * Plan reference: Wave 3 — B3.3.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useSessionCreation } from "./useSessionCreation";
import { useSessionStore } from "../../../store/sessionStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUIStore } from "../../../store/uiStore";
import { resetAllStores } from "../../../test/storeReset";
import {
  buildCreateSessionHandler,
  buildDialogOpenHandler,
  installRealIPC,
  type IPCHandler,
} from "../../../test/mockTauriIPC";

/**
 * Track every dialog-open invocation so tests can assert that the picker
 * was (or was not) invoked. Wraps the canonical `buildDialogOpenHandler`
 * to preserve its return-shape semantics.
 */
function buildTrackedDialogOpenHandler(result: string | null): {
  handler: IPCHandler;
  callCount: () => number;
} {
  const inner = buildDialogOpenHandler(result);
  let count = 0;
  const handler: IPCHandler = async (args) => {
    count++;
    return await inner(args);
  };
  return { handler, callCount: () => count };
}

describe("useSessionCreation.handleNewSessionFromDefaults — Layer-B", () => {
  beforeEach(() => {
    resetAllStores();
  });

  it("defaultProjectPath set → spawns session immediately, never opens the picker", async () => {
    useSettingsStore.getState().setDefaultProjectPath("C:\\Projects\\test");

    const { handler: createHandler, calls } = buildCreateSessionHandler();
    const { handler: dialogHandler, callCount: dialogCalls } =
      buildTrackedDialogOpenHandler("C:\\Should\\Not\\Be\\Used");

    installRealIPC({
      create_session: createHandler,
      "plugin:dialog|open": dialogHandler,
    });

    const { result } = renderHook(() => useSessionCreation());
    await act(async () => {
      await result.current.handleNewSessionFromDefaults();
    });

    // (a) create_session received the configured folder + resolved shell + folder-name title.
    expect(calls).toHaveLength(1);
    expect(calls[0].folder).toBe("C:\\Projects\\test");
    expect(calls[0].shell).toBe("auto"); // Preference geht unaufgeloest ans Backend
    expect(calls[0].title).toBe("test");
    expect(typeof calls[0].id).toBe("string");

    // (b) Session landed in the real store.
    const sessions = useSessionStore.getState().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].folder).toBe("C:\\Projects\\test");
    expect(sessions[0].title).toBe("test");
    expect(sessions[0].shell).toBe("powershell");

    // (c) Dialog was NEVER opened — that is the whole point of one-click.
    expect(dialogCalls()).toBe(0);

    // (d) No save-default nudge toast — only the picker-path emits that.
    const toasts = useUIStore.getState().toasts;
    expect(toasts.find((t) => t.title === "Default speichern?")).toBeUndefined();
  });

  it("defaultProjectPath empty + picker returns path → spawns AND emits save-default toast", async () => {
    // defaultProjectPath defaults to "" after resetAllStores, so no setup needed.
    expect(useSettingsStore.getState().defaultProjectPath).toBe("");

    const { handler: createHandler, calls } = buildCreateSessionHandler();
    const dialogHandler = buildDialogOpenHandler("C:\\Picked\\Folder");

    installRealIPC({
      create_session: createHandler,
      "plugin:dialog|open": dialogHandler,
    });

    const { result } = renderHook(() => useSessionCreation());
    await act(async () => {
      await result.current.handleNewSessionFromDefaults();
    });

    // Session created with the picked folder.
    expect(calls).toHaveLength(1);
    expect(calls[0].folder).toBe("C:\\Picked\\Folder");
    expect(calls[0].title).toBe("Folder");

    expect(useSessionStore.getState().sessions).toHaveLength(1);

    // Save-default toast surfaced with a "Speichern" action.
    const toasts = useUIStore.getState().toasts;
    const nudge = toasts.find((t) => t.title === "Default speichern?");
    expect(nudge).toBeDefined();
    expect(nudge?.type).toBe("info");
    expect(nudge?.action?.label).toBe("Speichern");
    expect(typeof nudge?.action?.onClick).toBe("function");

    // Action wires through to settings.setDefaultProjectPath.
    nudge?.action?.onClick();
    expect(useSettingsStore.getState().defaultProjectPath).toBe("C:\\Picked\\Folder");
  });

  it("defaultProjectPath empty + picker cancelled → no session, no toast", async () => {
    expect(useSettingsStore.getState().defaultProjectPath).toBe("");

    const { handler: createHandler, calls } = buildCreateSessionHandler();
    const dialogHandler = buildDialogOpenHandler(null); // user cancelled

    installRealIPC({
      create_session: createHandler,
      "plugin:dialog|open": dialogHandler,
    });

    const { result } = renderHook(() => useSessionCreation());
    await act(async () => {
      await result.current.handleNewSessionFromDefaults();
    });

    // No backend call.
    expect(calls).toHaveLength(0);
    // No session.
    expect(useSessionStore.getState().sessions).toHaveLength(0);
    // No toasts of any kind.
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });

  it("create_session rejects → error toast appears, no session added", async () => {
    useSettingsStore.getState().setDefaultProjectPath("C:\\Projects\\test");

    const failingCreate: IPCHandler = async () => {
      throw new Error("boom: backend pty spawn failed");
    };

    installRealIPC({ create_session: failingCreate });

    const { result } = renderHook(() => useSessionCreation());
    await act(async () => {
      await result.current.handleNewSessionFromDefaults();
    });

    // (a) Store stays clean — failed spawn must NOT leave a phantom session.
    expect(useSessionStore.getState().sessions).toHaveLength(0);

    // (b) Error toast surfaced with the production-defined title.
    const toasts = useUIStore.getState().toasts;
    const errorToast = toasts.find((t) => t.type === "error");
    expect(errorToast).toBeDefined();
    expect(errorToast?.title).toBe("Session-Start fehlgeschlagen");
    expect(errorToast?.message).toContain("boom: backend pty spawn failed");
  });

  describe("shell preference pass-through", () => {
    it("defaultShell=bash → invokes create_session with shell='bash'", async () => {
      useSettingsStore.getState().setDefaultProjectPath("C:\\Projects\\test");
      useSettingsStore.getState().setDefaultShell("bash");

      const { handler, calls } = buildCreateSessionHandler();
      installRealIPC({ create_session: handler });

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleNewSessionFromDefaults();
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].shell).toBe("bash");
    });

    it("defaultShell=powershell → invokes create_session with shell='powershell'", async () => {
      useSettingsStore.getState().setDefaultProjectPath("C:\\Projects\\test");
      useSettingsStore.getState().setDefaultShell("powershell");

      const { handler, calls } = buildCreateSessionHandler();
      installRealIPC({ create_session: handler });

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleNewSessionFromDefaults();
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].shell).toBe("powershell");
    });

    it("defaultShell=auto → invokes create_session with shell='auto', store erhaelt die aufgeloeste Shell", async () => {
      useSettingsStore.getState().setDefaultProjectPath("C:\\Projects\\test");
      useSettingsStore.getState().setDefaultShell("auto");

      const { handler, calls } = buildCreateSessionHandler();
      installRealIPC({ create_session: handler });

      const { result } = renderHook(() => useSessionCreation());
      await act(async () => {
        await result.current.handleNewSessionFromDefaults();
      });

      expect(calls).toHaveLength(1);
      // Die Aufloesung von "auto" ist Backend-Sache — ueber IPC geht die
      // rohe Preference, zurueck kommt die konkrete Shell (Mock: powershell).
      expect(calls[0].shell).toBe("auto");
      expect(useSessionStore.getState().sessions[0]?.shell).toBe("powershell");
    });
  });

  it("passes the global defaultPermissionMode through to create_session", async () => {
    useSettingsStore.getState().setDefaultProjectPath("C:\\Projects\\test");
    useSettingsStore.getState().setDefaultPermissionMode("auto");

    const { handler, calls } = buildCreateSessionHandler();
    installRealIPC({ create_session: handler });

    const { result } = renderHook(() => useSessionCreation());
    await act(async () => {
      await result.current.handleNewSessionFromDefaults();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].permissionMode).toBe("auto");
  });

  it("defaults permissionMode to 'default' when unset", async () => {
    useSettingsStore.getState().setDefaultProjectPath("C:\\Projects\\test");

    const { handler, calls } = buildCreateSessionHandler();
    installRealIPC({ create_session: handler });

    const { result } = renderHook(() => useSessionCreation());
    await act(async () => {
      await result.current.handleNewSessionFromDefaults();
    });

    expect(calls[0].permissionMode).toBe("default");
  });
});

/**
 * Layer-B integration tests for handleQuickStart — the favorite/Quick-Start
 * path that was the actual macOS session-start blocker. Favorites used to
 * hardcode shell "powershell" (→ absent `pwsh` on macOS), create_session
 * rejected, and the catch only logError'd — the user clicked and nothing
 * happened. These guard both halves of the fix: the failure is now visible,
 * and the favorite's preference (now "auto") reaches the backend verbatim.
 */
describe("useSessionCreation.handleQuickStart — Layer-B (macOS session-start guard)", () => {
  const favorite = {
    id: "fav-1",
    path: "/Users/me/proj",
    label: "Proj",
    shell: "auto" as const,
    addedAt: 0,
    lastUsedAt: 0,
    groupId: null,
    sortIndex: 0,
  };

  beforeEach(() => {
    resetAllStores();
  });

  it("favorite spawn failure surfaces a visible error toast (no silent logError)", async () => {
    const failingCreate: IPCHandler = async () => {
      throw new Error("shell executable 'pwsh' not found in PATH");
    };
    installRealIPC({ create_session: failingCreate });

    const { result } = renderHook(() => useSessionCreation());
    await act(async () => {
      await result.current.handleQuickStart(favorite);
    });

    // No phantom session left behind by the failed spawn.
    expect(useSessionStore.getState().sessions).toHaveLength(0);

    // The user sees the real backend error instead of nothing.
    const errorToast = useUIStore.getState().toasts.find((t) => t.type === "error");
    expect(errorToast).toBeDefined();
    expect(errorToast?.title).toBe("Session-Start fehlgeschlagen");
    expect(errorToast?.message).toContain("pwsh");
  });

  it("passes the favorite's shell preference through to create_session", async () => {
    const { handler, calls } = buildCreateSessionHandler();
    installRealIPC({ create_session: handler });

    const { result } = renderHook(() => useSessionCreation());
    await act(async () => {
      await result.current.handleQuickStart(favorite);
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].shell).toBe("auto");
    expect(calls[0].folder).toBe("/Users/me/proj");
    expect(useSessionStore.getState().sessions).toHaveLength(1);
  });

  it("passes the global defaultPermissionMode through on quick-start", async () => {
    useSettingsStore.getState().setDefaultPermissionMode("plan");
    const { handler, calls } = buildCreateSessionHandler();
    installRealIPC({ create_session: handler });

    const { result } = renderHook(() => useSessionCreation());
    await act(async () => {
      await result.current.handleQuickStart(favorite);
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].permissionMode).toBe("plan");
  });
});
