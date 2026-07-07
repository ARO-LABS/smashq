import { useEffect, useCallback, useId, useRef, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DURATION, EASE } from "../../utils/motion";
import { ICONS, ICON_SIZE } from "../../utils/icons";
import { IconButton } from "./IconButton";

const CloseIcon = ICONS.action.close;

// Selector for all tabbable descendants used by the focus trap.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true");
}

// ============================================================================
// Types
// ============================================================================

export type ModalSize = "sm" | "md" | "lg" | "none";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  size?: ModalSize;
  className?: string;
}

// ============================================================================
// Styles
// ============================================================================

const sizeClasses: Record<ModalSize, string> = {
  sm: "w-full max-w-sm",
  md: "w-full max-w-md",
  lg: "w-full max-w-lg",
  none: "",
};

// ============================================================================
// Component
// ============================================================================

export function Modal({
  open,
  onClose,
  children,
  title,
  size = "md",
  className = "",
}: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Escape key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  // Focus trap: on open capture the previously focused element, move focus into
  // the dialog (first focusable descendant, else the dialog itself), and restore
  // focus to the captured element on close/cleanup.
  useEffect(() => {
    if (!open) return;
    const dialog = contentRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = getFocusable(dialog);
    (focusable[0] ?? dialog).focus();
    return () => previouslyFocused?.focus?.();
  }, [open]);

  // Trap Tab / Shift+Tab so focus cycles within the dialog (wrap last->first /
  // first->last) instead of escaping to the underlying page.
  const handleTabKey = useCallback((e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const dialog = contentRef.current;
    if (!dialog) return;
    const focusable = getFocusable(dialog);
    if (focusable.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", handleTabKey);
    return () => window.removeEventListener("keydown", handleTabKey);
  }, [open, handleTabKey]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Dialog */}
          <motion.div
            ref={contentRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title !== undefined ? titleId : undefined}
            tabIndex={-1}
            className={`relative flex flex-col bg-surface-raised rounded-lg shadow-modal focus:outline-none ${sizeClasses[size]} ${className}`}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: DURATION.fast, ease: EASE.out }}
          >
            {/* Header (optional) */}
            {title !== undefined && (
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700 shrink-0">
                <div id={titleId} className="flex-1 min-w-0">{title}</div>
                <IconButton
                  icon={<CloseIcon className={ICON_SIZE.close} />}
                  label="Schliessen"
                  onClick={onClose}
                />
              </div>
            )}

            {/* Content */}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
