import type { JSX } from "react";
import { useState, useEffect } from "react";
import { useSettingsStore } from "../../store/settingsStore";
import { useDraggableWindow } from "../../hooks/useDraggableWindow";
import { useProjectNotesContext } from "./notes/useProjectNotesContext";
import { NotesToggleButton } from "./notes/NotesToggleButton";
import { NotesWindow } from "./notes/NotesWindow";

/**
 * Notes feature shell: owns the open/close state + window geometry, derives
 * the project-notes context, and composes the toggle button with the
 * portal-mounted floating window. All concern-specific logic lives in the
 * co-located `notes/` units.
 */
export function NotesPanel({
  variant = "header",
}: {
  variant?: "header" | "sidebar" | "dock";
}): JSX.Element {
  const [open, setOpen] = useState(false);

  const notesWindowSize = useSettingsStore((s) => s.notesWindowSize);
  const setNotesWindowSize = useSettingsStore((s) => s.setNotesWindowSize);
  const { pos, setPos, size, clamp, dragHandlers, resizeHandlers } =
    useDraggableWindow({
      initialSize: notesWindowSize,
      onResizeEnd: setNotesWindowSize,
    });

  const ctx = useProjectNotesContext(open);
  const { setFolderPickerOpen } = ctx;

  // Place the window near the top-right corner the first time it is opened.
  useEffect(() => {
    if (open && pos === null) {
      setPos(clamp({ x: window.innerWidth - size.w - 24, y: 72 }));
    }
  }, [open, pos, clamp, setPos, size.w]);

  // Escape closes the window (windowed behaviour — no click-outside-to-close,
  // so the window stays put while the user works elsewhere).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setOpen(false);
        setFolderPickerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setFolderPickerOpen]);

  const closeWindow = (): void => {
    setOpen(false);
    setFolderPickerOpen(false);
  };

  return (
    <>
      <NotesToggleButton
        variant={variant}
        open={open}
        hasAnyNotes={ctx.hasAnyNotes}
        onToggle={() => setOpen(!open)}
      />

      {open && (
        <NotesWindow
          ctx={ctx}
          pos={pos}
          size={size}
          dragHandlers={dragHandlers}
          resizeHandlers={resizeHandlers}
          onClose={closeWindow}
        />
      )}
    </>
  );
}
