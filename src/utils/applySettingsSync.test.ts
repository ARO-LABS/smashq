import { describe, it, expect, vi, beforeEach } from "vitest";
import { applySettingsSync } from "./wireRuntimeGates";
import { useSettingsStore } from "../store/settingsStore";

// Eigene Testdatei statt wireRuntimeGates.test.ts: dort ist der settingsStore
// modulweit gemockt — applySettingsSync braucht aber den echten Store, weil
// genau das Zusammenspiel mit setState getestet wird.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve("")) }));

describe("applySettingsSync — Empfänger für Cross-Window-Settings", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      defaultPermissionMode: "default",
      defaultShell: "auto",
      defaultProjectPath: "",
      notifications: {
        enabled: true,
        pipelineComplete: true,
        pipelineError: true,
        qaGateResult: true,
        costAlert: true,
      },
      sound: { enabled: true, volume: 1 },
    });
  });

  it("wendet defaultPermissionMode an", () => {
    applySettingsSync({ defaultPermissionMode: "bypass" });
    expect(useSettingsStore.getState().defaultPermissionMode).toBe("bypass");
  });

  it("sanitisiert ungültigen PermissionMode (Trust-Boundary) auf 'default'", () => {
    useSettingsStore.setState({ defaultPermissionMode: "plan" });
    applySettingsSync({ defaultPermissionMode: "yolo" as never });
    expect(useSettingsStore.getState().defaultPermissionMode).toBe("default");
  });

  it("verwirft unbekannte Shell-Werte, wendet gültige an", () => {
    applySettingsSync({ defaultShell: "fish" as never });
    expect(useSettingsStore.getState().defaultShell).toBe("auto");
    applySettingsSync({ defaultShell: "zsh" });
    expect(useSettingsStore.getState().defaultShell).toBe("zsh");
  });

  it("wendet defaultProjectPath an, ignoriert Nicht-Strings", () => {
    applySettingsSync({ defaultProjectPath: "C:/projekte" });
    expect(useSettingsStore.getState().defaultProjectPath).toBe("C:/projekte");
    applySettingsSync({ defaultProjectPath: 42 as never });
    expect(useSettingsStore.getState().defaultProjectPath).toBe("C:/projekte");
  });

  it("merged notifications-/sound-Partials statt zu ersetzen", () => {
    applySettingsSync({ notifications: { enabled: false }, sound: { volume: 0.3 } });
    const s = useSettingsStore.getState();
    expect(s.notifications.enabled).toBe(false);
    expect(s.notifications.pipelineComplete).toBe(true);
    expect(s.sound.volume).toBe(0.3);
    expect(s.sound.enabled).toBe(true);
  });

  it("no-op wenn nichts sich ändert (kein setState, keine Re-Render-Welle)", () => {
    const before = useSettingsStore.getState();
    applySettingsSync({ defaultPermissionMode: "default", sound: { volume: 1 } });
    expect(useSettingsStore.getState()).toBe(before);
  });
});
