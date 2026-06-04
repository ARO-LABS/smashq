import { describe, it, expect, beforeEach } from "vitest";
import { useProjectStore } from "./projectStore";

const PROJECT_A = { projectNumber: 1, projectId: "PVT_a", title: "Board A" };
const PROJECT_B = { projectNumber: 2, projectId: "PVT_b", title: "Board B" };

function resetStore() {
  localStorage.clear();
  useProjectStore.setState({ projectByFolder: {}, globalProject: null });
}

beforeEach(() => {
  resetStore();
});

describe("setFolderProject / getProjectForFolder", () => {
  it("stores a project under its folder path", () => {
    useProjectStore.getState().setFolderProject("/repo/a", PROJECT_A);
    expect(useProjectStore.getState().getProjectForFolder("/repo/a")).toEqual(
      PROJECT_A,
    );
  });

  it("returns undefined for a folder that has no project", () => {
    expect(
      useProjectStore.getState().getProjectForFolder("/unknown"),
    ).toBeUndefined();
  });

  it("keeps projects for different folders independent", () => {
    const store = useProjectStore.getState();
    store.setFolderProject("/repo/a", PROJECT_A);
    store.setFolderProject("/repo/b", PROJECT_B);
    expect(useProjectStore.getState().getProjectForFolder("/repo/a")).toEqual(
      PROJECT_A,
    );
    expect(useProjectStore.getState().getProjectForFolder("/repo/b")).toEqual(
      PROJECT_B,
    );
  });

  it("overwrites the project when the same folder is set twice", () => {
    const store = useProjectStore.getState();
    store.setFolderProject("/repo/a", PROJECT_A);
    store.setFolderProject("/repo/a", PROJECT_B);
    expect(useProjectStore.getState().getProjectForFolder("/repo/a")).toEqual(
      PROJECT_B,
    );
  });

  it("does not mutate the previous projectByFolder map", () => {
    useProjectStore.getState().setFolderProject("/repo/a", PROJECT_A);
    const first = useProjectStore.getState().projectByFolder;
    useProjectStore.getState().setFolderProject("/repo/b", PROJECT_B);
    const second = useProjectStore.getState().projectByFolder;
    expect(first).not.toBe(second);
    expect(first["/repo/b"]).toBeUndefined();
  });
});

describe("setGlobalProject / getGlobalProject", () => {
  it("starts with no global project", () => {
    expect(useProjectStore.getState().getGlobalProject()).toBeUndefined();
  });

  it("stores and returns the global project", () => {
    useProjectStore.getState().setGlobalProject(PROJECT_A);
    expect(useProjectStore.getState().getGlobalProject()).toEqual(PROJECT_A);
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
  it("writes folder selections into localStorage under its store name", () => {
    useProjectStore.getState().setFolderProject("/repo/a", PROJECT_A);
    const raw = localStorage.getItem("agentic-project-store");
    expect(raw).toBeTruthy();
    expect(raw).toContain("/repo/a");
  });
});
