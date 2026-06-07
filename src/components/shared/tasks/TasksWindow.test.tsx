import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TasksWindow } from "./TasksWindow";
import { useTasksStore } from "../../../store/tasksStore";
import type { TasksContext } from "./useTasksContext";

function makeCtx(): TasksContext {
  return {
    activeTab: "global",
    setActiveTab: vi.fn(),
    effectiveProjectKey: null,
    projectTabLabel: "Projekt",
    hasProjectContext: false,
    availableProjects: [{ key: null, label: "Global" }],
    addTask: vi.fn(() => "id"),
    updateTask: vi.fn(),
    completeTask: vi.fn(),
    reopenTask: vi.fn(),
    deleteTask: vi.fn(),
    openCountForProject: () => 0,
  };
}

describe("TasksWindow drag", () => {
  beforeEach(() => useTasksStore.setState({ tasks: [] }));

  it("starts a drag from the header but not from the tab buttons", () => {
    const onPointerDown = vi.fn();
    const dragHandlers = { onPointerDown } as never;
    const resizeHandlers = { onPointerDown: vi.fn() } as never;
    render(
      <TasksWindow
        ctx={makeCtx()}
        pos={{ x: 0, y: 0 }}
        size={{ w: 320, h: 360 }}
        dragHandlers={dragHandlers}
        resizeHandlers={resizeHandlers}
        onClose={vi.fn()}
      />,
    );
    // pointerDown on the global tab must NOT bubble to the drag handler
    fireEvent.pointerDown(screen.getByRole("button", { name: "Globale Aufgaben" }));
    expect(onPointerDown).not.toHaveBeenCalled();
    // pointerDown on the close button must NOT start a drag either
    fireEvent.pointerDown(screen.getByRole("button", { name: "Aufgaben schliessen" }));
    expect(onPointerDown).not.toHaveBeenCalled();
  });

  it("no longer renders the bottom-left move icon", () => {
    render(
      <TasksWindow
        ctx={makeCtx()}
        pos={{ x: 0, y: 0 }}
        size={{ w: 320, h: 360 }}
        dragHandlers={{ onPointerDown: vi.fn() } as never}
        resizeHandlers={{ onPointerDown: vi.fn() } as never}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Aufgaben-Fenster verschieben")).toBeNull();
  });

  it("header element carries the drag handler", () => {
    const onPointerDown = vi.fn();
    const dragHandlers = { onPointerDown } as never;
    render(
      <TasksWindow
        ctx={makeCtx()}
        pos={{ x: 0, y: 0 }}
        size={{ w: 320, h: 360 }}
        dragHandlers={dragHandlers}
        resizeHandlers={{ onPointerDown: vi.fn() } as never}
        onClose={vi.fn()}
      />,
    );
    // The dialog element is in document.body via portal; find the header
    const dialog = screen.getByRole("dialog", { name: "Aufgaben" });
    // Header is the first child of the dialog div
    const header = dialog.firstElementChild as HTMLElement;
    fireEvent.pointerDown(header);
    expect(onPointerDown).toHaveBeenCalledTimes(1);
  });
});
