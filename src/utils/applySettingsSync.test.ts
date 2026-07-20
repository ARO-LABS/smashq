import { describe, it, expect, vi, beforeEach } from "vitest";
import { applySettingsSync } from "./wireRuntimeGates";
import { useSettingsStore } from "../store/settingsStore";
import { broadcastPreferencesChange } from "./preferencesBroadcast";

// Eigene Testdatei statt wireRuntimeGates.test.ts: dort ist der settingsStore
// modulweit gemockt — applySettingsSync braucht aber den echten Store, weil
// genau das Zusammenspiel mit setState getestet wird.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve("")) }));

// broadcastPreferencesChange spy-en (Rest des Moduls bleibt echt, weil
// wireRuntimeGates auch listenForPreferencesChanges importiert): so lässt sich
// der Sender-Payload einfangen und für den Roundtrip an den Empfänger füttern.
vi.mock("./preferencesBroadcast", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./preferencesBroadcast")>();
  return { ...mod, broadcastPreferencesChange: vi.fn(() => Promise.resolve()) };
});

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
      autoUpdateEnabled: true,
    });
    vi.mocked(broadcastPreferencesChange).mockClear();
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
    applySettingsSync({
      defaultPermissionMode: "default",
      sound: { volume: 1 },
      autoUpdateEnabled: true,
    });
    expect(useSettingsStore.getState()).toBe(before);
  });

  it("wendet autoUpdateEnabled=false an (Auto-Check abschalten kommt im Hauptfenster an)", () => {
    applySettingsSync({ autoUpdateEnabled: false });
    expect(useSettingsStore.getState().autoUpdateEnabled).toBe(false);
  });

  it("sanitisiert korrupten autoUpdateEnabled-Wert (Trust-Boundary) auf true — Update-Kanal bleibt offen", () => {
    useSettingsStore.setState({ autoUpdateEnabled: false });
    // String "false" ist truthy-Müll: ohne Sanitize würde er roh in den
    // persistierten State laufen. Fail-safe ist true (Kanal offen).
    applySettingsSync({ autoUpdateEnabled: "false" as never });
    expect(useSettingsStore.getState().autoUpdateEnabled).toBe(true);
  });

  it("Roundtrip (Bug-Klasse PR #40): Setter im Sekundärfenster → Broadcast-Payload → Empfänger übernimmt den Wert", () => {
    // Sekundärfenster-Seite: der Setter MUSS die settingsSync-Variante
    // broadcasten — Disk-Writes des Settings-Fensters verwirft tauriStorage.
    useSettingsStore.getState().setAutoUpdateEnabled(false);
    const payload = vi.mocked(broadcastPreferencesChange).mock.calls.at(-1)?.[0];
    expect(payload).toEqual({ settingsSync: { autoUpdateEnabled: false } });

    // Empfängerfenster-Seite: dort steht der Wert noch auf true — genau der
    // Zustand, in dem ein vergessener applySettingsSync-Zweig den Wert still
    // verlieren würde (der Empfänger ist nicht compile-time-exhaustiv).
    useSettingsStore.setState({ autoUpdateEnabled: true });
    const sync = (payload as { settingsSync: Parameters<typeof applySettingsSync>[0] }).settingsSync;
    applySettingsSync(sync);
    expect(useSettingsStore.getState().autoUpdateEnabled).toBe(false);
  });
});
