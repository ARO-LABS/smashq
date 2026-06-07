import { describe, it, expect } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { seedDesignDocState } from "./mockState";
import { useSessionStore } from "../../store/sessionStore";

describe("seedDesignDocState", () => {
  it("seeds at least one session and stubs IPC (happy path)", async () => {
    seedDesignDocState();
    expect(useSessionStore.getState().sessions.length).toBeGreaterThan(0);
    await expect(invoke("open_folder_in_explorer", { path: "C:/x" })).resolves.toBeNull();
  });
});
