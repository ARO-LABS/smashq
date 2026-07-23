import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConfigTasksViewer from "./ConfigTasksViewer";
import { useTasksStore } from "../../store/tasksStore";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const FOLDER = "C:\\Projekte\\smashq";
const KEY = "c:/projekte/smashq";

/** Tippt einen Wert ins Quick-Add-Feld und drückt danach eine Taste. */
function typeAndPress(input: HTMLElement, value: string, key: string): void {
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(undefined);
  useTasksStore.setState({ tasks: [] });
});

describe("ConfigTasksViewer", () => {
  it("renders open tasks of the panel project with header count", () => {
    useTasksStore.getState().addTask({ title: "Alpha", projectKey: KEY });
    useTasksStore.getState().addTask({ title: "Beta", projectKey: KEY });
    useTasksStore.getState().addTask({ title: "Fremd", projectKey: "c:/andere" });
    render(<ConfigTasksViewer folder={FOLDER} />);
    expect(screen.getByText("2 offene Aufgaben")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Fremd")).not.toBeInTheDocument();
  });

  it("quick-add creates a task for this project on Enter and clears the input", () => {
    render(<ConfigTasksViewer folder={FOLDER} />);
    const input = screen.getByPlaceholderText("Aufgabe hinzufügen …");
    typeAndPress(input, "Neue Aufgabe", "Enter");
    const tasks = useTasksStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Neue Aufgabe");
    expect(tasks[0].projectKey).toBe(KEY);
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("does not create a task for whitespace input (edge case)", () => {
    render(<ConfigTasksViewer folder={FOLDER} />);
    typeAndPress(screen.getByPlaceholderText("Aufgabe hinzufügen …"), "   ", "Enter");
    expect(useTasksStore.getState().tasks).toHaveLength(0);
  });

  it("checkbox completes the task; done section reopens it", () => {
    useTasksStore.getState().addTask({ title: "Alpha", projectKey: KEY });
    render(<ConfigTasksViewer folder={FOLDER} />);
    fireEvent.click(screen.getByRole("button", { name: "Aufgabe erledigen: Alpha" }));
    expect(useTasksStore.getState().tasks[0].status).toBe("done");
    fireEvent.click(screen.getByRole("button", { name: /Erledigt \(1\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Aufgabe wieder öffnen: Alpha" }));
    expect(useTasksStore.getState().tasks[0].status).toBe("open");
  });

  it("shows empty state with quick-add still visible and opens the big view", () => {
    render(<ConfigTasksViewer folder={FOLDER} />);
    expect(screen.getByText(/Keine offenen Aufgaben für dieses Projekt/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Aufgabe hinzufügen …")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aufgaben-View öffnen" }));
    expect(mockInvoke).toHaveBeenCalledWith("open_detached_window", {
      view: "tasks",
      title: "Aufgaben",
    });
  });

  it("shows subtask tally only when subtasks exist", () => {
    const id = useTasksStore.getState().addTask({ title: "Alpha", projectKey: KEY });
    useTasksStore.getState().addTask({ title: "Ohne", projectKey: KEY });
    useTasksStore.getState().updateTask(id, {
      subtasks: [
        { id: "s1", title: "a", done: true },
        { id: "s2", title: "b", done: false },
      ],
    });
    render(<ConfigTasksViewer folder={FOLDER} />);
    // Genau EIN Tally — die Aufgabe ohne Subtasks rendert keinen.
    expect(screen.getAllByText("1/2")).toHaveLength(1);
  });

  it("Escape clears the quick-add input without creating a task (edge case)", () => {
    render(<ConfigTasksViewer folder={FOLDER} />);
    const input = screen.getByPlaceholderText("Aufgabe hinzufügen …");
    typeAndPress(input, "Verworfen", "Escape");
    expect((input as HTMLInputElement).value).toBe("");
    expect(useTasksStore.getState().tasks).toHaveLength(0);
  });

  it("hides the done section entirely when no task is done", () => {
    useTasksStore.getState().addTask({ title: "Alpha", projectKey: KEY });
    render(<ConfigTasksViewer folder={FOLDER} />);
    expect(screen.queryByRole("button", { name: /Erledigt/ })).not.toBeInTheDocument();
  });
});
