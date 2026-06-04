import { useCallback, useRef } from "react";
import { useUIStore } from "../../../store/uiStore";

export interface UseResizeHandleReturn {
  containerRef: React.RefObject<HTMLDivElement>;
  handleResizeStart: (e: React.MouseEvent) => void;
}

export function useResizeHandle(): UseResizeHandleReturn {
  const setConfigPanelWidth = useUIStore((s) => s.setConfigPanelWidth);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current || !containerRef.current) return;
        const containerRect = containerRef.current.getBoundingClientRect();
        const newWidth = containerRect.right - ev.clientX;
        setConfigPanelWidth(newWidth);
      };

      const onMouseUp = () => {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [setConfigPanelWidth],
  );

  return { containerRef, handleResizeStart };
}
