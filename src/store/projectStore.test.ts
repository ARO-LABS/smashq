import { describe, it, expect, beforeEach } from "vitest";
import { useProjectStore, sanitizeBoardRef } from "./projectStore";

const PROJECT_A = { projectNumber: 1, projectId: "PVT_a", title: "Board A" };
const PROJECT_B = { projectNumber: 2, projectId: "PVT_b", title: "Board B" };

function resetStore() {
  localStorage.clear();
  useProjectStore.setState({ globalProject: null });
}

beforeEach(() => {
  resetStore();
});

describe("setGlobalProject / getGlobalProject", () => {
  it("starts with no global project", () => {
    expect(useProjectStore.getState().getGlobalProject()).toBeUndefined();
  });

  it("stores and returns the global project", () => {
    useProjectStore.getState().setGlobalProject(PROJECT_A);
    expect(useProjectStore.getState().getGlobalProject()).toEqual(PROJECT_A);
  });

  it("overwrites the global project when set twice", () => {
    const store = useProjectStore.getState();
    store.setGlobalProject(PROJECT_A);
    store.setGlobalProject(PROJECT_B);
    expect(useProjectStore.getState().getGlobalProject()).toEqual(PROJECT_B);
  });

  it("returns undefined after the global project is cleared with null", () => {
    const store = useProjectStore.getState();
    store.setGlobalProject(PROJECT_A);
    store.setGlobalProject(null);
    expect(useProjectStore.getState().getGlobalProject()).toBeUndefined();
  });

  it("keeps globalProject as null in raw state when cleared", () => {
    const store = useProjectStore.getState();
    store.setGlobalProject(PROJECT_A);
    store.setGlobalProject(null);
    expect(useProjectStore.getState().globalProject).toBeNull();
  });
});

describe("persistence", () => {
  it("writes the global selection into localStorage under its store name", () => {
    useProjectStore.getState().setGlobalProject(PROJECT_A);
    const raw = localStorage.getItem("agentic-project-store");
    expect(raw).toBeTruthy();
    expect(raw).toContain("PVT_a");
  });
});

describe("sanitizeBoardRef", () => {
  it("accepts a valid board ref", () => {
    expect(
      sanitizeBoardRef({ projectNumber: 3, projectId: "PVT_x", title: "T" }),
    ).toEqual({ projectNumber: 3, projectId: "PVT_x", title: "T" });
  });

  it("preserves an owner login when present", () => {
    const r = sanitizeBoardRef({
      projectNumber: 1,
      projectId: "PVT_x",
      title: "T",
      owner: "ARO-LABS",
    });
    expect(r?.owner).toBe("ARO-LABS");
  });

  it("defaults a missing title to an empty string", () => {
    expect(sanitizeBoardRef({ projectNumber: 1, projectId: "PVT_x" })?.title).toBe("");
  });

  it("rejects a non-positive, non-integer, or NaN project number", () => {
    expect(sanitizeBoardRef({ projectNumber: 0, projectId: "PVT_x" })).toBeNull();
    expect(sanitizeBoardRef({ projectNumber: -1, projectId: "PVT_x" })).toBeNull();
    expect(sanitizeBoardRef({ projectNumber: NaN, projectId: "PVT_x" })).toBeNull();
    expect(sanitizeBoardRef({ projectNumber: 1.5, projectId: "PVT_x" })).toBeNull();
  });

  it("rejects a missing or empty projectId", () => {
    expect(sanitizeBoardRef({ projectNumber: 1, projectId: "" })).toBeNull();
    expect(sanitizeBoardRef({ projectNumber: 1 })).toBeNull();
  });

  it("rejects non-objects", () => {
    expect(sanitizeBoardRef(null)).toBeNull();
    expect(sanitizeBoardRef("x")).toBeNull();
    expect(sanitizeBoardRef(42)).toBeNull();
  });
});

describe("rehydrate: corruption recovery + v1->v2 migration", () => {
  it("drops a corrupt globalProject on rehydrate", async () => {
    localStorage.setItem(
      "agentic-project-store",
      JSON.stringify({
        state: { globalProject: { projectNumber: "bad", title: 5 } },
        version: 2,
      }),
    );
    await useProjectStore.persist.rehydrate();
    expect(useProjectStore.getState().globalProject).toBeNull();
  });

  it("keeps a valid globalProject on rehydrate", async () => {
    localStorage.setItem(
      "agentic-project-store",
      JSON.stringify({
        state: { globalProject: { projectNumber: 7, projectId: "PVT_ok", title: "OK" } },
        version: 2,
      }),
    );
    await useProjectStore.persist.rehydrate();
    expect(useProjectStore.getState().getGlobalProject()).toMatchObject({
      projectId: "PVT_ok",
    });
  });

  it("migrates a pre-v2 payload: drops projectByFolder, keeps globalProject", async () => {
    localStorage.setItem(
      "agentic-project-store",
      JSON.stringify({
        state: {
          projectByFolder: { "/repo/a": { projectNumber: 1, projectId: "PVT_a", title: "A" } },
          globalProject: { projectNumber: 9, projectId: "PVT_g", title: "G" },
        },
        version: 1,
      }),
    );
    await useProjectStore.persist.rehydrate();
    const state = useProjectStore.getState() as unknown as Record<string, unknown>;
    expect(state.globalProject).toMatchObject({ projectId: "PVT_g" });
    // The dropped per-folder map must not survive the migration.
    expect(state.projectByFolder).toBeUndefined();
  });
});
